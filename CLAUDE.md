# co-bord

Tableros colaborativos en tiempo real (flujos, documentos de diseño, retrospectivas), producto hermano de SparkyTC. La versión 0.4.0 está en `main`; 0.5.0 (Confluence) en desarrollo.

**Repositorio:** https://github.com/cesared19/co-bord.

**Idioma:** comunícate con el usuario en español. La interfaz, el README y los mensajes de commit van en inglés.

## Arquitectura

- **Servidor** (`server/`): Node 22 + TypeScript (ESM), Fastify 5, PostgreSQL con `pg`. Un solo proceso sirve la API (`/api/*`), el WebSocket de colaboración (`/collab`) y el cliente compilado (`CLIENT_DIR`, con fallback a `index.html`).
- **Migraciones:** lista `migrations` en `server/src/db.ts` (versión actual 0.0.4), tabla `schema_migrations`, con `pg_advisory_lock`. Nunca editar una migración publicada: agregar una nueva al final.
- **Colaboración:** cada tablero es un documento Yjs (nombre = id del tablero, UUID) sincronizado con Hocuspocus 4 (`server/src/collab.ts`, puente entre `@fastify/websocket` y `handleConnection`). Se guarda completo en `boards.document` (debounce 1.5 s, máx. 10 s) y al cerrar. La autenticación usa la cookie de sesión del handshake y rechaza otros orígenes. Los viewers se conectan en solo lectura (`connectionConfig.readOnly`).
- **Cliente** (`client/`): React 19, React Router 7 (modo librería, `BrowserRouter`), Tailwind 4 (variables `--color-brand-*` en `src/index.css`, modo oscuro con la clase `.dark`), Vite 7. Llamadas con `api()` (`src/lib/api.ts`), sesión en `AuthProvider` (`src/lib/auth.tsx`).
- **Lienzo propio** (`client/src/board`):
  - Modelo: `Y.Map('elements')`, id → objeto plano (`types.ts`: `shape`, `sticky`, `text`, `media`, `frame`, `connector`; `TextBox` son los que tienen texto, `BoxElement` todos los rectangulares). Cada cambio reemplaza el elemento completo (último gana). Orden por `z`, con los marcos siempre debajo (`drawOrder`).
  - `BoardStore` (`store.ts`): agregar, actualizar, borrar (los conectores enganchados quedan sueltos donde estaban), z-order, clonar. Transacciones con origen `LOCAL`; `Y.UndoManager` solo deshace lo propio; `checkpoint()` separa pasos de deshacer.
  - `geometry.ts`: caminos SVG de las formas, márgenes del texto, puntos de anclaje, rutas de conectores (recta, codo, curva), cámara (`screen = world * zoom + offset`).
  - `Canvas.tsx`: herramientas, arrastres (pan, mover, redimensionar, selección por recuadro, crear, conectar, extremos, pinch), atajos, portapapeles (eventos `copy`/`paste`, funcionan sin HTTPS), presencia (awareness: `user`, `cursor`, `selection`, `editing`). Elementos en HTML/SVG dentro de un contenedor transformado; selección y manijas en coordenadas de pantalla.
  - `useBoardDoc.ts`: el proveedor se crea en un efecto (`useBoardConnection`), no en render.
  - Marcos (`FrameView`): el área deja pasar los clics al tablero; se eligen y arrastran por el título (tamaño fijo en pantalla hasta 60 % de zoom). Mover, copiar, duplicar y empujar con flechas incluye lo que está completamente dentro (`withFrameContents`). La selección por recuadro solo toma un marco si lo cubre entero. Los conectores no se enganchan a marcos.
  - Plantillas (`templates.ts`): funciones que arman elementos con ids propios; se insertan con `store.clone` en espacio libre y la vista se ajusta a ellas.
  - SparkyTC (`sparky.ts`, `SparkyLinks.tsx`): los elementos rectangulares guardan `links` (`{ kind: case | section | plan, id, label }`; el id de un caso es su número). `useLinkResults` pide al servidor los resultados de todos los vínculos (cada minuto y al cambiar), y cada elemento muestra el peor estado (FAIL > BLOCKED > NOT_RUN > SKIP > PASS). Cobertura (`CoveragePanel`): pasos = formas y notas con texto del tablero o de un marco, en el orden del flujo (`flowOrder`: conectores y luego orden de lectura); cubierto = con al menos un vínculo; CSV con BOM.
  - Confluence (`confluence.ts`, `PublishDialog.tsx`): `media` de `kind` `confluence` guarda el id de la página en `src`; la tarjeta (`ConfluenceView`) la lee del servidor con el `projectId` de `BoardEnvContext`. Una dirección pegada solo se vuelve tarjeta si es del sitio conectado (`confluencePageId`). Publicar arma el PNG en el navegador (claro) y el reporte de cobertura (`useCoverage().report()`), y los manda en multipart.
  - Facilitación (`session.ts`, `Facilitation.tsx`): `Y.Map('session')` con `timer` y `voting`, y `Y.Map('votes')` con una clave por ronda y usuario (`${round}:${userId}`), así cada uno escribe solo la suya. Fuera del deshacer. El temporizador usa la hora del servidor (`serverNow`, desfase medido con `/api/health`). Mientras hay votación, el clic en un elemento vota en lugar de seleccionar.
  - `exportPng.ts`: dibuja el tablero en canvas (no usa foreignObject). Imágenes externas solo si permiten CORS; PDF subidos con su primera página; videos como tarjeta.
  - Embeds (`media.ts`, `MediaView.tsx`, `pdf.ts`, `upload.ts`): `media` con `kind` image, video, pdf, youtube, drive, vimeo o link. Las subidas guardan `assetId`; YouTube/Drive/Vimeo guardan solo el id y el iframe se arma con él (nunca un iframe con URL arbitraria); los enlaces pasan por `safeUrl` (solo http(s) o `/api/assets/`). Mientras no está seleccionado, el contenido tiene `pointer-events: none` (el clic selecciona); seleccionado, el contenido lleva `data-interactive` y el lienzo no captura el puntero ahí; se arrastra por la barra de título. pdf.js se carga bajo demanda (chunk aparte, worker con `?url`). Al insertar sin posición exacta se busca espacio libre (`freeSpot`).
- **Deploy:** `Dockerfile` (multi-stage, una imagen) + `docker-compose.yml` (Postgres 16 + app en `APP_PORT`, 3200 por defecto; en el servidor ya están SparkyTC en 3000 y 8080 y ProDash en 3100). Sin HTTPS todavía; `COOKIE_SECURE=true` cuando lo haya. `crypto.randomUUID` no existe sin HTTPS: usar `newId()` (`src/lib/id.ts`).

## Decisiones tomadas

- App separada de SparkyTC, en su propio repositorio.
- Licencia: propietaria, todos los derechos reservados (`LICENSE`, `"license": "UNLICENSED"` en los package.json). Revisar que las dependencias nuevas sigan siendo de licencia permisiva (MIT, Apache 2.0, BSD, ISC).
- Cuentas propias (admin inicial desde `/setup`; los admins crean usuarios y proyectos). Roles por proyecto: owner, editor, viewer; los admins actúan como owner en todo. Proyectos ajenos responden 404.
- Vínculo con SparkyTC (desde 0.4.0): **solo con un token por proyecto** de la API de integración de SparkyTC 2.2.0 (`/api/integration/v1`). No compartir sesiones ni usuarios con SparkyTC. Solo los admins conectan un proyecto (dirección de la API, dirección pública para los enlaces y token, en `projects.sparkytc_*`; el token cifrado con `SecretBox`, AES-256-GCM, clave `ENCRYPTION_KEY` o `DATA_DIR/encryption.key`). Los miembros leen a través de co-bord (`routes/sparkytc.ts`, caché de 15 s), nunca con el token. En el mismo servidor, co-bord se une a la red de Docker de SparkyTC con `docker-compose.sparkytc.yml` y usa `http://backend-service:8080`.
- Cobertura: un paso es una forma o nota con texto; está cubierto si tiene al menos un caso, sección o plan vinculado.
- Confluence (desde 0.5.0): **embeber páginas** como tarjetas y **publicar** el tablero o un marco con el PNG adjunto y el reporte de cobertura (no se toman requisitos desde Confluence). Credenciales **por proyecto**, solo admins (sitio, email, API token cifrado con `SecretBox`, espacio y página padre opcional en `projects.confluence_*`). `routes/confluence.ts`: API v2 para espacios y páginas (cuerpo en formato storage, versión + 1 al actualizar) y v1 para adjuntos (`X-Atlassian-Token: no-check`) y búsqueda CQL. `confluence_publications` recuerda la página de cada tablero o marco para actualizarla; si se borró en Confluence, se crea otra. Títulos repetidos responden 409. Tests contra un Confluence simulado (`test/fakeConfluence.ts`, también se corre con `npx tsx test/fakeConfluence.ts 8095`).
- Automatizaciones (fase 6): reglas de tarjetas, generar test cases o planes de SparkyTC desde el tablero, retro guiada y notificaciones.
- Archivos subidos (desde 0.2.0): en disco, en el volumen `app-data` (`DATA_DIR`, `server/src/storage.ts`), con la tabla `assets` (por proyecto; borrar un tablero no borra sus archivos porque las copias pueden usarlos, borrar el proyecto sí). Se descartó MinIO porque dejó de publicar imágenes y binarios libres; `FileStorage` permite cambiar a S3 más adelante. Se sirven en `/api/assets/:id` solo a miembros, con rangos HTTP, `nosniff` y CSP `sandbox`. Tipos permitidos en `ALLOWED_TYPES` (`routes/assets.ts`), límite `MAX_UPLOAD_MB`.

## Cómo trabajar

- **Antes de hacer push:**
  - Servidor: `cd server && npx tsc --noEmit -p . && npm test` (Vitest + Testcontainers con Postgres real; hoy son 11 tests, incluido uno de sincronización con dos clientes, uno de archivos y los de SparkyTC y Confluence con servidores simulados).
  - Cliente: `cd client && npx tsc -b && npm run lint && npm run build`. El lint debe quedar en 0 problemas.
- **Si Testcontainers no encuentra Docker:** inicia dockerd con `DOCKER_MIN_API_VERSION=1.24`. Si Docker Hub responde 429, baja la imagen de `mirror.gcr.io/library/...` y etiquétala con el nombre original.
- **Cambios de interfaz:** pruébalos de punta a punta con Playwright contra el build de producción servido por el servidor (`CLIENT_DIR=../client/dist`), con dos usuarios a la vez para lo colaborativo, en modo oscuro y a 390 px y 820 px.
- **Formato:** Prettier (`.prettierrc.json`: tabs, comillas simples, sin punto y coma, ancho 140): `npx prettier --write "server/src/**/*.ts" "client/src/**/*.{ts,tsx}"`.
- **Flujo de trabajo:** un PR por versión. El usuario decide cuándo abrir y cuándo fusionar el PR.
- **Versionado:** `version` en `server/package.json`, `client/package.json` y sus `package-lock.json`, y el README.
- **Al recibir una lista de trabajo:** proponer un orden (bugs primero) y preguntar lo que no quede claro antes de empezar.

## Plan

1. ~~Lienzo: formas de flujo, notas, texto, conectores, deshacer, exportar PNG~~ (0.1.0)
2. ~~Tiempo real: cursores, selecciones, cambios en vivo~~ (0.1.0, salvo "seguir a alguien")
3. ~~Embeds: imágenes, videos (YouTube, Drive, Vimeo, subidos) y PDF como bloques redimensionables~~ (0.2.0)
4. Plantillas: retrospectiva (columnas, votos, temporizador), workflow, documento de diseño; marcos (frames)
5. ~~SparkyTC (token por proyecto, bloques vinculados a casos/suites/planes con su último resultado, reporte de cobertura)~~ (0.4.0) ~~y Confluence (embeber y publicar)~~ (0.5.0)
6. Automatizaciones

## Pendientes conocidos

- Confluence: no se probó contra un Confluence Cloud real desde el entorno de desarrollo (sin acceso); verificar al conectarlo por primera vez.
- Más adelante: HTTPS, límite de intentos de inicio de sesión, ajuste a la cuadrícula y guías de alineación, minimapa, comentarios en el tablero, historial de versiones del tablero, redimensionar varios elementos a la vez, rotación.
- Un usuario quitado de un proyecto sigue conectado al tablero abierto hasta que recarga.
- Los archivos subidos que ya no usa ningún tablero no se borran (deshacer puede necesitarlos): falta una limpieza periódica.
- Pegar un elemento con archivo subido en un tablero de otro proyecto no funciona para quien no es miembro del proyecto original.
- La reproducción de videos y la página de los PDF no se sincronizan entre usuarios.

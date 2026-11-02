# co-bord

Collaborative boards for teams: flowcharts, design documents and retrospectives, with everyone's cursor and changes live on the same board.

![A board with a login flowchart, a sticky note and a teammate's cursor](./documentation/assets/board.png)

## Features (0.1.0)

### Boards

-  **Infinite canvas**: pan with the Hand tool, by holding Space, with the middle button, the trackpad or one finger on touch screens; zoom with Ctrl + wheel, a pinch or the zoom controls. **Fit** (Shift 1) shows everything, Shift 2 the selection.
-  **Sticky notes, text and shapes**: flowchart shapes (process, rounded, ellipse, decision, start / end, input / output, preparation, document, database, triangle). Click to add one at its default size, or drag to draw it. Double-click the board to write text anywhere.
-  **Connectors**: drag from a shape's **+** handles, or use the Connector tool, from one element to another. They stay attached when elements move, and can be straight, elbow or curved, with arrows, dashes, color, width and a label. Drag a connector's end to attach it somewhere else.
-  **Editing**: select with a click, Shift + click or a selection box; move, resize (Shift keeps the proportions; sticky notes always do), change colors, text size, bold and alignment from the toolbar above the selection, bring to front or send to back, duplicate (Ctrl D), copy and paste (also between boards), delete, and move with the arrow keys.
-  **Undo and redo** (Ctrl Z, Ctrl Shift Z) undo your own changes only, never a teammate's.
-  **Download as PNG** of the whole board.
-  Light, dark or system theme.

### Real time

-  Everyone on a board sees the others' changes as they happen, their cursors with their names, what each one has selected and who is typing where.
-  The avatars at the top show who is on the board; click one to go to their cursor.
-  If the connection drops, changes are kept and sent when it is back.

### Accounts and projects

-  **Own accounts**: on the first start co-bord asks for the admin account. Admins create the other accounts, reset passwords and create projects. Everyone changes their name and password in **Account**.
-  **Projects** hold boards and have members with a role: **Owner** (manages members, deletes boards), **Editor** (creates and edits boards) or **Viewer** (only looks). Projects a user is not in are hidden.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| V, H, N, T, S / R, L | Select, Hand, Sticky note, Text, Shape / Rectangle, Connector |
| Enter | Edit the text or label of the selected element |
| Esc | Finish editing, clear the selection |
| Delete, Backspace | Delete |
| Ctrl A, Ctrl D | Select all, duplicate |
| Ctrl C, Ctrl X, Ctrl V | Copy, cut, paste |
| Ctrl Z, Ctrl Shift Z / Ctrl Y | Undo, redo |
| Ctrl +, Ctrl -, Ctrl 0 | Zoom in, out, 100% |
| Shift 1, Shift 2 | Fit everything, fit the selection |

## Roadmap

1. ~~Boards with shapes, sticky notes, text and connectors~~ (0.1.0)
2. ~~Live cursors, selections and changes~~ (0.1.0)
3. Embedded images, videos (YouTube, Google Drive, uploaded) and PDFs as resizable blocks that play and page inside the board
4. Templates: retrospectives (columns, votes, timer), workflows and design documents
5. Links to SparkyTC (test cases, suites and plans with their latest results, per-project token) and test coverage; Confluence pages embedded as blocks, and boards published to Confluence
6. Automations: card rules (for example, create a Jira issue when a note moves to a column), generate SparkyTC test cases from a flow, guided retrospectives and notifications

## Running it

You need Docker with Docker Compose.

```bash
cp .env.example .env
```

Set `DB_PASSWORD` in `.env`, then:

```bash
docker compose up -d --build
```

co-bord is served on port 3200 (`APP_PORT`). Open it and create the admin account.

| Variable | Meaning |
| --- | --- |
| `DB_PASSWORD` | Password of the PostgreSQL user (required) |
| `APP_PORT` | Port on the host, 3200 by default |
| `COOKIE_SECURE` | `true` once co-bord is served over HTTPS |
| `SESSION_DAYS` | How long a sign-in lasts, 7 days by default |

To update, pull the new version and run `docker compose up -d --build` again; the database is migrated on start.

## Development

-  **Server** (`server/`): Node 22, TypeScript, Fastify and PostgreSQL. Boards are [Yjs](https://yjs.dev) documents synced over WebSocket by [Hocuspocus](https://tiptap.dev/docs/hocuspocus) at `/collab` and stored in `boards.document`.
-  **Client** (`client/`): React 19, React Router, Tailwind CSS 4 and Vite. The board canvas is our own (`client/src/board`).

```bash
docker run -d --name cobord-db -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=cobord -p 5432:5432 postgres:16-alpine
```

```bash
cd server && npm install && DATABASE_URL=postgres://postgres:pw@localhost:5432/cobord npm run dev
```

```bash
cd client && npm install && npm run dev
```

The client runs on http://localhost:5173 and sends `/api` and `/collab` to the server on port 8080.

Checks before pushing:

```bash
cd server && npm test
```

```bash
cd client && npx tsc -b && npm run lint && npm run build
```

The server tests start PostgreSQL with Testcontainers, so they need Docker.

## License

Copyright (c) 2026 César Eduardo Godoy Robles. All rights reserved. See [LICENSE](./LICENSE).

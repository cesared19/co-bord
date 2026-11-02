import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb, migrate } from './db.js'

const config = loadConfig()
const db = createDb(config.databaseUrl)
await migrate(db)
const { app } = await buildApp(config, db, { logger: true })
await app.listen({ port: config.port, host: '0.0.0.0' })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, async () => {
		await app.close()
		await db.end()
		process.exit(0)
	})
}

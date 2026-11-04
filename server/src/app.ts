import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify from 'fastify'
import { createCollab } from './collab.js'
import type { Config } from './config.js'
import type { Ctx } from './context.js'
import type { Db } from './db.js'
import { HttpError } from './errors.js'
import { assetRoutes } from './routes/assets.js'
import { authRoutes } from './routes/auth.js'
import { boardRoutes } from './routes/boards.js'
import { projectRoutes } from './routes/projects.js'
import { userRoutes } from './routes/users.js'
import { FileStorage } from './storage.js'
import { SecretBox } from './crypto.js'
import { sparkyRoutes } from './routes/sparkytc.js'
import { confluenceRoutes } from './routes/confluence.js'
import { notificationRoutes } from './routes/notifications.js'
import { retroRoutes } from './routes/retro.js'
import { RetroWriter } from './ai.js'
import { jiraRoutes } from './routes/jira.js'
import { ruleRoutes } from './routes/rules.js'
import { commentRoutes } from './routes/comments.js'
import { versionRoutes } from './routes/versions.js'

export async function buildApp(config: Config, db: Db, opts: { logger?: boolean; retroWriter?: RetroWriter } = {}) {
	const app = Fastify({ logger: opts.logger ?? false, disableRequestLogging: true, bodyLimit: 1024 * 1024 })
	const storage = new FileStorage(config.dataDir)
	await storage.init()
	const secrets = SecretBox.load(config.dataDir, config.encryptionKey)
	const ctx: Ctx = { db, config, storage, secrets }

	await app.register(fastifyCookie)
	await app.register(fastifyMultipart)
	await app.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 * 1024 } })

	app.setErrorHandler((error, req, reply) => {
		if (error instanceof HttpError) return reply.status(error.statusCode).send({ error: error.message })
		const status = (error as { statusCode?: number }).statusCode
		if (status && status < 500) return reply.status(status).send({ error: (error as Error).message })
		req.log.error(error)
		return reply.status(500).send({ error: 'Something went wrong' })
	})

	authRoutes(app, ctx)
	userRoutes(app, ctx)
	projectRoutes(app, ctx)
	boardRoutes(app, ctx)
	assetRoutes(app, ctx)
	sparkyRoutes(app, ctx)
	confluenceRoutes(app, ctx)
	notificationRoutes(app, ctx)
	retroRoutes(app, ctx, opts.retroWriter ?? new RetroWriter(config.anthropicApiKey))
	jiraRoutes(app, ctx)
	ruleRoutes(app, ctx)
	commentRoutes(app, ctx)
	versionRoutes(app, ctx)

	const collab = createCollab(ctx)
	app.get('/collab', { websocket: true }, (socket, req) => collab.handle(socket, req.raw))
	app.addHook('onClose', async () => collab.close())
	// links in Jira issues and test cases need the address people use, when PUBLIC_URL isn't set
	app.addHook('onRequest', async (req) => {
		const rules = collab.rules
		if (rules && !rules.baseUrl && req.url.startsWith('/api/') && req.headers.host) {
			const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http'
			rules.baseUrl = `${proto}://${req.headers.host}`
		}
	})

	// `now` lets clients line up their clock with the server's for the shared timer
	app.get('/api/health', async () => ({ ok: true, now: Date.now() }))

	// The built client, with every non-API path falling back to index.html.
	const clientDir = config.clientDir ? resolve(config.clientDir) : null
	if (clientDir && existsSync(join(clientDir, 'index.html'))) {
		await app.register(fastifyStatic, { root: clientDir, wildcard: false })
		app.setNotFoundHandler((req, reply) => {
			if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url === '/collab')
				return reply.status(404).send({ error: 'Not found' })
			return reply.sendFile('index.html')
		})
	} else {
		app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Not found' }))
	}

	return { app, ctx, collab }
}

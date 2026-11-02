import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createDb, type Db, migrate } from '../src/db.js'

export interface TestEnv {
	app: FastifyInstance
	db: Db
	url: string
	stop: () => Promise<void>
}

let container: StartedPostgreSqlContainer | null = null

export async function startEnv(): Promise<TestEnv> {
	container ??= await new PostgreSqlContainer('postgres:16-alpine').start()
	const db = createDb(container.getConnectionUri())
	await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
	await migrate(db)
	const { app } = await buildApp(
		{ port: 0, databaseUrl: container.getConnectionUri(), cookieSecure: false, sessionDays: 7, clientDir: null },
		db,
	)
	const url = await app.listen({ port: 0, host: '127.0.0.1' })
	return {
		app,
		db,
		url,
		stop: async () => {
			await app.close()
			await db.end()
		},
	}
}

/** A tiny client that keeps the session cookie, like a browser. */
export class Client {
	cookie = ''
	constructor(private env: TestEnv) {}

	async call(method: string, path: string, body?: unknown) {
		const res = await this.env.app.inject({
			method: method as 'GET',
			url: path,
			headers: this.cookie ? { cookie: this.cookie } : {},
			payload: body as object,
		})
		const setCookie = res.headers['set-cookie']
		const first = Array.isArray(setCookie) ? setCookie[0] : setCookie
		if (first) this.cookie = first.split(';')[0]
		return { status: res.statusCode, body: res.json() }
	}

	get = (path: string) => this.call('GET', path)
	post = (path: string, body: unknown = {}) => this.call('POST', path, body)
	put = (path: string, body: unknown) => this.call('PUT', path, body)
	delete = (path: string) => this.call('DELETE', path)
}

export async function setupAdmin(env: TestEnv) {
	const admin = new Client(env)
	const res = await admin.post('/api/setup', { username: 'admin', displayName: 'Admin', password: 'password123' })
	if (res.status !== 200) throw new Error(JSON.stringify(res.body))
	return admin
}

export async function createUser(env: TestEnv, admin: Client, username: string) {
	const res = await admin.post('/api/users', { username, displayName: username.toUpperCase(), password: 'password123' })
	if (res.status !== 200) throw new Error(JSON.stringify(res.body))
	const client = new Client(env)
	await client.post('/api/auth/login', { username, password: 'password123' })
	return { client, id: res.body.user.id as number }
}

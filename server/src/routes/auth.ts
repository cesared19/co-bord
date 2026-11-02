import type { FastifyInstance } from 'fastify'
import {
	createSession,
	deleteSession,
	hashPassword,
	hashToken,
	pickColor,
	SESSION_COOKIE,
	toUser,
	USER_COLUMNS,
	verifyPassword,
} from '../auth.js'
import { type Ctx, requireUser, setSessionCookie } from '../context.js'
import { badRequest, conflict, HttpError } from '../errors.js'
import { asBody, str } from '../validate.js'

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/

export function checkUsername(username: string) {
	if (!USERNAME_PATTERN.test(username)) throw badRequest('Username must have 3 to 40 letters, numbers, dots, dashes or underscores')
}

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	app.get('/api/setup', async () => {
		const { rows } = await db.query<{ count: string }>('SELECT count(*) FROM users')
		return { needsSetup: rows[0].count === '0' }
	})

	/** Creates the first admin account; only works while there are no users. */
	app.post('/api/setup', async (req, reply) => {
		const body = asBody(req.body)
		const username = str(body, 'username', { min: 1 })
		checkUsername(username)
		const displayName = str(body, 'displayName', { min: 1, max: 80 })
		const password = str(body, 'password', { min: 8, max: 200 })
		const hash = await hashPassword(password)
		const client = await db.connect()
		let userId: number
		try {
			await client.query('BEGIN')
			await client.query('LOCK TABLE users IN EXCLUSIVE MODE')
			const { rows } = await client.query<{ count: string }>('SELECT count(*) FROM users')
			if (rows[0].count !== '0') throw conflict('Setup is already done')
			const inserted = await client.query<{ id: number }>(
				`INSERT INTO users (username, display_name, password_hash, is_admin, color) VALUES ($1, $2, $3, TRUE, $4) RETURNING id`,
				[username, displayName, hash, pickColor(0)],
			)
			userId = inserted.rows[0].id
			await client.query('COMMIT')
		} catch (e) {
			await client.query('ROLLBACK')
			throw e
		} finally {
			client.release()
		}
		const session = await createSession(db, userId, ctx.config.sessionDays)
		setSessionCookie(ctx, reply, session.token, session.expiresAt)
		return { ok: true }
	})

	app.post('/api/auth/login', async (req, reply) => {
		const body = asBody(req.body)
		const username = str(body, 'username', { min: 1 })
		const password = str(body, 'password', { min: 1 })
		const { rows } = await db.query<{ id: number; password_hash: string }>(
			'SELECT id, password_hash FROM users WHERE lower(username) = lower($1)',
			[username],
		)
		const ok = rows[0] ? await verifyPassword(password, rows[0].password_hash) : false
		if (!ok) throw new HttpError(401, 'Wrong username or password')
		const session = await createSession(db, rows[0].id, ctx.config.sessionDays)
		setSessionCookie(ctx, reply, session.token, session.expiresAt)
		return { ok: true }
	})

	app.post('/api/auth/logout', async (req, reply) => {
		const token = req.cookies[SESSION_COOKIE]
		if (token) await deleteSession(db, token)
		reply.clearCookie(SESSION_COOKIE, { path: '/' })
		return { ok: true }
	})

	app.get('/api/auth/me', async (req) => {
		return { user: await requireUser(ctx, req) }
	})

	app.put('/api/account', async (req) => {
		const user = await requireUser(ctx, req)
		const displayName = str(asBody(req.body), 'displayName', { min: 1, max: 80 })
		const { rows } = await db.query(`UPDATE users u SET display_name = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`, [user.id, displayName])
		return { user: toUser(rows[0]) }
	})

	app.put('/api/account/password', async (req) => {
		const user = await requireUser(ctx, req)
		const body = asBody(req.body)
		const current = str(body, 'currentPassword', { min: 1 })
		const next = str(body, 'newPassword', { min: 8, max: 200 })
		const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id])
		if (!(await verifyPassword(current, rows[0].password_hash))) throw badRequest('The current password is wrong')
		await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(next)])
		const token = req.cookies[SESSION_COOKIE]
		await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, hashToken(token ?? '')])
		return { ok: true }
	})
}

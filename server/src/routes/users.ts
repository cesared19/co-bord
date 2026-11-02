import type { FastifyInstance } from 'fastify'
import { hashPassword, pickColor, toUser, USER_COLUMNS } from '../auth.js'
import { type Ctx, requireAdmin, requireUser } from '../context.js'
import { badRequest, conflict, notFound } from '../errors.js'
import { asBody, bool, intParam, str } from '../validate.js'
import { checkUsername } from './auth.js'

export function userRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	/** Everyone signed in can see names, to add members and show who edited what. */
	app.get('/api/users/directory', async (req) => {
		await requireUser(ctx, req)
		const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users u ORDER BY lower(u.display_name)`)
		return { users: rows.map(toUser).map(({ id, username, displayName, color }) => ({ id, username, displayName, color })) }
	})

	app.get('/api/users', async (req) => {
		await requireAdmin(ctx, req)
		const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users u ORDER BY lower(u.username)`)
		return { users: rows.map(toUser) }
	})

	app.post('/api/users', async (req) => {
		await requireAdmin(ctx, req)
		const body = asBody(req.body)
		const username = str(body, 'username', { min: 1 })
		checkUsername(username)
		const displayName = str(body, 'displayName', { min: 1, max: 80 })
		const password = str(body, 'password', { min: 8, max: 200 })
		const isAdmin = bool(body, 'isAdmin') ?? false
		const exists = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])
		if (exists.rowCount) throw conflict('That username is taken')
		const { rows: seq } = await db.query<{ n: string }>('SELECT count(*) AS n FROM users')
		const { rows } = await db.query(
			`INSERT INTO users AS u (username, display_name, password_hash, is_admin, color) VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLUMNS}`,
			[username, displayName, await hashPassword(password), isAdmin, pickColor(Number(seq[0].n))],
		)
		return { user: toUser(rows[0]) }
	})

	app.put<{ Params: { id: string } }>('/api/users/:id', async (req) => {
		const admin = await requireAdmin(ctx, req)
		const id = intParam(req.params.id)
		const body = asBody(req.body)
		const displayName = str(body, 'displayName', { min: 1, max: 80, optional: true })
		const isAdmin = bool(body, 'isAdmin')
		if (id === admin.id && isAdmin === false) throw badRequest('You cannot remove your own admin role')
		const { rows } = await db.query(
			`UPDATE users u SET display_name = COALESCE($2, display_name), is_admin = COALESCE($3, is_admin) WHERE id = $1 RETURNING ${USER_COLUMNS}`,
			[id, displayName ?? null, isAdmin ?? null],
		)
		if (!rows[0]) throw notFound('User not found')
		return { user: toUser(rows[0]) }
	})

	app.put<{ Params: { id: string } }>('/api/users/:id/password', async (req) => {
		await requireAdmin(ctx, req)
		const id = intParam(req.params.id)
		const password = str(asBody(req.body), 'password', { min: 8, max: 200 })
		const result = await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await hashPassword(password)])
		if (!result.rowCount) throw notFound('User not found')
		await db.query('DELETE FROM sessions WHERE user_id = $1', [id])
		return { ok: true }
	})

	app.delete<{ Params: { id: string } }>('/api/users/:id', async (req) => {
		const admin = await requireAdmin(ctx, req)
		const id = intParam(req.params.id)
		if (id === admin.id) throw badRequest('You cannot delete your own account')
		const result = await db.query('DELETE FROM users WHERE id = $1', [id])
		if (!result.rowCount) throw notFound('User not found')
		return { ok: true }
	})
}

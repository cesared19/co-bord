import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess, requireProjectRole } from '../access.js'
import { type Ctx, requireUser } from '../context.js'
import { forbidden, notFound } from '../errors.js'
import { asBody, intParam, isUuid, str } from '../validate.js'

const BOARD_COLUMNS = `b.id, b.project_id, b.name, b.created_at, b.updated_at,
	cu.display_name AS created_by_name, uu.display_name AS updated_by_name`
const BOARD_FROM = 'boards b LEFT JOIN users cu ON cu.id = b.created_by LEFT JOIN users uu ON uu.id = b.updated_by'

// rows from pg are untyped
const toBoard = (r: any) => ({
	id: r.id,
	projectId: r.project_id,
	name: r.name,
	createdAt: r.created_at,
	updatedAt: r.updated_at,
	createdByName: r.created_by_name,
	updatedByName: r.updated_by_name,
})

export function boardRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	function boardId(raw: string) {
		if (!isUuid(raw)) throw notFound('Board not found')
		return raw
	}

	app.get<{ Params: { id: string } }>('/api/projects/:id/boards', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const { rows } = await db.query(`SELECT ${BOARD_COLUMNS} FROM ${BOARD_FROM} WHERE b.project_id = $1 ORDER BY b.updated_at DESC`, [
			projectId,
		])
		return { boards: rows.map(toBoard) }
	})

	app.post<{ Params: { id: string } }>('/api/projects/:id/boards', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'editor')
		const name = str(asBody(req.body), 'name', { min: 1, max: 120 })
		const { rows } = await db.query<{ id: string }>(
			'INSERT INTO boards (project_id, name, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id',
			[projectId, name, user.id],
		)
		const board = await db.query(`SELECT ${BOARD_COLUMNS} FROM ${BOARD_FROM} WHERE b.id = $1`, [rows[0].id])
		return { board: toBoard(board.rows[0]) }
	})

	app.get<{ Params: { id: string } }>('/api/boards/:id', async (req) => {
		const user = await requireUser(ctx, req)
		const id = boardId(req.params.id)
		const access = await boardAccess(db, user, id)
		const { rows } = await db.query(
			`SELECT ${BOARD_COLUMNS}, p.name AS project_name FROM ${BOARD_FROM} JOIN projects p ON p.id = b.project_id WHERE b.id = $1`,
			[id],
		)
		return { board: { ...toBoard(rows[0]), projectName: rows[0].project_name, role: access.role } }
	})

	app.put<{ Params: { id: string } }>('/api/boards/:id', async (req) => {
		const user = await requireUser(ctx, req)
		const id = boardId(req.params.id)
		const access = await boardAccess(db, user, id)
		if (!atLeast(access.role, 'editor')) throw forbidden()
		const name = str(asBody(req.body), 'name', { min: 1, max: 120 })
		await db.query('UPDATE boards SET name = $2, updated_by = $3, updated_at = now() WHERE id = $1', [id, name, user.id])
		return { ok: true }
	})

	app.delete<{ Params: { id: string } }>('/api/boards/:id', async (req) => {
		const user = await requireUser(ctx, req)
		const id = boardId(req.params.id)
		const access = await boardAccess(db, user, id)
		if (!atLeast(access.role, 'owner')) throw forbidden('Only project owners can delete boards')
		await db.query('DELETE FROM boards WHERE id = $1', [id])
		ctx.onBoardDeleted?.(id)
		return { ok: true }
	})

	app.post<{ Params: { id: string } }>('/api/boards/:id/duplicate', async (req) => {
		const user = await requireUser(ctx, req)
		const id = boardId(req.params.id)
		const access = await boardAccess(db, user, id)
		if (!atLeast(access.role, 'editor')) throw forbidden()
		await ctx.flushBoard?.(id)
		const { rows } = await db.query<{ id: string }>(
			`INSERT INTO boards (project_id, name, document, created_by, updated_by)
			SELECT project_id, name || ' (copy)', document, $2, $2 FROM boards WHERE id = $1 RETURNING id`,
			[id, user.id],
		)
		const board = await db.query(`SELECT ${BOARD_COLUMNS} FROM ${BOARD_FROM} WHERE b.id = $1`, [rows[0].id])
		return { board: toBoard(board.rows[0]) }
	})
}

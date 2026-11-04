import type { FastifyInstance } from 'fastify'
import * as Y from 'yjs'
import { atLeast, boardAccess } from '../access.js'
import { type Ctx, requireUser } from '../context.js'
import { forbidden, HttpError, notFound } from '../errors.js'
import { asBody, intParam, isUuid, str } from '../validate.js'

/**
 * Saved states of a board: automatic ones every 10 minutes of editing (kept 30 days) and named ones (kept).
 * Everyone sees them; editors save, name and restore. Restoring first saves the current state.
 */
export function versionRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	async function access(req: Parameters<typeof requireUser>[1], boardId: string, needed: 'viewer' | 'editor') {
		const user = await requireUser(ctx, req)
		if (!isUuid(boardId)) throw notFound('Board not found')
		const a = await boardAccess(db, user, boardId)
		if (!atLeast(a.role, needed)) throw forbidden('Only editors can do this')
		return user
	}

	/** The board as it is now: the live document when open, else the stored one. */
	async function current(boardId: string): Promise<Buffer> {
		await ctx.flushBoard?.(boardId)
		const { rows } = await db.query<{ document: Buffer | null }>('SELECT document FROM boards WHERE id = $1', [boardId])
		return rows[0]?.document ?? Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))
	}

	app.get<{ Params: { id: string } }>('/api/boards/:id/versions', async (req) => {
		await access(req, req.params.id, 'viewer')
		const { rows } = await db.query(
			`SELECT v.id, v.name, v.auto, v.created_at, length(v.document) AS size, u.display_name AS created_by
			FROM board_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.board_id = $1 ORDER BY v.created_at DESC, v.id DESC LIMIT 300`,
			[req.params.id],
		)
		return {
			versions: rows.map((r) => ({ id: r.id, name: r.name, auto: r.auto, createdAt: r.created_at, createdBy: r.created_by, size: r.size })),
		}
	})

	/** The saved document, for previews. */
	app.get<{ Params: { id: string; versionId: string } }>('/api/boards/:id/versions/:versionId', async (req, reply) => {
		await access(req, req.params.id, 'viewer')
		const { rows } = await db.query<{ document: Buffer }>('SELECT document FROM board_versions WHERE id = $1 AND board_id = $2', [
			intParam(req.params.versionId),
			req.params.id,
		])
		if (!rows[0]) throw notFound('Version not found')
		return reply.header('Content-Type', 'application/octet-stream').header('Cache-Control', 'private, max-age=86400').send(rows[0].document)
	})

	/** Saves the board as it is now, with a name. */
	app.post<{ Params: { id: string } }>('/api/boards/:id/versions', async (req) => {
		const user = await access(req, req.params.id, 'editor')
		const name = str(asBody(req.body), 'name', { min: 1, max: 200 })
		const { rows } = await db.query<{ id: number }>(
			'INSERT INTO board_versions (board_id, name, auto, document, created_by) VALUES ($1, $2, FALSE, $3, $4) RETURNING id',
			[req.params.id, name, await current(req.params.id), user.id],
		)
		return { id: rows[0].id }
	})

	/** Names a version (an automatic one is then kept), or renames it. */
	app.put<{ Params: { id: string; versionId: string } }>('/api/boards/:id/versions/:versionId', async (req) => {
		await access(req, req.params.id, 'editor')
		const name = str(asBody(req.body), 'name', { min: 1, max: 200 })
		const { rowCount } = await db.query('UPDATE board_versions SET name = $3, auto = FALSE WHERE id = $1 AND board_id = $2', [
			intParam(req.params.versionId),
			req.params.id,
			name,
		])
		if (!rowCount) throw notFound('Version not found')
		return { ok: true }
	})

	app.delete<{ Params: { id: string; versionId: string } }>('/api/boards/:id/versions/:versionId', async (req) => {
		await access(req, req.params.id, 'editor')
		const { rowCount } = await db.query('DELETE FROM board_versions WHERE id = $1 AND board_id = $2', [
			intParam(req.params.versionId),
			req.params.id,
		])
		if (!rowCount) throw notFound('Version not found')
		return { ok: true }
	})

	/** Puts the board back as it was in a version, after saving how it is now. Everyone sees the change live. */
	app.post<{ Params: { id: string; versionId: string } }>('/api/boards/:id/versions/:versionId/restore', async (req) => {
		const user = await access(req, req.params.id, 'editor')
		const { rows } = await db.query<{ document: Buffer; name: string | null; created_at: Date }>(
			'SELECT document, name, created_at FROM board_versions WHERE id = $1 AND board_id = $2',
			[intParam(req.params.versionId), req.params.id],
		)
		if (!rows[0]) throw notFound('Version not found')
		if (!ctx.restoreBoard) throw new HttpError(503, 'Not ready')
		const label = rows[0].name ?? rows[0].created_at.toISOString().slice(0, 16).replace('T', ' ')
		const { rows: saved } = await db.query<{ id: number }>(
			'INSERT INTO board_versions (board_id, name, auto, document, created_by) VALUES ($1, $2, FALSE, $3, $4) RETURNING id',
			[req.params.id, `Before restoring ${label}`.slice(0, 200), await current(req.params.id), user.id],
		)
		const version = new Y.Doc()
		Y.applyUpdate(version, new Uint8Array(rows[0].document))
		await ctx.restoreBoard(req.params.id, version, user.id)
		return { ok: true, savedId: saved[0].id }
	})
}

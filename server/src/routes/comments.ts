import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess } from '../access.js'
import { type Ctx, requireUser } from '../context.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { mentionsIn } from '../notify.js'
import { asBody, bool, intParam, isUuid, str } from '../validate.js'

const ID = /^[\w-]{1,64}$/

/**
 * Comment threads on a board, on an element or at a point. Everyone who can open the board comments, viewers
 * too; mentions and replies notify people; threads are resolved and reopened by anyone.
 */
export function commentRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	async function access(req: Parameters<typeof requireUser>[1], boardId: string) {
		const user = await requireUser(ctx, req)
		if (!isUuid(boardId)) throw notFound('Board not found')
		return { user, ...(await boardAccess(db, user, boardId)) }
	}

	const changed = (boardId: string) => ctx.broadcastBoard?.(boardId, 'comments')

	const text = (body: Record<string, unknown>) => {
		const value = str(body, 'text', { min: 1, max: 5000 })
		return value
	}

	/** Notifies people mentioned in a comment, and the others in the thread. */
	async function notify(projectId: number, boardId: string, threadId: number, authorId: number, body: string) {
		const line = body.replace(/\s+/g, ' ').trim().slice(0, 200)
		const mentioned = [...mentionsIn({ text: body })]
		await db.query(
			`INSERT INTO notifications (user_id, kind, board_id, element_id, actor_id, text)
			SELECT u.id, 'comment', $2, $3, $4, $5 FROM users u
			WHERE u.id <> $4 AND (u.is_admin OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = u.id))
				AND ((lower(u.username) = ANY($6) AND u.notify_mentions)
					OR (u.notify_follows AND EXISTS (SELECT 1 FROM comments c WHERE c.thread_id = $7 AND c.user_id = u.id)))`,
			[projectId, boardId, `comment:${threadId}`, authorId, line, mentioned, threadId],
		)
	}

	app.get<{ Params: { id: string } }>('/api/boards/:id/comments', async (req) => {
		await access(req, req.params.id)
		const { rows: threads } = await db.query(
			`SELECT t.*, r.display_name AS resolved_by_name FROM comment_threads t LEFT JOIN users r ON r.id = t.resolved_by
			WHERE t.board_id = $1 ORDER BY t.id`,
			[req.params.id],
		)
		const { rows: comments } = await db.query(
			`SELECT c.*, u.display_name, u.color, u.username FROM comments c JOIN comment_threads t ON t.id = c.thread_id
			LEFT JOIN users u ON u.id = c.user_id WHERE t.board_id = $1 ORDER BY c.id`,
			[req.params.id],
		)
		return {
			threads: threads.map((t) => ({
				id: t.id,
				elementId: t.element_id,
				x: t.x,
				y: t.y,
				createdAt: t.created_at,
				resolvedAt: t.resolved_at,
				resolvedBy: t.resolved_by_name,
				comments: comments
					.filter((c) => c.thread_id === t.id)
					.map((c) => ({
						id: c.id,
						userId: c.user_id,
						author: c.display_name ?? 'Deleted user',
						username: c.username,
						color: c.color ?? '#9ca3af',
						text: c.text,
						createdAt: c.created_at,
						editedAt: c.edited_at,
					})),
			})),
		}
	})

	/** Starts a thread on an element (x, y from its top left corner) or at a point of the board. */
	app.post<{ Params: { id: string } }>('/api/boards/:id/comments', async (req) => {
		const a = await access(req, req.params.id)
		const body = asBody(req.body)
		const elementId = body.elementId === undefined || body.elementId === null ? null : String(body.elementId)
		if (elementId !== null && !ID.test(elementId)) throw badRequest('Invalid element')
		const x = Number(body.x)
		const y = Number(body.y)
		if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) throw badRequest('Invalid position')
		const first = text(body)
		const { rows } = await db.query<{ id: number }>(
			'INSERT INTO comment_threads (board_id, element_id, x, y, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
			[req.params.id, elementId, x, y, a.user.id],
		)
		await db.query('INSERT INTO comments (thread_id, user_id, text) VALUES ($1, $2, $3)', [rows[0].id, a.user.id, first])
		await notify(a.projectId, req.params.id, rows[0].id, a.user.id, first)
		changed(req.params.id)
		return { id: rows[0].id }
	})

	async function thread(boardId: string, threadId: number) {
		const { rows } = await db.query('SELECT * FROM comment_threads WHERE id = $1 AND board_id = $2', [threadId, boardId])
		if (!rows[0]) throw notFound('Comment not found')
		return rows[0]
	}

	app.post<{ Params: { id: string; threadId: string } }>('/api/boards/:id/comments/:threadId/replies', async (req) => {
		const a = await access(req, req.params.id)
		const t = await thread(req.params.id, intParam(req.params.threadId))
		const reply = text(asBody(req.body))
		const { rows } = await db.query<{ id: number }>('INSERT INTO comments (thread_id, user_id, text) VALUES ($1, $2, $3) RETURNING id', [
			t.id,
			a.user.id,
			reply,
		])
		// replying to a resolved thread opens it again
		await db.query('UPDATE comment_threads SET resolved_at = NULL, resolved_by = NULL WHERE id = $1', [t.id])
		await notify(a.projectId, req.params.id, t.id, a.user.id, reply)
		changed(req.params.id)
		return { id: rows[0].id }
	})

	/** Resolves or reopens a thread, or moves it (x, y) when dragged. */
	app.put<{ Params: { id: string; threadId: string } }>('/api/boards/:id/comments/:threadId', async (req) => {
		const a = await access(req, req.params.id)
		const t = await thread(req.params.id, intParam(req.params.threadId))
		const body = asBody(req.body)
		const resolved = bool(body, 'resolved')
		if (resolved !== undefined)
			await db.query('UPDATE comment_threads SET resolved_at = $2, resolved_by = $3 WHERE id = $1', [
				t.id,
				resolved ? new Date() : null,
				resolved ? a.user.id : null,
			])
		changed(req.params.id)
		return { ok: true }
	})

	/** Authors edit their comments. */
	app.put<{ Params: { id: string; commentId: string } }>('/api/boards/:id/comment-items/:commentId', async (req) => {
		const a = await access(req, req.params.id)
		const { rows } = await db.query(
			'SELECT c.user_id FROM comments c JOIN comment_threads t ON t.id = c.thread_id WHERE c.id = $1 AND t.board_id = $2',
			[intParam(req.params.commentId), req.params.id],
		)
		if (!rows[0]) throw notFound('Comment not found')
		if (rows[0].user_id !== a.user.id) throw forbidden('Only the author can edit a comment')
		await db.query('UPDATE comments SET text = $2, edited_at = now() WHERE id = $1', [
			intParam(req.params.commentId),
			text(asBody(req.body)),
		])
		changed(req.params.id)
		return { ok: true }
	})

	/** Authors, and the board's editors, delete comments; deleting the first one deletes the thread. */
	app.delete<{ Params: { id: string; commentId: string } }>('/api/boards/:id/comment-items/:commentId', async (req) => {
		const a = await access(req, req.params.id)
		const commentId = intParam(req.params.commentId)
		const { rows } = await db.query(
			`SELECT c.user_id, c.thread_id, (SELECT min(id) FROM comments WHERE thread_id = c.thread_id) AS first_id
			FROM comments c JOIN comment_threads t ON t.id = c.thread_id WHERE c.id = $1 AND t.board_id = $2`,
			[commentId, req.params.id],
		)
		if (!rows[0]) throw notFound('Comment not found')
		if (rows[0].user_id !== a.user.id && !atLeast(a.role, 'editor')) throw forbidden('Only the author or an editor can delete a comment')
		if (rows[0].first_id === commentId) await db.query('DELETE FROM comment_threads WHERE id = $1', [rows[0].thread_id])
		else await db.query('DELETE FROM comments WHERE id = $1', [commentId])
		changed(req.params.id)
		return { ok: true }
	})
}

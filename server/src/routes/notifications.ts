import type { FastifyInstance } from 'fastify'
import { boardAccess } from '../access.js'
import { type Ctx, requireUser } from '../context.js'
import { badRequest, notFound } from '../errors.js'
import { asBody, bool, isUuid, str } from '../validate.js'

/** The bell: notifications of the signed-in user, what they follow, and which notifications they want. */
export function notificationRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	app.get('/api/notifications', async (req) => {
		const user = await requireUser(ctx, req)
		// only about boards they can still open
		const { rows } = await db.query(
			`SELECT n.id, n.kind, n.board_id, n.element_id, n.text, n.count, n.created_at, n.updated_at, n.read_at,
				b.name AS board_name, p.name AS project_name, a.display_name AS actor_name, a.color AS actor_color
			FROM notifications n
			LEFT JOIN boards b ON b.id = n.board_id
			LEFT JOIN projects p ON p.id = b.project_id
			LEFT JOIN users a ON a.id = n.actor_id
			WHERE n.user_id = $1
				AND (n.board_id IS NULL OR $2 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = b.project_id AND m.user_id = $1))
			ORDER BY n.updated_at DESC LIMIT 50`,
			[user.id, user.isAdmin],
		)
		const unread = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [
			user.id,
		])
		return {
			unread: unread.rows[0].n,
			notifications: rows.map((r) => ({
				id: r.id,
				kind: r.kind,
				boardId: r.board_id,
				boardName: r.board_name,
				projectName: r.project_name,
				elementId: r.element_id,
				actor: r.actor_name ? { name: r.actor_name, color: r.actor_color } : null,
				text: r.text,
				count: r.count,
				createdAt: r.created_at,
				updatedAt: r.updated_at,
				read: !!r.read_at,
			})),
		}
	})

	/** Marks the given notifications, or all of them, as read. */
	app.post('/api/notifications/read', async (req) => {
		const user = await requireUser(ctx, req)
		const body = asBody(req.body)
		if (body.all === true) {
			await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [user.id])
			return { ok: true }
		}
		const ids = body.ids
		if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => Number.isInteger(i))) throw badRequest('ids must be a list of numbers')
		await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL', [user.id, ids])
		return { ok: true }
	})

	/** Deletes the notifications already read. */
	app.delete('/api/notifications/read', async (req) => {
		const user = await requireUser(ctx, req)
		await db.query('DELETE FROM notifications WHERE user_id = $1 AND read_at IS NOT NULL', [user.id])
		return { ok: true }
	})

	app.get('/api/account/notifications', async (req) => {
		const user = await requireUser(ctx, req)
		const { rows } = await db.query('SELECT notify_mentions, notify_follows, notify_rules FROM users WHERE id = $1', [user.id])
		return { mentions: rows[0].notify_mentions, follows: rows[0].notify_follows, rules: rows[0].notify_rules }
	})

	app.put('/api/account/notifications', async (req) => {
		const user = await requireUser(ctx, req)
		const body = asBody(req.body)
		const { rows } = await db.query(
			`UPDATE users SET notify_mentions = COALESCE($2, notify_mentions), notify_follows = COALESCE($3, notify_follows),
			notify_rules = COALESCE($4, notify_rules) WHERE id = $1 RETURNING notify_mentions, notify_follows, notify_rules`,
			[user.id, bool(body, 'mentions') ?? null, bool(body, 'follows') ?? null, bool(body, 'rules') ?? null],
		)
		return { mentions: rows[0].notify_mentions, follows: rows[0].notify_follows, rules: rows[0].notify_rules }
	})

	app.get<{ Params: { id: string } }>('/api/boards/:id/follows', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		await boardAccess(db, user, req.params.id)
		const { rows } = await db.query<{ element_id: string }>('SELECT element_id FROM follows WHERE user_id = $1 AND board_id = $2', [
			user.id,
			req.params.id,
		])
		return { board: rows.some((r) => r.element_id === ''), elements: rows.filter((r) => r.element_id).map((r) => r.element_id) }
	})

	/** Follows or stops following the board (no elementId) or one of its elements. Viewers can follow too. */
	app.put<{ Params: { id: string } }>('/api/boards/:id/follows', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		await boardAccess(db, user, req.params.id)
		const body = asBody(req.body)
		const elementId = str(body, 'elementId', { max: 64, optional: true }) ?? ''
		const follow = bool(body, 'follow')
		if (follow === undefined) throw badRequest('follow is required')
		if (follow)
			await db.query('INSERT INTO follows (user_id, board_id, element_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
				user.id,
				req.params.id,
				elementId,
			])
		else await db.query('DELETE FROM follows WHERE user_id = $1 AND board_id = $2 AND element_id = $3', [user.id, req.params.id, elementId])
		return { ok: true }
	})
}

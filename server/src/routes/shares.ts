import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess } from '../access.js'
import { hashToken } from '../auth.js'
import { type Ctx, requireUser } from '../context.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { newShareToken, shareLink } from '../shares.js'
import { asBody, intParam, isUuid } from '../validate.js'

/**
 * Read-only links to a board for people without an account. Owners (and admins) create, copy and revoke them;
 * a link can expire. Revoking one closes the boards opened with it.
 */
export function shareRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, secrets } = ctx

	async function owner(req: Parameters<typeof requireUser>[1], boardId: string) {
		const user = await requireUser(ctx, req)
		if (!isUuid(boardId)) throw notFound('Board not found')
		const access = await boardAccess(db, user, boardId)
		if (!atLeast(access.role, 'owner')) throw forbidden('Only owners can share a board with people outside the project')
		return user
	}

	app.get<{ Params: { id: string } }>('/api/boards/:id/share-links', async (req) => {
		await owner(req, req.params.id)
		const { rows } = await db.query(
			`SELECT l.id, l.token, l.created_at, l.expires_at, u.display_name AS created_by
			FROM board_share_links l LEFT JOIN users u ON u.id = l.created_by
			WHERE l.board_id = $1 AND l.revoked_at IS NULL ORDER BY l.id DESC`,
			[req.params.id],
		)
		return {
			links: rows.map((r) => ({
				id: r.id,
				token: secrets.decrypt(r.token),
				createdAt: r.created_at,
				createdBy: r.created_by,
				expiresAt: r.expires_at,
				expired: !!r.expires_at && new Date(r.expires_at) <= new Date(),
			})),
		}
	})

	app.post<{ Params: { id: string } }>('/api/boards/:id/share-links', async (req) => {
		const user = await owner(req, req.params.id)
		const days = asBody(req.body ?? {}).expiresInDays
		if (days !== undefined && days !== null && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 365))
			throw badRequest('expiresInDays must be a number of days from 1 to 365')
		const token = newShareToken()
		const { rows } = await db.query<{ id: number; expires_at: Date | null }>(
			`INSERT INTO board_share_links (board_id, token_hash, token, created_by, expires_at)
			VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + $5::int * interval '1 day' END) RETURNING id, expires_at`,
			[req.params.id, hashToken(token), secrets.encrypt(token), user.id, days ?? null],
		)
		return { id: rows[0].id, token, expiresAt: rows[0].expires_at }
	})

	app.delete<{ Params: { id: string; linkId: string } }>('/api/boards/:id/share-links/:linkId', async (req) => {
		await owner(req, req.params.id)
		const linkId = intParam(req.params.linkId)
		const { rowCount } = await db.query(
			'UPDATE board_share_links SET revoked_at = now() WHERE id = $1 AND board_id = $2 AND revoked_at IS NULL',
			[linkId, req.params.id],
		)
		if (!rowCount) throw notFound('Link not found')
		ctx.onShareRevoked?.(linkId)
		return { ok: true }
	})

	/** What a guest needs to open the board: no session, only the link. */
	app.get<{ Params: { token: string } }>('/api/guest/:token', async (req) => {
		const link = await shareLink(db, req.params.token)
		if (!link) throw notFound("This link doesn't work anymore. Ask for a new one.")
		const { rows } = await db.query<{ name: string }>('SELECT name FROM boards WHERE id = $1', [link.boardId])
		return { board: { id: link.boardId, name: rows[0].name } }
	})
}

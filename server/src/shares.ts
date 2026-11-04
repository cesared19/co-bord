import { randomBytes } from 'node:crypto'
import { hashToken, type User } from './auth.js'
import type { Db } from './db.js'

/** Someone opening a board through a share link: read-only, with no account. */
export const GUEST_USER: User = { id: 0, username: 'guest', displayName: 'Guest', isAdmin: false, color: '#6b7280' }

export const newShareToken = () => `g_${randomBytes(24).toString('base64url')}`

/** The active link behind a token: not revoked and not expired. */
export async function shareLink(
	db: Db,
	token: string | undefined | null,
): Promise<{ id: number; boardId: string; projectId: number } | null> {
	if (!token || token.length > 100 || !token.startsWith('g_')) return null
	const { rows } = await db.query<{ id: number; board_id: string; project_id: number }>(
		`SELECT l.id, l.board_id, b.project_id FROM board_share_links l JOIN boards b ON b.id = l.board_id
		WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now())`,
		[hashToken(token)],
	)
	return rows[0] ? { id: rows[0].id, boardId: rows[0].board_id, projectId: rows[0].project_id } : null
}

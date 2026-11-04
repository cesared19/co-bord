import type { FastifyReply, FastifyRequest } from 'fastify'
import { SESSION_COOKIE, type User, userForToken } from './auth.js'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { SecretBox } from './crypto.js'
import type { FileStorage } from './storage.js'
import type { RuleEngine } from './rules.js'
import { forbidden, unauthorized } from './errors.js'

export interface Ctx {
	db: Db
	config: Config
	storage: FileStorage
	secrets: SecretBox
	/** Set by the collaboration server: closes live connections of a deleted board. */
	onBoardDeleted?: (boardId: string) => void
	/** Set by the collaboration server: stores pending changes of a board now. */
	flushBoard?: (boardId: string) => Promise<void>
	/**
	 * Set by the collaboration server: closes the user's live connections to the boards of a project (or to every
	 * board), so they reconnect with their new access, or are turned away.
	 */
	onAccessChanged?: (userId: number, projectId?: number) => Promise<void>
	/** Set by the collaboration server: deletes the uploaded files no board has used for a while (see cleanup.ts). */
	cleanupAssets?: () => Promise<{ deleted: number }>
	/** Set by the collaboration server: tells the board's open clients something changed (like 'comments'). */
	broadcastBoard?: (boardId: string, message: string) => void
	/** Set by the collaboration server: replaces the board's elements with a version's, for everyone. */
	restoreBoard?: (boardId: string, version: import('yjs').Doc, userId: number) => Promise<void>
	/** Set by the collaboration server: closes the boards opened with a share link that was revoked. */
	onShareRevoked?: (linkId: number) => void
	/** Set by the collaboration server: card rules. */
	rules?: RuleEngine
}

export async function currentUser(ctx: Ctx, req: FastifyRequest): Promise<User | null> {
	return userForToken(ctx.db, req.cookies[SESSION_COOKIE])
}

export async function requireUser(ctx: Ctx, req: FastifyRequest): Promise<User> {
	const user = await currentUser(ctx, req)
	if (!user) throw unauthorized()
	return user
}

export async function requireAdmin(ctx: Ctx, req: FastifyRequest): Promise<User> {
	const user = await requireUser(ctx, req)
	if (!user.isAdmin) throw forbidden('Only admins can do this')
	return user
}

export function setSessionCookie(ctx: Ctx, reply: FastifyReply, token: string, expiresAt: Date) {
	reply.setCookie(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: ctx.config.cookieSecure,
		expires: expiresAt,
	})
}

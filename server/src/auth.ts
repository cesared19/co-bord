import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Db } from './db.js'

export const SESSION_COOKIE = 'cobord_session'

export interface User {
	id: number
	username: string
	displayName: string
	isAdmin: boolean
	color: string
}

interface UserRow {
	id: number
	username: string
	display_name: string
	is_admin: boolean
	color: string
}

export const toUser = (r: UserRow): User => ({
	id: r.id,
	username: r.username,
	displayName: r.display_name,
	isAdmin: r.is_admin,
	color: r.color,
})

export const USER_COLUMNS = 'u.id, u.username, u.display_name, u.is_admin, u.color'

/** Cursor colors, picked per user so everyone keeps the same one on every board. */
const CURSOR_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f', '#c2410c', '#0f766e']
export const pickColor = (seed: number) => CURSOR_COLORS[seed % CURSOR_COLORS.length]

export const hashPassword = (password: string) => bcrypt.hash(password, 10)
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createSession(db: Db, userId: number, days: number): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url')
	const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000)
	await db.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expiresAt])
	await db.query('DELETE FROM sessions WHERE expires_at < now()')
	return { token, expiresAt }
}

export async function userForToken(db: Db, token: string | undefined): Promise<User | null> {
	if (!token) return null
	const { rows } = await db.query<UserRow>(
		`SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`,
		[hashToken(token)],
	)
	return rows[0] ? toUser(rows[0]) : null
}

export async function deleteSession(db: Db, token: string): Promise<void> {
	await db.query('DELETE FROM sessions WHERE id = $1', [hashToken(token)])
}

/** Reads one cookie from a raw Cookie header (used by the collaboration socket). */
export function cookieFromHeader(header: string | null | undefined, name: string): string | undefined {
	if (!header) return undefined
	for (const part of header.split(';')) {
		const index = part.indexOf('=')
		if (index < 0) continue
		if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim())
	}
	return undefined
}

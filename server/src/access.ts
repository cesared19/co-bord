import type { User } from './auth.js'
import type { Db } from './db.js'
import { forbidden, notFound } from './errors.js'

export type Role = 'owner' | 'editor' | 'viewer'
const rank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

export const atLeast = (role: Role, needed: Role) => rank[role] >= rank[needed]

/** The user's role in a project; admins act as owners everywhere. Hidden projects are reported as missing. */
export async function projectRole(db: Db, user: User, projectId: number): Promise<Role> {
	const { rows } = await db.query<{ role: Role | null }>(
		'SELECT m.role FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2 WHERE p.id = $1',
		[projectId, user.id],
	)
	if (!rows[0]) throw notFound('Project not found')
	if (user.isAdmin) return 'owner'
	if (!rows[0].role) throw notFound('Project not found')
	return rows[0].role
}

export async function requireProjectRole(db: Db, user: User, projectId: number, needed: Role): Promise<Role> {
	const role = await projectRole(db, user, projectId)
	if (!atLeast(role, needed)) throw forbidden()
	return role
}

export interface BoardAccess {
	projectId: number
	role: Role
}

export async function boardAccess(db: Db, user: User, boardId: string): Promise<BoardAccess> {
	const { rows } = await db.query<{ project_id: number }>('SELECT project_id FROM boards WHERE id = $1', [boardId])
	if (!rows[0]) throw notFound('Board not found')
	try {
		return { projectId: rows[0].project_id, role: await projectRole(db, user, rows[0].project_id) }
	} catch {
		throw notFound('Board not found')
	}
}

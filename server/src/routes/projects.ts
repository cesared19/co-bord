import type { FastifyInstance } from 'fastify'
import { atLeast, projectRole, type Role, requireProjectRole } from '../access.js'
import { type Ctx, requireAdmin, requireUser } from '../context.js'
import { badRequest, notFound } from '../errors.js'
import { asBody, intParam, str } from '../validate.js'

const ROLES: Role[] = ['owner', 'editor', 'viewer']

export function projectRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	app.get('/api/projects', async (req) => {
		const user = await requireUser(ctx, req)
		const { rows } = await db.query(
			`SELECT p.id, p.name, p.description, m.role,
				(SELECT count(*)::int FROM boards b WHERE b.project_id = p.id) AS board_count
			FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
			WHERE $2 OR m.user_id IS NOT NULL
			ORDER BY lower(p.name)`,
			[user.id, user.isAdmin],
		)
		return {
			projects: rows.map((r) => ({
				id: r.id,
				name: r.name,
				description: r.description,
				role: user.isAdmin ? 'owner' : r.role,
				boardCount: r.board_count,
			})),
		}
	})

	app.post('/api/projects', async (req) => {
		const user = await requireAdmin(ctx, req)
		const body = asBody(req.body)
		const name = str(body, 'name', { min: 1, max: 100 })
		const description = str(body, 'description', { max: 1000, optional: true }) ?? ''
		const { rows } = await db.query<{ id: number }>(
			'INSERT INTO projects (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
			[name, description, user.id],
		)
		await db.query(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')`, [rows[0].id, user.id])
		return { project: { id: rows[0].id, name, description, role: 'owner', boardCount: 0 } }
	})

	app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
		const user = await requireUser(ctx, req)
		const id = intParam(req.params.id)
		const role = await projectRole(ctx.db, user, id)
		const { rows } = await db.query('SELECT id, name, description FROM projects WHERE id = $1', [id])
		return { project: { ...rows[0], role } }
	})

	app.put<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
		const user = await requireUser(ctx, req)
		const id = intParam(req.params.id)
		await requireProjectRole(db, user, id, 'owner')
		const body = asBody(req.body)
		const name = str(body, 'name', { min: 1, max: 100, optional: true })
		const description = str(body, 'description', { max: 1000, optional: true })
		const { rows } = await db.query(
			'UPDATE projects SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1 RETURNING id, name, description',
			[id, name ?? null, description ?? null],
		)
		return { project: rows[0] }
	})

	app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
		const user = await requireAdmin(ctx, req)
		const id = intParam(req.params.id)
		await requireProjectRole(db, user, id, 'owner')
		await db.query('DELETE FROM projects WHERE id = $1', [id])
		return { ok: true }
	})

	app.get<{ Params: { id: string } }>('/api/projects/:id/members', async (req) => {
		const user = await requireUser(ctx, req)
		const id = intParam(req.params.id)
		await requireProjectRole(db, user, id, 'viewer')
		const { rows } = await db.query(
			`SELECT u.id, u.username, u.display_name, u.color, m.role FROM project_members m JOIN users u ON u.id = m.user_id
			WHERE m.project_id = $1 ORDER BY lower(u.display_name)`,
			[id],
		)
		return {
			members: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, color: r.color, role: r.role })),
		}
	})

	app.put<{ Params: { id: string; userId: string } }>('/api/projects/:id/members/:userId', async (req) => {
		const user = await requireUser(ctx, req)
		const id = intParam(req.params.id)
		const userId = intParam(req.params.userId)
		await requireProjectRole(db, user, id, 'owner')
		const role = str(asBody(req.body), 'role', { min: 1 }) as Role
		if (!ROLES.includes(role)) throw badRequest('role must be owner, editor or viewer')
		const exists = await db.query('SELECT 1 FROM users WHERE id = $1', [userId])
		if (!exists.rowCount) throw notFound('User not found')
		if (role !== 'owner') await ensureAnotherOwner(id, userId)
		await db.query(
			`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
			ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
			[id, userId, role],
		)
		return { ok: true }
	})

	app.delete<{ Params: { id: string; userId: string } }>('/api/projects/:id/members/:userId', async (req) => {
		const user = await requireUser(ctx, req)
		const id = intParam(req.params.id)
		const userId = intParam(req.params.userId)
		const role = await projectRole(db, user, id)
		// anyone can leave a project; only owners remove others
		if (userId !== user.id && !atLeast(role, 'owner')) throw notFound('Project not found')
		await ensureAnotherOwner(id, userId)
		await db.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [id, userId])
		return { ok: true }
	})

	/** A project always keeps at least one owner. */
	async function ensureAnotherOwner(projectId: number, leavingUserId: number) {
		const { rows } = await db.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'owner' AND user_id <> $2`,
			[projectId, leavingUserId],
		)
		const { rows: current } = await db.query<{ role: Role }>('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [
			projectId,
			leavingUserId,
		])
		if (current[0]?.role === 'owner' && rows[0].n === 0) throw badRequest('A project needs at least one owner')
	}
}

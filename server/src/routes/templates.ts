import type { FastifyInstance } from 'fastify'
import { atLeast, requireProjectRole } from '../access.js'
import { type Ctx, requireUser } from '../context.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { asBody, intParam, str } from '../validate.js'

const MAX_ELEMENTS = 5000

/**
 * Boards and frames saved as templates of a project. Every member sees them; editors save them; the person who
 * saved one, or an owner, deletes it. Uploaded files stay in the project and are kept while a template uses them.
 */
export function templateRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	app.get<{ Params: { id: string } }>('/api/projects/:id/templates', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const { rows } = await db.query(
			`SELECT t.id, t.name, t.description, t.element_count, t.created_by, t.created_at, t.thumbnail IS NOT NULL AS has_thumbnail,
				u.display_name AS created_by_name
			FROM project_templates t LEFT JOIN users u ON u.id = t.created_by WHERE t.project_id = $1 ORDER BY lower(t.name), t.id`,
			[projectId],
		)
		return {
			templates: rows.map((r) => ({
				id: r.id,
				name: r.name,
				description: r.description,
				elementCount: r.element_count,
				createdBy: r.created_by,
				createdByName: r.created_by_name,
				createdAt: r.created_at,
				thumbnail: r.has_thumbnail ? `/api/projects/${projectId}/templates/${r.id}/thumbnail` : null,
			})),
		}
	})

	async function template(req: Parameters<typeof requireUser>[1], projectIdRaw: string, templateIdRaw: string) {
		const user = await requireUser(ctx, req)
		const projectId = intParam(projectIdRaw)
		const role = await requireProjectRole(db, user, projectId, 'viewer')
		const { rows } = await db.query('SELECT * FROM project_templates WHERE id = $1 AND project_id = $2', [
			intParam(templateIdRaw),
			projectId,
		])
		if (!rows[0]) throw notFound('Template not found')
		return { user, role, row: rows[0] }
	}

	app.get<{ Params: { id: string; templateId: string } }>('/api/projects/:id/templates/:templateId', async (req) => {
		const { row } = await template(req, req.params.id, req.params.templateId)
		return { id: row.id, name: row.name, elements: row.elements }
	})

	app.get<{ Params: { id: string; templateId: string } }>('/api/projects/:id/templates/:templateId/thumbnail', async (req, reply) => {
		const { row } = await template(req, req.params.id, req.params.templateId)
		if (!row.thumbnail) throw notFound('No thumbnail')
		return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=86400').send(row.thumbnail)
	})

	/** Saves elements (a board or a frame, as the board has them) with a small picture (a PNG data URL). */
	app.post<{ Params: { id: string } }>('/api/projects/:id/templates', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		const role = await requireProjectRole(db, user, projectId, 'viewer')
		if (!atLeast(role, 'editor')) throw forbidden('Only editors can save templates')
		const body = asBody(req.body)
		const name = str(body, 'name', { min: 1, max: 120 })
		const description = str(body, 'description', { max: 500, optional: true }) ?? ''
		const elements = body.elements
		if (!Array.isArray(elements) || !elements.length) throw badRequest('There is nothing to save')
		if (elements.length > MAX_ELEMENTS) throw badRequest(`A template can have at most ${MAX_ELEMENTS} elements`)
		if (!elements.every((e) => e && typeof e === 'object' && !Array.isArray(e) && typeof (e as { id?: unknown }).id === 'string'))
			throw badRequest('Invalid elements')
		let thumbnail: Buffer | null = null
		if (typeof body.thumbnail === 'string') {
			const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.thumbnail)
			if (!m) throw badRequest('The thumbnail must be a PNG')
			thumbnail = Buffer.from(m[1], 'base64')
			if (thumbnail.length > 1024 * 1024) throw badRequest('The thumbnail is too big')
		}
		const { rows } = await db.query<{ id: number }>(
			`INSERT INTO project_templates (project_id, name, description, elements, element_count, thumbnail, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
			[projectId, name, description, JSON.stringify(elements), elements.length, thumbnail, user.id],
		)
		return { id: rows[0].id }
	})

	app.delete<{ Params: { id: string; templateId: string } }>('/api/projects/:id/templates/:templateId', async (req) => {
		const { user, role, row } = await template(req, req.params.id, req.params.templateId)
		if (row.created_by !== user.id && !atLeast(role, 'owner')) throw forbidden('Only the person who saved it or an owner can delete it')
		await db.query('DELETE FROM project_templates WHERE id = $1', [row.id])
		return { ok: true }
	})
}

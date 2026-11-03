import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess } from '../access.js'
import { type Ctx, requireUser } from '../context.js'
import { forbidden, notFound } from '../errors.js'
import { parseActions, parseTrigger } from '../rules.js'
import { asBody, bool, intParam, isUuid, str } from '../validate.js'

/** Card rules of a board: everyone sees them and their history; editors create, change, pause and delete them. */
export function ruleRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db } = ctx

	async function access(req: Parameters<typeof requireUser>[1], boardId: string, needed: 'viewer' | 'editor') {
		const user = await requireUser(ctx, req)
		if (!isUuid(boardId)) throw notFound('Board not found')
		const a = await boardAccess(db, user, boardId)
		if (!atLeast(a.role, needed)) throw forbidden('Only editors can change the rules of a board')
		return user
	}

	app.get<{ Params: { id: string } }>('/api/boards/:id/rules', async (req) => {
		await access(req, req.params.id, 'viewer')
		const { rows } = await db.query(
			`SELECT r.id, r.name, r.enabled, r.trigger, r.actions, r.created_at, u.display_name AS created_by
			FROM board_rules r LEFT JOIN users u ON u.id = r.created_by WHERE r.board_id = $1 ORDER BY r.id`,
			[req.params.id],
		)
		const runs = await db.query(
			`SELECT * FROM (SELECT x.*, row_number() OVER (PARTITION BY x.rule_id ORDER BY x.id DESC) AS n
				FROM rule_runs x JOIN board_rules r ON r.id = x.rule_id WHERE r.board_id = $1) t WHERE n <= 20 ORDER BY id DESC`,
			[req.params.id],
		)
		return {
			rules: rows.map((r) => ({
				id: r.id,
				name: r.name,
				enabled: r.enabled,
				trigger: r.trigger,
				actions: r.actions,
				createdBy: r.created_by,
				createdAt: r.created_at,
				runs: runs.rows
					.filter((x) => x.rule_id === r.id)
					.map((x) => ({ id: x.id, elementId: x.element_id, text: x.element_text, ok: x.ok, details: x.details, at: x.created_at })),
			})),
		}
	})

	app.post<{ Params: { id: string } }>('/api/boards/:id/rules', async (req) => {
		const user = await access(req, req.params.id, 'editor')
		const body = asBody(req.body)
		const name = str(body, 'name', { min: 1, max: 200 })
		const trigger = parseTrigger(body.trigger)
		const actions = parseActions(body.actions)
		const { rows } = await db.query(
			'INSERT INTO board_rules (board_id, name, trigger, actions, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
			[req.params.id, name, JSON.stringify(trigger), JSON.stringify(actions), user.id],
		)
		ctx.rules?.invalidate(req.params.id)
		return { id: rows[0].id }
	})

	app.put<{ Params: { id: string; ruleId: string } }>('/api/boards/:id/rules/:ruleId', async (req) => {
		await access(req, req.params.id, 'editor')
		const ruleId = intParam(req.params.ruleId)
		const body = asBody(req.body)
		const name = str(body, 'name', { min: 1, max: 200, optional: true })
		const enabled = bool(body, 'enabled')
		const trigger = body.trigger === undefined ? null : parseTrigger(body.trigger)
		const actions = body.actions === undefined ? null : parseActions(body.actions)
		const { rowCount } = await db.query(
			`UPDATE board_rules SET name = COALESCE($3, name), enabled = COALESCE($4, enabled), trigger = COALESCE($5, trigger),
				actions = COALESCE($6, actions), state = CASE WHEN $5::jsonb IS NOT NULL OR ($4::boolean AND NOT enabled) THEN '{}' ELSE state END, updated_at = now()
			WHERE id = $1 AND board_id = $2`,
			[ruleId, req.params.id, name ?? null, enabled ?? null, trigger && JSON.stringify(trigger), actions && JSON.stringify(actions)],
		)
		if (!rowCount) throw notFound('Rule not found')
		ctx.rules?.invalidate(req.params.id)
		return { ok: true }
	})

	app.delete<{ Params: { id: string; ruleId: string } }>('/api/boards/:id/rules/:ruleId', async (req) => {
		await access(req, req.params.id, 'editor')
		const { rowCount } = await db.query('DELETE FROM board_rules WHERE id = $1 AND board_id = $2', [
			intParam(req.params.ruleId),
			req.params.id,
		])
		if (!rowCount) throw notFound('Rule not found')
		ctx.rules?.invalidate(req.params.id)
		return { ok: true }
	})
}

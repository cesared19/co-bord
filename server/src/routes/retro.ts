import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess } from '../access.js'
import { type RetroWriter, retroInput } from '../ai.js'
import { type Ctx, requireUser } from '../context.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { asBody, isUuid } from '../validate.js'

export function retroRoutes(app: FastifyInstance, ctx: Ctx, writer: RetroWriter) {
	/** Whether this server can write summaries with Claude. */
	app.get('/api/ai', async (req) => {
		await requireUser(ctx, req)
		return { enabled: writer.enabled }
	})

	/** A retrospective summary written by Claude from the notes the board sends. Editors only, as it costs. */
	app.post<{ Params: { id: string } }>('/api/boards/:id/retro/summary', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		const access = await boardAccess(ctx.db, user, req.params.id)
		if (!atLeast(access.role, 'editor')) throw forbidden()
		const input = retroInput(asBody(req.body))
		if (!input.columns.some((c) => c.notes.length)) throw badRequest('There are no notes to summarize')
		return writer.summarize(input)
	})
}

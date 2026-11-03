import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RetroWriter } from '../src/ai.js'
import { createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let fake: FastifyInstance
let requests: { headers: Record<string, unknown>; body: Record<string, unknown> }[] = []
let refuse = false

/** A stand-in for the Anthropic Messages API. */
async function startFakeAnthropic() {
	const app = Fastify()
	app.post('/v1/messages', async (req) => {
		requests.push({ headers: req.headers, body: req.body as Record<string, unknown> })
		const summary = {
			summary: 'A steady sprint with slow reviews.',
			themes: [{ title: 'Reviews', detail: 'Reviews take too long.' }],
			actions: [{ text: 'Pair on reviews', owner: 'ana' }],
		}
		return {
			id: 'msg_1',
			type: 'message',
			role: 'assistant',
			model: 'claude-opus-5-5',
			content: refuse ? [] : [{ type: 'text', text: JSON.stringify(summary) }],
			stop_reason: refuse ? 'refusal' : 'end_turn',
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 10 },
		}
	})
	return { app, url: await app.listen({ port: 0, host: '127.0.0.1' }) }
}

const notes = {
	title: 'Sprint 12',
	columns: [
		{
			name: 'Stop',
			notes: [
				{ text: 'Slow   reviews', votes: 3 },
				{ text: '', votes: 9 },
			],
		},
		{ name: 'Start', notes: [] },
	],
	actions: [{ text: 'Pair on reviews @ana' }],
}

describe('retro summaries with Claude', () => {
	let env: TestEnv
	beforeAll(async () => {
		const started = await startFakeAnthropic()
		fake = started.app
		env = await startEnv({ retroWriter: new RetroWriter('sk-test', started.url) })
	})
	afterAll(async () => {
		await env.stop()
		await fake.close()
	})

	it('sends the notes with structured output and the default fallback, for editors only', async () => {
		const admin = await setupAdmin(env)
		const { client: viewer, id: viewerId } = await createUser(env, admin, 'vera')
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${viewerId}`, { role: 'viewer' })
		const board = (await admin.post(`/api/projects/${project.id}/boards`, { name: 'Retro' })).body.board

		expect((await viewer.get('/api/ai')).body).toEqual({ enabled: true })
		expect((await viewer.post(`/api/boards/${board.id}/retro/summary`, notes)).status).toBe(403)
		expect((await admin.post(`/api/boards/${board.id}/retro/summary`, { columns: [] })).status).toBe(400)

		const res = await admin.post(`/api/boards/${board.id}/retro/summary`, notes)
		expect(res.status).toBe(200)
		expect(res.body.actions).toEqual([{ text: 'Pair on reviews', owner: 'ana' }])
		const sent = requests.at(-1)!
		expect(sent.body).toMatchObject({
			model: 'claude-opus-5-5',
			fallbacks: 'default',
			output_config: { effort: 'low', format: { type: 'json_schema' } },
		})
		expect(String(sent.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
		expect(sent.headers['x-api-key']).toBe('sk-test')
		// notes are cleaned up before they leave: whitespace collapsed, empty ones dropped
		const input = JSON.parse((sent.body.messages as { content: string }[])[0].content)
		expect(input.columns[0].notes).toEqual([{ text: 'Slow reviews', votes: 3 }])

		refuse = true
		const declined = await admin.post(`/api/boards/${board.id}/retro/summary`, notes)
		expect(declined.status).toBe(422)
		expect(declined.body.error).toContain('declined')
	})
})

describe('without an API key', () => {
	let env: TestEnv
	beforeAll(async () => {
		env = await startEnv()
	})
	afterAll(async () => env.stop())

	it('says summaries with Claude are off', async () => {
		const admin = await setupAdmin(env)
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		const board = (await admin.post(`/api/projects/${project.id}/boards`, { name: 'Retro' })).body.board
		expect((await admin.get('/api/ai')).body).toEqual({ enabled: false })
		const res = await admin.post(`/api/boards/${board.id}/retro/summary`, notes)
		expect(res.status).toBe(409)
	})
})

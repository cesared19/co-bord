import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
let fake: FastifyInstance
let fakeUrl: string
const calls: string[] = []

/** A stand-in for SparkyTC's integration API. */
async function startFakeSparky() {
	const app = Fastify()
	app.addHook('onRequest', async (req, reply) => {
		calls.push(`${req.method} ${req.url}`)
		if (req.headers.authorization !== 'Bearer stc_good')
			return reply.status(401).send({ error: 'Unauthorized', message: 'Send a valid project API token' })
	})
	app.get('/api/integration/v1/project', async () => ({
		data: {
			projectShortCode: 'PRJ',
			title: 'Project',
			currentBuild: { buildID: 'b2', buildNumber: '1.1' },
			builds: [],
			webPath: '/projects/PRJ',
		},
	}))
	app.get('/api/integration/v1/test-cases', async (req) => ({
		data: [{ testCaseNumber: 1, title: `match ${(req.query as { query?: string }).query ?? ''}`, webPath: '/test-cases/PRJ/1' }],
	}))
	app.get('/api/integration/v1/sections', async () => ({
		data: [
			{ sectionID: '11111111-1111-1111-1111-111111111111', path: 'Checkout' },
			{ sectionID: '22222222-2222-2222-2222-222222222222', path: 'Account' },
		],
	}))
	app.get('/api/integration/v1/test-plans', async () => ({ data: [] }))
	app.post('/api/integration/v1/results', async (req) => ({ data: { echo: req.body } }))
	const url = await app.listen({ port: 0, host: '127.0.0.1' })
	return { app, url }
}

beforeAll(async () => {
	env = await startEnv()
	const started = await startFakeSparky()
	fake = started.app
	fakeUrl = started.url
})
afterAll(async () => {
	await env.stop()
	await fake.close()
})

describe('SparkyTC connection', () => {
	it('is set by admins, keeps the token encrypted and proxies reads for members', async () => {
		const admin = await setupAdmin(env)
		const { client: owner, id: ownerId } = await createUser(env, admin, 'olivia')
		const { client: viewer, id: viewerId } = await createUser(env, admin, 'vera')
		const { client: outsider } = await createUser(env, admin, 'otto')
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${ownerId}`, { role: 'owner' })
		await admin.put(`/api/projects/${project.id}/members/${viewerId}`, { role: 'viewer' })
		const base = `/api/projects/${project.id}/sparkytc`

		expect((await viewer.get(base)).body).toEqual({ connected: false })
		expect((await viewer.post(`${base}/results`, {})).status).toBe(409)

		// project owners that aren't admins can't point co-bord at other servers
		expect((await owner.put(base, { url: fakeUrl, token: 'stc_good' })).status).toBe(403)
		expect((await admin.put(base, { url: 'ftp://x', token: 'stc_good' })).status).toBe(400)
		const rejected = await admin.put(base, { url: fakeUrl, token: 'stc_bad' })
		expect(rejected.status).toBe(502)
		expect(rejected.body.error).toContain('rejected the token')
		const unreachable = await admin.put(base, { url: 'http://127.0.0.1:1', token: 'stc_good' })
		expect(unreachable.body.error).toContain("can't be reached")
		const local = await admin.put(base, { url: 'http://127.0.0.1:59999', token: 'stc_good' })
		expect(local.body.error).toContain('is the container itself')
		const unknown = await admin.put(base, { url: 'http://backend-service.invalid:8080', token: 'stc_good' })
		expect(unknown.body.error).toContain("doesn't know the name backend-service.invalid")
		expect(unknown.body.error).toContain('SPARKYTC_NETWORK')

		const saved = await admin.put(base, { url: `${fakeUrl}/`, publicUrl: 'http://sparky.example:3000', token: 'stc_good' })
		expect(saved.status).toBe(200)
		expect(saved.body.project.projectShortCode).toBe('PRJ')
		const { rows } = await env.db.query('SELECT sparkytc_token FROM projects WHERE id = $1', [project.id])
		expect(rows[0].sparkytc_token).not.toContain('stc_good')

		// keeping the token while changing the address
		expect((await admin.put(base, { url: fakeUrl, publicUrl: 'http://sparky.example:3000' })).status).toBe(200)

		const seen = (await viewer.get(base)).body
		expect(seen).toMatchObject({ connected: true, publicUrl: 'http://sparky.example:3000', project: { title: 'Project' } })
		expect(seen.url).toBeUndefined()
		expect(JSON.stringify(seen)).not.toContain('stc_good')
		expect((await admin.get(base)).body.url).toBe(fakeUrl)
		expect((await outsider.get(base)).status).toBe(404)

		const cases = (await viewer.get(`${base}/search?kind=case&q=pay`)).body.items
		expect(cases[0].title).toBe('match pay')
		const sections = (await viewer.get(`${base}/search?kind=section&q=check`)).body.items
		expect(sections.map((s: { path: string }) => s.path)).toEqual(['Checkout'])

		const results = await viewer.post(`${base}/results`, {
			testCaseNumbers: [3, 1, 3, -1, 'x'],
			sectionIDs: ['11111111-1111-1111-1111-111111111111', 'not-a-uuid'],
			build: '1.0',
		})
		expect(results.body.echo).toEqual({
			testCaseNumbers: [1, 3],
			sectionIDs: ['11111111-1111-1111-1111-111111111111'],
			testPlanIDs: [],
			build: '1.0',
		})
		// asked again right away, the answer comes from the short cache
		const before = calls.filter((c) => c.includes('/results')).length
		await viewer.post(`${base}/results`, { testCaseNumbers: [1, 3], sectionIDs: ['11111111-1111-1111-1111-111111111111'], build: '1.0' })
		expect(calls.filter((c) => c.includes('/results')).length).toBe(before)

		expect((await owner.delete(base)).status).toBe(403)
		expect((await admin.delete(base)).status).toBe(200)
		expect((await viewer.get(base)).body).toEqual({ connected: false })
	})
})

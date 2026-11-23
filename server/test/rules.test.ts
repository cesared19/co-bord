import { HocuspocusProvider } from '@hocuspocus/provider'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { parseActions, parseTrigger } from '../src/rules.js'
import { startFakeJira } from './fakeJira.js'
import { type Client, createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
let jira: Awaited<ReturnType<typeof startFakeJira>>
let sparky: FastifyInstance
let sparkyUrl: string
const sparkyCalls: { url: string; body: unknown }[] = []
/** Status of each test case in the fake SparkyTC. */
const caseStatus = new Map<number, string>([[1, 'PASS']])
/** Whether the fake SparkyTC updates test cases (2.7.0 and later). */
const sparkyUpdates = { on: true }
/** Whether the fake SparkyTC archives test cases (2.6.0 and later). */
const sparkyArchives = { on: true }

/** A stand-in for SparkyTC's integration API, with writes for the token stc_write. */
async function startFakeSparky() {
	const app = Fastify()
	const cases = new Map<string, { testCaseNumber: number; title: string; webPath: string; sectionPath?: string; archived?: boolean }>()
	const plans = new Map<string, { testPlanID: string; name: string; webPath: string }>()
	let nextCase = 100
	app.addHook('onRequest', async (req, reply) => {
		const token = req.headers.authorization
		if (token !== 'Bearer stc_write' && token !== 'Bearer stc_read') return reply.status(401).send({ message: 'Unauthorized' })
		if (req.method === 'POST' && !req.url.endsWith('/results') && token !== 'Bearer stc_write')
			return reply.status(403).send({ message: 'This API token can only read' })
	})
	app.addHook('preHandler', async (req) => {
		sparkyCalls.push({ url: `${req.method} ${req.url}`, body: req.body })
	})
	app.get('/api/integration/v1/project', async (req) => ({
		data: {
			projectShortCode: 'PRJ',
			title: 'Project',
			currentBuild: null,
			builds: [],
			webPath: '/projects/PRJ',
			permissions: req.headers.authorization === 'Bearer stc_write' ? ['read', 'write'] : ['read'],
		},
	}))
	app.post('/api/integration/v1/results', async (req) => {
		const body = req.body as { testCaseNumbers: number[] }
		return {
			data: {
				build: null,
				testCases: body.testCaseNumbers.map((n) => ({ testCaseNumber: n, title: `Case ${n}`, status: caseStatus.get(n) ?? 'NOT_RUN' })),
				sections: [],
				testPlans: [],
				missingTestCaseNumbers: [],
				missingSectionIDs: [],
				missingTestPlanIDs: [],
			},
		}
	})
	app.post('/api/integration/v1/sections', async (req) => {
		const path = (req.body as { path: string }).path
		return { data: { sectionID: '33333333-3333-3333-3333-333333333333', path, name: path.split(' / ').pop(), webPath: '/s' } }
	})
	app.post('/api/integration/v1/test-cases', async (req) => {
		const body = req.body as { title: string; sourceRef?: string; sectionPath?: string; updateExisting?: boolean }
		const existing = body.sourceRef ? cases.get(body.sourceRef) : undefined
		if (existing && !existing.archived) {
			if (!body.updateExisting || !sparkyUpdates.on) return { data: { ...existing, created: false } }
			const updated = existing.title !== body.title
			existing.title = body.title
			return { data: { ...existing, created: false, updated } }
		}
		const created = { testCaseNumber: nextCase++, title: body.title, webPath: `/test-cases/${nextCase}`, sectionPath: body.sectionPath }
		if (body.sourceRef) cases.set(body.sourceRef, created)
		return { data: { ...created, created: true } }
	})
	app.get<{ Querystring: { sourceRefPrefix?: string } }>('/api/integration/v1/test-cases', async (req) => ({
		data: [...cases.entries()]
			.filter(([ref, c]) => !c.archived && ref.startsWith(req.query.sourceRefPrefix ?? ''))
			.map(([sourceRef, c]) => ({ ...c, sourceRef })),
	}))
	app.post('/api/integration/v1/test-cases/archive', async (req, reply) => {
		if (!sparkyArchives.on) return reply.status(404).send({ timestamp: 'now', status: 404, error: 'Not Found', path: req.url })
		const numbers = (req.body as { testCaseNumbers: number[] }).testCaseNumbers
		const archived: number[] = []
		for (const c of cases.values())
			if (numbers.includes(c.testCaseNumber) && !c.archived) {
				c.archived = true
				archived.push(c.testCaseNumber)
			}
		return { data: { archived, skipped: [] } }
	})
	app.post('/api/integration/v1/test-plans', async (req) => {
		const body = req.body as { name: string; sourceRef?: string }
		const existing = body.sourceRef ? plans.get(body.sourceRef) : undefined
		if (existing) return { data: { ...existing, created: false } }
		const created = { testPlanID: '44444444-4444-4444-4444-444444444444', name: body.name, webPath: '/plans/1' }
		if (body.sourceRef) plans.set(body.sourceRef, created)
		return { data: { ...created, created: true } }
	})
	const url = await app.listen({ port: 0, host: '127.0.0.1' })
	return { app, url }
}

beforeAll(async () => {
	env = await startEnv()
	jira = await startFakeJira()
	const s = await startFakeSparky()
	sparky = s.app
	sparkyUrl = s.url
})
afterAll(async () => {
	await env.stop()
	await jira.app.close()
	await sparky.close()
})

function connect(boardId: string, cookie: string) {
	const document = new Y.Doc()
	class CookieWebSocket extends WebSocket {
		constructor(url: string, protocols?: string | string[]) {
			super(url, protocols, { headers: { cookie } })
		}
	}
	const provider = new HocuspocusProvider({
		url: `${env.url.replace('http', 'ws')}/collab`,
		name: boardId,
		document,
		WebSocketPolyfill: CookieWebSocket,
	})
	return { document, provider, elements: document.getMap<Record<string, unknown>>('elements') }
}

const until = async (check: () => boolean | Promise<boolean>, ms = 10000) => {
	const start = Date.now()
	while (!(await check())) {
		if (Date.now() - start > ms) throw new Error('Timed out')
		await new Promise((r) => setTimeout(r, 50))
	}
}
const settle = () => new Promise((r) => setTimeout(r, 500))
const runCount = async () => (await env.db.query<{ n: number }>('SELECT count(*)::int AS n FROM rule_runs')).rows[0].n

const sticky = (id: string, x: number, y: number, text: string) => ({
	id,
	type: 'sticky',
	z: 1,
	x,
	y,
	w: 100,
	h: 100,
	text,
	fill: '#fef08a',
	fontSize: 18,
	bold: false,
	align: 'center',
	textColor: 'auto',
})
const frame = (id: string, x: number, title: string) => ({ id, type: 'frame', z: 0, x, y: 0, w: 600, h: 400, title, fill: 'auto' })

describe('rule definitions', () => {
	it('validates triggers and actions', () => {
		expect(parseTrigger({ type: 'votes', count: 3 })).toEqual({ type: 'votes', count: 3 })
		expect(() => parseTrigger({ type: 'votes', count: 0 })).toThrow()
		expect(() => parseTrigger({ type: 'frame' })).toThrow('Choose the frame')
		expect(
			parseActions([
				{ type: 'note', color: '#bbf7d0', frameId: '' },
				{ type: 'test-case', sectionPath: ' ' },
			]),
		).toEqual([{ type: 'note', color: '#bbf7d0' }, { type: 'test-case' }])
		expect(() => parseActions([])).toThrow()
		expect(() => parseActions([{ type: 'note' }])).toThrow('Choose how to change the card')
		expect(() => parseActions([{ type: 'notify', userIds: [] }])).toThrow('Choose who to notify')
	})
})

describe('card rules', () => {
	let admin: Client
	let eddie: Client
	let vera: Client
	let veraId: number
	let projectId: number

	it('connects Jira per project, checking the project and issue type', async () => {
		admin = await setupAdmin(env)
		const e = await createUser(env, admin, 'eddie')
		const v = await createUser(env, admin, 'vera')
		eddie = e.client
		vera = v.client
		veraId = v.id
		projectId = (await admin.post('/api/projects', { name: 'P' })).body.project.id
		await admin.put(`/api/projects/${projectId}/members/${e.id}`, { role: 'editor' })
		await admin.put(`/api/projects/${projectId}/members/${veraId}`, { role: 'viewer' })
		const base = `/api/projects/${projectId}/jira`

		expect((await vera.get(base)).body).toEqual({ connected: false })
		expect(
			(await eddie.put(base, { url: jira.url, email: 'bot@example.com', token: 'atl_good', projectKey: 'QA', issueType: 'Bug' })).status,
		).toBe(403)
		const bad = await admin.post(`${base}/projects`, { url: jira.url, email: 'bot@example.com', token: 'nope' })
		expect(bad.body.error).toContain('rejected the email or API token')
		const listed = await admin.post(`${base}/projects`, { url: `${jira.url}/jira/x`, email: 'bot@example.com', token: 'atl_good' })
		expect(listed.body.projects).toEqual([{ key: 'QA', name: 'Quality', issueTypes: ['Bug', 'Task'] }])
		expect((await admin.post(`${base}/projects`, { useConfluence: true })).body.error).toContain('not connected to Confluence')

		const wrongType = await admin.put(base, {
			url: jira.url,
			email: 'bot@example.com',
			token: 'atl_good',
			projectKey: 'QA',
			issueType: 'Epic',
		})
		expect(wrongType.body.error).toContain('no issue type Epic')
		const wrongProject = await admin.put(base, {
			url: jira.url,
			email: 'bot@example.com',
			token: 'atl_good',
			projectKey: 'XX',
			issueType: 'Bug',
		})
		expect(wrongProject.body.error).toContain('No Jira project with the key XX')
		const saved = await admin.put(base, { url: jira.url, email: 'bot@example.com', token: 'atl_good', projectKey: 'qa', issueType: 'bug' })
		expect(saved.body).toMatchObject({ connected: true, projectKey: 'QA', issueType: 'Bug' })
		// the token can be kept when saving again
		expect((await admin.put(base, { url: jira.url, email: 'bot@example.com', projectKey: 'QA', issueType: 'Task' })).status).toBe(200)
		const { rows } = await env.db.query('SELECT jira_token FROM projects WHERE id = $1', [projectId])
		expect(rows[0].jira_token).not.toContain('atl_good')
		expect((await vera.get(base)).body).toEqual({ connected: true, url: jira.url, projectKey: 'QA', issueType: 'Task' })
		await admin.put(base, { url: jira.url, email: 'bot@example.com', projectKey: 'QA', issueType: 'Bug' })
	})

	it('runs rules when cards enter frames, marks them done when the Jira issue closes, and keeps a history', async () => {
		const board = (await eddie.post(`/api/projects/${projectId}/boards`, { name: 'Flow' })).body.board
		const rules = `/api/boards/${board.id}/rules`
		const rule = {
			name: 'Bug for done',
			trigger: { type: 'frame', frameId: 'done' },
			actions: [{ type: 'jira' }, { type: 'note', color: '#bbf7d0' }, { type: 'notify', userIds: [veraId] }],
		}
		expect((await vera.post(rules, rule)).status).toBe(403)
		expect((await eddie.post(rules, { ...rule, trigger: { type: 'nope' } })).status).toBe(400)
		const created = await eddie.post(rules, rule)
		expect(created.status).toBe(200)
		// a rule for a frame that doesn't exist yet
		await eddie.post(rules, { name: 'Pasted', trigger: { type: 'frame', frameId: 'later' }, actions: [{ type: 'note', done: true }] })

		const { document, provider, elements } = connect(board.id, eddie.cookie)
		await until(() => provider.isSynced)
		document.transact(() => {
			elements.set('done', frame('done', 1000, 'Done'))
			elements.set('n1', sticky('n1', 0, 0, 'Checkout fails\nwith an expired card'))
			elements.set('blank', sticky('blank', 0, 200, ' '))
		})
		await settle()
		expect(await runCount()).toBe(0)

		// dragging through a frame doesn't count, only where the card stays
		elements.set('n1', { ...elements.get('n1'), x: 1100, y: 100 })
		elements.set('n1', { ...elements.get('n1'), x: 1100, y: 600 })
		await settle()
		expect(await runCount()).toBe(0)
		elements.set('n1', { ...elements.get('n1'), x: 1100, y: 100 })
		elements.set('blank', { ...elements.get('blank'), x: 1300, y: 100 })
		await until(async () => (await runCount()) === 1)
		await env.ctx.rules!.idle()
		await until(() => !!elements.get('n1')?.issue)
		const n1 = elements.get('n1') as Record<string, unknown>
		expect(n1.issue).toMatchObject({ key: 'QA-1', status: 'To Do', category: 'new', url: `${jira.url}/browse/QA-1` })
		expect(n1.fill).toBe('#bbf7d0')
		expect(n1.done).toBeUndefined()
		expect(jira.issues.get('QA-1')).toMatchObject({ summary: 'Checkout fails', issueType: 'Bug' })
		expect(JSON.stringify(jira.issues.get('QA-1')!.description)).toContain(`/boards/${board.id}?el=n1`)
		const inbox = (await vera.get('/api/notifications')).body
		expect(inbox.notifications[0]).toMatchObject({
			kind: 'rule',
			elementId: 'n1',
			text: 'Bug for done: Checkout fails with an expired card',
		})

		const history = (await vera.get(rules)).body.rules[0]
		expect(history.runs).toHaveLength(1)
		expect(history.runs[0]).toMatchObject({ ok: true, elementId: 'n1', text: 'Entered Done: Checkout fails with an expired card' })
		expect(history.runs[0].details.map((d: { message: string }) => d.message)).toEqual([
			'Created QA-1',
			'Changed its color',
			'Notified 1 person',
		])

		// closing the issue in Jira marks the card done; reopening it clears that
		await fetch(`${jira.url}/_test/issues/QA-1`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'Done', category: 'done' }),
		})
		await env.ctx.rules!.checkIssues()
		await until(() => elements.get('n1')?.done === true)
		expect(elements.get('n1')?.issue).toMatchObject({ status: 'Done', category: 'done' })
		await fetch(`${jira.url}/_test/issues/QA-1`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'Reopened', category: 'indeterminate' }),
		})
		await env.ctx.rules!.checkIssues()
		await until(() => elements.get('n1')?.done === false)

		// leaving and entering again runs it again, but the card keeps its issue
		elements.set('n1', { ...elements.get('n1'), x: 0 })
		await settle()
		elements.set('n1', { ...elements.get('n1'), x: 1100 })
		await until(async () => (await runCount()) === 2)
		await env.ctx.rules!.idle()
		expect((await vera.get(rules)).body.rules[0].runs[0].details[0].message).toBe('Already linked to QA-1')

		// a frame pasted with its cards doesn't run rules; a card added to it later does
		document.transact(() => {
			elements.set('later', frame('later', 3000, 'Later'))
			elements.set('n2', sticky('n2', 3100, 100, 'Pasted card'))
		})
		await settle()
		expect(await runCount()).toBe(2)
		elements.set('n3', sticky('n3', 3300, 100, 'New card'))
		await until(() => elements.get('n3')?.done === true)

		// a card created and moved into a frame right away, without a pause, still enters it
		const runs = await runCount()
		document.transact(() => {
			elements.set('col', frame('col', 5000, 'Column'))
			elements.set('n4', sticky('n4', 5100, 100, 'Quick card'))
		})
		elements.set('n4', { ...elements.get('n4'), x: 1300, y: 250 })
		await until(async () => (await runCount()) === runs + 1)
		await env.ctx.rules!.idle()

		// paused rules don't run
		await eddie.put(`${rules}/${created.body.id}`, { enabled: false })
		elements.set('n1', { ...elements.get('n1'), x: 0 })
		await settle()
		elements.set('n1', { ...elements.get('n1'), x: 1100 })
		await settle()
		await env.ctx.rules!.idle()
		expect((await vera.get(rules)).body.rules[0].runs).toHaveLength(3)

		// people can create an issue from a card's menu too
		expect((await vera.post(`/api/boards/${board.id}/elements/n2/jira`)).status).toBe(403)
		const manual = await eddie.post(`/api/boards/${board.id}/elements/n2/jira`)
		expect(manual.body).toMatchObject({ key: 'QA-3' })
		await until(() => (elements.get('n2')?.issue as { key?: string } | undefined)?.key === 'QA-3')
		expect((await eddie.post(`/api/boards/${board.id}/elements/n2/jira`)).body.key).toBe('QA-3')
		provider.destroy()
	})

	it('runs rules on votes, chains rules started by rules, and creates test cases in SparkyTC', async () => {
		await admin.put(`/api/projects/${projectId}/sparkytc`, { url: sparkyUrl, token: 'stc_write' })
		const board = (await eddie.post(`/api/projects/${projectId}/boards`, { name: 'Retro' })).body.board
		const rules = `/api/boards/${board.id}/rules`
		await eddie.post(rules, {
			name: 'Top voted',
			trigger: { type: 'votes', count: 2 },
			actions: [{ type: 'note', frameId: 'actions', done: true }],
		})
		await eddie.post(rules, {
			name: 'Test it',
			trigger: { type: 'frame', frameId: 'actions' },
			actions: [{ type: 'test-case', sectionPath: 'Retro' }],
		})

		const { document, provider, elements } = connect(board.id, eddie.cookie)
		await until(() => provider.isSynced)
		const base = await runCount()
		const votes = document.getMap<string[]>('votes')
		const session = document.getMap('session')
		document.transact(() => {
			elements.set('actions', frame('actions', 2000, 'Action items'))
			elements.set('a', sticky('a', 0, 0, 'Add a test for refunds'))
			session.set('voting', { round: 'r1', active: true, perPerson: 3, by: 'eddie' })
		})
		await settle()
		votes.set('r1:1', ['a'])
		await settle()
		expect(await runCount()).toBe(base)
		votes.set('r1:2', ['a'])
		await until(() => (elements.get('a')?.links as unknown[] | undefined)?.length === 1)
		const a = elements.get('a') as Record<string, unknown>
		expect(a.done).toBe(true)
		expect(a.x).toBeGreaterThanOrEqual(2000)
		expect(a.links).toEqual([{ kind: 'case', id: '100', label: '#100 Add a test for refunds' }])
		const call = sparkyCalls.find((c) => c.url === 'POST /api/integration/v1/test-cases')
		expect(call?.body).toMatchObject({ title: 'Add a test for refunds', sectionPath: 'Retro', sourceRef: `cobord:${board.id}:a` })
		const list = (await eddie.get(rules)).body.rules
		expect(list[1].runs[0].details[0].message).toBe('Created test case #100')

		// a token that can only read gets a clear error in the history
		await admin.put(`/api/projects/${projectId}/sparkytc`, { url: sparkyUrl, token: 'stc_read' })
		elements.set('b', sticky('b', 2100, 300, 'Another'))
		await until(async () => (await eddie.get(rules)).body.rules[1].runs.length === 2)
		const failed = (await eddie.get(rules)).body.rules[1].runs[0]
		expect(failed.ok).toBe(false)
		expect(failed.details[0].message).toContain('can only read')
		provider.destroy()
	})

	it('runs rules when linked tests start failing, after a first look', async () => {
		await admin.put(`/api/projects/${projectId}/sparkytc`, { url: sparkyUrl, token: 'stc_write' })
		const board = (await eddie.post(`/api/projects/${projectId}/boards`, { name: 'Tests' })).body.board
		const rules = `/api/boards/${board.id}/rules`
		await eddie.post(rules, { name: 'Bug on failure', trigger: { type: 'test-fails' }, actions: [{ type: 'jira' }] })
		const { document, provider, elements } = connect(board.id, eddie.cookie)
		await until(() => provider.isSynced)
		document.transact(() => {
			elements.set('s', { ...sticky('s', 0, 0, 'Pay with card'), links: [{ kind: 'case', id: '1', label: '#1' }] })
			elements.set('t', { ...sticky('t', 0, 0, 'Pay with cash'), links: [{ kind: 'case', id: '2', label: '#2' }] })
		})
		await settle()
		caseStatus.set(2, 'FAIL')
		const before = await runCount()
		await env.ctx.rules!.checkTests()
		await env.ctx.rules!.idle()
		// already failing when the rule first looked: nothing runs
		expect(await runCount()).toBe(before)
		caseStatus.set(1, 'FAIL')
		await env.ctx.rules!.checkTests()
		await env.ctx.rules!.idle()
		expect(await runCount()).toBe(before + 1)
		await until(() => !!elements.get('s')?.issue)
		expect(elements.get('t')?.issue).toBeUndefined()
		// still failing: no new run
		await env.ctx.rules!.checkTests()
		await env.ctx.rules!.idle()
		expect(await runCount()).toBe(before + 1)
		provider.destroy()
	})

	it('generates test cases from flow paths, again without duplicates', async () => {
		const board = (await eddie.post(`/api/projects/${projectId}/boards`, { name: 'Flow' })).body.board
		const url = `/api/boards/${board.id}/sparkytc/generate`
		const body = {
			sectionPath: 'co-bord / Flow',
			planName: 'Flow paths',
			planSourceRef: `cobord:${board.id}:plan:`,
			cases: [
				{ title: 'Flow: Start → OK', sourceRef: `cobord:${board.id}:path:a`, steps: [{ action: 'Start', expected: 'OK' }] },
				{ title: 'Flow: Start → Error', sourceRef: `cobord:${board.id}:path:b`, steps: [{ action: 'Start', expected: 'Error' }] },
			],
		}
		expect((await vera.post(url, body)).status).toBe(403)
		const first = await eddie.post(url, body)
		expect(first.status).toBe(200)
		expect(first.body.cases.map((c: { created: boolean }) => c.created)).toEqual([true, true])
		expect(first.body.plan).toMatchObject({ name: 'Flow paths', created: true })
		const planCall = sparkyCalls.filter((c) => c.url === 'POST /api/integration/v1/test-plans').pop()
		expect(planCall?.body).toMatchObject({ sectionIDs: ['33333333-3333-3333-3333-333333333333'] })
		const caseCall = sparkyCalls.filter((c) => c.url === 'POST /api/integration/v1/test-cases').pop()
		expect(caseCall?.body).toMatchObject({
			format: 'STEPS',
			sectionPath: 'co-bord / Flow',
			steps: [{ action: 'Start', expected: 'Error' }],
		})
		const again = await eddie.post(url, body)
		expect(again.body.cases.map((c: { created: boolean }) => c.created)).toEqual([false, false])
		expect(again.body.cases.map((c: { updated: boolean }) => c.updated)).toEqual([false, false])
		expect(sparkyCalls.filter((c) => c.url === 'POST /api/integration/v1/test-cases').pop()?.body).toMatchObject({ updateExisting: true })
		// a step renamed on the board: the same test case, updated
		const renamed = await eddie.post(url, { ...body, cases: [{ ...body.cases[0], title: 'Flow: Begin → OK' }, body.cases[1]] })
		expect(renamed.body.cases.map((c: { created: boolean; updated: boolean }) => [c.created, c.updated])).toEqual([
			[false, true],
			[false, false],
		])
		expect(renamed.body.cases[0].testCaseNumber).toBe(first.body.cases[0].testCaseNumber)
		// a SparkyTC that can't update says nothing about it
		sparkyUpdates.on = false
		expect((await eddie.post(url, body)).body.cases[0].updated).toBeUndefined()
		sparkyUpdates.on = true
		expect(again.body.plan.created).toBe(false)
		expect((await eddie.post(url, { ...body, cases: [] })).status).toBe(400)

		// the flow changed: path b is gone and c is new. b is listed as generated before, and archived
		const generated = (await eddie.get(`/api/boards/${board.id}/sparkytc/generated?section=${encodeURIComponent('co-bord / Flow')}`)).body
			.cases
		expect(generated.map((c: { title: string }) => c.title)).toEqual(['Flow: Begin → OK', 'Flow: Start → Error'])
		const b = generated[1].testCaseNumber
		const changed = {
			...body,
			cases: [
				body.cases[0],
				{ title: 'Flow: Start → Retry', sourceRef: `cobord:${board.id}:path:c`, steps: [{ action: 'Start', expected: 'Retry' }] },
			],
		}
		// a number that isn't a stale path of this board (here, path a, still current) is never sent
		const updated = await eddie.post(url, { ...changed, archive: [b, first.body.cases[0].testCaseNumber, 999] })
		expect(updated.body.archived).toEqual([b])
		expect(sparkyCalls.filter((c) => c.url === 'POST /api/integration/v1/test-cases/archive').pop()?.body).toEqual({ testCaseNumbers: [b] })
		const after = (await eddie.get(`/api/boards/${board.id}/sparkytc/generated?section=${encodeURIComponent('co-bord / Flow')}`)).body.cases
		expect(after.map((c: { title: string }) => c.title)).toEqual(['Flow: Start → OK', 'Flow: Start → Retry'])
		expect((await vera.get(`/api/boards/${board.id}/sparkytc/generated?section=x`)).status).toBe(403)

		// a SparkyTC without archiving: the test cases are created, with a message
		sparkyArchives.on = false
		const old = await eddie.post(url, { ...body, archive: [after[1].testCaseNumber] })
		expect(old.status).toBe(200)
		expect(old.body.archived).toEqual([])
		expect(old.body.archiveError).toContain('SparkyTC 2.6.0')
		sparkyArchives.on = true
	})
})

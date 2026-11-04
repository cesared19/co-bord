import { HocuspocusProvider } from '@hocuspocus/provider'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { type Client, createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
beforeAll(async () => {
	env = await startEnv()
})
afterAll(async () => env.stop())

const until = async (check: () => boolean | Promise<boolean>, ms = 10000) => {
	const start = Date.now()
	while (!(await check())) {
		if (Date.now() - start > ms) throw new Error('Timed out')
		await new Promise((r) => setTimeout(r, 50))
	}
}

function connect(boardId: string, cookie: string) {
	const document = new Y.Doc()
	class CookieWebSocket extends WebSocket {
		constructor(url: string, protocols?: string | string[]) {
			super(url, protocols, { headers: { cookie } })
		}
	}
	const messages: string[] = []
	const provider = new HocuspocusProvider({
		url: `${env.url.replace('http', 'ws')}/collab`,
		name: boardId,
		document,
		WebSocketPolyfill: CookieWebSocket,
		onStateless: ({ payload }) => messages.push(payload),
	})
	return { document, provider, messages, elements: document.getMap<Record<string, unknown>>('elements') }
}

let admin: Client
let eddie: Client
let vera: Client
let otto: Client
let board: { id: string }

describe('comments', () => {
	it('threads on elements and points, with replies, mentions, resolving and live updates', async () => {
		admin = await setupAdmin(env)
		const e = await createUser(env, admin, 'eddie')
		const v = await createUser(env, admin, 'vera')
		const o = await createUser(env, admin, 'otto')
		eddie = e.client
		vera = v.client
		otto = o.client
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${e.id}`, { role: 'editor' })
		await admin.put(`/api/projects/${project.id}/members/${v.id}`, { role: 'viewer' })
		board = (await eddie.post(`/api/projects/${project.id}/boards`, { name: 'B' })).body.board
		const base = `/api/boards/${board.id}/comments`
		const live = connect(board.id, vera.cookie)
		await until(() => live.provider.isSynced)

		expect((await otto.get(base)).status).toBe(404)
		expect((await eddie.post(base, { x: 1, y: 2, text: ' ' })).status).toBe(400)
		expect((await eddie.post(base, { elementId: 'bad id!', x: 1, y: 2, text: 'x' })).status).toBe(400)
		// viewers comment too
		const t1 = (await vera.post(base, { elementId: 'sticky1', x: 20, y: 10, text: 'Is this step right, @eddie?' })).body.id
		const t2 = (await eddie.post(base, { x: 500, y: -40, text: 'Something missing here' })).body.id
		await until(() => live.messages.includes('comments'))

		await eddie.post(`${base}/${t1}/replies`, { text: 'Yes, see the spec @otto' })
		const list = (await vera.get(base)).body.threads
		expect(list).toHaveLength(2)
		expect(list[0]).toMatchObject({ id: t1, elementId: 'sticky1', x: 20, y: 10, resolvedAt: null })
		expect(list[0].comments.map((c: { author: string; text: string }) => `${c.author}: ${c.text}`)).toEqual([
			'VERA: Is this step right, @eddie?',
			'EDDIE: Yes, see the spec @otto',
		])
		expect(list[1]).toMatchObject({ elementId: null, x: 500, y: -40 })

		// eddie was mentioned; vera gets the reply in her thread; otto isn't in the project
		const bell = async (c: Client) => (await c.get('/api/notifications')).body.notifications
		expect((await bell(eddie)).map((n: { kind: string; text: string; elementId: string }) => [n.kind, n.text, n.elementId])).toEqual([
			['comment', 'Is this step right, @eddie?', `comment:${t1}`],
		])
		expect((await bell(vera)).map((n: { text: string }) => n.text)).toEqual(['Yes, see the spec @otto'])
		expect(await bell(otto)).toEqual([])

		// resolving, and a reply opens it again
		await vera.put(`${base}/${t1}`, { resolved: true })
		let thread = (await vera.get(base)).body.threads[0]
		expect(thread.resolvedBy).toBe('VERA')
		await eddie.post(`${base}/${t1}/replies`, { text: 'One more thing' })
		thread = (await vera.get(base)).body.threads[0]
		expect(thread.resolvedAt).toBeNull()

		// authors edit; authors and editors delete; deleting the first comment deletes the thread
		const [first, reply] = thread.comments
		expect((await vera.put(`/api/boards/${board.id}/comment-items/${reply.id}`, { text: 'hacked' })).status).toBe(403)
		await eddie.put(`/api/boards/${board.id}/comment-items/${reply.id}`, { text: 'Yes, see the spec' })
		expect((await vera.get(base)).body.threads[0].comments[1]).toMatchObject({ text: 'Yes, see the spec', editedAt: expect.any(String) })
		expect((await vera.delete(`/api/boards/${board.id}/comment-items/${thread.comments[2].id}`)).status).toBe(403)
		await eddie.delete(`/api/boards/${board.id}/comment-items/${thread.comments[2].id}`)
		await vera.delete(`/api/boards/${board.id}/comment-items/${first.id}`)
		expect((await vera.get(base)).body.threads.map((t: { id: number }) => t.id)).toEqual([t2])
		live.provider.destroy()
	})
})

describe('versions', () => {
	it('saves versions automatically and by name, and restores them for everyone', async () => {
		const base = `/api/boards/${board.id}/versions`
		const a = connect(board.id, eddie.cookie)
		const b = connect(board.id, vera.cookie)
		await until(() => a.provider.isSynced && b.provider.isSynced)
		a.elements.set('n1', { id: 'n1', type: 'sticky', text: 'First' })
		// the first save while editing makes an automatic version
		await until(async () => (await vera.get(base)).body.versions.length === 1, 15000)
		expect((await vera.get(base)).body.versions[0]).toMatchObject({ auto: true, name: null, createdBy: 'EDDIE' })

		expect((await vera.post(base, { name: 'Nope' })).status).toBe(403)
		const named = (await eddie.post(base, { name: 'Before the workshop' })).body.id
		a.elements.set('n2', { id: 'n2', type: 'sticky', text: 'Second' })
		a.elements.set('n1', { id: 'n1', type: 'sticky', text: 'First, changed' })
		await new Promise((r) => setTimeout(r, 300))

		const doc = await env.app.inject({ method: 'GET', url: `${base}/${named}`, headers: { cookie: vera.cookie } })
		const saved = new Y.Doc()
		Y.applyUpdate(saved, new Uint8Array(doc.rawPayload))
		expect(saved.getMap('elements').get('n1')).toMatchObject({ text: 'First' })
		expect(saved.getMap('elements').has('n2')).toBe(false)

		expect((await vera.post(`${base}/${named}/restore`)).status).toBe(403)
		const restored = await eddie.post(`${base}/${named}/restore`)
		expect(restored.status).toBe(200)
		// both people see it, and the state before the restore was saved
		await until(() => !b.elements.has('n2') && (b.elements.get('n1') as { text?: string })?.text === 'First')
		expect(a.elements.has('n2')).toBe(false)
		const versions = (await vera.get(base)).body.versions
		expect(versions[0]).toMatchObject({ id: restored.body.savedId, name: 'Before restoring Before the workshop', auto: false })

		// naming an automatic version keeps it; deleting
		const auto = versions.find((v: { auto: boolean }) => v.auto)
		await eddie.put(`${base}/${auto.id}`, { name: 'Kickoff' })
		expect((await vera.get(base)).body.versions.find((v: { id: number }) => v.id === auto.id)).toMatchObject({
			name: 'Kickoff',
			auto: false,
		})
		expect((await eddie.delete(`${base}/${auto.id}`)).status).toBe(200)
		expect((await otto.get(base)).status).toBe(404)
		a.provider.destroy()
		b.provider.destroy()
	})
})

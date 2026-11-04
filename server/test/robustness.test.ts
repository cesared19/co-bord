import { HocuspocusProvider } from '@hocuspocus/provider'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { Client, createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

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
	const closes: string[] = []
	let denied = false
	const provider = new HocuspocusProvider({
		url: `${env.url.replace('http', 'ws')}/collab`,
		name: boardId,
		document,
		WebSocketPolyfill: CookieWebSocket,
		onClose: ({ event }) => closes.push(event.reason),
		onAuthenticationFailed: () => {
			denied = true
		},
	})
	return { document, provider, closes, isDenied: () => denied, elements: document.getMap<Record<string, unknown>>('elements') }
}

async function upload(cookie: string, boardId: string, name: string) {
	const form = new FormData()
	form.append('file', new Blob(['png bytes'], { type: 'image/png' }), name)
	const res = await fetch(`${env.url}/api/boards/${boardId}/assets`, { method: 'POST', headers: { cookie }, body: form })
	return (await res.json()).asset as { id: string; url: string }
}

let admin: Client
let eddie: Client
let eddieId: number
let vera: Client
let veraId: number

describe('robustness', () => {
	it('locks sign-ins after 5 failures for 15 minutes, and admins can unlock', async () => {
		admin = await setupAdmin(env)
		;({ client: eddie, id: eddieId } = await createUser(env, admin, 'eddie'))
		;({ client: vera, id: veraId } = await createUser(env, admin, 'vera'))
		const login = (username: string, password: string) => new Client(env).post('/api/auth/login', { username, password })

		for (let i = 0; i < 4; i++) expect((await login('eddie', 'wrong')).status).toBe(401)
		const fifth = await login('Eddie', 'wrong')
		expect(fifth.status).toBe(429)
		expect(fifth.body.error).toBe('Too many failed sign-ins. Try again in 15 minutes.')
		// even the right password waits
		expect((await login('eddie', 'password123')).status).toBe(429)
		const users = (await admin.get('/api/users')).body.users
		expect(users.find((u: { username: string }) => u.username === 'eddie').lockedUntil).toBeTruthy()
		expect(users.find((u: { username: string }) => u.username === 'vera').lockedUntil).toBeNull()
		expect((await eddie.delete(`/api/users/${eddieId}/lock`)).status).toBe(403)

		// the address is locked too (the tests all come from 127.0.0.1); unlocking the user unlocks it
		expect((await login('vera', 'password123')).status).toBe(429)
		expect((await admin.delete(`/api/users/${eddieId}/lock`)).status).toBe(200)
		expect((await login('eddie', 'password123')).status).toBe(200)

		// failures from one address over several usernames lock the address
		for (let i = 0; i < 4; i++) expect((await login(`nobody${i}`, 'x')).status).toBe(401)
		expect((await login('nobody9', 'x')).status).toBe(429)
		expect((await login('vera', 'password123')).status).toBe(429)
		await env.db.query("DELETE FROM login_locks WHERE key LIKE 'ip:%'")
		// a success clears the count
		for (let i = 0; i < 4; i++) await login('vera', 'wrong')
		expect((await login('vera', 'password123')).status).toBe(200)
		expect((await login('vera', 'wrong')).status).toBe(401)
		await env.db.query('DELETE FROM login_locks')
	})

	it('closes live board connections when access changes', async () => {
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${eddieId}`, { role: 'editor' })
		await admin.put(`/api/projects/${project.id}/members/${veraId}`, { role: 'editor' })
		const board = (await eddie.post(`/api/projects/${project.id}/boards`, { name: 'B' })).body.board
		const e = connect(board.id, eddie.cookie)
		const v = connect(board.id, vera.cookie)
		await until(() => e.provider.isSynced && v.provider.isSynced)
		e.elements.set('a', { id: 'a', text: 'hi' })
		await until(() => !!v.elements.get('a'))

		// vera becomes a viewer: her connection is closed, and when she opens it again (the app does) it's read-only
		await admin.put(`/api/projects/${project.id}/members/${veraId}`, { role: 'viewer' })
		await until(() => v.closes.includes('Access changed'))
		expect(e.closes).toEqual([])
		v.provider.destroy()
		const v2 = connect(board.id, vera.cookie)
		await until(() => v2.provider.isSynced)
		v2.elements.set('b', { id: 'b', text: 'from a viewer' })
		e.elements.set('c', { id: 'c', text: 'from an editor' })
		await until(() => !!v2.elements.get('c'))
		await new Promise((r) => setTimeout(r, 300))
		expect(e.elements.get('b')).toBeUndefined()

		// removed from the project: closed, and turned away when opening it again
		await admin.delete(`/api/projects/${project.id}/members/${veraId}`)
		await until(() => v2.closes.includes('Access changed'))
		v2.provider.destroy()
		const v3 = connect(board.id, vera.cookie)
		await until(() => v3.isDenied())
		v3.provider.destroy()
		// a password reset by an admin signs eddie out of live boards too
		await admin.put(`/api/users/${eddieId}/password`, { password: 'password456' })
		await until(() => e.closes.includes('Access changed'))
		e.provider.destroy()
		const e2 = connect(board.id, eddie.cookie)
		await until(() => e2.isDenied())
		e2.provider.destroy()
		await eddie.post('/api/auth/login', { username: 'eddie', password: 'password456' })
	})

	it("copies pasted files into the board's project, for people who can read them", async () => {
		const a = (await admin.post('/api/projects', { name: 'A' })).body.project
		const b = (await admin.post('/api/projects', { name: 'B' })).body.project
		await admin.put(`/api/projects/${a.id}/members/${eddieId}`, { role: 'editor' })
		await admin.put(`/api/projects/${b.id}/members/${eddieId}`, { role: 'editor' })
		await admin.put(`/api/projects/${b.id}/members/${veraId}`, { role: 'editor' })
		const boardA = (await eddie.post(`/api/projects/${a.id}/boards`, { name: 'A' })).body.board
		const boardB = (await eddie.post(`/api/projects/${b.id}/boards`, { name: 'B' })).body.board
		const asset = await upload(eddie.cookie, boardA.id, 'shot.png')
		const local = await upload(eddie.cookie, boardB.id, 'here.png')
		const read = (c: Client, url: string) => fetch(`${env.url}${url}`, { headers: { cookie: c.cookie } })
		expect((await read(vera, asset.url)).status).toBe(404)

		const copied = await eddie.post(`/api/boards/${boardB.id}/assets/copy`, { ids: [asset.id, local.id] })
		expect(copied.status).toBe(200)
		const copy = copied.body.assets[asset.id]
		expect(copy.id).not.toBe(asset.id)
		expect(copied.body.assets[local.id]).toEqual({ id: local.id, url: local.url })
		const res = await read(vera, copy.url)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('png bytes')
		const { rows } = await env.db.query('SELECT project_id, name FROM assets WHERE id = $1', [copy.id])
		expect(rows[0]).toEqual({ project_id: b.id, name: 'shot.png' })

		// vera can't read project A's file, so she gets nothing to copy
		expect((await vera.post(`/api/boards/${boardB.id}/assets/copy`, { ids: [asset.id] })).body.assets).toEqual({})
		expect((await vera.post(`/api/boards/${boardA.id}/assets/copy`, { ids: [asset.id] })).status).toBe(404)
		expect((await eddie.post(`/api/boards/${boardB.id}/assets/copy`, { ids: ['nope'] })).status).toBe(400)
	})

	it('deletes uploaded files no board has used for 30 days', async () => {
		const project = (await admin.post('/api/projects', { name: 'Files' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${eddieId}`, { role: 'editor' })
		const board = (await eddie.post(`/api/projects/${project.id}/boards`, { name: 'F' })).body.board
		const used = await upload(eddie.cookie, board.id, 'used.png')
		const byUrl = await upload(eddie.cookie, board.id, 'link.png')
		const unused = await upload(eddie.cookie, board.id, 'unused.png')
		const e = connect(board.id, eddie.cookie)
		await until(() => e.provider.isSynced)
		e.elements.set('m1', { id: 'm1', type: 'media', kind: 'image', assetId: used.id, src: used.url })
		e.elements.set('m2', { id: 'm2', type: 'media', kind: 'link', src: `${byUrl.url}#x` })
		await new Promise((r) => setTimeout(r, 300))

		const since = async (id: string) =>
			(await env.db.query<{ unused_since: Date | null }>('SELECT unused_since FROM assets WHERE id = $1', [id])).rows[0]?.unused_since
		expect(await env.ctx.cleanupAssets!()).toEqual({ deleted: 0 })
		expect(await since(used.id)).toBeNull()
		expect(await since(byUrl.id)).toBeNull()
		expect(await since(unused.id)).toBeTruthy()

		await env.db.query("UPDATE assets SET unused_since = now() - interval '31 days' WHERE id = ANY($1)", [[unused.id, used.id]])
		expect(await env.ctx.cleanupAssets!()).toEqual({ deleted: 1 })
		expect(await since(unused.id)).toBeUndefined()
		expect(await since(used.id)).toBeNull()
		expect((await fetch(`${env.url}${unused.url}`, { headers: { cookie: eddie.cookie } })).status).toBe(404)

		// stored boards count too, not only open ones
		e.provider.destroy()
		await until(async () => !(await env.db.query('SELECT 1 FROM boards WHERE id = $1 AND document IS NULL', [board.id])).rowCount)
		await new Promise((r) => setTimeout(r, 500))
		await env.db.query("UPDATE assets SET unused_since = now() - interval '31 days' WHERE id = $1", [used.id])
		expect(await env.ctx.cleanupAssets!()).toEqual({ deleted: 0 })
		expect(await since(used.id)).toBeNull()
	})
})

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

function connect(boardId: string, opts: { cookie?: string; token?: string }) {
	const document = new Y.Doc()
	class CookieWebSocket extends WebSocket {
		constructor(url: string, protocols?: string | string[]) {
			super(url, protocols, { headers: opts.cookie ? { cookie: opts.cookie } : {} })
		}
	}
	const closes: string[] = []
	let denied = ''
	const provider = new HocuspocusProvider({
		url: `${env.url.replace('http', 'ws')}/collab`,
		name: boardId,
		document,
		token: opts.token,
		WebSocketPolyfill: CookieWebSocket,
		onClose: ({ event }) => closes.push(event.reason),
		onAuthenticationFailed: ({ reason }) => {
			denied = reason || 'denied'
		},
	})
	return { document, provider, closes, denied: () => denied, elements: document.getMap<Record<string, unknown>>('elements') }
}

async function upload(cookie: string, boardId: string) {
	const form = new FormData()
	form.append('file', new Blob(['png bytes'], { type: 'image/png' }), 'shot.png')
	const res = await fetch(`${env.url}/api/boards/${boardId}/assets`, { method: 'POST', headers: { cookie }, body: form })
	return (await res.json()).asset as { id: string; url: string }
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

let admin: Client
let olivia: Client
let eddie: Client
let vera: Client
let projectId: number
let boardId: string

describe('project templates', () => {
	it('are saved by editors, used by members and deleted by their author or an owner', async () => {
		admin = await setupAdmin(env)
		const o = await createUser(env, admin, 'olivia')
		const e = await createUser(env, admin, 'eddie')
		const v = await createUser(env, admin, 'vera')
		olivia = o.client
		eddie = e.client
		vera = v.client
		projectId = (await admin.post('/api/projects', { name: 'P' })).body.project.id
		await admin.put(`/api/projects/${projectId}/members/${o.id}`, { role: 'owner' })
		await admin.put(`/api/projects/${projectId}/members/${e.id}`, { role: 'editor' })
		await admin.put(`/api/projects/${projectId}/members/${v.id}`, { role: 'viewer' })
		boardId = (await eddie.post(`/api/projects/${projectId}/boards`, { name: 'B' })).body.board.id
		const base = `/api/projects/${projectId}/templates`
		const asset = await upload(eddie.cookie, boardId)
		const elements = [
			{ id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Kickoff', fill: 'auto', z: 1 },
			{ id: 'm', type: 'media', kind: 'image', assetId: asset.id, src: asset.url, x: 20, y: 20, w: 100, h: 100, name: 'shot.png', z: 2 },
		]

		expect((await vera.post(base, { name: 'Nope', elements })).status).toBe(403)
		expect((await eddie.post(base, { name: 'Empty', elements: [] })).status).toBe(400)
		expect((await eddie.post(base, { name: 'Bad', elements: [{ x: 1 }] })).status).toBe(400)
		expect((await eddie.post(base, { name: 'Bad pic', elements, thumbnail: 'data:text/html;base64,PGI+' })).status).toBe(400)
		const id = (await eddie.post(base, { name: 'Kickoff', description: 'Agenda and goals', elements, thumbnail: PNG })).body.id
		const list = (await vera.get(base)).body.templates
		expect(list).toEqual([
			expect.objectContaining({
				id,
				name: 'Kickoff',
				description: 'Agenda and goals',
				elementCount: 2,
				createdByName: 'EDDIE',
				thumbnail: `${base}/${id}/thumbnail`,
			}),
		])
		expect((await vera.get(`${base}/${id}`)).body.elements).toEqual(elements)
		const thumb = await env.app.inject({ method: 'GET', url: `${base}/${id}/thumbnail`, headers: { cookie: vera.cookie } })
		expect(thumb.headers['content-type']).toBe('image/png')

		// the file stays while only the template uses it
		await env.db.query("UPDATE assets SET unused_since = now() - interval '40 days'")
		expect(await env.ctx.cleanupAssets!()).toEqual({ deleted: 0 })

		expect((await vera.delete(`${base}/${id}`)).status).toBe(403)
		const other = (await eddie.post(base, { name: 'Other', elements })).body.id
		expect((await olivia.delete(`${base}/${other}`)).status).toBe(200)
		expect((await eddie.delete(`${base}/${id}`)).status).toBe(200)
		expect((await vera.get(base)).body.templates).toEqual([])
		const outsider = (await createUser(env, admin, 'otto')).client
		expect((await outsider.get(base)).status).toBe(404)
	})
})

describe('guest links', () => {
	it('open a board read-only and live, without an account, until revoked or expired', async () => {
		const base = `/api/boards/${boardId}/share-links`
		expect((await eddie.post(base, {})).status).toBe(403)
		expect((await olivia.post(base, { expiresInDays: 0 })).status).toBe(400)
		const link = (await olivia.post(base, { expiresInDays: 7 })).body
		expect(link.token).toMatch(/^g_/)
		expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000)
		expect((await olivia.get(base)).body.links).toEqual([
			expect.objectContaining({ id: link.id, token: link.token, createdBy: 'OLIVIA', expired: false }),
		])

		// no session at all
		const anonymous = new Client(env)
		expect((await anonymous.get(`/api/guest/${link.token}`)).body).toEqual({ board: { id: boardId, name: 'B' } })
		expect((await anonymous.get('/api/guest/g_nope')).status).toBe(404)
		expect((await anonymous.get(`/api/boards/${boardId}/comments`)).status).toBe(401)

		const editor = connect(boardId, { cookie: eddie.cookie })
		const guest = connect(boardId, { token: link.token })
		await until(() => editor.provider.isSynced && guest.provider.isSynced)
		editor.elements.set('n1', { id: 'n1', type: 'sticky', text: 'Live for guests' })
		await until(() => !!guest.elements.get('n1'))
		guest.elements.set('g1', { id: 'g1', type: 'sticky', text: 'From a guest' })
		await new Promise((r) => setTimeout(r, 300))
		expect(editor.elements.has('g1')).toBe(false)

		// a link for another board doesn't open this one
		const other = (await eddie.post(`/api/projects/${projectId}/boards`, { name: 'Other' })).body.board.id
		const wrong = connect(other, { token: link.token })
		await until(() => !!wrong.denied())
		wrong.provider.destroy()

		// files of the project, with the link
		const asset = await upload(eddie.cookie, boardId)
		expect((await fetch(`${env.url}${asset.url}?guest=${link.token}`)).status).toBe(200)
		expect((await fetch(`${env.url}${asset.url}`)).status).toBe(401)
		const p2 = (await admin.post('/api/projects', { name: 'Elsewhere' })).body.project.id
		const b2 = (await admin.post(`/api/projects/${p2}/boards`, { name: 'X' })).body.board.id
		const foreign = await upload(admin.cookie, b2)
		expect((await fetch(`${env.url}${foreign.url}?guest=${link.token}`)).status).toBe(404)

		// revoking closes the guest's board and the link stops working
		expect((await eddie.delete(`${base}/${link.id}`)).status).toBe(403)
		await olivia.delete(`${base}/${link.id}`)
		await until(() => guest.closes.includes('Access changed'))
		expect(editor.closes).toEqual([])
		guest.provider.destroy()
		const again = connect(boardId, { token: link.token })
		await until(() => !!again.denied())
		again.provider.destroy()
		expect((await anonymous.get(`/api/guest/${link.token}`)).status).toBe(404)
		expect((await olivia.get(base)).body.links).toEqual([])

		// expired links stop working too
		const old = (await olivia.post(base, {})).body
		expect(old.expiresAt).toBeNull()
		await env.db.query("UPDATE board_share_links SET expires_at = now() - interval '1 minute' WHERE id = $1", [old.id])
		expect((await anonymous.get(`/api/guest/${old.token}`)).status).toBe(404)
		expect((await olivia.get(base)).body.links[0]).toMatchObject({ id: old.id, expired: true })
		editor.provider.destroy()
	})
})

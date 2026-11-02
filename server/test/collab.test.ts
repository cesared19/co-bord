import { HocuspocusProvider } from '@hocuspocus/provider'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
beforeAll(async () => {
	env = await startEnv()
})
afterAll(async () => env.stop())

function connect(boardId: string, cookie: string, origin?: string) {
	const document = new Y.Doc()
	class CookieWebSocket extends WebSocket {
		constructor(url: string, protocols?: string | string[]) {
			super(url, protocols, { headers: { cookie, ...(origin ? { origin } : {}) } })
		}
	}
	let failure: string | null = null
	const provider = new HocuspocusProvider({
		url: `${env.url.replace('http', 'ws')}/collab`,
		name: boardId,
		document,
		WebSocketPolyfill: CookieWebSocket,
		onAuthenticationFailed: ({ reason }) => {
			failure = reason
		},
	})
	return { document, provider, failure: () => failure }
}

const until = async (check: () => boolean, ms = 10000) => {
	const start = Date.now()
	while (!check()) {
		if (Date.now() - start > ms) throw new Error('Timed out')
		await new Promise((r) => setTimeout(r, 50))
	}
}

describe('collaboration', () => {
	it('syncs changes between members, keeps viewers read-only and stores the board', async () => {
		const admin = await setupAdmin(env)
		const { client: editor, id: editorId } = await createUser(env, admin, 'eddie')
		const { client: viewer, id: viewerId } = await createUser(env, admin, 'vera')
		const { client: outsider } = await createUser(env, admin, 'olga')
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${editorId}`, { role: 'editor' })
		await admin.put(`/api/projects/${project.id}/members/${viewerId}`, { role: 'viewer' })
		const board = (await editor.post(`/api/projects/${project.id}/boards`, { name: 'B' })).body.board

		const a = connect(board.id, editor.cookie)
		const b = connect(board.id, viewer.cookie)
		const c = connect(board.id, outsider.cookie)
		const foreign = connect(board.id, editor.cookie, 'http://evil.example')
		await until(() => a.provider.isSynced && b.provider.isSynced)
		await until(() => c.failure() !== null && foreign.failure() !== null)
		foreign.provider.destroy()

		a.document.getMap('elements').set('one', { type: 'shape', x: 10 })
		await until(() => b.document.getMap('elements').has('one'))

		// the viewer's change stays local
		b.document.getMap('elements').set('two', { type: 'shape', x: 20 })
		await new Promise((r) => setTimeout(r, 500))
		expect(a.document.getMap('elements').has('two')).toBe(false)

		a.provider.destroy()
		b.provider.destroy()
		c.provider.destroy()

		// duplicating stores pending changes first
		const copy = (await editor.post(`/api/boards/${board.id}/duplicate`)).body.board
		const { rows } = await env.db.query('SELECT document FROM boards WHERE id = $1', [copy.id])
		const stored = new Y.Doc()
		Y.applyUpdate(stored, new Uint8Array(rows[0].document))
		expect(stored.getMap('elements').toJSON()).toEqual({ one: { type: 'shape', x: 10 } })

		const reopened = connect(copy.id, editor.cookie)
		await until(() => reopened.provider.isSynced)
		expect(reopened.document.getMap('elements').get('one')).toEqual({ type: 'shape', x: 10 })
		reopened.provider.destroy()
	})
})

import { HocuspocusProvider } from '@hocuspocus/provider'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { describe as describeElement, mentionsIn } from '../src/notify.js'
import { type Client, createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
beforeAll(async () => {
	env = await startEnv()
})
afterAll(async () => env.stop())

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
const settle = () => new Promise((r) => setTimeout(r, 600))
const inbox = async (c: Client) => (await c.get('/api/notifications')).body

describe('mentions', () => {
	it('finds @usernames and describes elements', () => {
		expect([...mentionsIn({ text: 'Ask @Ana.Lopez and mail a@b.com, @bo too. @ana.lopez' })]).toEqual(['ana.lopez'])
		expect([...mentionsIn({ label: '@eddie', title: 'by @vera' })].sort()).toEqual(['eddie', 'vera'])
		expect(describeElement({ type: 'sticky', text: '  Line\n two ' })).toBe('Line two')
		expect(describeElement({ type: 'shape', text: '' })).toBe('A shape')
	})
})

describe('notifications', () => {
	it('notifies new mentions and followers, merges follow changes, and respects access and preferences', async () => {
		const admin = await setupAdmin(env)
		const { client: eddie, id: eddieId } = await createUser(env, admin, 'eddie')
		const { client: vera, id: veraId } = await createUser(env, admin, 'vera')
		const { client: otto } = await createUser(env, admin, 'otto')
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${eddieId}`, { role: 'editor' })
		await admin.put(`/api/projects/${project.id}/members/${veraId}`, { role: 'viewer' })
		const board = (await eddie.post(`/api/projects/${project.id}/boards`, { name: 'Retro' })).body.board

		// vera follows one sticky note; otto can't follow a board he can't open
		expect((await vera.put(`/api/boards/${board.id}/follows`, { elementId: 'one', follow: true })).status).toBe(200)
		expect((await otto.put(`/api/boards/${board.id}/follows`, { follow: true })).status).toBe(404)
		expect((await vera.get(`/api/boards/${board.id}/follows`)).body).toEqual({ board: false, elements: ['one'] })

		const e = connect(board.id, eddie.cookie)
		await until(() => e.provider.isSynced)
		e.elements.set('one', { id: 'one', type: 'sticky', text: 'Ask @vera, @otto and @eddie' })
		await until(async () => (await inbox(vera)).unread === 2)
		await settle()
		const first = await inbox(vera)
		// mentioned, and the note she follows changed
		expect(first.notifications.map((n: { kind: string }) => n.kind).sort()).toEqual(['follow', 'mention'])
		const mention = first.notifications.find((n: { kind: string }) => n.kind === 'mention')
		expect(mention).toMatchObject({
			boardId: board.id,
			boardName: 'Retro',
			elementId: 'one',
			text: 'Ask @vera, @otto and @eddie',
			actor: { name: 'EDDIE' },
		})
		// outsiders and the author aren't notified
		expect((await inbox(otto)).unread).toBe(0)
		expect((await inbox(eddie)).unread).toBe(0)

		// editing again: only the new mention notifies; followers get one merged notification
		await vera.post('/api/notifications/read', { all: true })
		e.elements.set('one', { id: 'one', type: 'sticky', text: 'Ask @vera, @otto, @eddie and @admin' })
		await until(async () => (await inbox(admin)).unread === 1)
		e.elements.set('one', { id: 'one', type: 'sticky', text: 'Ask @vera, @otto, @eddie and @admin!' })
		await settle()
		await settle()
		const second = await inbox(vera)
		const unread = second.notifications.filter((n: { read: boolean }) => !n.read)
		expect(unread.map((n: { kind: string }) => n.kind)).toEqual(['follow'])
		expect(unread[0].count).toBeGreaterThanOrEqual(2)
		expect(unread[0].text).toBe('Ask @vera, @otto, @eddie and @admin!')

		// reading and clearing
		await vera.post('/api/notifications/read', { ids: [unread[0].id] })
		expect((await inbox(vera)).unread).toBe(0)
		await vera.delete('/api/notifications/read')
		expect((await inbox(vera)).notifications).toEqual([])

		// preferences: no more mentions for vera
		expect((await vera.put('/api/account/notifications', { mentions: false })).body).toEqual({
			mentions: false,
			follows: true,
			rules: true,
		})
		e.elements.set('two', { id: 'two', type: 'text', text: 'cc @vera' })
		await settle()
		await settle()
		expect((await inbox(vera)).notifications).toEqual([])

		// a board that is opened again remembers mentions already there
		await vera.put('/api/account/notifications', { mentions: true })
		e.provider.destroy()
		await new Promise((r) => setTimeout(r, 1500))
		const again = connect(board.id, eddie.cookie)
		await until(() => again.provider.isSynced)
		again.elements.set('one', { id: 'one', type: 'sticky', text: 'Ask @vera, @otto, @eddie and @admin!!' })
		await settle()
		await settle()
		expect((await inbox(vera)).notifications.filter((n: { kind: string }) => n.kind === 'mention')).toEqual([])
		again.provider.destroy()

		// losing access hides the notifications
		await admin.delete(`/api/projects/${project.id}/members/${veraId}`)
		expect((await inbox(vera)).notifications).toEqual([])
	})
})

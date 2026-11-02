import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
beforeAll(async () => {
	env = await startEnv()
})
afterAll(async () => env.stop())

describe('setup and accounts', () => {
	it('creates the first admin only once', async () => {
		const anon = new Client(env)
		expect((await anon.get('/api/setup')).body).toEqual({ needsSetup: true })
		expect((await anon.get('/api/auth/me')).status).toBe(401)
		const admin = await setupAdmin(env)
		expect((await admin.get('/api/auth/me')).body.user).toMatchObject({ username: 'admin', isAdmin: true })
		expect((await anon.get('/api/setup')).body).toEqual({ needsSetup: false })
		const again = await anon.post('/api/setup', { username: 'other', displayName: 'Other', password: 'password123' })
		expect(again.status).toBe(409)
	})

	it('logs in case-insensitively, rejects wrong passwords and logs out', async () => {
		const c = new Client(env)
		expect((await c.post('/api/auth/login', { username: 'ADMIN', password: 'nope' })).status).toBe(401)
		expect((await c.post('/api/auth/login', { username: 'ADMIN', password: 'password123' })).status).toBe(200)
		expect((await c.get('/api/auth/me')).status).toBe(200)
		await c.post('/api/auth/logout')
		c.cookie = c.cookie || ''
		expect((await c.get('/api/auth/me')).status).toBe(401)
	})

	it('only admins manage users; usernames are unique ignoring case', async () => {
		const admin = new Client(env)
		await admin.post('/api/auth/login', { username: 'admin', password: 'password123' })
		const { client: ana } = await createUser(env, admin, 'ana')
		expect((await ana.get('/api/users')).status).toBe(403)
		expect((await ana.post('/api/users', { username: 'x', displayName: 'x', password: 'password123' })).status).toBe(403)
		const dup = await admin.post('/api/users', { username: 'ANA', displayName: 'Ana 2', password: 'password123' })
		expect(dup.status).toBe(409)
		expect((await admin.post('/api/users', { username: 'bo', displayName: 'Bo', password: 'short' })).status).toBe(400)
	})

	it('changing the password signs out other sessions', async () => {
		const admin = new Client(env)
		await admin.post('/api/auth/login', { username: 'admin', password: 'password123' })
		const { client: first } = await createUser(env, admin, 'carla')
		const second = new Client(env)
		await second.post('/api/auth/login', { username: 'carla', password: 'password123' })
		const wrong = await first.put('/api/account/password', { currentPassword: 'bad', newPassword: 'newpassword1' })
		expect(wrong.status).toBe(400)
		const ok = await first.put('/api/account/password', { currentPassword: 'password123', newPassword: 'newpassword1' })
		expect(ok.status).toBe(200)
		expect((await first.get('/api/auth/me')).status).toBe(200)
		expect((await second.get('/api/auth/me')).status).toBe(401)
	})
})

describe('projects and boards', () => {
	it('applies project visibility and roles', async () => {
		const admin = new Client(env)
		await admin.post('/api/auth/login', { username: 'admin', password: 'password123' })
		const { client: editor, id: editorId } = await createUser(env, admin, 'eddie')
		const { client: viewer, id: viewerId } = await createUser(env, admin, 'vera')
		const { client: outsider } = await createUser(env, admin, 'olga')

		expect((await editor.post('/api/projects', { name: 'Nope' })).status).toBe(403)
		const project = (await admin.post('/api/projects', { name: 'Checkout', description: 'Payments' })).body.project
		expect((await admin.put(`/api/projects/${project.id}/members/${editorId}`, { role: 'editor' })).status).toBe(200)
		expect((await admin.put(`/api/projects/${project.id}/members/${viewerId}`, { role: 'viewer' })).status).toBe(200)

		expect((await outsider.get('/api/projects')).body.projects).toEqual([])
		expect((await outsider.get(`/api/projects/${project.id}`)).status).toBe(404)
		expect((await editor.get('/api/projects')).body.projects).toMatchObject([{ name: 'Checkout', role: 'editor' }])

		const board = (await editor.post(`/api/projects/${project.id}/boards`, { name: 'Login flow' })).body.board
		expect(board).toMatchObject({ name: 'Login flow', createdByName: 'EDDIE' })
		expect((await viewer.post(`/api/projects/${project.id}/boards`, { name: 'x' })).status).toBe(403)
		expect((await viewer.get(`/api/boards/${board.id}`)).body.board).toMatchObject({ role: 'viewer', projectName: 'Checkout' })
		expect((await outsider.get(`/api/boards/${board.id}`)).status).toBe(404)
		expect((await outsider.get('/api/boards/not-a-uuid')).status).toBe(404)

		expect((await viewer.put(`/api/boards/${board.id}`, { name: 'Renamed' })).status).toBe(403)
		expect((await editor.put(`/api/boards/${board.id}`, { name: 'Renamed' })).status).toBe(200)
		const copy = (await editor.post(`/api/boards/${board.id}/duplicate`)).body.board
		expect(copy.name).toBe('Renamed (copy)')
		expect((await editor.get(`/api/projects/${project.id}/boards`)).body.boards).toHaveLength(2)

		expect((await editor.delete(`/api/boards/${copy.id}`)).status).toBe(403)
		expect((await admin.delete(`/api/boards/${copy.id}`)).status).toBe(200)
		expect((await editor.get(`/api/boards/${copy.id}`)).status).toBe(404)
	})

	it('keeps at least one owner', async () => {
		const admin = new Client(env)
		await admin.post('/api/auth/login', { username: 'admin', password: 'password123' })
		const me = (await admin.get('/api/auth/me')).body.user
		const project = (await admin.post('/api/projects', { name: 'Solo' })).body.project
		expect((await admin.put(`/api/projects/${project.id}/members/${me.id}`, { role: 'viewer' })).status).toBe(400)
		expect((await admin.delete(`/api/projects/${project.id}/members/${me.id}`)).status).toBe(400)
	})
})

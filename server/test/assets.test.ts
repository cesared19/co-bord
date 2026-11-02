import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
beforeAll(async () => {
	env = await startEnv()
})
afterAll(async () => env.stop())

async function upload(cookie: string, boardId: string, name: string, type: string, data: Uint8Array | string) {
	const form = new FormData()
	form.append('file', new Blob([data], { type }), name)
	const res = await fetch(`${env.url}/api/boards/${boardId}/assets`, { method: 'POST', headers: { cookie }, body: form })
	return { status: res.status, body: await res.json() }
}

describe('assets', () => {
	it('uploads, serves with ranges and applies project access', async () => {
		const admin = await setupAdmin(env)
		const { client: editor, id: editorId } = await createUser(env, admin, 'eddie')
		const { client: viewer, id: viewerId } = await createUser(env, admin, 'vera')
		const { client: outsider } = await createUser(env, admin, 'olga')
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${editorId}`, { role: 'editor' })
		await admin.put(`/api/projects/${project.id}/members/${viewerId}`, { role: 'viewer' })
		const board = (await editor.post(`/api/projects/${project.id}/boards`, { name: 'B' })).body.board

		const pdf = '%PDF-1.4 fake pdf bytes 0123456789'
		const up = await upload(editor.cookie, board.id, 'spec é.pdf', 'application/pdf', pdf)
		expect(up.status).toBe(200)
		expect(up.body.asset).toMatchObject({ name: 'spec é.pdf', contentType: 'application/pdf', kind: 'pdf', size: pdf.length })

		expect((await upload(viewer.cookie, board.id, 'a.pdf', 'application/pdf', pdf)).status).toBe(403)
		expect((await upload(outsider.cookie, board.id, 'a.pdf', 'application/pdf', pdf)).status).toBe(404)
		const html = await upload(editor.cookie, board.id, 'x.html', 'text/html', '<script>alert(1)</script>')
		expect(html.status).toBe(400)
		const big = await upload(editor.cookie, board.id, 'big.mp4', 'video/mp4', new Uint8Array(1024 * 1024 + 10))
		expect(big.status).toBe(413)
		expect(big.body.error).toContain('1 MB')

		const url = `${env.url}${up.body.asset.url}`
		const full = await fetch(url, { headers: { cookie: viewer.cookie } })
		expect(full.status).toBe(200)
		expect(full.headers.get('content-type')).toBe('application/pdf')
		expect(full.headers.get('content-security-policy')).toContain('sandbox')
		expect(await full.text()).toBe(pdf)

		const part = await fetch(url, { headers: { cookie: viewer.cookie, range: 'bytes=5-9' } })
		expect(part.status).toBe(206)
		expect(part.headers.get('content-range')).toBe(`bytes 5-9/${pdf.length}`)
		expect(await part.text()).toBe(pdf.slice(5, 10))
		const tail = await fetch(url, { headers: { cookie: viewer.cookie, range: 'bytes=-4' } })
		expect(await tail.text()).toBe(pdf.slice(-4))
		expect((await fetch(url, { headers: { cookie: viewer.cookie, range: 'bytes=999-' } })).status).toBe(416)

		expect((await fetch(url, { headers: { cookie: outsider.cookie } })).status).toBe(404)
		expect((await fetch(url)).status).toBe(401)

		// deleting the board keeps the file (copies of the board may use it); deleting the project removes it
		await admin.delete(`/api/boards/${board.id}`)
		expect((await fetch(url, { headers: { cookie: editor.cookie } })).status).toBe(200)
		await admin.delete(`/api/projects/${project.id}`)
		expect((await fetch(url, { headers: { cookie: admin.cookie } })).status).toBe(404)
		const { rows } = await env.db.query('SELECT count(*)::int AS n FROM assets')
		expect(rows[0].n).toBe(0)
	})
})

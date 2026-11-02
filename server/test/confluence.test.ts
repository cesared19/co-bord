import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { excerpt, pageIdFrom } from '../src/confluence.js'
import { startFakeConfluence } from './fakeConfluence.js'
import { createUser, setupAdmin, startEnv, type TestEnv } from './helpers.js'

let env: TestEnv
let fake: Awaited<ReturnType<typeof startFakeConfluence>>

beforeAll(async () => {
	env = await startEnv()
	fake = await startFakeConfluence()
})
afterAll(async () => {
	await env.stop()
	await fake.app.close()
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

async function publish(cookie: string, boardId: string, meta: object, image = true) {
	const form = new FormData()
	form.append('meta', JSON.stringify(meta))
	if (image) form.append('image', new Blob([PNG], { type: 'image/png' }), 'board.png')
	const res = await fetch(`${env.url}/api/boards/${boardId}/confluence/publish`, { method: 'POST', headers: { cookie }, body: form })
	return { status: res.status, body: await res.json() }
}

describe('helpers', () => {
	it('reads page ids and excerpts', () => {
		expect(pageIdFrom('https://team.atlassian.net/wiki/spaces/QA/pages/12345/My+page')).toBe('12345')
		expect(pageIdFrom('https://team.atlassian.net/wiki/pages/viewpage.action?pageId=777')).toBe('777')
		expect(pageIdFrom('42')).toBe('42')
		expect(pageIdFrom('nope')).toBeNull()
		expect(excerpt('<h1>A</h1><p>b &amp; c&nbsp;d <script>x</script></p>')).toBe('A b & c d')
	})
})

describe('Confluence', () => {
	it('connects per project, shows pages as cards and publishes boards with their picture', async () => {
		const admin = await setupAdmin(env)
		const { client: editor, id: editorId } = await createUser(env, admin, 'eddie')
		const { client: viewer, id: viewerId } = await createUser(env, admin, 'vera')
		const project = (await admin.post('/api/projects', { name: 'P' })).body.project
		await admin.put(`/api/projects/${project.id}/members/${editorId}`, { role: 'editor' })
		await admin.put(`/api/projects/${project.id}/members/${viewerId}`, { role: 'viewer' })
		const board = (await editor.post(`/api/projects/${project.id}/boards`, { name: 'Checkout flow' })).body.board
		const base = `/api/projects/${project.id}/confluence`
		const good = { url: `${fake.url}/wiki/home`, email: 'bot@example.com', token: 'atl_good', spaceKey: 'QA' }

		expect((await viewer.get(base)).body).toEqual({ connected: false })
		expect((await editor.put(base, good)).status).toBe(403)
		expect((await admin.put(base, { ...good, token: 'atl_bad' })).body.error).toContain('rejected the email or API token')
		expect((await admin.put(base, { ...good, spaceKey: 'NOPE' })).body.error).toContain('No space with the key NOPE')
		expect((await admin.put(base, { ...good, parentId: '999999' })).body.error).toContain('parent page was not found')

		const saved = await admin.put(base, { ...good, parentId: `${fake.url}/wiki/spaces/QA/pages/555/Payments+design` })
		expect(saved.status).toBe(200)
		expect(saved.body).toMatchObject({ url: fake.url, spaceKey: 'QA', spaceName: 'Quality', parentId: '555' })
		const { rows } = await env.db.query('SELECT confluence_token FROM projects WHERE id = $1', [project.id])
		expect(rows[0].confluence_token).not.toContain('atl_good')
		const seen = (await viewer.get(base)).body
		expect(seen).toMatchObject({ connected: true, spaceName: 'Quality' })
		expect(seen.email).toBeUndefined()
		expect(JSON.stringify(seen)).not.toContain('atl_good')

		// page cards and search
		const card = (await viewer.get(`${base}/pages/555`)).body
		expect(card).toMatchObject({ title: 'Payments design', spaceName: 'Quality' })
		expect(card.excerpt).toBe('Payments Cards are charged when the order is confirmed & refunds take 5 days.')
		expect(card.url).toBe(`${fake.url}/wiki/spaces/QA/pages/555/Payments%2Bdesign`)
		expect((await viewer.get(`${base}/pages/12`)).status).toBe(404)
		expect((await viewer.get(`${base}/search?q=pay`)).body.pages.map((p: { title: string }) => p.title)).toEqual(['Payments design'])

		// publishing: viewers can't; a new page under the parent, with the picture and the coverage report
		const meta = {
			title: 'Checkout flow',
			boardUrl: `http://cobord.example/boards/${board.id}`,
			coverage: {
				percent: 50,
				covered: 1,
				total: 2,
				build: '3.5.0',
				counts: { Passed: 1, 'Not covered': 1 },
				steps: [
					{ text: 'Pay <now>', status: 'Passed', links: [{ name: '#1 Pay with card', status: 'Passed' }] },
					{ text: 'Refund', status: 'Not covered', links: [] },
				],
			},
		}
		expect((await publish(viewer.cookie, board.id, meta)).status).toBe(403)
		const first = await publish(editor.cookie, board.id, meta)
		expect(first.status).toBe(200)
		expect(first.body.updated).toBe(false)
		const page = fake.pages.get(first.body.pageId)!
		expect(page.parentId).toBe('555')
		expect(page.attachments).toEqual([{ name: 'co-bord.png', type: 'image/png', size: PNG.length }])
		expect(page.storage).toContain('<ri:attachment ri:filename="co-bord.png" />')
		expect(page.storage).toContain('Pay &lt;now&gt;')
		expect(page.storage).toContain('<ac:parameter ac:name="title">Passed</ac:parameter>')
		expect(page.storage).toContain('results of build 3.5.0')

		// the same title as a new page is refused clearly
		const duplicate = await publish(editor.cookie, board.id, meta)
		expect(duplicate.status).toBe(409)
		expect(duplicate.body.error).toContain('already exists')

		// updating the page published before: new version, same attachment name
		const second = await publish(editor.cookie, board.id, { ...meta, title: 'Checkout flow (v2)', update: true })
		expect(second.body).toMatchObject({ pageId: first.body.pageId, updated: true })
		expect(fake.pages.get(first.body.pageId)).toMatchObject({ title: 'Checkout flow (v2)', version: 2 })
		expect(fake.pages.get(first.body.pageId)!.attachments).toHaveLength(1)

		// a frame is published to its own page; publications are listed per board
		const framePage = await publish(
			editor.cookie,
			board.id,
			{ title: 'Refunds', frameId: 'frame-1', scopeName: 'Refunds', boardUrl: meta.boardUrl },
			false,
		)
		expect(framePage.status).toBe(200)
		expect(fake.pages.get(framePage.body.pageId)!.attachments).toEqual([])
		const publications = (await viewer.get(`/api/boards/${board.id}/confluence/publications`)).body.publications
		expect(publications.map((p: { frameId: string | null; title: string }) => [p.frameId, p.title]).sort()).toEqual([
			[null, 'Checkout flow (v2)'],
			['frame-1', 'Refunds'],
		])

		// a page deleted in Confluence is published again as a new one
		fake.pages.delete(first.body.pageId)
		const again = await publish(editor.cookie, board.id, { ...meta, title: 'Checkout flow (v3)', update: true })
		expect(again.body.updated).toBe(false)
		expect(again.body.pageId).not.toBe(first.body.pageId)

		expect((await admin.delete(base)).status).toBe(200)
		expect((await publish(editor.cookie, board.id, meta)).status).toBe(409)
	})
})

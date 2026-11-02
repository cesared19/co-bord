import fastifyMultipart from '@fastify/multipart'
import Fastify from 'fastify'

export interface FakePage {
	id: string
	title: string
	spaceId: string
	parentId?: string
	version: number
	createdAt: string
	storage: string
	attachments: { name: string; type: string; size: number }[]
}

/**
 * A stand-in for the parts of Confluence Cloud's REST API co-bord uses. The account is
 * bot@example.com with the token atl_good; space QA (id 100) has the page 555 "Payments design".
 */
export async function startFakeConfluence(port = 0) {
	const app = Fastify()
	await app.register(fastifyMultipart)
	const pages = new Map<string, FakePage>()
	let nextId = 900
	pages.set('555', {
		id: '555',
		title: 'Payments design',
		spaceId: '100',
		version: 3,
		createdAt: '2026-10-30T10:00:00.000Z',
		storage: '<h1>Payments</h1><p>Cards are charged when the order is confirmed &amp; refunds take <strong>5 days</strong>.</p>',
		attachments: [],
	})
	const space = { id: '100', key: 'QA', name: 'Quality' }
	const auth = `Basic ${Buffer.from('bot@example.com:atl_good').toString('base64')}`

	app.addHook('onRequest', async (req, reply) => {
		if (req.headers.authorization !== auth) return reply.status(401).send({ message: 'Unauthorized' })
	})
	const view = (p: FakePage) => ({
		id: p.id,
		title: p.title,
		spaceId: p.spaceId,
		parentId: p.parentId,
		version: { number: p.version, createdAt: p.createdAt },
		body: { view: { value: p.storage } },
		_links: { webui: `/spaces/QA/pages/${p.id}/${encodeURIComponent(p.title.replace(/ /g, '+'))}` },
	})

	app.get('/wiki/api/v2/spaces', async (req) => {
		const keys = String((req.query as { keys?: string }).keys ?? '')
		return { results: keys.split(',').includes(space.key) ? [space] : [] }
	})
	app.get<{ Params: { id: string } }>('/wiki/api/v2/spaces/:id', async (req, reply) =>
		req.params.id === space.id ? space : reply.status(404).send({ message: 'Not found' }),
	)
	app.get<{ Params: { id: string } }>('/wiki/api/v2/pages/:id', async (req, reply) => {
		const p = pages.get(req.params.id)
		return p ? view(p) : reply.status(404).send({ message: 'Not found' })
	})
	app.post('/wiki/api/v2/pages', async (req, reply) => {
		const b = req.body as { spaceId: string; title: string; parentId?: string; body: { value: string } }
		if ([...pages.values()].some((p) => p.spaceId === b.spaceId && p.title === b.title))
			return reply.status(400).send({ errors: [{ title: `A page with this title already exists: ${b.title}` }] })
		const p: FakePage = {
			id: String(nextId++),
			title: b.title,
			spaceId: b.spaceId,
			parentId: b.parentId,
			version: 1,
			createdAt: new Date().toISOString(),
			storage: b.body.value,
			attachments: [],
		}
		pages.set(p.id, p)
		return view(p)
	})
	app.put<{ Params: { id: string } }>('/wiki/api/v2/pages/:id', async (req, reply) => {
		const p = pages.get(req.params.id)
		if (!p) return reply.status(404).send({ message: 'Not found' })
		const b = req.body as { title: string; body: { value: string }; version: { number: number } }
		if (b.version.number !== p.version + 1) return reply.status(409).send({ message: 'Version conflict' })
		Object.assign(p, { title: b.title, storage: b.body.value, version: b.version.number, createdAt: new Date().toISOString() })
		return view(p)
	})
	app.put<{ Params: { id: string } }>('/wiki/rest/api/content/:id/child/attachment', async (req, reply) => {
		const p = pages.get(req.params.id)
		if (!p) return reply.status(404).send({ message: 'Not found' })
		if (req.headers['x-atlassian-token'] !== 'no-check') return reply.status(403).send({ message: 'XSRF check failed' })
		for await (const part of req.parts()) {
			if (part.type !== 'file') continue
			const data = await part.toBuffer()
			p.attachments = p.attachments.filter((a) => a.name !== part.filename)
			p.attachments.push({ name: part.filename, type: part.mimetype, size: data.length })
		}
		return { results: p.attachments }
	})
	app.get('/wiki/rest/api/search', async (req) => {
		const cql = String((req.query as { cql?: string }).cql ?? '')
		const q = /title ~ "([^"*]*)\*?"/.exec(cql)?.[1]?.toLowerCase() ?? ''
		return {
			results: [...pages.values()]
				.filter((p) => cql.includes(`space="${space.key}"`) && p.title.toLowerCase().includes(q))
				.map((p) => ({ content: { id: p.id, title: p.title, _links: { webui: view(p)._links.webui } }, lastModified: p.createdAt })),
		}
	})
	const url = await app.listen({ port, host: '127.0.0.1' })
	return { app, url, pages }
}

// `tsx test/fakeConfluence.ts 8095` runs it on its own, for trying co-bord by hand
if (process.argv[1]?.endsWith('fakeConfluence.ts') && process.argv[2]) {
	const { url } = await startFakeConfluence(Number(process.argv[2]))
	console.log(`Fake Confluence at ${url}`)
}

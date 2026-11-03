import Fastify from 'fastify'

export interface FakeIssue {
	key: string
	summary: string
	issueType: string
	description: unknown
	status: string
	category: string
}

/**
 * A stand-in for the parts of Jira Cloud's REST API co-bord uses. The account is bot@example.com with the token
 * atl_good; the project QA has the issue types Bug and Task. POST /_test/issues/:key { status, category } changes
 * an issue's status, as if someone closed it in Jira.
 */
export async function startFakeJira(port = 0) {
	const app = Fastify()
	const issues = new Map<string, FakeIssue>()
	let next = 1
	const auth = `Basic ${Buffer.from('bot@example.com:atl_good').toString('base64')}`
	const project = {
		id: '10000',
		key: 'QA',
		name: 'Quality',
		issueTypes: [
			{ id: '1', name: 'Bug', subtask: false },
			{ id: '2', name: 'Task', subtask: false },
			{ id: '3', name: 'Sub-task', subtask: true },
		],
	}

	app.addHook('onRequest', async (req, reply) => {
		if (req.url.startsWith('/_test/')) return
		if (req.headers.authorization !== auth) return reply.status(401).send({ errorMessages: ['Unauthorized'] })
	})
	app.get('/rest/api/3/project/search', async () => ({ values: [project], total: 1, isLast: true }))
	app.get<{ Params: { key: string } }>('/rest/api/3/project/:key', async (req, reply) =>
		req.params.key.toUpperCase() === project.key ? project : reply.status(404).send({ errorMessages: ['No project'] }),
	)
	app.post('/rest/api/3/issue', async (req, reply) => {
		const fields = (req.body as { fields: Record<string, { key?: string; name?: string } & unknown> }).fields
		if ((fields.project as { key?: string }).key !== project.key)
			return reply.status(400).send({ errors: { project: 'valid project is required' } })
		const type = (fields.issuetype as { name?: string }).name
		if (!project.issueTypes.some((t) => t.name === type))
			return reply.status(400).send({ errors: { issuetype: 'valid issue type is required' } })
		const key = `QA-${next++}`
		issues.set(key, {
			key,
			summary: fields.summary as unknown as string,
			issueType: type!,
			description: fields.description,
			status: 'To Do',
			category: 'new',
		})
		return reply.status(201).send({ id: String(10000 + next), key, self: `http://jira/rest/api/3/issue/${key}` })
	})
	app.get<{ Params: { key: string } }>('/rest/api/3/issue/:key', async (req, reply) => {
		const issue = issues.get(req.params.key)
		if (!issue) return reply.status(404).send({ errorMessages: ['Issue does not exist or you do not have permission to see it.'] })
		return { key: issue.key, fields: { status: { name: issue.status, statusCategory: { key: issue.category } } } }
	})
	app.post<{ Params: { key: string } }>('/_test/issues/:key', async (req, reply) => {
		const issue = issues.get(req.params.key)
		if (!issue) return reply.status(404).send({})
		Object.assign(issue, req.body)
		return issue
	})
	app.get('/_test/issues', async () => [...issues.values()])

	const url = await app.listen({ port, host: '127.0.0.1' })
	return { app, url, issues }
}

if (process.argv[1]?.endsWith('fakeJira.ts') && process.argv[2]) {
	const { url } = await startFakeJira(Number(process.argv[2]))
	console.log(`Fake Jira at ${url}`)
}

import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess, requireProjectRole } from '../access.js'
import { confluenceConfig, siteUrl } from '../confluence.js'
import { type Ctx, requireAdmin, requireUser } from '../context.js'
import { badRequest, forbidden, HttpError, notFound } from '../errors.js'
import { type JiraAuth, jiraConfig, jiraProject, jiraProjects } from '../jira.js'
import { asBody, bool, intParam, isUuid, str } from '../validate.js'

/**
 * Jira Cloud for a project: admins connect it (site, account and API token kept encrypted, the Jira project and
 * issue type for new issues). The Confluence account can be reused when it's the same Atlassian site.
 */
export function jiraRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, secrets } = ctx

	/** The site, email and token from the form; the token can be kept, or taken from the Confluence connection. */
	async function auth(projectId: number, body: Record<string, unknown>): Promise<JiraAuth> {
		if (bool(body, 'useConfluence')) {
			const confluence = await confluenceConfig(db, secrets, projectId)
			if (!confluence) throw badRequest('This project is not connected to Confluence')
			return { url: confluence.url, email: confluence.email, token: confluence.token }
		}
		const url = siteUrl(str(body, 'url', { min: 1, max: 300 }))
		const email = str(body, 'email', { min: 3, max: 200 })
		const newToken = str(body, 'token', { max: 1000, optional: true })
		const token = newToken || (await jiraConfig(db, secrets, projectId))?.token
		if (!token) throw badRequest('Paste an Atlassian API token')
		return { url, email, token }
	}

	app.get<{ Params: { id: string } }>('/api/projects/:id/jira', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const config = await jiraConfig(db, secrets, projectId)
		if (!config) return { connected: false }
		return {
			connected: true,
			url: config.url,
			projectKey: config.projectKey,
			issueType: config.issueType,
			...(user.isAdmin ? { email: config.email } : {}),
		}
	})

	/** The Jira projects (with their issue types) the account can see, to choose where issues go. */
	app.post<{ Params: { id: string } }>('/api/projects/:id/jira/projects', async (req) => {
		const user = await requireAdmin(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'owner')
		const a = await auth(projectId, asBody(req.body))
		return { url: a.url, email: a.email, projects: await jiraProjects(a) }
	})

	app.put<{ Params: { id: string } }>('/api/projects/:id/jira', async (req) => {
		const user = await requireAdmin(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'owner')
		const body = asBody(req.body)
		const a = await auth(projectId, body)
		const projectKey = str(body, 'projectKey', { min: 1, max: 100 })
		const issueType = str(body, 'issueType', { min: 1, max: 100 })
		const project = await jiraProject(a, projectKey).catch((e) => {
			if (e instanceof HttpError && e.statusCode === 404)
				throw badRequest(`No Jira project with the key ${projectKey}, or the account can't see it`)
			throw e
		})
		const type = project.issueTypes.find((t) => t.toLowerCase() === issueType.toLowerCase())
		if (!type) throw badRequest(`The project ${project.key} has no issue type ${issueType}`)
		await db.query(
			`UPDATE projects SET jira_url = $2, jira_email = $3, jira_token = $4, jira_project_key = $5, jira_issue_type = $6 WHERE id = $1`,
			[projectId, a.url, a.email, secrets.encrypt(a.token), project.key, type],
		)
		return { connected: true, url: a.url, email: a.email, projectKey: project.key, issueType: type }
	})

	app.delete<{ Params: { id: string } }>('/api/projects/:id/jira', async (req) => {
		const user = await requireAdmin(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'owner')
		await db.query(
			`UPDATE projects SET jira_url = NULL, jira_email = NULL, jira_token = NULL, jira_project_key = NULL, jira_issue_type = NULL
			WHERE id = $1`,
			[projectId],
		)
		return { ok: true }
	})

	/** Creates a Jira issue for a card and links it to the card. */
	app.post<{ Params: { id: string; elementId: string } }>('/api/boards/:id/elements/:elementId/jira', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		const access = await boardAccess(db, user, req.params.id)
		if (!atLeast(access.role, 'editor')) throw forbidden()
		if (!/^[\w-]{1,64}$/.test(req.params.elementId)) throw notFound('Card not found')
		if (!ctx.rules) throw new HttpError(503, 'Not ready')
		return (await ctx.rules.createIssueFor(req.params.id, req.params.elementId)).issue
	})
}

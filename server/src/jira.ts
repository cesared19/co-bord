import type { SecretBox } from './crypto.js'
import type { Db } from './db.js'
import { HttpError } from './errors.js'
import { unreachable } from './net.js'

export interface JiraConfig {
	url: string
	email: string
	token: string
	projectKey: string
	issueType: string
}

export type JiraAuth = Pick<JiraConfig, 'url' | 'email' | 'token'>

/** The Jira connection of a project, or null when it has none. */
export async function jiraConfig(db: Db, secrets: SecretBox, projectId: number): Promise<JiraConfig | null> {
	const { rows } = await db.query(
		'SELECT jira_url, jira_email, jira_token, jira_project_key, jira_issue_type FROM projects WHERE id = $1',
		[projectId],
	)
	const r = rows[0]
	if (!r?.jira_url || !r.jira_token) return null
	return {
		url: r.jira_url,
		email: r.jira_email,
		token: secrets.decrypt(r.jira_token),
		projectKey: r.jira_project_key,
		issueType: r.jira_issue_type,
	}
}

/** Calls Jira Cloud's REST API with the account's email and API token; failures become clear errors. */
export async function jiraRequest<T>(auth: JiraAuth, path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
	const headers: Record<string, string> = {
		Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`,
		Accept: 'application/json',
	}
	if (init.json !== undefined) headers['Content-Type'] = 'application/json'
	let res: Response
	try {
		res = await fetch(`${auth.url}${path}`, {
			method: init.method ?? 'GET',
			headers,
			body: init.json === undefined ? undefined : JSON.stringify(init.json),
			signal: AbortSignal.timeout(20_000),
		})
	} catch (e) {
		throw unreachable('Jira', auth.url, e)
	}
	const text = await res.text()
	let data: unknown = null
	try {
		data = text ? JSON.parse(text) : null
	} catch {
		data = null
	}
	if (res.status === 401)
		throw new HttpError(502, 'Jira rejected the email or API token. Create a new token and save the connection again.')
	if (res.status === 403) throw new HttpError(502, "The Jira account doesn't have permission for this. Check its project permissions.")
	if (res.status === 404) throw new HttpError(404, 'Not found in Jira')
	if (!res.ok) throw new HttpError(502, `Jira: ${jiraMessage(data) ?? `error ${res.status}`}`)
	return data as T
}

function jiraMessage(data: unknown): string | null {
	if (!data || typeof data !== 'object') return null
	const d = data as { errorMessages?: string[]; errors?: Record<string, string> }
	const all = [...(d.errorMessages ?? []), ...Object.values(d.errors ?? {})]
	return all.length ? all.join('; ') : null
}

export interface JiraProject {
	key: string
	name: string
	issueTypes: string[]
}

interface RawProject {
	key: string
	name: string
	issueTypes?: { name: string; subtask?: boolean }[]
}

const toProject = (p: RawProject): JiraProject => ({
	key: p.key,
	name: p.name,
	issueTypes: (p.issueTypes ?? []).filter((t) => !t.subtask).map((t) => t.name),
})

/** The projects the account can see, with their issue types. */
export async function jiraProjects(auth: JiraAuth): Promise<JiraProject[]> {
	const r = await jiraRequest<{ values: RawProject[] }>(auth, '/rest/api/3/project/search?expand=issueTypes&maxResults=100&orderBy=name')
	return r.values.map(toProject)
}

export async function jiraProject(auth: JiraAuth, key: string): Promise<JiraProject> {
	return toProject(await jiraRequest<RawProject>(auth, `/rest/api/3/project/${encodeURIComponent(key)}`))
}

export interface IssueStatus {
	status: string
	/** Jira's status category: new, indeterminate or done. */
	category: string
}

export interface CreatedIssue extends IssueStatus {
	key: string
	url: string
}

/** Text as Atlassian Document Format: one paragraph per line, with an optional link at the end. */
function adf(text: string, link?: { text: string; href: string }) {
	const paragraphs = text
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))
	if (link)
		paragraphs.push({
			type: 'paragraph',
			content: [{ type: 'text', text: link.text, marks: [{ type: 'link', attrs: { href: link.href } }] } as never],
		})
	return { type: 'doc', version: 1, content: paragraphs }
}

export const issueUrl = (config: Pick<JiraConfig, 'url'>, key: string) => `${config.url}/browse/${key}`

export async function createIssue(
	config: JiraConfig,
	o: { summary: string; description: string; link?: { text: string; href: string } },
): Promise<CreatedIssue> {
	const summary = o.summary.replace(/\s+/g, ' ').trim().slice(0, 250) || 'Item from co-bord'
	const created = await jiraRequest<{ key: string }>(config, '/rest/api/3/issue', {
		method: 'POST',
		json: {
			fields: {
				project: { key: config.projectKey },
				issuetype: { name: config.issueType },
				summary,
				description: adf(o.description, o.link),
			},
		},
	})
	const status = await issueStatus(config, created.key).catch(() => ({ status: '', category: 'new' }))
	return { key: created.key, url: issueUrl(config, created.key), ...status }
}

export async function issueStatus(auth: JiraAuth, key: string): Promise<IssueStatus & { key: string }> {
	const issue = await jiraRequest<{ key: string; fields: { status?: { name?: string; statusCategory?: { key?: string } } } }>(
		auth,
		`/rest/api/3/issue/${encodeURIComponent(key)}?fields=status`,
	)
	return { key: issue.key, status: issue.fields.status?.name ?? '', category: issue.fields.status?.statusCategory?.key ?? '' }
}

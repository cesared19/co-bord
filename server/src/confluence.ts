import type { SecretBox } from './crypto.js'
import type { Db } from './db.js'
import { HttpError } from './errors.js'
import { unreachable } from './net.js'

export interface ConfluenceConfig {
	url: string
	email: string
	token: string
	spaceKey: string
	spaceId: string
	parentId: string | null
}

export async function confluenceConfig(db: Db, secrets: SecretBox, projectId: number): Promise<ConfluenceConfig | null> {
	const { rows } = await db.query(
		`SELECT confluence_url, confluence_email, confluence_token, confluence_space_key, confluence_space_id, confluence_parent_id
		FROM projects WHERE id = $1`,
		[projectId],
	)
	const r = rows[0]
	if (!r?.confluence_url || !r.confluence_token) return null
	return {
		url: r.confluence_url,
		email: r.confluence_email,
		token: secrets.decrypt(r.confluence_token),
		spaceKey: r.confluence_space_key,
		spaceId: r.confluence_space_id,
		parentId: r.confluence_parent_id,
	}
}

type Auth = Pick<ConfluenceConfig, 'url' | 'email' | 'token'>

/** Calls Confluence Cloud's REST API with the account's email and API token; failures become clear errors. */
export async function confluenceRequest<T>(
	auth: Auth,
	path: string,
	init: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<T> {
	const headers: Record<string, string> = {
		Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`,
		Accept: 'application/json',
	}
	let body: string | FormData | undefined
	if (init.json !== undefined) {
		headers['Content-Type'] = 'application/json'
		body = JSON.stringify(init.json)
	} else if (init.form) {
		// attachments need this header to pass Confluence's XSRF check
		headers['X-Atlassian-Token'] = 'no-check'
		body = init.form
	}
	let res: Response
	try {
		res = await fetch(`${auth.url}/wiki${path}`, { method: init.method ?? 'GET', headers, body, signal: AbortSignal.timeout(20_000) })
	} catch (e) {
		throw unreachable('Confluence', auth.url, e)
	}
	const text = await res.text()
	let data: unknown = null
	try {
		data = text ? JSON.parse(text) : null
	} catch {
		data = null
	}
	if (res.status === 401)
		throw new HttpError(502, 'Confluence rejected the email or API token. Create a new token and save the connection again.')
	if (res.status === 403) throw new HttpError(502, "The Confluence account doesn't have permission for this. Check its space permissions.")
	if (res.status === 404) throw new HttpError(404, 'Not found in Confluence')
	if (!res.ok) throw new HttpError(502, `Confluence: ${confluenceMessage(data) ?? `error ${res.status}`}`)
	return data as T
}

function confluenceMessage(data: unknown): string | null {
	if (!data || typeof data !== 'object') return null
	const d = data as { message?: string; errors?: { title?: string; detail?: string }[] }
	if (d.errors?.length)
		return d.errors
			.map((e) => e.title ?? e.detail)
			.filter(Boolean)
			.join('; ')
	return d.message ?? null
}

/** A site address like https://team.atlassian.net, without /wiki or a trailing slash. */
export function siteUrl(value: string): string {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new HttpError(400, 'The Confluence site must be a web address, like https://your-team.atlassian.net')
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'The Confluence site must start with https://')
	return `${url.protocol}//${url.host}`
}

/** The page id in a Confluence page address (…/wiki/spaces/KEY/pages/123/Title or …?pageId=123), or a bare id. */
export function pageIdFrom(value: string): string | null {
	const trimmed = value.trim()
	if (/^\d+$/.test(trimmed)) return trimmed
	try {
		const url = new URL(trimmed)
		const m = /\/pages\/(\d+)/.exec(url.pathname)
		return m?.[1] ?? url.searchParams.get('pageId')
	} catch {
		return null
	}
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Plain text of a page's HTML, for the excerpt on its card. */
export function excerpt(html: string, length = 320): string {
	const text = html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
		// block ends separate words; inline tags like <strong> don't
		.replace(/<\/(p|div|h\d|li|tr|td|th|blockquote|pre)>|<br\s*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
			if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)))
			return ENTITIES[e.toLowerCase()] ?? m
		})
		.replace(/\s+/g, ' ')
		.trim()
	return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, '')}…` : text
}

/** Escapes text for Confluence's storage format (XHTML). */
export const xml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess, requireProjectRole } from '../access.js'
import { confluenceConfig, confluenceRequest, excerpt, siteUrl, xml } from '../confluence.js'
import { type Ctx, requireAdmin, requireUser } from '../context.js'
import { badRequest, forbidden, HttpError, notFound } from '../errors.js'
import { asBody, intParam, isUuid, str } from '../validate.js'

interface V2Page {
	id: string
	title: string
	spaceId: string
	version?: { number: number; createdAt?: string }
	body?: { view?: { value?: string } }
	_links?: { webui?: string; base?: string }
}

const cache = new Map<string, { at: number; value: Promise<unknown> }>()
function cached<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
	const now = Date.now()
	const hit = cache.get(key)
	if (hit && now - hit.at < ms) return hit.value as Promise<T>
	const value = load()
	cache.set(key, { at: now, value })
	value.catch(() => cache.delete(key))
	if (cache.size > 500) for (const [k, v] of cache) if (now - v.at >= 60_000) cache.delete(k)
	return value
}

interface CoverageStep {
	text: string
	status: string
	links: { name: string; status: string }[]
}
interface Coverage {
	percent: number
	covered: number
	total: number
	build: string | null
	counts: Record<string, number>
	steps: CoverageStep[]
}

const STATUS_COLOR: Record<string, string> = { Passed: 'Green', Failed: 'Red', Blocked: 'Yellow', Skipped: 'Blue', 'Not run': 'Grey' }

/** A Confluence status lozenge. */
const lozenge = (title: string) =>
	`<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${STATUS_COLOR[title] ?? 'Grey'}</ac:parameter><ac:parameter ac:name="title">${xml(title)}</ac:parameter></ac:structured-macro>`

/** The page in Confluence's storage format: where it comes from, the picture and the coverage report. */
export interface Summary {
	sections: { heading: string; text: string | null; items: string[] }[]
}

export function pageBody(o: {
	boardName: string
	scopeName: string
	boardUrl: string
	by: string
	image: string | null
	coverage: Coverage | null
	summary?: Summary | null
}) {
	const date = new Date().toISOString().slice(0, 10)
	const parts = [
		`<p>Published from co-bord, board <a href="${xml(o.boardUrl)}">${xml(o.boardName)}</a>${o.scopeName !== o.boardName ? `, frame ${xml(o.scopeName)}` : ''}, by ${xml(o.by)} on ${date}. Changes made here are replaced the next time it is published.</p>`,
	]
	if (o.image) parts.push(`<p><ac:image ac:width="1200"><ri:attachment ri:filename="${xml(o.image)}" /></ac:image></p>`)
	for (const section of o.summary?.sections ?? []) {
		parts.push(`<h2>${xml(section.heading)}</h2>`)
		if (section.text) parts.push(`<p>${xml(section.text)}</p>`)
		if (section.items.length) parts.push(`<ul>${section.items.map((i) => `<li>${xml(i)}</li>`).join('')}</ul>`)
	}
	const c = o.coverage
	if (c) {
		parts.push('<h2>Test coverage</h2>')
		parts.push(
			`<p><strong>${c.percent}%</strong> of the steps are covered by tests (${c.covered} of ${c.total})${c.build ? `, results of build ${xml(c.build)}` : ''}.</p>`,
		)
		const counts = Object.entries(c.counts)
			.map(([k, v]) => `${xml(k)}: ${v}`)
			.join(' · ')
		if (counts) parts.push(`<p>${counts}</p>`)
		parts.push('<table><tbody><tr><th>Step</th><th>Status</th><th>Tests</th></tr>')
		for (const s of c.steps) {
			const tests = s.links.map((l) => `${xml(l.name)} (${xml(l.status)})`).join('<br />')
			parts.push(
				`<tr><td>${xml(s.text)}</td><td>${s.status === 'Not covered' ? 'Not covered' : lozenge(s.status)}</td><td>${tests}</td></tr>`,
			)
		}
		parts.push('</tbody></table>')
	}
	return parts.join('')
}

function parseSummary(value: unknown): Summary | null {
	if (!value || typeof value !== 'object') return null
	const sections = (value as { sections?: unknown }).sections
	if (!Array.isArray(sections)) return null
	const text = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '')
	return {
		sections: sections.slice(0, 30).map((s) => {
			const section = (s ?? {}) as Record<string, unknown>
			return {
				heading: text(section.heading, 200) || 'Summary',
				text: text(section.text, 4000) || null,
				items: (Array.isArray(section.items) ? section.items.slice(0, 200) : []).map((i) => text(i, 1000)).filter(Boolean),
			}
		}),
	}
}

function parseCoverage(value: unknown): Coverage | null {
	if (!value || typeof value !== 'object') return null
	const v = value as Record<string, unknown>
	const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0)
	const text = (x: unknown, max = 500) => (typeof x === 'string' ? x.slice(0, max) : '')
	const steps = Array.isArray(v.steps) ? v.steps.slice(0, 500) : []
	return {
		percent: num(v.percent),
		covered: num(v.covered),
		total: num(v.total),
		build: typeof v.build === 'string' ? v.build.slice(0, 100) : null,
		counts: Object.fromEntries(
			Object.entries((v.counts as Record<string, unknown>) ?? {})
				.slice(0, 10)
				.map(([k, n]) => [k.slice(0, 40), num(n)]),
		),
		steps: steps.map((s) => {
			const step = (s ?? {}) as Record<string, unknown>
			return {
				text: text(step.text),
				status: text(step.status, 40),
				links: (Array.isArray(step.links) ? step.links.slice(0, 50) : []).map((l) => {
					const link = (l ?? {}) as Record<string, unknown>
					return { name: text(link.name, 300), status: text(link.status, 40) }
				}),
			}
		}),
	}
}

/**
 * Confluence Cloud for a project: admins connect it (site, account, API token kept encrypted, space and an
 * optional parent page); members see pages as cards on boards; editors publish boards and frames as pages.
 */
export function confluenceRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, secrets } = ctx

	async function connection(projectId: number) {
		const config = await confluenceConfig(db, secrets, projectId)
		if (!config) throw new HttpError(409, 'This project is not connected to Confluence')
		return config
	}

	const pageUrl = (site: string, page: V2Page) =>
		page._links?.webui ? `${page._links.base ?? `${site}/wiki`}${page._links.webui}` : `${site}/wiki/pages/${page.id}`

	app.get<{ Params: { id: string } }>('/api/projects/:id/confluence', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const config = await confluenceConfig(db, secrets, projectId)
		if (!config) return { connected: false }
		const base = {
			connected: true,
			url: config.url,
			spaceKey: config.spaceKey,
			parentId: config.parentId,
			...(user.isAdmin ? { email: config.email } : {}),
		}
		try {
			const space = await cached(`${projectId}:space`, 60_000, () =>
				confluenceRequest<{ name: string }>(config, `/api/v2/spaces/${encodeURIComponent(config.spaceId)}`),
			)
			return { ...base, spaceName: space.name }
		} catch (e) {
			return { ...base, error: (e as Error).message }
		}
	})

	/** Connects, after checking the account, the space and the parent page. The token can be kept. */
	app.put<{ Params: { id: string } }>('/api/projects/:id/confluence', async (req) => {
		const user = await requireAdmin(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'owner')
		const body = asBody(req.body)
		const url = siteUrl(str(body, 'url', { min: 1, max: 300 }))
		const email = str(body, 'email', { min: 3, max: 200 })
		const spaceKey = str(body, 'spaceKey', { min: 1, max: 100 })
		const parentRaw = str(body, 'parentId', { max: 300, optional: true })
		const newToken = str(body, 'token', { max: 1000, optional: true })
		const token = newToken || (await confluenceConfig(db, secrets, projectId))?.token
		if (!token) throw badRequest('Paste an Atlassian API token')
		const auth = { url, email, token }
		const spaces = await confluenceRequest<{ results: { id: string; key: string; name: string }[] }>(
			auth,
			`/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`,
		)
		const space = spaces.results.find((s) => s.key.toLowerCase() === spaceKey.toLowerCase())
		if (!space) throw badRequest(`No space with the key ${spaceKey}, or the account can't see it`)
		let parentId: string | null = null
		if (parentRaw) {
			parentId = /^\d+$/.test(parentRaw) ? parentRaw : (/\/pages\/(\d+)/.exec(parentRaw)?.[1] ?? null)
			if (!parentId) throw badRequest('The parent page must be a page address or id')
			const parent = await confluenceRequest<V2Page>(auth, `/api/v2/pages/${parentId}`).catch((e) => {
				if (e instanceof HttpError && e.statusCode === 404) throw badRequest('The parent page was not found')
				throw e
			})
			if (parent.spaceId !== space.id) throw badRequest(`The parent page is not in the space ${space.key}`)
		}
		await db.query(
			`UPDATE projects SET confluence_url = $2, confluence_email = $3, confluence_token = $4, confluence_space_key = $5,
			confluence_space_id = $6, confluence_parent_id = $7 WHERE id = $1`,
			[projectId, url, email, secrets.encrypt(token), space.key, space.id, parentId],
		)
		for (const key of cache.keys()) if (key.startsWith(`${projectId}:`)) cache.delete(key)
		return { connected: true, url, email, spaceKey: space.key, spaceName: space.name, parentId }
	})

	app.delete<{ Params: { id: string } }>('/api/projects/:id/confluence', async (req) => {
		const user = await requireAdmin(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'owner')
		await db.query(
			`UPDATE projects SET confluence_url = NULL, confluence_email = NULL, confluence_token = NULL, confluence_space_key = NULL,
			confluence_space_id = NULL, confluence_parent_id = NULL WHERE id = $1`,
			[projectId],
		)
		for (const key of cache.keys()) if (key.startsWith(`${projectId}:`)) cache.delete(key)
		return { ok: true }
	})

	/** Pages of the project's space whose title matches `q`, newest first. */
	app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/api/projects/:id/confluence/search', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const config = await connection(projectId)
		const q = (req.query.q ?? '').replace(/["\\]/g, ' ').trim().slice(0, 100)
		const cql = `type=page AND space="${config.spaceKey}"${q ? ` AND title ~ "${q}*"` : ''} ORDER BY lastmodified DESC`
		const r = await confluenceRequest<{
			results: { content?: { id: string; title: string; _links?: { webui?: string } }; lastModified?: string }[]
		}>(config, `/rest/api/search?${new URLSearchParams({ cql, limit: '15' })}`)
		return {
			pages: r.results
				.filter((x) => x.content)
				.map((x) => ({
					id: x.content!.id,
					title: x.content!.title,
					url: `${config.url}/wiki${x.content!._links?.webui ?? `/pages/${x.content!.id}`}`,
					lastModified: x.lastModified,
				})),
		}
	})

	/** What a page card shows: title, space, last update and the start of its text. */
	app.get<{ Params: { id: string; pageId: string } }>('/api/projects/:id/confluence/pages/:pageId', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		if (!/^\d{1,30}$/.test(req.params.pageId)) throw notFound('Page not found')
		const config = await connection(projectId)
		return cached(`${projectId}:page:${req.params.pageId}`, 60_000, async () => {
			const page = await confluenceRequest<V2Page>(config, `/api/v2/pages/${req.params.pageId}?body-format=view`)
			const space = await cached(`${projectId}:spaceName:${page.spaceId}`, 300_000, () =>
				confluenceRequest<{ name: string }>(config, `/api/v2/spaces/${encodeURIComponent(page.spaceId)}`).catch(() => ({ name: '' })),
			)
			return {
				id: page.id,
				title: page.title,
				spaceName: space.name,
				updatedAt: page.version?.createdAt ?? null,
				excerpt: excerpt(page.body?.view?.value ?? ''),
				url: pageUrl(config.url, page),
			}
		})
	})

	app.get<{ Params: { id: string } }>('/api/boards/:id/confluence/publications', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		await boardAccess(db, user, req.params.id)
		const { rows } = await db.query(
			`SELECT p.frame_id, p.page_id, p.page_url, p.title, p.published_at, u.display_name AS published_by
			FROM confluence_publications p LEFT JOIN users u ON u.id = p.published_by WHERE p.board_id = $1`,
			[req.params.id],
		)
		return {
			publications: rows.map((r) => ({
				frameId: r.frame_id || null,
				pageId: r.page_id,
				url: r.page_url,
				title: r.title,
				publishedAt: r.published_at,
				publishedBy: r.published_by,
			})),
		}
	})

	/**
	 * Publishes the board or one frame as a Confluence page: a new page under the project's parent page, or the
	 * page it was published to before. The picture (PNG drawn by the browser) is attached to the page.
	 */
	app.post<{ Params: { id: string } }>('/api/boards/:id/confluence/publish', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		const access = await boardAccess(db, user, req.params.id)
		if (!atLeast(access.role, 'editor')) throw forbidden()
		const config = await connection(access.projectId)

		let meta: Record<string, unknown> | null = null
		let image: Buffer | null = null
		for await (const part of req.parts({ limits: { fileSize: 40 * 1024 * 1024, files: 1 } })) {
			if (part.type === 'file') {
				if (part.mimetype !== 'image/png') {
					part.file.resume()
					throw badRequest('The picture must be a PNG')
				}
				image = await part.toBuffer()
			} else if (part.fieldname === 'meta') {
				try {
					meta = asBody(JSON.parse(String(part.value)))
				} catch {
					throw badRequest('meta must be JSON')
				}
			}
		}
		if (!meta) throw badRequest('meta is required')
		const title = str(meta, 'title', { min: 1, max: 255 })
		const frameId = str(meta, 'frameId', { max: 64, optional: true }) ?? ''
		const scopeName = str(meta, 'scopeName', { max: 255, optional: true }) ?? title
		const boardUrl = str(meta, 'boardUrl', { min: 1, max: 500 })
		if (!/^https?:\/\//.test(boardUrl)) throw badRequest('boardUrl must be a web address')
		const update = meta.update === true
		const coverage = parseCoverage(meta.coverage)
		const summary = parseSummary(meta.summary)

		const { rows: boardRows } = await db.query<{ name: string }>('SELECT name FROM boards WHERE id = $1', [req.params.id])
		const imageName = image ? 'co-bord.png' : null
		const value = pageBody({ boardName: boardRows[0].name, scopeName, boardUrl, by: user.displayName, image: imageName, coverage, summary })

		// the page published before, if it still exists
		let existing: V2Page | null = null
		if (update) {
			const { rows } = await db.query<{ page_id: string }>(
				'SELECT page_id FROM confluence_publications WHERE board_id = $1 AND frame_id = $2',
				[req.params.id, frameId],
			)
			if (rows[0])
				existing = await confluenceRequest<V2Page>(config, `/api/v2/pages/${rows[0].page_id}`).catch((e) => {
					if (e instanceof HttpError && e.statusCode === 404) return null
					throw e
				})
		}

		let page: V2Page
		try {
			page = existing
				? await confluenceRequest<V2Page>(config, `/api/v2/pages/${existing.id}`, {
						method: 'PUT',
						json: {
							id: existing.id,
							status: 'current',
							title,
							body: { representation: 'storage', value },
							version: { number: (existing.version?.number ?? 1) + 1, message: 'Published from co-bord' },
						},
					})
				: await confluenceRequest<V2Page>(config, '/api/v2/pages', {
						method: 'POST',
						json: {
							spaceId: config.spaceId,
							status: 'current',
							title,
							...(config.parentId ? { parentId: config.parentId } : {}),
							body: { representation: 'storage', value },
						},
					})
		} catch (e) {
			if (e instanceof HttpError && /title/i.test(e.message) && /exist/i.test(e.message))
				throw new HttpError(409, `A page titled "${title}" already exists in the space. Choose another title.`)
			throw e
		}

		if (image && imageName) {
			const form = new FormData()
			form.append('file', new Blob([new Uint8Array(image)], { type: 'image/png' }), imageName)
			form.append('minorEdit', 'true')
			await confluenceRequest(config, `/rest/api/content/${page.id}/child/attachment`, { method: 'PUT', form })
		}

		const url = pageUrl(config.url, page)
		await db.query(
			`INSERT INTO confluence_publications (board_id, frame_id, page_id, page_url, title, published_by) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (board_id, frame_id) DO UPDATE SET page_id = EXCLUDED.page_id, page_url = EXCLUDED.page_url, title = EXCLUDED.title,
			published_by = EXCLUDED.published_by, published_at = now()`,
			[req.params.id, frameId, page.id, url, title, user.id],
		)
		cache.delete(`${access.projectId}:page:${page.id}`)
		return { pageId: page.id, url, updated: !!existing }
	})
}

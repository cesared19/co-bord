import type { FastifyInstance } from 'fastify'
import { requireProjectRole } from '../access.js'
import { type Ctx, requireAdmin, requireUser } from '../context.js'
import { badRequest, HttpError } from '../errors.js'
import { sparkyConfig, sparkyRequest, validUrl } from '../sparkytc.js'
import { asBody, intParam, isUuid, str } from '../validate.js'

interface SparkyProject {
	projectShortCode: string
	title: string
	currentBuild: { buildID: string; buildNumber: string } | null
	builds: { buildID: string; buildNumber: string }[]
	webPath: string
}

/** Short cache of SparkyTC answers, so a board full of people doesn't ask SparkyTC once per person. */
const cache = new Map<string, { at: number; value: Promise<unknown> }>()
const CACHE_MS = 15_000

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
	const now = Date.now()
	const hit = cache.get(key)
	if (hit && now - hit.at < CACHE_MS) return hit.value as Promise<T>
	const value = load()
	cache.set(key, { at: now, value })
	value.catch(() => cache.delete(key))
	if (cache.size > 500) for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k)
	return value
}

/**
 * The link between a co-bord project and a SparkyTC project: admins connect it with a SparkyTC project API
 * token (kept encrypted); members read through co-bord, never with the token.
 */
export function sparkyRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, secrets } = ctx

	async function connection(projectId: number) {
		const config = await sparkyConfig(db, secrets, projectId)
		if (!config) throw new HttpError(409, 'This project is not connected to SparkyTC')
		return config
	}

	app.get<{ Params: { id: string } }>('/api/projects/:id/sparkytc', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const config = await sparkyConfig(db, secrets, projectId)
		if (!config) return { connected: false }
		const base = { connected: true, publicUrl: config.publicUrl, ...(user.isAdmin ? { url: config.url } : {}) }
		try {
			const project = await cached(`${projectId}:project`, () => sparkyRequest<SparkyProject>(config, '/project'))
			return { ...base, project }
		} catch (e) {
			return { ...base, error: (e as Error).message }
		}
	})

	/** Connects the project, checking the address and token against SparkyTC first. The token can be kept. */
	app.put<{ Params: { id: string } }>('/api/projects/:id/sparkytc', async (req) => {
		const user = await requireAdmin(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'owner')
		const body = asBody(req.body)
		const url = validUrl(str(body, 'url', { min: 1, max: 500 }), 'The SparkyTC API address')
		const publicRaw = str(body, 'publicUrl', { max: 500, optional: true })
		const publicUrl = publicRaw ? validUrl(publicRaw, 'The address people open') : url
		const newToken = str(body, 'token', { max: 500, optional: true })
		const token = newToken || (await sparkyConfig(db, secrets, projectId))?.token
		if (!token) throw badRequest('Paste a project API token from SparkyTC (Settings, API tokens)')
		const project = await sparkyRequest<SparkyProject>({ url, token }, '/project')
		await db.query('UPDATE projects SET sparkytc_url = $2, sparkytc_public_url = $3, sparkytc_token = $4 WHERE id = $1', [
			projectId,
			url,
			publicUrl,
			secrets.encrypt(token),
		])
		for (const key of cache.keys()) if (key.startsWith(`${projectId}:`)) cache.delete(key)
		return { connected: true, url, publicUrl, project }
	})

	app.delete<{ Params: { id: string } }>('/api/projects/:id/sparkytc', async (req) => {
		const user = await requireAdmin(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'owner')
		await db.query('UPDATE projects SET sparkytc_url = NULL, sparkytc_public_url = NULL, sparkytc_token = NULL WHERE id = $1', [projectId])
		for (const key of cache.keys()) if (key.startsWith(`${projectId}:`)) cache.delete(key)
		return { ok: true }
	})

	/** Test cases, sections (suites) or plans to link, matching `q`. */
	app.get<{ Params: { id: string }; Querystring: { kind?: string; q?: string } }>('/api/projects/:id/sparkytc/search', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const config = await connection(projectId)
		const q = (req.query.q ?? '').trim().slice(0, 200)
		const kind = req.query.kind ?? 'case'
		if (kind === 'case') {
			const params = new URLSearchParams({ limit: '30', ...(q ? { query: q } : {}) })
			return { items: await sparkyRequest<unknown[]>(config, `/test-cases?${params}`) }
		}
		const filter = <T extends Record<string, unknown>>(items: T[], field: string) =>
			items.filter((i) => !q || String(i[field]).toLowerCase().includes(q.toLowerCase())).slice(0, 50)
		if (kind === 'section') {
			const items = await cached(`${projectId}:sections`, () => sparkyRequest<Record<string, unknown>[]>(config, '/sections'))
			return { items: filter(items, 'path') }
		}
		if (kind === 'plan') {
			const items = await cached(`${projectId}:plans`, () => sparkyRequest<Record<string, unknown>[]>(config, '/test-plans'))
			return { items: filter(items, 'name') }
		}
		throw badRequest('kind must be case, section or plan')
	})

	/** Latest results of linked items, in the current build or the given one. */
	app.post<{ Params: { id: string } }>('/api/projects/:id/sparkytc/results', async (req) => {
		const user = await requireUser(ctx, req)
		const projectId = intParam(req.params.id)
		await requireProjectRole(db, user, projectId, 'viewer')
		const config = await connection(projectId)
		const body = asBody(req.body)
		const list = (key: string) => {
			const value = body[key] ?? []
			if (!Array.isArray(value) || value.length > 1000) throw badRequest(`${key} must be a list`)
			return value
		}
		const testCaseNumbers = list('testCaseNumbers').filter((n): n is number => Number.isInteger(n) && n > 0)
		const sectionIDs = list('sectionIDs').filter((s): s is string => typeof s === 'string' && isUuid(s))
		const testPlanIDs = list('testPlanIDs').filter((s): s is string => typeof s === 'string' && isUuid(s))
		const build = str(body, 'build', { max: 100, optional: true })
		const request = {
			testCaseNumbers: [...new Set(testCaseNumbers)].sort((a, b) => a - b),
			sectionIDs: [...new Set(sectionIDs)].sort(),
			testPlanIDs: [...new Set(testPlanIDs)].sort(),
			...(build ? { build } : {}),
		}
		const key = `${projectId}:results:${JSON.stringify(request)}`
		return cached(key, () => sparkyRequest(config, '/results', request))
	})
}

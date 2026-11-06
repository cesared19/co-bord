import type { Db } from './db.js'
import { HttpError } from './errors.js'
import { SPARKY_DOCKER_HINT, unreachable } from './net.js'
import type { SecretBox } from './crypto.js'

export interface SparkyConfig {
	url: string
	publicUrl: string
	token: string
}

/** The SparkyTC connection of a project, or null when it has none. */
export async function sparkyConfig(db: Db, secrets: SecretBox, projectId: number): Promise<SparkyConfig | null> {
	const { rows } = await db.query<{ sparkytc_url: string | null; sparkytc_public_url: string | null; sparkytc_token: string | null }>(
		'SELECT sparkytc_url, sparkytc_public_url, sparkytc_token FROM projects WHERE id = $1',
		[projectId],
	)
	const r = rows[0]
	if (!r?.sparkytc_url || !r.sparkytc_token) return null
	return { url: r.sparkytc_url, publicUrl: r.sparkytc_public_url ?? r.sparkytc_url, token: secrets.decrypt(r.sparkytc_token) }
}

/** Calls SparkyTC's integration API; failures become clear 502 errors. */
export async function sparkyRequest<T>(config: Pick<SparkyConfig, 'url' | 'token'>, path: string, body?: unknown): Promise<T> {
	const url = `${config.url.replace(/\/+$/, '')}/api/integration/v1${path}`
	let res: Response
	try {
		res = await fetch(url, {
			method: body === undefined ? 'GET' : 'POST',
			headers: { Authorization: `Bearer ${config.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(10_000),
		})
	} catch (e) {
		throw unreachable('SparkyTC', config.url, e, SPARKY_DOCKER_HINT)
	}
	const data = (await res.json().catch(() => null)) as { data?: T; message?: string } | null
	if (res.status === 401) throw new HttpError(502, 'SparkyTC rejected the token. Create a new one in the project settings of SparkyTC.')
	if (res.status === 403 && body !== undefined && path !== '/results')
		throw new HttpError(502, 'The SparkyTC token can only read. An admin can connect a Read and write token in the project settings.')
	if (res.status === 404 && path.includes('/history')) {
		// SparkyTC's own 404 says what's missing; older versions don't have the endpoint at all
		const own = (data as { status?: unknown } | null)?.status === 'ERROR' && data?.message
		if (own) throw new HttpError(404, `SparkyTC: ${data!.message}`)
		throw new HttpError(502, 'Seeing the history of a test case needs SparkyTC 2.4.0 or later. Update SparkyTC to use it.')
	}
	if (!res.ok) throw new HttpError(502, `SparkyTC: ${data?.message ?? `error ${res.status}`}`)
	if (!data || !('data' in data)) throw new HttpError(502, `${config.url} doesn't look like SparkyTC 2.2.0 or later`)
	return data.data as T
}

export function validUrl(value: string, field: string): string {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new HttpError(400, `${field} must be a web address, like http://backend-service:8080`)
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, `${field} must start with http:// or https://`)
	return url.toString().replace(/\/+$/, '')
}

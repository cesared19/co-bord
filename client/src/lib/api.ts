export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message)
	}
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
	const res = await fetch(path, {
		method: init.method ?? 'GET',
		headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
		body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
		credentials: 'same-origin',
	})
	const data = await res.json().catch(() => ({}))
	if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`)
	return data as T
}

export type Role = 'owner' | 'editor' | 'viewer'

export interface User {
	id: number
	username: string
	displayName: string
	isAdmin: boolean
	color: string
}

export interface Project {
	id: number
	name: string
	description: string
	role: Role
	boardCount?: number
}

export interface Member {
	id: number
	username: string
	displayName: string
	color: string
	role: Role
}

export interface BoardInfo {
	id: string
	projectId: number
	name: string
	createdAt: string
	updatedAt: string
	createdByName: string | null
	updatedByName: string | null
	projectName?: string
	role?: Role
}

export const canEdit = (role: Role | undefined) => role === 'owner' || role === 'editor'

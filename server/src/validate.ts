import { badRequest } from './errors.js'

type Body = Record<string, unknown>

export function asBody(value: unknown): Body {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Expected a JSON object')
	return value as Body
}

export function str(body: Body, key: string, opts: { min?: number; max?: number; optional?: false }): string
export function str(body: Body, key: string, opts: { min?: number; max?: number; optional: true }): string | undefined
export function str(body: Body, key: string, opts: { min?: number; max?: number; optional?: boolean }) {
	const value = body[key]
	if (value === undefined || value === null) {
		if (opts.optional) return undefined
		throw badRequest(`${key} is required`)
	}
	if (typeof value !== 'string') throw badRequest(`${key} must be text`)
	const trimmed = key.toLowerCase().includes('password') ? value : value.trim()
	if (opts.min !== undefined && trimmed.length < opts.min)
		throw badRequest(opts.min === 1 ? `${key} is required` : `${key} must have at least ${opts.min} characters`)
	if (opts.max !== undefined && trimmed.length > opts.max)
		throw badRequest(`${key} must have at most ${opts.max} characters`)
	return trimmed
}

export function bool(body: Body, key: string): boolean | undefined {
	const value = body[key]
	if (value === undefined) return undefined
	if (typeof value !== 'boolean') throw badRequest(`${key} must be true or false`)
	return value
}

export function intParam(value: string): number {
	const n = Number(value)
	if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid id')
	return n
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: string) => uuidPattern.test(value)

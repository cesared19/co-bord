import Anthropic from '@anthropic-ai/sdk'
import { HttpError } from './errors.js'

export interface RetroInput {
	title: string
	columns: { name: string; notes: { text: string; votes: number }[] }[]
	actions: { text: string }[]
}

export interface RetroSummary {
	summary: string
	themes: { title: string; detail: string }[]
	actions: { text: string; owner: string | null }[]
}

const MODEL = 'claude-opus-5-5'

const SCHEMA = {
	type: 'object',
	properties: {
		summary: { type: 'string', description: 'Two to four sentences on how the period went, in the language of the notes.' },
		themes: {
			type: 'array',
			items: {
				type: 'object',
				properties: { title: { type: 'string' }, detail: { type: 'string' } },
				required: ['title', 'detail'],
				additionalProperties: false,
			},
		},
		actions: {
			type: 'array',
			items: {
				type: 'object',
				properties: { text: { type: 'string' }, owner: { type: ['string', 'null'] } },
				required: ['text', 'owner'],
				additionalProperties: false,
			},
		},
	},
	required: ['summary', 'themes', 'actions'],
	additionalProperties: false,
} as const

const SYSTEM = `You summarize team retrospectives written on a whiteboard. You get the retrospective's columns with their sticky notes (and how many votes each got) and the action items the team wrote.

Write in the same language as the notes. Be concrete and brief; don't invent facts that aren't in the notes.
- summary: two to four sentences on how the period went.
- themes: three to six recurring topics, giving more weight to notes with more votes; each with a short title and one or two sentences.
- actions: the team's own action items first (keep their wording; owner is the @username or name written in the item, or null), then up to three suggested ones for the most voted problems without an action, marked with "(suggested)" at the end of the text and owner null.`

/** Optional: a summary of a retrospective written by Claude, when ANTHROPIC_API_KEY is set. */
export class RetroWriter {
	private readonly client: Anthropic | null

	constructor(apiKey: string | undefined, baseURL?: string) {
		this.client = apiKey ? new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 1 }) : null
	}

	get enabled() {
		return !!this.client
	}

	async summarize(input: RetroInput): Promise<RetroSummary> {
		if (!this.client) throw new HttpError(409, 'Summaries with Claude are not set up on this server (ANTHROPIC_API_KEY)')
		let response: Anthropic.Beta.BetaMessage
		try {
			response = await this.client.beta.messages.create({
				model: MODEL,
				max_tokens: 16000,
				// on a policy decline, Anthropic retries on its recommended fallback model
				betas: ['server-side-fallback-2026-07-01'],
				fallbacks: 'default',
				output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
				system: SYSTEM,
				messages: [{ role: 'user', content: JSON.stringify(input) }],
			})
		} catch (e) {
			if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'Anthropic rejected the API key (ANTHROPIC_API_KEY)')
			if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'Claude is busy right now. Try again in a minute.')
			if (e instanceof Anthropic.APIError) throw new HttpError(502, `Claude: ${e.message}`)
			throw new HttpError(502, "Claude can't be reached")
		}
		if (response.stop_reason === 'refusal')
			throw new HttpError(422, "Claude declined to summarize these notes. Use the summary built from the board's rules instead.")
		if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'The summary was cut short. Try again.')
		const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text
		try {
			return JSON.parse(text ?? '') as RetroSummary
		} catch {
			throw new HttpError(502, "Claude's answer couldn't be read. Try again.")
		}
	}
}

/** Keeps what goes to Claude small and well-formed. */
export function retroInput(body: Record<string, unknown>): RetroInput {
	const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
	const columns = Array.isArray(body.columns) ? body.columns.slice(0, 12) : []
	const actions = Array.isArray(body.actions) ? body.actions.slice(0, 100) : []
	return {
		title: text(body.title, 200),
		columns: columns.map((c) => {
			const col = (c ?? {}) as Record<string, unknown>
			const notes = Array.isArray(col.notes) ? col.notes.slice(0, 200) : []
			return {
				name: text(col.name, 100),
				notes: notes
					.map((n) => {
						const note = (n ?? {}) as Record<string, unknown>
						return { text: text(note.text, 600), votes: typeof note.votes === 'number' ? Math.max(0, Math.round(note.votes)) : 0 }
					})
					.filter((n) => n.text),
			}
		}),
		actions: actions.map((a) => ({ text: text(((a ?? {}) as Record<string, unknown>).text, 600) })).filter((a) => a.text),
	}
}

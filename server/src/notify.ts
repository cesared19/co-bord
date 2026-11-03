import * as Y from 'yjs'
import type { Db } from './db.js'

/** @username in text, the way people mention each other on boards. */
const MENTION = /(^|[^\w@.])@([a-zA-Z0-9._-]{3,40})/g

/** The usernames mentioned in an element's text, label or title, lowercased. */
export function mentionsIn(el: unknown): Set<string> {
	const found = new Set<string>()
	if (!el || typeof el !== 'object') return found
	const e = el as Record<string, unknown>
	for (const field of ['text', 'label', 'title']) {
		const value = e[field]
		if (typeof value !== 'string') continue
		for (const m of value.matchAll(MENTION)) found.add(m[2].replace(/[.]+$/, '').toLowerCase())
	}
	return found
}

/** A short line describing an element, for notifications. */
export function describe(el: unknown): string {
	if (!el || typeof el !== 'object') return 'An item'
	const e = el as Record<string, unknown>
	const text = [e.text, e.label, e.title, e.name].find((v): v is string => typeof v === 'string' && v.trim().length > 0)
	if (text) {
		const line = text.replace(/\s+/g, ' ').trim()
		return line.length > 140 ? `${line.slice(0, 140)}…` : line
	}
	const labels: Record<string, string> = {
		shape: 'A shape',
		sticky: 'A sticky note',
		text: 'A text',
		media: 'A file',
		frame: 'A frame',
		connector: 'A connector',
	}
	return labels[String(e.type)] ?? 'An item'
}

/** The user behind a Hocuspocus transaction: edits from a connection carry its context. */
function originUser(origin: unknown): number | undefined {
	const o = origin as { source?: string; connection?: { context?: { user?: { id?: number } } } } | null
	return o?.source === 'connection' ? o.connection?.context?.user?.id : undefined
}

/** Unread follow notifications for the same thing within this time are merged into one. */
const MERGE_MS = 30 * 60 * 1000

/**
 * Turns board edits into notifications: people newly @mentioned in an element, and people following the board
 * or the element. Edits are collected per board and handled a few seconds after they stop.
 */
export class BoardWatcher {
	/** Mentions already seen per board and element, so only new ones notify. */
	private mentions = new Map<string, Map<string, Set<string>>>()
	/** Elements changed since the last flush, with who changed them last. */
	private pending = new Map<string, Map<string, number>>()
	private timers = new Map<string, { timer: NodeJS.Timeout; first: number }>()
	/** The live document of each board with pending edits. */
	private docs = new Map<string, Y.Doc>()

	constructor(
		private readonly db: Db,
		private readonly delayMs = 3000,
	) {}

	/** Remembers the mentions a board already has when it's loaded, and watches its elements from then on. */
	loaded(boardId: string, doc: Y.Doc) {
		const seen = new Map<string, Set<string>>()
		const elements = doc.getMap('elements')
		elements.forEach((el, id) => seen.set(id, mentionsIn(el)))
		this.mentions.set(boardId, seen)
		elements.observe((event, transaction) => this.changed(boardId, doc, event.keysChanged, originUser(transaction.origin)))
	}

	changed(boardId: string, doc: Y.Doc, ids: Set<string>, userId: number | undefined) {
		if (!userId || !ids.size) return
		this.docs.set(boardId, doc)
		const pending = this.pending.get(boardId) ?? new Map<string, number>()
		for (const id of ids) pending.set(id, userId)
		this.pending.set(boardId, pending)
		const existing = this.timers.get(boardId)
		const first = existing?.first ?? Date.now()
		if (existing) clearTimeout(existing.timer)
		// wait for a pause in typing, but not forever
		const wait = Math.max(0, Math.min(this.delayMs, first + this.delayMs * 4 - Date.now()))
		const timer = setTimeout(() => void this.flush(boardId), wait)
		this.timers.set(boardId, { timer, first })
	}

	/** The board was closed: send what's pending and forget it. */
	async unloaded(boardId: string) {
		await this.flush(boardId)
		this.mentions.delete(boardId)
	}

	async flushAll() {
		await Promise.all([...this.pending.keys()].map((id) => this.flush(id)))
	}

	async flush(boardId: string) {
		const doc = this.docs.get(boardId)
		this.docs.delete(boardId)
		const t = this.timers.get(boardId)
		if (t) clearTimeout(t.timer)
		this.timers.delete(boardId)
		const pending = this.pending.get(boardId)
		this.pending.delete(boardId)
		if (!pending?.size || !doc) return
		const elements = doc.getMap('elements')
		const seen = this.mentions.get(boardId) ?? new Map<string, Set<string>>()
		this.mentions.set(boardId, seen)
		try {
			const { rows: boardRows } = await this.db.query<{ project_id: number }>('SELECT project_id FROM boards WHERE id = $1', [boardId])
			if (!boardRows[0]) return
			const projectId = boardRows[0].project_id

			for (const [elementId, actorId] of pending) {
				const el = elements.get(elementId)
				if (!el) {
					seen.delete(elementId)
					continue
				}
				const now = mentionsIn(el)
				const before = seen.get(elementId) ?? new Set()
				seen.set(elementId, now)
				const added = [...now].filter((u) => !before.has(u))
				if (added.length) await this.notifyMentions(projectId, boardId, elementId, actorId, added, describe(el))
			}
			await this.notifyFollowers(boardId, pending, elements)
		} catch (e) {
			console.error('Notifications failed', e)
		}
	}

	private async notifyMentions(projectId: number, boardId: string, elementId: string, actorId: number, usernames: string[], text: string) {
		// only people who can open the board, and who want mention notifications
		await this.db.query(
			`INSERT INTO notifications (user_id, kind, board_id, element_id, actor_id, text)
			SELECT u.id, 'mention', $2, $3, $4, $5 FROM users u
			WHERE lower(u.username) = ANY($6) AND u.id <> $4 AND u.notify_mentions
				AND (u.is_admin OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = u.id))`,
			[projectId, boardId, elementId, actorId, text, usernames],
		)
	}

	private async notifyFollowers(boardId: string, pending: Map<string, number>, elements: Y.Map<unknown>) {
		const { rows } = await this.db.query<{ user_id: number; element_id: string }>(
			`SELECT f.user_id, f.element_id FROM follows f JOIN users u ON u.id = f.user_id
			WHERE f.board_id = $1 AND u.notify_follows AND (f.element_id = '' OR f.element_id = ANY($2))`,
			[boardId, [...pending.keys()]],
		)
		for (const follow of rows) {
			const targets = follow.element_id ? [follow.element_id] : [...pending.keys()]
			const others = targets.filter((id) => pending.get(id) !== follow.user_id)
			if (!others.length) continue
			const elementId = follow.element_id || null
			const actorId = pending.get(others[others.length - 1])!
			const text = elementId ? describe(elements.get(elementId)) : describe(elements.get(others[others.length - 1]))
			// merge into a recent unread one about the same thing
			const merged = await this.db.query(
				`UPDATE notifications SET count = count + $5, actor_id = $4, text = $6, updated_at = now()
				WHERE id = (SELECT id FROM notifications WHERE user_id = $1 AND kind = 'follow' AND board_id = $2
					AND element_id IS NOT DISTINCT FROM $3 AND read_at IS NULL AND updated_at > now() - $7 * interval '1 millisecond'
					ORDER BY updated_at DESC LIMIT 1)`,
				[follow.user_id, boardId, elementId, actorId, others.length, text, MERGE_MS],
			)
			if (merged.rowCount) continue
			await this.db.query(
				`INSERT INTO notifications (user_id, kind, board_id, element_id, actor_id, text, count) VALUES ($1, 'follow', $2, $3, $4, $5, $6)`,
				[follow.user_id, boardId, elementId, actorId, text, others.length],
			)
		}
	}
}

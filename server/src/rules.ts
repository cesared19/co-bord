import * as Y from 'yjs'
import type { Ctx } from './context.js'
import { badRequest, HttpError } from './errors.js'
import { createIssue, issueStatus, jiraConfig } from './jira.js'
import { describe } from './notify.js'
import { sparkyConfig, sparkyRequest } from './sparkytc.js'

/** When a rule runs. */
export type Trigger =
	/** A card enters the frame. */
	| { type: 'frame'; frameId: string }
	/** A card reaches this many votes in the current voting round. */
	| { type: 'votes'; count: number }
	/** A test linked to a card starts failing in SparkyTC. */
	| { type: 'test-fails' }

/** What a rule does with the card. */
export type Action =
	| { type: 'jira' }
	| { type: 'note'; color?: string; done?: boolean; frameId?: string }
	| { type: 'notify'; userIds: number[] }
	| { type: 'test-case'; sectionPath?: string }

export interface Rule {
	id: number
	boardId: string
	name: string
	enabled: boolean
	trigger: Trigger
	actions: Action[]
	state: RuleState
}

interface RuleState {
	/** Test results already seen, per element, so only new failures run the rule. */
	statuses?: Record<string, string>
	initialized?: boolean
}

const HEX = /^#[0-9a-f]{6}$/i
const ID = /^[\w-]{1,64}$/

export function parseTrigger(value: unknown): Trigger {
	const t = (value ?? {}) as Record<string, unknown>
	if (t.type === 'frame') {
		if (typeof t.frameId !== 'string' || !ID.test(t.frameId)) throw badRequest('Choose the frame')
		return { type: 'frame', frameId: t.frameId }
	}
	if (t.type === 'votes') {
		const count = t.count
		if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 99)
			throw badRequest('The votes must be a number from 1 to 99')
		return { type: 'votes', count: count as number }
	}
	if (t.type === 'test-fails') return { type: 'test-fails' }
	throw badRequest('Unknown trigger')
}

export function parseActions(value: unknown): Action[] {
	if (!Array.isArray(value) || !value.length) throw badRequest('Add at least one action')
	if (value.length > 8) throw badRequest('A rule can have at most 8 actions')
	return value.map((raw): Action => {
		const a = (raw ?? {}) as Record<string, unknown>
		switch (a.type) {
			case 'jira':
				return { type: 'jira' }
			case 'note': {
				const action: Action = { type: 'note' }
				if (a.color !== undefined && a.color !== null && a.color !== '') {
					if (typeof a.color !== 'string' || !HEX.test(a.color)) throw badRequest('The color must be like #fef08a')
					action.color = a.color
				}
				if (a.done === true) action.done = true
				if (a.frameId !== undefined && a.frameId !== null && a.frameId !== '') {
					if (typeof a.frameId !== 'string' || !ID.test(a.frameId)) throw badRequest('Choose the frame to move the card to')
					action.frameId = a.frameId
				}
				if (!action.color && !action.done && !action.frameId) throw badRequest('Choose how to change the card')
				return action
			}
			case 'notify': {
				const ids = a.userIds
				if (!Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every((i) => Number.isInteger(i) && i > 0))
					throw badRequest('Choose who to notify')
				return { type: 'notify', userIds: [...new Set(ids as number[])] }
			}
			case 'test-case': {
				const path = a.sectionPath
				if (path !== undefined && path !== null && (typeof path !== 'string' || path.length > 500))
					throw badRequest('The section must have at most 500 characters')
				const sectionPath = typeof path === 'string' ? path.trim() : ''
				return sectionPath ? { type: 'test-case', sectionPath } : { type: 'test-case' }
			}
			default:
				throw badRequest('Unknown action')
		}
	})
}

export const ruleFromRow = (r: Record<string, unknown>): Rule => ({
	id: r.id as number,
	boardId: r.board_id as string,
	name: r.name as string,
	enabled: r.enabled as boolean,
	trigger: r.trigger as Trigger,
	actions: r.actions as Action[],
	state: (r.state as RuleState) ?? {},
})

/** How the rule engine reads and changes boards; given by the collaboration server. */
export interface BoardEditor {
	/** Changes the board's elements as a rule at this depth (rules run by rules count one deeper). */
	edit(boardId: string, depth: number, change: (elements: Y.Map<unknown>) => void): Promise<void>
	/** The board's document: the live one when people have it open, otherwise read from the database. */
	snapshot(boardId: string): Promise<Y.Doc | null>
}

type El = Record<string, unknown> & { id: string; type: string; x: number; y: number; w: number; h: number }

const isBox = (el: unknown): el is El =>
	!!el && typeof el === 'object' && (el as El).type !== 'connector' && typeof (el as El).x === 'number'
/** Cards are sticky notes and shapes with text. */
const isCard = (el: unknown): el is El =>
	isBox(el) && (el.type === 'sticky' || el.type === 'shape') && typeof el.text === 'string' && el.text.trim().length > 0

const inside = (el: El, frame: El) =>
	el.x >= frame.x && el.y >= frame.y && el.x + el.w <= frame.x + frame.w && el.y + el.h <= frame.y + frame.h

function framesOf(el: El, frames: El[]): Set<string> {
	return new Set(frames.filter((f) => f.id !== el.id && inside(el, f)).map((f) => f.id))
}

const framesIn = (elements: Y.Map<unknown>) => [...elements.values()].filter((e): e is El => isBox(e) && e.type === 'frame')

/** A free place for a card inside a frame, next to what is already there. */
function spotInFrame(el: El, frame: El, elements: Y.Map<unknown>): { x: number; y: number } {
	const others = [...elements.values()].filter((e): e is El => isBox(e) && e.type !== 'frame' && e.id !== el.id && inside(e, frame))
	const pad = 24
	const step = 20
	for (let y = frame.y + pad; y + el.h <= frame.y + frame.h - pad / 2; y += step)
		for (let x = frame.x + pad; x + el.w <= frame.x + frame.w - pad / 2; x += step) {
			const hit = others.some((o) => x < o.x + o.w + 8 && x + el.w + 8 > o.x && y < o.y + o.h + 8 && y + el.h + 8 > o.y)
			if (!hit) return { x, y }
		}
	return { x: frame.x + pad, y: frame.y + pad }
}

export const SEVERITY = ['FAIL', 'BLOCKED', 'NOT_RUN', 'SKIP', 'PASS']
export const worstStatus = (statuses: (string | undefined)[]) => SEVERITY.find((s) => statuses.includes(s))

interface Link {
	kind: 'case' | 'section' | 'plan'
	id: string
	label?: string
}

/** Rules started by rules stop here, so two rules can't keep moving a card back and forth. */
const MAX_DEPTH = 3
const RUNS_KEPT = 50

interface Watched {
	doc: Y.Doc
	/** The frames each element was in at the last check. */
	frames: Map<string, Set<string>>
	knownFrames: Set<string>
	round: string | null
	votes: Map<string, number>
	pending: Map<string, number>
	votesDepth: number | null
	timer: NodeJS.Timeout | null
	/** When the first change waiting for the check came. */
	first: number | null
}

/** The depth of the rule behind a change: 0 for people, rules count up, and anything else (like loading) is ignored. */
function depthOf(origin: unknown): number | null {
	const o = origin as { source?: string; context?: { ruleDepth?: number } } | null
	if (o?.source === 'connection') return 0
	if (o?.source === 'local' && typeof o.context?.ruleDepth === 'number') return o.context.ruleDepth
	return null
}

/**
 * Card rules: watches the open boards for cards entering frames and reaching votes, checks SparkyTC for
 * newly failing tests and Jira for closed issues now and then, and runs the actions, keeping a history.
 */
export class RuleEngine {
	private watched = new Map<string, Watched>()
	private rules = new Map<string, { at: number; value: Promise<Rule[]> }>()
	private queues = new Map<string, Promise<void>>()
	private intervals: NodeJS.Timeout[] = []
	/** The address people open co-bord at, for links in Jira; learned from requests when not configured. */
	baseUrl: string | null

	constructor(
		private readonly ctx: Ctx,
		private readonly editor: BoardEditor,
		private readonly delayMs = 3000,
	) {
		this.baseUrl = ctx.config.publicUrl ?? null
	}

	start(pollMs: number) {
		if (pollMs <= 0) return
		const tick = (job: () => Promise<void>) => () => void job().catch((e) => console.error('Rules check failed', e))
		this.intervals.push(
			setInterval(
				tick(() => this.checkTests()),
				pollMs,
			),
		)
		this.intervals.push(
			setInterval(
				tick(() => this.checkIssues()),
				pollMs,
			),
		)
	}

	async stop() {
		for (const i of this.intervals) clearInterval(i)
		this.intervals = []
		await Promise.all([...this.watched.keys()].map((id) => this.flush(id)))
		await Promise.all([...this.queues.values()])
	}

	/** Forgets the cached rules of a board after they change. */
	invalidate(boardId: string) {
		this.rules.delete(boardId)
	}

	private rulesFor(boardId: string): Promise<Rule[]> {
		const hit = this.rules.get(boardId)
		if (hit && Date.now() - hit.at < 30_000) return hit.value
		const value = this.ctx.db
			.query('SELECT * FROM board_rules WHERE board_id = $1 AND enabled ORDER BY id', [boardId])
			.then((r) => r.rows.map(ruleFromRow))
		this.rules.set(boardId, { at: Date.now(), value })
		value.catch(() => this.rules.delete(boardId))
		return value
	}

	loaded(boardId: string, doc: Y.Doc) {
		const elements = doc.getMap('elements')
		const w: Watched = {
			doc,
			frames: new Map(),
			knownFrames: new Set(),
			round: null,
			votes: new Map(),
			pending: new Map(),
			votesDepth: null,
			timer: null,
			first: null,
		}
		this.snapshotFrames(w)
		;[w.round, w.votes] = this.voteCounts(doc)
		this.watched.set(boardId, w)
		elements.observe((event, tx) => {
			// where a new card starts: in the frames added with it, so pasting a frame with its cards isn't "entering"
			const added = new Set([...event.changes.keys].filter(([, change]) => change.action === 'add').map(([id]) => id))
			if (added.size) {
				const addedFrames = framesIn(elements).filter((f) => added.has(f.id))
				for (const id of added) {
					const el = elements.get(id)
					if (isBox(el) && el.type !== 'frame') w.frames.set(id, framesOf(el, addedFrames))
				}
			}
			const depth = depthOf(tx.origin)
			if (depth === null) return
			for (const id of event.keysChanged) w.pending.set(id, depth)
			this.schedule(boardId, w)
		})
		const onVotes = (_: unknown, tx: Y.Transaction) => {
			const depth = depthOf(tx.origin)
			if (depth === null) return
			w.votesDepth = Math.min(w.votesDepth ?? depth, depth)
			this.schedule(boardId, w)
		}
		doc.getMap('votes').observe(onVotes)
		doc.getMap('session').observe(onVotes)
	}

	async unloaded(boardId: string) {
		await this.flush(boardId)
		this.watched.delete(boardId)
	}

	private schedule(boardId: string, w: Watched) {
		if (w.timer) clearTimeout(w.timer)
		w.first ??= Date.now()
		// wait for a pause, but not forever while people keep editing
		const wait = Math.max(0, Math.min(this.delayMs, w.first + this.delayMs * 4 - Date.now()))
		w.timer = setTimeout(() => void this.flush(boardId), wait)
	}

	private snapshotFrames(w: Watched) {
		const elements = w.doc.getMap('elements')
		const frames = framesIn(elements)
		w.frames.clear()
		elements.forEach((el, id) => {
			if (isBox(el) && el.type !== 'frame') w.frames.set(id, framesOf(el, frames))
		})
		w.knownFrames = new Set(frames.map((f) => f.id))
	}

	private voteCounts(doc: Y.Doc): [string | null, Map<string, number>] {
		const voting = doc.getMap('session').get('voting') as { round?: string } | undefined
		const counts = new Map<string, number>()
		if (!voting?.round) return [null, counts]
		for (const [key, ids] of doc.getMap<string[]>('votes').entries()) {
			if (!key.startsWith(`${voting.round}:`) || !Array.isArray(ids)) continue
			for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
		}
		return [voting.round, counts]
	}

	/** Looks at what changed since the last check and runs the rules it triggers. */
	async flush(boardId: string) {
		const w = this.watched.get(boardId)
		if (!w) return
		if (w.timer) clearTimeout(w.timer)
		w.timer = null
		w.first = null
		const pending = w.pending
		w.pending = new Map()
		const votesDepth = w.votesDepth
		w.votesDepth = null
		if (!pending.size && votesDepth === null) return

		const fired: { trigger: (t: Trigger) => boolean; elementId: string; depth: number; why: string }[] = []
		const elements = w.doc.getMap('elements')

		if (pending.size) {
			const frames = framesIn(elements)
			let framesChanged = false
			for (const [id, depth] of pending) {
				const el = elements.get(id)
				if (!isBox(el) || el.type === 'frame') {
					framesChanged ||= w.knownFrames.has(id) || (isBox(el) && el.type === 'frame')
					if (!el) w.frames.delete(id)
					continue
				}
				const now = framesOf(el, frames)
				const before = w.frames.get(id) ?? now
				w.frames.set(id, now)
				if (!isCard(el)) continue
				const entered = [...now].filter((f) => !before.has(f))
				for (const frameId of entered) {
					const frame = frames.find((f) => f.id === frameId)
					fired.push({
						trigger: (t) => t.type === 'frame' && t.frameId === frameId,
						elementId: id,
						depth,
						why: `Entered ${describe(frame)}`,
					})
				}
			}
			if (framesChanged) this.snapshotFrames(w)
			else w.knownFrames = new Set(frames.map((f) => f.id))
		}

		if (votesDepth !== null) {
			const [round, counts] = this.voteCounts(w.doc)
			const before = round && round === w.round ? w.votes : new Map<string, number>()
			for (const [id, n] of counts) {
				const was = before.get(id) ?? 0
				if (n <= was) continue
				fired.push({
					trigger: (t) => t.type === 'votes' && was < t.count && n >= t.count,
					elementId: id,
					depth: votesDepth,
					why: `Reached ${n} vote${n === 1 ? '' : 's'}`,
				})
			}
			w.round = round
			w.votes = counts
		}

		if (!fired.length) return
		try {
			const rules = await this.rulesFor(boardId)
			for (const f of fired) {
				if (f.depth >= MAX_DEPTH) continue
				for (const rule of rules) if (f.trigger(rule.trigger)) this.enqueue(boardId, () => this.run(rule, f.elementId, f.why, f.depth))
			}
		} catch (e) {
			console.error('Rules failed', e)
		}
	}

	/** Runs one thing at a time per board, so actions see each other's changes. */
	private enqueue(boardId: string, job: () => Promise<unknown>) {
		const previous = this.queues.get(boardId) ?? Promise.resolve()
		const next = previous.then(job).then(
			() => {},
			(e) => console.error('Rule failed', e),
		)
		this.queues.set(boardId, next)
		void next.then(() => {
			if (this.queues.get(boardId) === next) this.queues.delete(boardId)
		})
		return next
	}

	/** Waits for the rules already started (tests use it). */
	async idle() {
		while (this.queues.size) await Promise.all([...this.queues.values()])
	}

	private async element(boardId: string, elementId: string): Promise<El | null> {
		const doc = await this.editor.snapshot(boardId)
		const el = doc?.getMap('elements').get(elementId)
		return isBox(el) ? el : null
	}

	async run(rule: Rule, elementId: string, why: string, depth: number) {
		const el = await this.element(rule.boardId, elementId)
		const details: { action: string; ok: boolean; message: string }[] = []
		for (const action of rule.actions) {
			try {
				const message = await this.apply(rule, action, elementId, depth)
				details.push({ action: action.type, ok: true, message })
			} catch (e) {
				details.push({ action: action.type, ok: false, message: e instanceof HttpError || e instanceof Error ? e.message : String(e) })
			}
		}
		await this.ctx.db.query('INSERT INTO rule_runs (rule_id, element_id, element_text, ok, details) VALUES ($1, $2, $3, $4, $5)', [
			rule.id,
			elementId,
			`${why}: ${describe(el)}`.slice(0, 300),
			details.every((d) => d.ok),
			JSON.stringify(details),
		])
		await this.ctx.db.query(
			`DELETE FROM rule_runs WHERE rule_id = $1 AND id NOT IN (SELECT id FROM rule_runs WHERE rule_id = $1 ORDER BY id DESC LIMIT ${RUNS_KEPT})`,
			[rule.id],
		)
	}

	private async projectOf(boardId: string): Promise<{ projectId: number; boardName: string }> {
		const { rows } = await this.ctx.db.query<{ project_id: number; name: string }>('SELECT project_id, name FROM boards WHERE id = $1', [
			boardId,
		])
		if (!rows[0]) throw new HttpError(404, 'The board was deleted')
		return { projectId: rows[0].project_id, boardName: rows[0].name }
	}

	private elementUrl(boardId: string, elementId: string) {
		return this.baseUrl ? `${this.baseUrl}/boards/${boardId}?el=${encodeURIComponent(elementId)}` : null
	}

	private async apply(rule: Rule, action: Action, elementId: string, depth: number): Promise<string> {
		switch (action.type) {
			case 'jira':
				return (await this.createIssueFor(rule.boardId, elementId, depth + 1)).message
			case 'note':
				return this.changeCard(rule.boardId, elementId, action, depth + 1)
			case 'notify':
				return this.notify(rule, elementId, action.userIds)
			case 'test-case':
				return this.createTestCase(rule.boardId, elementId, action.sectionPath, depth + 1)
		}
	}

	/** Creates a Jira issue for a card and links it, unless it has one. Also used from the card's menu. */
	async createIssueFor(boardId: string, elementId: string, depth = 0): Promise<{ message: string; issue: unknown }> {
		const el = await this.element(boardId, elementId)
		if (!el) throw new HttpError(404, 'The card was deleted')
		const existing = el.issue as { key?: string } | undefined
		if (existing?.key) return { message: `Already linked to ${existing.key}`, issue: existing }
		const { projectId, boardName } = await this.projectOf(boardId)
		const config = await jiraConfig(this.ctx.db, this.ctx.secrets, projectId)
		if (!config) throw new HttpError(409, 'This project is not connected to Jira')
		const text = typeof el.text === 'string' ? el.text : describe(el)
		const url = this.elementUrl(boardId, elementId)
		const created = await createIssue(config, {
			summary: text.split('\n').find((l) => l.trim()) ?? describe(el),
			description: `${text}\n\nFrom the co-bord board ${boardName}.`,
			link: url ? { text: 'Open the card in co-bord', href: url } : undefined,
		})
		const issue = { key: created.key, url: created.url, status: created.status, category: created.category }
		await this.editor.edit(boardId, depth, (elements) => {
			const current = elements.get(elementId) as El | undefined
			if (current) elements.set(elementId, { ...current, issue, ...(created.category === 'done' ? { done: true } : {}) })
		})
		await this.ctx.db.query(
			`INSERT INTO jira_links (board_id, element_id, issue_key, status, category, checked_at) VALUES ($1, $2, $3, $4, $5, now())
			ON CONFLICT (board_id, element_id) DO UPDATE SET issue_key = $3, status = $4, category = $5, checked_at = now()`,
			[boardId, elementId, created.key, created.status, created.category],
		)
		return { message: `Created ${created.key}`, issue }
	}

	private async changeCard(boardId: string, elementId: string, action: Extract<Action, { type: 'note' }>, depth: number) {
		const done: string[] = []
		let missingFrame = false as boolean
		let missing = false as boolean
		await this.editor.edit(boardId, depth, (elements) => {
			const el = elements.get(elementId) as El | undefined
			if (!isBox(el)) {
				missing = true
				return
			}
			const next: El = { ...el }
			if (action.color && (el.type === 'sticky' || el.type === 'shape')) {
				next.fill = action.color
				done.push('changed its color')
			}
			if (action.done) {
				next.done = true
				done.push('marked it done')
			}
			if (action.frameId) {
				const frame = elements.get(action.frameId) as El | undefined
				if (!isBox(frame) || frame.type !== 'frame') missingFrame = true
				else if (!inside(el, frame)) {
					Object.assign(next, spotInFrame(el, frame, elements))
					done.push(`moved it to ${describe(frame)}`)
				}
			}
			elements.set(elementId, next)
		})
		if (missing) throw new HttpError(404, 'The card was deleted')
		if (missingFrame) throw new HttpError(404, 'The frame to move the card to was deleted')
		return done.length ? `${done.join(', ').replace(/^./, (c) => c.toUpperCase())}` : 'Nothing to change'
	}

	private async notify(rule: Rule, elementId: string, userIds: number[]) {
		const el = await this.element(rule.boardId, elementId)
		const { projectId } = await this.projectOf(rule.boardId)
		const { rowCount } = await this.ctx.db.query(
			`INSERT INTO notifications (user_id, kind, board_id, element_id, text)
			SELECT u.id, 'rule', $2, $3, $4 FROM users u
			WHERE u.id = ANY($5) AND u.notify_rules
				AND (u.is_admin OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = u.id))`,
			[projectId, rule.boardId, elementId, `${rule.name}: ${describe(el)}`.slice(0, 300), userIds],
		)
		return `Notified ${rowCount ?? 0} ${rowCount === 1 ? 'person' : 'people'}`
	}

	private async createTestCase(boardId: string, elementId: string, sectionPath: string | undefined, depth: number) {
		const el = await this.element(boardId, elementId)
		if (!el) throw new HttpError(404, 'The card was deleted')
		const { projectId, boardName } = await this.projectOf(boardId)
		const config = await sparkyConfig(this.ctx.db, this.ctx.secrets, projectId)
		if (!config) throw new HttpError(409, 'This project is not connected to SparkyTC')
		const text = typeof el.text === 'string' ? el.text.trim() : describe(el)
		const title = (text.split('\n').find((l) => l.trim()) ?? describe(el)).trim().slice(0, 500)
		const url = this.elementUrl(boardId, elementId)
		const created = await sparkyRequest<{ testCaseNumber: number; title: string; created: boolean }>(config, '/test-cases', {
			title,
			description: `${text}\n\nFrom the co-bord board ${boardName}${url ? `: ${url}` : '.'}`,
			...(sectionPath ? { sectionPath } : {}),
			sourceRef: `cobord:${boardId}:${elementId}`,
		})
		const link: Link = { kind: 'case', id: String(created.testCaseNumber), label: `#${created.testCaseNumber} ${created.title}` }
		await this.editor.edit(boardId, depth, (elements) => {
			const current = elements.get(elementId) as El | undefined
			if (!isBox(current)) return
			const links = (current.links as Link[] | undefined) ?? []
			if (!links.some((l) => l.kind === 'case' && l.id === link.id)) elements.set(elementId, { ...current, links: [...links, link] })
		})
		return created.created ? `Created test case #${created.testCaseNumber}` : `Linked to test case #${created.testCaseNumber}`
	}

	/** Runs the "test fails" rules for cards whose linked tests failed since the last check. */
	async checkTests() {
		const { rows } = await this.ctx.db.query(
			`SELECT r.*, b.project_id FROM board_rules r JOIN boards b ON b.id = r.board_id
			WHERE r.enabled AND r.trigger->>'type' = 'test-fails' ORDER BY r.board_id, r.id`,
		)
		const byBoard = new Map<string, { projectId: number; rules: Rule[] }>()
		for (const row of rows) {
			const entry = byBoard.get(row.board_id) ?? { projectId: row.project_id as number, rules: [] as Rule[] }
			entry.rules.push(ruleFromRow(row))
			byBoard.set(row.board_id, entry)
		}
		for (const [boardId, { projectId, rules }] of byBoard) {
			try {
				const statuses = await this.boardStatuses(boardId, projectId)
				if (!statuses) continue
				for (const rule of rules) {
					const before = rule.state.statuses ?? {}
					if (rule.state.initialized)
						for (const [id, status] of Object.entries(statuses))
							if (status === 'FAIL' && before[id] !== 'FAIL') this.enqueue(boardId, () => this.run(rule, id, 'A linked test failed', 0))
					await this.ctx.db.query('UPDATE board_rules SET state = $2 WHERE id = $1', [
						rule.id,
						JSON.stringify({ initialized: true, statuses } satisfies RuleState),
					])
				}
			} catch (e) {
				console.error('Checking tests failed', e)
			}
		}
	}

	/** The status of each card with links, from SparkyTC's latest results in the current build. */
	private async boardStatuses(boardId: string, projectId: number): Promise<Record<string, string> | null> {
		const config = await sparkyConfig(this.ctx.db, this.ctx.secrets, projectId)
		if (!config) return null
		const doc = await this.editor.snapshot(boardId)
		if (!doc) return null
		const linked: [string, Link[]][] = []
		doc.getMap('elements').forEach((el, id) => {
			const links = isBox(el) ? (el.links as Link[] | undefined) : undefined
			if (links?.length) linked.push([id, links])
		})
		if (!linked.length) return {}
		const all = linked.flatMap(([, links]) => links)
		const result = await sparkyRequest<{
			testCases: { testCaseNumber: number; status: string }[]
			sections: { id: string; status?: string }[]
			testPlans: { id: string; status?: string }[]
		}>(config, '/results', {
			testCaseNumbers: [...new Set(all.filter((l) => l.kind === 'case').map((l) => Number(l.id)))],
			sectionIDs: [...new Set(all.filter((l) => l.kind === 'section').map((l) => l.id))],
			testPlanIDs: [...new Set(all.filter((l) => l.kind === 'plan').map((l) => l.id))],
		})
		const status = new Map<string, string | undefined>()
		for (const c of result.testCases) status.set(`case:${c.testCaseNumber}`, c.status)
		for (const s of result.sections) status.set(`section:${s.id}`, s.status)
		for (const p of result.testPlans) status.set(`plan:${p.id}`, p.status)
		const out: Record<string, string> = {}
		for (const [id, links] of linked) {
			const worst = worstStatus(links.map((l) => status.get(`${l.kind}:${l.id}`)))
			if (worst) out[id] = worst
		}
		return out
	}

	/** Updates the Jira status shown on cards, and marks them done when their issue is closed (or not, when reopened). */
	async checkIssues() {
		const { rows } = await this.ctx.db.query(
			`SELECT l.*, b.project_id FROM jira_links l JOIN boards b ON b.id = l.board_id ORDER BY l.checked_at NULLS FIRST LIMIT 200`,
		)
		const configs = new Map<number, Awaited<ReturnType<typeof jiraConfig>>>()
		for (const row of rows) {
			if (!configs.has(row.project_id)) configs.set(row.project_id, await jiraConfig(this.ctx.db, this.ctx.secrets, row.project_id))
			const config = configs.get(row.project_id)
			if (!config) continue
			try {
				const now = await issueStatus(config, row.issue_key)
				if (now.status !== row.status || now.category !== row.category || now.key !== row.issue_key) {
					const crossed = (now.category === 'done') !== (row.category === 'done')
					let gone = false as boolean
					await this.editor.edit(row.board_id, 1, (elements) => {
						const el = elements.get(row.element_id) as El | undefined
						if (!isBox(el)) {
							gone = true
							return
						}
						const issue = { key: now.key, url: `${config.url}/browse/${now.key}`, status: now.status, category: now.category }
						elements.set(row.element_id, { ...el, issue, ...(crossed ? { done: now.category === 'done' } : {}) })
					})
					if (gone) {
						await this.ctx.db.query('DELETE FROM jira_links WHERE board_id = $1 AND element_id = $2', [row.board_id, row.element_id])
						continue
					}
				}
				await this.ctx.db.query(
					'UPDATE jira_links SET issue_key = $3, status = $4, category = $5, checked_at = now() WHERE board_id = $1 AND element_id = $2',
					[row.board_id, row.element_id, now.key, now.status, now.category],
				)
			} catch (e) {
				await this.ctx.db.query('UPDATE jira_links SET checked_at = now() WHERE board_id = $1 AND element_id = $2', [
					row.board_id,
					row.element_id,
				])
				if (!(e instanceof HttpError && e.statusCode === 404)) console.error('Checking a Jira issue failed', e)
			}
		}
	}
}

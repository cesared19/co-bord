import { newId } from '../lib/id'
import { type ElementMap, elementBounds, frameContents } from './geometry'
import type { BoardStore } from './store'
import type { BoardElement, FrameElement, TextBox, TextElement } from './types'

export const GROUP_TAG = 'retro-group'

export interface RetroNote {
	el: TextBox
	votes: number
}

export interface RetroColumn {
	frame: FrameElement
	notes: RetroNote[]
}

export interface Retro {
	scope: FrameElement
	columns: RetroColumn[]
	actions: RetroColumn | null
}

const isActions = (title: string) => /action|acci[oó]n|to ?do|next step/i.test(title)

/** Frames that hold other frames: a retrospective and its columns. */
export function retroScopes(elements: ElementMap): FrameElement[] {
	const frames = [...elements.values()].filter((el): el is FrameElement => el.type === 'frame')
	return frames
		.filter((f) => frameContents(f, elements).some((id) => elements.get(id)?.type === 'frame'))
		.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** The columns of a retrospective (its frames, not nested deeper), their notes and votes. */
export function readRetro(scope: FrameElement, elements: ElementMap, votes: Map<string, number>): Retro {
	const inside = frameContents(scope, elements)
		.map((id) => elements.get(id))
		.filter((el): el is BoardElement => !!el)
	const frames = inside.filter((el): el is FrameElement => el.type === 'frame')
	const direct = frames
		.filter((f) => !frames.some((g) => g.id !== f.id && frameContents(g, elements).includes(f.id)))
		.sort((a, b) => a.x - b.x || a.y - b.y)
	const column = (frame: FrameElement): RetroColumn => ({
		frame,
		notes: frameContents(frame, elements)
			.map((id) => elements.get(id))
			.filter((el): el is TextBox => el?.type === 'sticky' && el.text.trim().length > 0)
			.map((el) => ({ el, votes: votes.get(el.id) ?? 0 }))
			.sort((a, b) => a.el.y - b.el.y || a.el.x - b.el.x),
	})
	const columns = direct.map(column)
	return {
		scope,
		columns: columns.filter((c) => !isActions(c.frame.title)),
		actions: columns.find((c) => isActions(c.frame.title)) ?? null,
	}
}

// ---------- grouping similar notes ----------

const STOPWORDS = new Set(
	`the and for that with this are was were has have had not but you your our out all can will would should could from into about more less than too very just also when what which who how why where there their they them its it's lot some any each other more most much many make made get got need needs use using
	los las del una uno unos unas que con por para como pero mas más muy sin sobre entre cuando donde porque esta este estos estas eso esa ese hay ser son fue han hace hacer tener tiene tenemos nos les sus mas también tambien cada todo todos toda todas otra otro otros otras mucho mucha poco poca`.split(
		/\s+/,
	),
)

/** Words that carry the meaning of a note, lowercased and roughly singular. */
export function keywords(text: string): Set<string> {
	const words = text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.match(/[a-z0-9]+/g)
	const out = new Set<string>()
	for (const w of words ?? []) {
		if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue
		out.add(w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
	}
	return out
}

const similarity = (a: Set<string>, b: Set<string>) => {
	if (!a.size || !b.size) return 0
	let shared = 0
	for (const w of a) if (b.has(w)) shared++
	return shared / Math.min(a.size, b.size)
}

export interface NoteGroup {
	label: string
	notes: RetroNote[]
}

/** Notes that share key words end up together; a group is named after its most common word. */
export function groupNotes(notes: RetroNote[]): NoteGroup[] {
	const words = notes.map((n) => keywords(n.el.text))
	const parent = notes.map((_, i) => i)
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
	for (let i = 0; i < notes.length; i++)
		for (let j = i + 1; j < notes.length; j++) if (similarity(words[i], words[j]) >= 0.3) parent[find(i)] = find(j)
	const byRoot = new Map<number, number[]>()
	notes.forEach((_, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]))
	const groups: NoteGroup[] = []
	const loose: RetroNote[] = []
	for (const members of byRoot.values()) {
		if (members.length < 2) {
			loose.push(notes[members[0]])
			continue
		}
		const counts = new Map<string, number>()
		for (const i of members) for (const w of words[i]) counts.set(w, (counts.get(w) ?? 0) + 1)
		const [top] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ['']
		const sorted = members.map((i) => notes[i]).sort((a, b) => b.votes - a.votes)
		groups.push({ label: top ? top[0].toUpperCase() + top.slice(1) : 'Group', notes: sorted })
	}
	groups.sort(
		(a, b) => b.notes.reduce((s, n) => s + n.votes, 0) - a.notes.reduce((s, n) => s + n.votes, 0) || b.notes.length - a.notes.length,
	)
	if (loose.length) groups.push({ label: groups.length ? 'Other' : 'Notes', notes: loose.sort((a, b) => b.votes - a.votes) })
	return groups
}

/**
 * Lays the notes of each column out in their groups, each under a small heading, most voted groups first. The
 * headings of an earlier grouping are replaced; a column grows when the notes don't fit. One undo step.
 */
export function arrangeGroups(store: BoardStore, retro: Retro, elements: ElementMap) {
	const gap = 16
	const columns = retro.columns.filter((c) => c.notes.length > 1)
	if (!columns.length) return
	const oldBottom = Math.max(...retro.columns.map((c) => c.frame.y + c.frame.h))
	let newBottom = oldBottom
	const moved = new Set<string>()
	store.checkpoint()
	for (const column of columns) {
		const frame = column.frame
		const inside = frameContents(frame, elements).map((id) => elements.get(id)!)
		const oldLabels = inside.filter((el) => 'tag' in el && el.tag === GROUP_TAG).map((el) => el.id)
		const noteIds = new Set(column.notes.map((n) => n.el.id))
		// keep what is above the notes, like the column's prompt
		const fixed = inside.filter((el) => !noteIds.has(el.id) && !oldLabels.includes(el.id) && el.type !== 'connector' && el.type !== 'frame')
		const top = Math.max(frame.y + 20, ...fixed.map((el) => elementBounds(el, elements)).map((b) => b.y + b.h + gap))
		const noteW = Math.max(...column.notes.map((n) => n.el.w))
		const noteH = Math.max(...column.notes.map((n) => n.el.h))
		const perRow = Math.max(1, Math.floor((frame.w - 48 + gap) / (noteW + gap)))
		const groups = groupNotes(column.notes)
		// with no notes in common, just tidy them up without headings
		const headings = groups.length > 1 || groups[0]?.label !== 'Notes'
		let y = top
		const updates: [string, Partial<BoardElement>][] = []
		const labels: (Omit<TextElement, 'z'> & { tag: string })[] = []
		for (const group of groups) {
			if (headings) {
				labels.push({
					id: newId(),
					type: 'text',
					tag: GROUP_TAG,
					x: frame.x + 24,
					y,
					w: frame.w - 48,
					h: 30,
					text: `${group.label} (${group.notes.length})`,
					fontSize: 18,
					bold: true,
					align: 'left',
					textColor: 'auto',
				})
				y += 38
			}
			group.notes.forEach((n, i) => {
				const row = Math.floor(i / perRow)
				const col = i % perRow
				updates.push([n.el.id, { x: frame.x + 24 + col * (noteW + gap), y: y + row * (noteH + gap) }])
				moved.add(n.el.id)
			})
			y += Math.ceil(group.notes.length / perRow) * (noteH + gap) + 8
		}
		store.remove(oldLabels)
		store.update(updates)
		store.add(labels)
		newBottom = Math.max(newBottom, y + 24)
	}
	// columns grow together; what is below them in the retro (like the action items) moves down
	const growth = Math.round(newBottom - oldBottom)
	if (growth > 0) {
		const columnIds = new Set(retro.columns.map((c) => c.frame.id))
		const shift: [string, Partial<BoardElement>][] = []
		for (const id of frameContents(retro.scope, elements)) {
			const el = elements.get(id)!
			if (columnIds.has(id) || moved.has(id) || el.type === 'connector') continue
			if (el.y >= oldBottom - 1) shift.push([id, { y: el.y + growth }])
		}
		store.update([
			...retro.columns.map((c): [string, Partial<BoardElement>] => [c.frame.id, { h: Math.round(newBottom - c.frame.y) }]),
			...shift,
			[retro.scope.id, { h: retro.scope.h + growth }],
		])
	}
	store.checkpoint()
}

// ---------- summary ----------

export interface SummarySection {
	heading: string
	text: string | null
	items: string[]
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const votesLabel = (n: number) => (n ? ` (${n} ${n === 1 ? 'vote' : 'votes'})` : '')

/** The summary made from the board itself: most voted notes and groups per column, and the action items. */
export function ruleSummary(retro: Retro, voters: number): SummarySection[] {
	const notes = retro.columns.flatMap((c) => c.notes)
	const votes = notes.reduce((s, n) => s + n.votes, 0)
	const sections: SummarySection[] = [
		{
			heading: retro.scope.title || 'Retrospective',
			text: `${notes.length} notes in ${retro.columns.length} columns${votes ? `, ${votes} votes from ${voters} ${voters === 1 ? 'person' : 'people'}` : ''}.`,
			items: [],
		},
	]
	for (const column of retro.columns) {
		const top = [...column.notes].sort((a, b) => b.votes - a.votes).slice(0, 5)
		const groups = groupNotes(column.notes).filter((g) => g.notes.length > 1 && g.label !== 'Other')
		sections.push({
			heading: `${column.frame.title || 'Column'} (${column.notes.length})`,
			text: groups.length ? `Groups: ${groups.map((g) => `${g.label} (${g.notes.length})`).join(', ')}.` : null,
			items: top.map((n) => `${oneLine(n.el.text)}${votesLabel(n.votes)}`),
		})
	}
	sections.push({
		heading: 'Action items',
		text: retro.actions?.notes.length ? null : 'No action items yet.',
		items: (retro.actions?.notes ?? []).map((n) => oneLine(n.el.text)),
	})
	return sections
}

export interface AiSummary {
	summary: string
	themes: { title: string; detail: string }[]
	actions: { text: string; owner: string | null }[]
}

export function aiSections(ai: AiSummary, title: string): SummarySection[] {
	return [
		{ heading: title || 'Retrospective', text: ai.summary, items: [] },
		{ heading: 'Themes', text: null, items: ai.themes.map((t) => `${t.title}: ${t.detail}`) },
		{
			heading: 'Action items',
			text: ai.actions.length ? null : 'No action items.',
			items: ai.actions.map((a) => `${a.text}${a.owner ? ` (${a.owner.startsWith('@') ? a.owner : `@${a.owner}`})` : ''}`),
		},
	]
}

/** What Claude gets: the columns' notes with their votes, and the action items. */
export function aiInput(retro: Retro) {
	return {
		title: retro.scope.title,
		columns: retro.columns.map((c) => ({ name: c.frame.title, notes: c.notes.map((n) => ({ text: n.el.text, votes: n.votes })) })),
		actions: (retro.actions?.notes ?? []).map((n) => ({ text: n.el.text })),
	}
}

export function summaryMarkdown(sections: SummarySection[]): string {
	return sections
		.map((s, i) => [`${i === 0 ? '#' : '##'} ${s.heading}`, s.text, ...s.items.map((item) => `- ${item}`)].filter(Boolean).join('\n'))
		.join('\n\n')
}

/** Adds the summary next to the retrospective, in its own frame. One undo step. */
export function insertSummary(store: BoardStore, retro: Retro, sections: SummarySection[]) {
	const x = retro.scope.x + retro.scope.w + 80
	const width = 560
	let y = retro.scope.y + 40
	const texts: Omit<TextElement, 'z'>[] = []
	// a rough line count is enough: text blocks grow when edited
	const lineCount = (text: string, size: number) =>
		text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil((line.length * size * 0.55) / (width - 64))), 0)
	for (const [i, s] of sections.entries()) {
		const heading = i === 0 ? 30 : 22
		const headingH = Math.ceil(lineCount(s.heading, heading) * heading * 1.3 + 8)
		texts.push({
			id: newId(),
			type: 'text',
			x: x + 32,
			y,
			w: width - 64,
			h: headingH,
			text: s.heading,
			fontSize: heading,
			bold: true,
			align: 'left',
			textColor: 'auto',
		})
		y += headingH + 10
		const body = [s.text, ...s.items.map((item) => `• ${item}`)].filter(Boolean).join('\n')
		if (body) {
			const h = Math.ceil(lineCount(body, 18) * 18 * 1.3 + 8)
			texts.push({
				id: newId(),
				type: 'text',
				x: x + 32,
				y,
				w: width - 64,
				h,
				text: body,
				fontSize: 18,
				bold: false,
				align: 'left',
				textColor: 'auto',
			})
			y += h + 24
		}
	}
	store.checkpoint()
	const [frameId] = store.add([
		{ type: 'frame', title: 'Summary', fill: '#fefce8', x, y: retro.scope.y, w: width, h: Math.max(240, y - retro.scope.y + 16) },
	])
	store.add(texts)
	store.checkpoint()
	return frameId
}

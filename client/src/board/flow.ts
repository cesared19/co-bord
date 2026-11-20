import { type ElementMap, frameContents } from './geometry'
import { isStep } from './SparkyLinks'
import type { TextBox } from './types'

/** A test step: what to do, and what should happen next. */
export interface PathStep {
	action: string
	expected: string
}

/** One way through a flow, from where it starts to where it ends. */
export interface FlowPath {
	/** The steps of the flow it goes through, in order. */
	nodes: string[]
	title: string
	/** Where it starts and ends, and the decisions it takes. */
	description: string
	steps: PathStep[]
	/** Stable for the same way through the flow, so generating again finds the same test case. */
	sourceRef: string
}

const MAX_PATHS = 100

const textOf = (el: TextBox) => el.text.replace(/\s+/g, ' ').trim()

/** A short, stable hash (cyrb53) as hex. */
function hash(value: string): string {
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < value.length; i++) {
		const ch = value.charCodeAt(i)
		h1 = Math.imul(h1 ^ ch, 2654435761)
		h2 = Math.imul(h2 ^ ch, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

const byReading = (a: TextBox, b: TextBox) => a.y - b.y || a.x - b.x

/**
 * Every path through the flow in the board or a frame: from each step nothing leads to (or the first one, in a
 * loop) along the connectors to a step that leads nowhere. A connector back to a step already on the path ends
 * it there, as one more step. Connector labels (like Yes / No) are added to the step they leave from.
 */
export function flowPaths(
	elements: ElementMap,
	frameId: string | null,
	o: { boardId: string; scopeName: string },
): { paths: FlowPath[]; truncated: boolean; unconnected: number } {
	const frame = frameId ? elements.get(frameId) : undefined
	const inside = frame?.type === 'frame' ? new Set(frameContents(frame, elements)) : null
	const steps = [...elements.values()].filter((el): el is TextBox => isStep(el) && (!inside || inside.has(el.id)))
	const byId = new Map(steps.map((s) => [s.id, s]))
	const next = new Map<string, { to: string; label: string; connector: string }[]>()
	const incoming = new Map<string, number>()
	for (const el of elements.values()) {
		if (el.type !== 'connector' || !el.from.id || !el.to.id) continue
		// an arrow drawn only at the start points backwards
		const [from, to] = el.startArrow && !el.endArrow ? [el.to.id, el.from.id] : [el.from.id, el.to.id]
		if (!byId.has(from) || !byId.has(to) || from === to) continue
		next.set(from, [...(next.get(from) ?? []), { to, label: el.label.replace(/\s+/g, ' ').trim(), connector: el.id }])
		incoming.set(to, (incoming.get(to) ?? 0) + 1)
	}
	for (const list of next.values()) list.sort((a, b) => byReading(byId.get(a.to)!, byId.get(b.to)!))

	const connected = steps.filter((s) => next.has(s.id) || incoming.has(s.id))
	const unconnected = steps.length - connected.length
	let starts = connected.filter((s) => !incoming.has(s.id)).sort(byReading)
	if (!starts.length && connected.length) starts = [[...connected].sort(byReading)[0]]

	const paths: FlowPath[] = []
	let truncated = false
	const walk = (path: string[], labels: string[], edges: string[], back: { to: string; label: string; connector: string } | null) => {
		if (paths.length >= MAX_PATHS) {
			truncated = true
			return
		}
		const last = path[path.length - 1]
		const out = back ? [] : (next.get(last) ?? [])
		if (!out.length) {
			paths.push(buildPath(path, labels, back, edges, byId, o))
			return
		}
		for (const edge of out) {
			if (path.includes(edge.to)) walk(path, [...labels, edge.label], [...edges, edge.connector], edge)
			else walk([...path, edge.to], [...labels, edge.label], [...edges, edge.connector], null)
		}
	}
	for (const start of starts) walk([start.id], [], [], null)
	return { paths, truncated, unconnected }
}

/** How a step of the flow reads in a test case, by its shape. */
type Kind = 'decision' | 'terminal' | 'step'

const kindOf = (el: TextBox): Kind =>
	el.type === 'shape' && el.shape === 'diamond'
		? 'decision'
		: el.type === 'shape' && (el.shape === 'terminator' || el.shape === 'ellipse')
			? 'terminal'
			: 'step'

/** Bumped when the way paths are written changes, so generating again replaces the old test cases. */
const WRITING = 'v2'

function buildPath(
	nodes: string[],
	labels: string[],
	back: { to: string; label: string } | null,
	edges: string[],
	byId: Map<string, TextBox>,
	o: { boardId: string; scopeName: string },
): FlowPath {
	const el = (id: string) => byId.get(id)!
	const text = (id: string) => textOf(el(id))
	const kind = (id: string) => kindOf(el(id))
	const last = nodes.length - 1

	// a start or end shape (Start, END) is where the test begins or finishes, not something to do
	const startsAtTerminal = kind(nodes[0]) === 'terminal' && nodes.length > 1
	const endsAtTerminal = !back && last > 0 && kind(nodes[last]) === 'terminal'
	const action = (id: string, label: string | undefined) =>
		kind(id) === 'decision'
			? label
				? `${text(id)} → choose "${label}"`
				: `Answer: ${text(id)}`
			: label
				? `${text(id)} (${label})`
				: text(id)
	const expected = (id: string) =>
		kind(id) === 'decision'
			? `"${text(id)}" is asked`
			: kind(id) === 'terminal'
				? `The flow ends at "${text(id)}"`
				: `"${text(id)}" comes next`

	const steps: PathStep[] = []
	for (let i = startsAtTerminal ? 1 : 0; i < last; i++)
		steps.push({ action: action(nodes[i], labels[i]), expected: expected(nodes[i + 1]) })
	if (back) steps.push({ action: action(nodes[last], back.label), expected: `Goes back to "${text(back.to)}"` })
	else if (!endsAtTerminal) steps.push({ action: action(nodes[last], undefined), expected: 'Completed: the flow has no further step' })
	// a path that is only Start → End still gets its one step
	if (!steps.length) steps.push({ action: text(nodes[0]), expected: expected(nodes[last]) })

	// the decisions taken tell the paths apart
	const decisions = nodes.flatMap((id, i) =>
		kind(id) === 'decision' && (labels[i] || (i === last && back?.label)) ? [`${text(id)} = ${labels[i] || back?.label}`] : [],
	)
	const from = text(nodes[0])
	const to = back ? `back to ${text(back.to)}` : text(nodes[last])
	const prefix = o.scopeName ? `${o.scopeName}: ` : ''
	const route = `${from} → ${to}${decisions.length ? ` (${decisions.join('; ')})` : ''}`
	const title = `${prefix}${route}`.slice(0, 480)
	const description = [
		`A path through ${o.scopeName || 'the flow'}, from "${from}" to ${back ? `"${text(nodes[last])}", which goes back to "${text(back.to)}"` : `"${text(nodes[last])}"`}.`,
		decisions.length ? `Decisions: ${decisions.join('; ')}.` : '',
	]
		.filter(Boolean)
		.join('\n')

	// the same way through the flow, with the same words, is the same test case
	const key = [WRITING, ...nodes, '|', ...edges, '|', ...nodes.map(text), '|', ...labels, '|', back?.label ?? ''].join('\u0000')
	return { nodes, title, description, steps, sourceRef: `${pathRefPrefix(o.boardId)}${hash(key)}` }
}

/** What every generated test case of a board starts its sourceRef with, to find them again. */
export const pathRefPrefix = (boardId: string) => `cobord:${boardId}:path:`

/** A name for a SparkyTC section path: its parts are separated by " / ", so slashes inside a name become dashes. */
export const sectionPart = (name: string) => name.replace(/\//g, '-').replace(/\s+/g, ' ').trim() || 'Untitled'

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

function buildPath(
	nodes: string[],
	labels: string[],
	back: { to: string; label: string } | null,
	edges: string[],
	byId: Map<string, TextBox>,
	o: { boardId: string; scopeName: string },
): FlowPath {
	const text = (id: string) => textOf(byId.get(id)!)
	const withLabel = (id: string, label: string | undefined) => (label ? `${text(id)} (${label})` : text(id))
	const steps: PathStep[] = []
	for (let i = 0; i < nodes.length - 1; i++) steps.push({ action: withLabel(nodes[i], labels[i]), expected: text(nodes[i + 1]) })
	if (back) steps.push({ action: withLabel(nodes[nodes.length - 1], back.label), expected: `Back to: ${text(back.to)}` })

	const prefix = o.scopeName ? `${o.scopeName}: ` : ''
	const parts = nodes.map((id, i) => withLabel(id, labels[i]))
	if (back) parts.push(`back to ${text(back.to)}`)
	let route = parts.join(' → ')
	if (route.length > 200) {
		// keep the start, the branches taken and the end
		const branches = nodes.slice(1, -1).flatMap((id, i) => (labels[i + 1] ? [withLabel(id, labels[i + 1])] : []))
		route = [parts[0], ...branches, parts[parts.length - 1]].join(' → … ')
	}
	const title = `${prefix}${route}`.slice(0, 480)
	return { nodes, title, steps, sourceRef: `cobord:${o.boardId}:path:${hash([...nodes, '|', ...edges].join(','))}` }
}

/** A name for a SparkyTC section path: its parts are separated by " / ", so slashes inside a name become dashes. */
export const sectionPart = (name: string) => name.replace(/\//g, '-').replace(/\s+/g, ' ').trim() || 'Untitled'

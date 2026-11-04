import type { Rect } from './types'

/** Grid step, in board units, when snapping to the grid is on. */
export const GRID = 20

/** An alignment line: at `at` on the axis, from `from` to `to` along the other one. */
export interface Guide {
	axis: 'x' | 'y'
	at: number
	from: number
	to: number
}

/** Equal gaps between neighbors, drawn as measured segments along the axis. */
export interface Gap {
	axis: 'x' | 'y'
	/** Where each gap starts and ends along the axis, and where across it it's drawn. */
	spans: { from: number; to: number; at: number }[]
}

export interface Snapped {
	dx: number
	dy: number
	guides: Guide[]
	gaps: Gap[]
}

/** A rect seen with x and y swapped, so one function handles both axes. */
const swap = (r: Rect): Rect => ({ x: r.y, y: r.x, w: r.h, h: r.w })
const lines = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w]
const overlapsAcross = (a: Rect, b: Rect) => a.y < b.y + b.h && b.y < a.y + a.h

/** The best shift along x for `m`: aligned with an edge or center, or with even spacing between neighbors. */
function axisSnap(m: Rect, others: Rect[], threshold: number): { d: number; guides: Omit<Guide, 'axis'>[]; gaps: Gap['spans'] } | null {
	let best: { d: number; kind: 'line' | 'gap'; spans?: Gap['spans'] } | null = null
	const consider = (d: number, kind: 'line' | 'gap', spans?: Gap['spans']) => {
		if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - 0.01)) best = { d, kind, spans }
	}
	for (const o of others) for (const a of lines(o)) for (const b of lines(m)) consider(a - b, 'line')

	// even spacing with the neighbors in the same row
	const row = others.filter((o) => overlapsAcross(o, m))
	const left = row.filter((o) => o.x + o.w <= m.x + threshold).sort((a, b) => b.x + b.w - (a.x + a.w))[0]
	const right = row.filter((o) => o.x >= m.x + m.w - threshold).sort((a, b) => a.x - b.x)[0]
	const across = (a: Rect, b: Rect) => (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2
	if (left && right) {
		const x = (left.x + left.w + right.x - m.w) / 2
		if (x >= left.x + left.w) {
			const at = { ...m, x }
			consider(x - m.x, 'gap', [
				{ from: left.x + left.w, to: x, at: across(left, at) },
				{ from: x + m.w, to: right.x, at: across(right, at) },
			])
		}
	}
	if (left) {
		const beyond = others
			.filter((o) => o !== left && overlapsAcross(o, left) && o.x + o.w <= left.x)
			.sort((a, b) => b.x + b.w - (a.x + a.w))[0]
		if (beyond) {
			const gap = left.x - (beyond.x + beyond.w)
			const x = left.x + left.w + gap
			consider(x - m.x, 'gap', [
				{ from: beyond.x + beyond.w, to: left.x, at: across(beyond, left) },
				{ from: left.x + left.w, to: x, at: across(left, { ...m, x }) },
			])
		}
	}
	if (right) {
		const beyond = others.filter((o) => o !== right && overlapsAcross(o, right) && o.x >= right.x + right.w).sort((a, b) => a.x - b.x)[0]
		if (beyond) {
			const gap = beyond.x - (right.x + right.w)
			const x = right.x - gap - m.w
			consider(x - m.x, 'gap', [
				{ from: x + m.w, to: right.x, at: across(right, { ...m, x }) },
				{ from: right.x + right.w, to: beyond.x, at: across(right, beyond) },
			])
		}
	}
	const found = best as { d: number; kind: 'line' | 'gap'; spans?: Gap['spans'] } | null
	if (!found) return null
	if (found.kind === 'gap') return { d: found.d, guides: [], gaps: found.spans ?? [] }
	const moved = { ...m, x: m.x + found.d }
	const guides: Omit<Guide, 'axis'>[] = []
	for (const at of lines(moved)) {
		const matched = others.filter((o) => lines(o).some((l) => Math.abs(l - at) < 0.5))
		if (!matched.length) continue
		const from = Math.min(moved.y, ...matched.map((o) => o.y))
		const to = Math.max(moved.y + moved.h, ...matched.map((o) => o.y + o.h))
		guides.push({ at, from, to })
	}
	return { d: found.d, guides, gaps: [] }
}

const toGrid = (v: number) => Math.round(v / GRID) * GRID - v

/**
 * Where a box being moved should go: lined up with the edges or centers of `others`, evenly spaced between
 * them, or else on the grid when it's on. `threshold` is in board units.
 */
export function snapMove(m: Rect, others: Rect[], threshold: number, grid: boolean): Snapped {
	const sx = axisSnap(m, others, threshold)
	const sy = axisSnap(swap(m), others.map(swap), threshold)
	return {
		dx: sx ? sx.d : grid ? toGrid(m.x) : 0,
		dy: sy ? sy.d : grid ? toGrid(m.y) : 0,
		guides: [
			...(sx?.guides ?? []).map((g) => ({ axis: 'x' as const, ...g })),
			...(sy?.guides ?? []).map((g) => ({ axis: 'y' as const, ...g })),
		],
		gaps: [
			...(sx?.gaps.length ? [{ axis: 'x' as const, spans: sx.gaps }] : []),
			...(sy?.gaps.length ? [{ axis: 'y' as const, spans: sy.gaps }] : []),
		],
	}
}

/**
 * Snaps the edges of a box being resized: `edges` says which edge moves on each axis. Returns the new rect and
 * the guides to show.
 */
export function snapEdges(
	r: Rect,
	edges: { x?: 'start' | 'end'; y?: 'start' | 'end' },
	others: Rect[],
	threshold: number,
	grid: boolean,
	min: number,
): { rect: Rect; guides: Guide[] } {
	const out = { ...r }
	const guides: Guide[] = []
	for (const axis of ['x', 'y'] as const) {
		const edge = edges[axis]
		if (!edge) continue
		const pos = axis === 'x' ? (edge === 'start' ? out.x : out.x + out.w) : edge === 'start' ? out.y : out.y + out.h
		let best: { at: number; matched: Rect[] } | null = null
		for (const o of others) {
			const ls = axis === 'x' ? lines(o) : lines(swap(o))
			for (const at of ls)
				if (Math.abs(at - pos) <= threshold && (!best || Math.abs(at - pos) < Math.abs(best.at - pos))) best = { at, matched: [o] }
		}
		const target = best ? best.at : grid ? pos + toGrid(pos) : pos
		if (axis === 'x') {
			if (edge === 'start') {
				const right = out.x + out.w
				out.x = Math.min(target, right - min)
				out.w = right - out.x
			} else out.w = Math.max(min, target - out.x)
		} else if (edge === 'start') {
			const bottom = out.y + out.h
			out.y = Math.min(target, bottom - min)
			out.h = bottom - out.y
		} else out.h = Math.max(min, target - out.y)
		if (best) {
			const matched = others.filter((o) => (axis === 'x' ? lines(o) : lines(swap(o))).some((l) => Math.abs(l - best!.at) < 0.5))
			const across = axis === 'x' ? [out, ...matched].map((o) => [o.y, o.y + o.h]) : [out, ...matched].map((o) => [o.x, o.x + o.w])
			guides.push({ axis, at: best.at, from: Math.min(...across.map((a) => a[0])), to: Math.max(...across.map((a) => a[1])) })
		}
	}
	return { rect: out, guides }
}

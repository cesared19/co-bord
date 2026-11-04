import { center, rotatePoint, rotationOf } from './geometry'
import type { DrawElement, InkMode, Point } from './types'

/** A smooth SVG path through x, y pairs: quadratic curves between the midpoints. */
export function inkPath(points: number[]): string {
	const n = points.length / 2
	if (n === 0) return ''
	const f = (v: number) => Math.round(v * 10) / 10
	const x = (i: number) => points[i * 2]
	const y = (i: number) => points[i * 2 + 1]
	// a single click is a dot
	if (n === 1) return `M${f(x(0))} ${f(y(0))}l0.01 0`
	let d = `M${f(x(0))} ${f(y(0))}`
	for (let i = 1; i < n - 1; i++) d += `Q${f(x(i))} ${f(y(i))} ${f((x(i) + x(i + 1)) / 2)} ${f((y(i) + y(i + 1)) / 2)}`
	return `${d}L${f(x(n - 1))} ${f(y(n - 1))}`
}

/** The new element for a stroke drawn through `world` points: a box around it, with the points inside. */
export function strokeElement(
	world: Point[],
	opts: { stroke: string; strokeWidth: number; highlighter: boolean },
): Omit<DrawElement, 'id' | 'z'> {
	const pad = opts.strokeWidth / 2 + 1
	const xs = world.map((p) => p.x)
	const ys = world.map((p) => p.y)
	const x = Math.floor(Math.min(...xs) - pad)
	const y = Math.floor(Math.min(...ys) - pad)
	const w = Math.max(1, Math.ceil(Math.max(...xs) + pad - x))
	const h = Math.max(1, Math.ceil(Math.max(...ys) + pad - y))
	const points: number[] = []
	for (const p of world) points.push(Math.round((p.x - x) * 10) / 10, Math.round((p.y - y) * 10) / 10)
	return {
		type: 'draw',
		x,
		y,
		w,
		h,
		vw: w,
		vh: h,
		points,
		stroke: opts.stroke,
		strokeWidth: opts.strokeWidth,
		...(opts.highlighter ? { highlighter: true } : {}),
	}
}

/** Adds a point to a stroke being drawn, unless it's too close to the last one to matter. */
export function addInkPoint(list: Point[], p: Point, minGap: number) {
	const last = list[list.length - 1]
	if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minGap) list.push(p)
}

const segmentDistance = (p: Point, a: Point, b: Point) => {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const len = dx * dx + dy * dy
	const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
	return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Whether a stroke passes within `radius` (board units) of a board point. */
export function touchesStroke(el: DrawElement, p: Point, radius: number): boolean {
	const local = rotatePoint(p, center(el), -rotationOf(el))
	const sx = el.w / (el.vw || 1)
	const sy = el.h / (el.vh || 1)
	const at = (i: number): Point => ({ x: el.x + el.points[i * 2] * sx, y: el.y + el.points[i * 2 + 1] * sy })
	const reach = radius + (el.strokeWidth * Math.min(sx, sy)) / 2
	const n = el.points.length / 2
	if (n === 1) return Math.hypot(local.x - at(0).x, local.y - at(0).y) <= reach
	for (let i = 0; i < n - 1; i++) if (segmentDistance(local, at(i), at(i + 1)) <= reach) return true
	return false
}

/** Where the drawing tool's choices are remembered, per person. */
export const INK_KEY = 'co-bord:ink'

export interface InkSettings {
	mode: InkMode
	/** Color and width (an index in INK_WIDTHS) of each kind of stroke. */
	pen: { color: string; width: number }
	highlighter: { color: string; width: number }
}

export const DEFAULT_INK: InkSettings = { mode: 'pen', pen: { color: 'auto', width: 1 }, highlighter: { color: '#facc15', width: 1 } }

export function loadInk(): InkSettings {
	try {
		const saved = JSON.parse(localStorage.getItem(INK_KEY) ?? 'null') as Partial<InkSettings> | null
		return saved ? { ...DEFAULT_INK, ...saved } : DEFAULT_INK
	} catch {
		return DEFAULT_INK
	}
}

export function saveInk(ink: InkSettings) {
	try {
		localStorage.setItem(INK_KEY, JSON.stringify(ink))
	} catch {
		/* storage unavailable */
	}
}

/** How long a laser point stays on screen. */
export const LASER_MS = 1400

/**
 * The laser strokes this person is drawing: points fade out after LASER_MS. They're shared through awareness
 * (never saved on the board), so everyone sees them while they last.
 */
export class LaserTrail {
	strokes: { x: number; y: number; t: number }[][] = []
	drawing = false
	private listeners = new Set<() => void>()

	start(p: Point) {
		this.strokes.push([{ ...p, t: performance.now() }])
		this.drawing = true
		this.emit()
	}

	add(p: Point) {
		const stroke = this.strokes[this.strokes.length - 1]
		if (!this.drawing || !stroke) return
		const last = stroke[stroke.length - 1]
		if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1) return
		stroke.push({ ...p, t: performance.now() })
		this.emit()
	}

	end() {
		this.drawing = false
		this.emit()
	}

	/** Drops faded points; whether anything is left to show. */
	prune(now: number): boolean {
		this.strokes = this.strokes
			.map((s) => s.filter((p) => now - p.t < LASER_MS))
			.filter((s, i, all) => s.length > 0 || (this.drawing && i === all.length - 1))
		return this.drawing || this.strokes.some((s) => s.length > 0)
	}

	/** The strokes as flat x, y lists, rounded, for awareness. */
	shared(): number[][] {
		return this.strokes.filter((s) => s.length).map((s) => s.flatMap((p) => [Math.round(p.x), Math.round(p.y)]))
	}

	onChange(fn: () => void) {
		this.listeners.add(fn)
		return () => {
			this.listeners.delete(fn)
		}
	}

	private emit() {
		for (const fn of this.listeners) fn()
	}
}

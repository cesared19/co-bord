import type { BoardElement, BoxElement, Camera, ConnectorElement, Endpoint, Point, Rect, ShapeKind, TextBox } from './types'
import { type FrameElement, isBox, isFrame } from './types'

export function shapePath(kind: ShapeKind, w: number, h: number): string {
	switch (kind) {
		case 'rounded': {
			const r = Math.min(14, w / 4, h / 4)
			return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`
		}
		case 'ellipse':
			return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`
		case 'diamond':
			return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`
		case 'terminator': {
			const rx = Math.min(h / 2, w / 2)
			const ry = h / 2
			return `M${rx} 0H${w - rx}A${rx} ${ry} 0 0 1 ${w - rx} ${h}H${rx}A${rx} ${ry} 0 0 1 ${rx} 0Z`
		}
		case 'parallelogram': {
			const s = Math.min(w * 0.2, h * 0.6)
			return `M${s} 0H${w}L${w - s} ${h}H0Z`
		}
		case 'hexagon': {
			const s = Math.min(w * 0.2, h / 2)
			return `M${s} 0H${w - s}L${w} ${h / 2}L${w - s} ${h}H${s}L0 ${h / 2}Z`
		}
		case 'triangle':
			return `M${w / 2} 0L${w} ${h}H0Z`
		case 'cylinder': {
			const ry = Math.min(h * 0.12, 18)
			return `M0 ${ry}A${w / 2} ${ry} 0 0 1 ${w} ${ry}V${h - ry}A${w / 2} ${ry} 0 0 1 0 ${h - ry}ZM0 ${ry}A${w / 2} ${ry} 0 0 0 ${w} ${ry}`
		}
		case 'document': {
			const wave = Math.min(h * 0.1, 14)
			return `M0 0H${w}V${h - wave}C${w * 0.75} ${h - wave * 3} ${w * 0.25} ${h + wave} 0 ${h - wave}Z`
		}
		default:
			return `M0 0H${w}V${h}H0Z`
	}
}

/** Padding around the text inside a shape, so it stays within the outline. */
export function textInsets(el: TextBox): { top: number; right: number; bottom: number; left: number } {
	const base = el.type === 'text' ? 4 : 10
	if (el.type !== 'shape') return { top: base, right: base, bottom: base, left: base }
	const { w, h } = el
	switch (el.shape) {
		case 'diamond':
			return { top: h * 0.22, bottom: h * 0.22, left: w * 0.22, right: w * 0.22 }
		case 'ellipse':
			return { top: h * 0.15, bottom: h * 0.15, left: w * 0.15, right: w * 0.15 }
		case 'triangle':
			return { top: h * 0.42, bottom: base, left: w * 0.22, right: w * 0.22 }
		case 'parallelogram':
		case 'hexagon':
			return { top: base, bottom: base, left: Math.min(w * 0.2, h * 0.6), right: Math.min(w * 0.2, h * 0.6) }
		case 'terminator':
			return { top: base, bottom: base, left: Math.min(h / 2, w / 2) * 0.6, right: Math.min(h / 2, w / 2) * 0.6 }
		case 'cylinder':
			return { top: Math.min(h * 0.12, 18) * 2 + 4, bottom: base, left: base, right: base }
		case 'document':
			return { top: base, bottom: Math.min(h * 0.1, 14) * 2, left: base, right: base }
		default:
			return { top: base, right: base, bottom: base, left: base }
	}
}

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** A rectangle that may be rotated around its center. */
export type Rotatable = Rect & { rotation?: number; type?: string }

/** The rotation of an element in degrees; frames and connectors don't rotate. */
export const rotationOf = (el: BoardElement | Rotatable | undefined): number =>
	!el || el.type === 'frame' || el.type === 'connector' ? 0 : ((el as Rotatable).rotation ?? 0) % 360 || 0

export function rotatePoint(p: Point, c: Point, degrees: number): Point {
	if (!degrees) return p
	const a = (degrees * Math.PI) / 180
	const cos = Math.cos(a)
	const sin = Math.sin(a)
	const dx = p.x - c.x
	const dy = p.y - c.y
	return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** The four corners of a box, rotated. */
export function boxCorners(el: Rotatable): Point[] {
	const c = center(el)
	const r = rotationOf(el)
	return [
		{ x: el.x, y: el.y },
		{ x: el.x + el.w, y: el.y },
		{ x: el.x + el.w, y: el.y + el.h },
		{ x: el.x, y: el.y + el.h },
	].map((p) => rotatePoint(p, c, r))
}

/** A point inside a box, rotated or not. */
export const containsRotated = (el: Rotatable, p: Point, pad = 0) => contains(el, rotatePoint(p, center(el), -rotationOf(el)), pad)

/** Where the line from the element's center toward `target` crosses its outline. */
export function outlinePoint(el: BoxElement, target: Point): Point {
	const r = rotationOf(el)
	if (r) return rotatePoint(outlinePoint({ ...el, rotation: 0 } as BoxElement, rotatePoint(target, center(el), -r)), center(el), r)
	const c = center(el)
	const dx = target.x - c.x
	const dy = target.y - c.y
	if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return c
	const hw = el.w / 2
	const hh = el.h / 2
	let t: number
	if (el.type === 'shape' && el.shape === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
	else if (el.type === 'shape' && el.shape === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
	else t = Math.min(Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity)
	return { x: c.x + dx * t, y: c.y + dy * t }
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** The middle of a side of a box, rotated with it. */
export function sidePoint(el: Rotatable, side: Side): Point {
	let p: Point
	switch (side) {
		case 'top':
			p = { x: el.x + el.w / 2, y: el.y }
			break
		case 'bottom':
			p = { x: el.x + el.w / 2, y: el.y + el.h }
			break
		case 'left':
			p = { x: el.x, y: el.y + el.h / 2 }
			break
		case 'right':
			p = { x: el.x + el.w, y: el.y + el.h / 2 }
	}
	return rotatePoint(p, center(el), rotationOf(el))
}

/**
 * The side of a box nearest to a point dropped on it, or undefined near its center (then the side facing the
 * other end is used, as before sides were kept).
 */
export function nearestSide(el: BoxElement, p: Point): Side | undefined {
	const c = center(el)
	const local = rotatePoint(p, c, -rotationOf(el))
	const nx = (local.x - c.x) / (el.w / 2 || 1)
	const ny = (local.y - c.y) / (el.h / 2 || 1)
	if (Math.max(Math.abs(nx), Math.abs(ny)) < 0.35) return undefined
	if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'right' : 'left'
	return ny >= 0 ? 'bottom' : 'top'
}

/** `{ side }` for an endpoint dropped at `p`, or nothing near the center (no undefined values in the board). */
export function sideOf(el: BoxElement, p: Point): { side?: Side } {
	const side = nearestSide(el, p)
	return side ? { side } : {}
}

/**
 * The side of a (rotated) box a line leaves from: the one it was attached to, or else the one facing `toward`;
 * and the axis direction it leaves in.
 */
function exitSide(el: BoxElement | null, from: Point, toward: Point, fixed?: Side): { side: Side; vector: Point } {
	const r = rotationOf(el ?? undefined)
	const side = (el && fixed) || facingSide(from, r ? rotatePoint(toward, from, -r) : toward)
	if (!r) return { side, vector: sideVector[side] }
	const v = rotatePoint(sideVector[side], { x: 0, y: 0 }, r)
	// elbows stay horizontal and vertical: the closest axis
	return { side, vector: Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) } }
}

const sideVector: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }

function facingSide(from: Point, toward: Point): Side {
	const dx = toward.x - from.x
	const dy = toward.y - from.y
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
	return dy >= 0 ? 'bottom' : 'top'
}

export type ElementMap = Map<string, BoardElement>

function attached(end: Endpoint, elements: ElementMap): BoxElement | null {
	if (!end.id) return null
	const el = elements.get(end.id)
	return isBox(el) ? el : null
}

/** The point an endpoint aims at: an element's center, or the free point. */
const aim = (end: Endpoint, elements: ElementMap): Point => {
	const el = attached(end, elements)
	return el ? center(el) : { x: end.x, y: end.y }
}

export interface ConnectorGeometry {
	path: string
	start: Point
	end: Point
	/** Direction the line leaves the start and arrives at the end, for the arrowheads. */
	startAngle: number
	endAngle: number
	mid: Point
	bounds: Rect
}

export function connectorGeometry(c: ConnectorElement, elements: ElementMap): ConnectorGeometry {
	const fromEl = attached(c.from, elements)
	const toEl = attached(c.to, elements)
	const fromAim = aim(c.from, elements)
	const toAim = aim(c.to, elements)

	if (c.route === 'straight') {
		const start = fromEl ? (c.from.side ? sidePoint(fromEl, c.from.side) : outlinePoint(fromEl, toAim)) : fromAim
		const end = toEl ? (c.to.side ? sidePoint(toEl, c.to.side) : outlinePoint(toEl, fromAim)) : toAim
		const angle = Math.atan2(end.y - start.y, end.x - start.x)
		return finish([start, end], `M${start.x} ${start.y}L${end.x} ${end.y}`, angle + Math.PI, angle, lerp(start, end, 0.5))
	}

	const fromExit = exitSide(fromEl, fromAim, toAim, c.from.side)
	const toExit = exitSide(toEl, toAim, fromAim, c.to.side)
	const start = fromEl ? sidePoint(fromEl, fromExit.side) : fromAim
	const end = toEl ? sidePoint(toEl, toExit.side) : toAim
	const ds = fromExit.vector
	const de = toExit.vector

	if (c.route === 'curved') {
		const k = Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) / 2.5)
		const c1 = { x: start.x + ds.x * k, y: start.y + ds.y * k }
		const c2 = { x: end.x + de.x * k, y: end.y + de.y * k }
		const mid = bezier(start, c1, c2, end, 0.5)
		return finish(
			[start, c1, c2, end],
			`M${start.x} ${start.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`,
			Math.atan2(c1.y - start.y, c1.x - start.x),
			Math.atan2(end.y - c2.y, end.x - c2.x),
			mid,
		)
	}

	const points = elbowRoute(start, ds, fromEl, end, de, toEl, obstacles(c, elements))
	const last = points[points.length - 2]
	const first = points[1]
	return finish(
		points,
		points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(''),
		Math.atan2(first.y - start.y, first.x - start.x),
		Math.atan2(end.y - last.y, end.x - last.x),
		polylineMid(points),
	)
}

/** How far an elbow goes straight out of a side before turning, so it never runs along the shape. */
const STUB = 20

/**
 * An elbow from `start` (leaving along `ds`) to `end` (arriving against `de`): out of each side by STUB, then the
 * shortest of a few horizontal / vertical paths that doesn't cut through the shapes at its ends or turn back on
 * itself, with few bends.
 */
/** Elements a connector's elbow keeps clear of: shapes, notes, text and media, not frames or strokes. */
export const isObstacle = (el: BoardElement | undefined): el is BoxElement => isBox(el) && el.type !== 'frame' && el.type !== 'draw'

/** How far around its ends an elbow looks for shapes in the way. */
const ROUTE_MARGIN = 160

/** The area an elbow can run through: around both ends. Shapes there are kept clear of. */
export function routeRegion(c: ConnectorElement, elements: ElementMap): Rect {
	const end = (e: Endpoint): Rect => {
		const el = attached(e, elements)
		return el ? elementBox(el) : { x: e.x, y: e.y, w: 0, h: 0 }
	}
	const b = unionBounds([end(c.from), end(c.to)])!
	return { x: b.x - ROUTE_MARGIN, y: b.y - ROUTE_MARGIN, w: b.w + ROUTE_MARGIN * 2, h: b.h + ROUTE_MARGIN * 2 }
}

/** The boxes of the other shapes in a connector's region. */
function obstacles(c: ConnectorElement, elements: ElementMap): Rect[] {
	const region = routeRegion(c, elements)
	const out: Rect[] = []
	for (const el of elements.values()) {
		if (!isObstacle(el) || el.id === c.from.id || el.id === c.to.id) continue
		const b = elementBox(el)
		if (intersects(region, b)) out.push(b)
	}
	return out
}

/** Shapes by area, so a connector finds the ones near it without looking at the whole board. */
export class BoxGrid {
	private cells = new Map<string, BoxElement[]>()
	private static SIZE = 512

	constructor(elements: ElementMap) {
		for (const el of elements.values()) {
			if (!isObstacle(el)) continue
			const b = elementBox(el)
			this.each(b, (key) => {
				const list = this.cells.get(key)
				if (list) list.push(el)
				else this.cells.set(key, [el])
			})
		}
	}

	private each(r: Rect, fn: (key: string) => void) {
		const s = BoxGrid.SIZE
		for (let x = Math.floor(r.x / s); x <= Math.floor((r.x + r.w) / s); x++)
			for (let y = Math.floor(r.y / s); y <= Math.floor((r.y + r.h) / s); y++) fn(`${x}:${y}`)
	}

	/** The shapes whose box touches `r`. */
	query(r: Rect): BoxElement[] {
		const found = new Set<BoxElement>()
		this.each(r, (key) => {
			for (const el of this.cells.get(key) ?? []) if (intersects(r, elementBox(el))) found.add(el)
		})
		return [...found]
	}
}

function elbowRoute(
	start: Point,
	ds: Point,
	fromEl: BoxElement | null,
	end: Point,
	de: Point,
	toEl: BoxElement | null,
	others: Rect[] = [],
): Point[] {
	const stub = (el: BoxElement | null) => (el ? STUB : 0)
	const a = { x: start.x + ds.x * stub(fromEl), y: start.y + ds.y * stub(fromEl) }
	const b = { x: end.x + de.x * stub(toEl), y: end.y + de.y * stub(toEl) }
	const mx = (a.x + b.x) / 2
	const my = (a.y + b.y) / 2
	const middles: Point[][] = [
		[{ x: b.x, y: a.y }],
		[{ x: a.x, y: b.y }],
		[
			{ x: mx, y: a.y },
			{ x: mx, y: b.y },
		],
		[
			{ x: a.x, y: my },
			{ x: b.x, y: my },
		],
	]
	// around the shapes too: the ends' (when they face away from each other) and those in the way
	const ends = [fromEl, toEl].filter((el): el is BoxElement => !!el).map(elementBox)
	for (const r of [...ends, ...others]) {
		for (const y of [r.y - STUB, r.y + r.h + STUB])
			middles.push([
				{ x: a.x, y },
				{ x: b.x, y },
			])
		for (const x of [r.x - STUB, r.x + r.w + STUB])
			middles.push([
				{ x, y: a.y },
				{ x, y: b.y },
			])
	}
	let best: Point[] = [start, a, b, end]
	let bestScore = Infinity
	for (const middle of middles) {
		const pts = clean([start, a, ...middle, b, end])
		const score = routeScore(pts, ends, others, { start: !!fromEl, end: !!toEl })
		if (score < bestScore) {
			bestScore = score
			best = pts
		}
	}
	return best.length < 2 ? [start, end] : best
}

/** The axis-aligned box of an element, rotated ones included. */
const elementBox = (el: BoxElement): Rect => (rotationOf(el) ? boundsOfPoints(boxCorners(el)) : { x: el.x, y: el.y, w: el.w, h: el.h })

/** Without repeated points or points in the middle of a straight run. */
function clean(points: Point[]): Point[] {
	const out: Point[] = []
	for (const p of points) {
		if (out.length && Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) < 0.01) continue
		if (out.length >= 2) {
			const [q, r] = [out[out.length - 2], out[out.length - 1]]
			const straight = (q.x === r.x && r.x === p.x) || (q.y === r.y && r.y === p.y)
			const turnsBack = straight && (r.x - q.x) * (p.x - r.x) + (r.y - q.y) * (p.y - r.y) < 0
			if (straight && !turnsBack) out.pop()
		}
		out.push(p)
	}
	return out
}

/** Length, plus a little for each bend, plus a lot for cutting through an end's shape or doubling back. */
function routeScore(points: Point[], boxes: Rect[], others: Rect[], stubs: { start: boolean; end: boolean }): number {
	let score = 0
	for (let i = 1; i < points.length; i++) {
		const [p, q] = [points[i - 1], points[i]]
		score += Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
		if (p.x !== q.x && p.y !== q.y) score += 1e5
		if (i >= 2) {
			const o = points[i - 2]
			score += 24
			if ((p.x - o.x) * (q.x - p.x) + (p.y - o.y) * (q.y - p.y) < 0) score += 1e4
		}
		// the stubs touch their shapes; everything else stays out of them
		const stub = (i === 1 && stubs.start) || (i === points.length - 1 && stubs.end)
		if (!stub) for (const r of boxes) if (segmentCrosses(p, q, r)) score += 1e4
		// other shapes: a little less, so a line that can't avoid them still goes the short way
		for (const r of others) if (segmentCrosses(p, q, r)) score += 5e3
	}
	return score
}

const shrink = (r: Rect, by: number): Rect => ({ x: r.x + by, y: r.y + by, w: Math.max(0, r.w - 2 * by), h: Math.max(0, r.h - 2 * by) })

/** Whether a horizontal or vertical segment passes through the inside of a box (its edges don't count). */
function segmentCrosses(p: Point, q: Point, r: Rect): boolean {
	const inside = shrink(r, 0.5)
	if (p.y === q.y) {
		const [x1, x2] = [Math.min(p.x, q.x), Math.max(p.x, q.x)]
		return p.y > inside.y && p.y < inside.y + inside.h && x2 > inside.x && x1 < inside.x + inside.w
	}
	const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)]
	return p.x > inside.x && p.x < inside.x + inside.w && y2 > inside.y && y1 < inside.y + inside.h
}

function finish(points: Point[], path: string, startAngle: number, endAngle: number, mid: Point): ConnectorGeometry {
	const start = points[0]
	const end = points[points.length - 1]
	return { path, start, end, startAngle, endAngle, mid, bounds: boundsOfPoints(points) }
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	const u = 1 - t
	return {
		x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
		y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
	}
}

function polylineMid(points: Point[]): Point {
	const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
	let remaining = lengths.reduce((a, b) => a + b, 0) / 2
	for (let i = 0; i < lengths.length; i++) {
		if (remaining <= lengths[i]) return lerp(points[i], points[i + 1], lengths[i] ? remaining / lengths[i] : 0)
		remaining -= lengths[i]
	}
	return points[points.length - 1]
}

/** Arrowhead triangle at `tip`, pointing along `angle`. */
export function arrowHead(tip: Point, angle: number, size: number): string {
	const spread = Math.PI / 7
	const a = { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) }
	const b = { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) }
	return `M${tip.x} ${tip.y}L${a.x} ${a.y}L${b.x} ${b.y}Z`
}

export function boundsOfPoints(points: Point[]): Rect {
	const xs = points.map((p) => p.x)
	const ys = points.map((p) => p.y)
	const x = Math.min(...xs)
	const y = Math.min(...ys)
	return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function elementBounds(el: BoardElement, elements: ElementMap): Rect {
	if (isBox(el)) return rotationOf(el) ? boundsOfPoints(boxCorners(el)) : { x: el.x, y: el.y, w: el.w, h: el.h }
	return connectorGeometry(el, elements).bounds
}

export function unionBounds(rects: Rect[]): Rect | null {
	if (!rects.length) return null
	const x = Math.min(...rects.map((r) => r.x))
	const y = Math.min(...rects.map((r) => r.y))
	const right = Math.max(...rects.map((r) => r.x + r.w))
	const bottom = Math.max(...rects.map((r) => r.y + r.h))
	return { x, y, w: right - x, h: bottom - y }
}

export const rectFromPoints = (a: Point, b: Point): Rect => ({
	x: Math.min(a.x, b.x),
	y: Math.min(a.y, b.y),
	w: Math.abs(a.x - b.x),
	h: Math.abs(a.y - b.y),
})

export const intersects = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
export const contains = (r: Rect, p: Point, pad = 0) =>
	p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad

export const toWorld = (cam: Camera, p: Point): Point => ({ x: (p.x - cam.x) / cam.zoom, y: (p.y - cam.y) / cam.zoom })
export const toScreen = (cam: Camera, p: Point): Point => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y })

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** Zooms keeping the world point under `screen` in place. */
export function zoomAt(cam: Camera, screen: Point, zoom: number): Camera {
	const z = clampZoom(zoom)
	const world = toWorld(cam, screen)
	return { zoom: z, x: screen.x - world.x * z, y: screen.y - world.y * z }
}

/** Camera that shows `rect` inside a viewport of the given size. */
export function fitCamera(rect: Rect, width: number, height: number, padding = 80, maxZoom = 1): Camera {
	const zoom = clampZoom(Math.min((width - padding * 2) / Math.max(rect.w, 1), (height - padding * 2) / Math.max(rect.h, 1), maxZoom))
	return { zoom, x: width / 2 - (rect.x + rect.w / 2) * zoom, y: height / 2 - (rect.y + rect.h / 2) * zoom }
}

/** Black or white, whichever reads better on `hex`. */
export function contrastText(hex: string): string {
	const m = /^#([0-9a-f]{6})$/i.exec(hex)
	if (!m) return '#1f2937'
	const n = Number.parseInt(m[1], 16)
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const c = v / 255
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	})
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
	return luminance > 0.35 ? '#1f2937' : '#f9fafb'
}

export function resolveTextColor(el: TextBox, dark: boolean): string {
	if (el.textColor !== 'auto') return el.textColor
	const fill = el.type === 'text' ? 'transparent' : el.fill
	if (fill === 'transparent') return dark ? '#e5e7eb' : '#1f2937'
	return contrastText(fill)
}

export const resolveStroke = (stroke: string, dark: boolean) => (stroke === 'auto' ? (dark ? '#d1d5db' : '#1f2937') : stroke)

/** Everything that lies completely inside the frame (other frames included), which moves with it. */
const inside = (b: Rect, f: Rect) => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h

/**
 * The frame an element belongs to, among the frames that hold it whole: the smallest one; between frames of the
 * same size (a frame pasted or duplicated over another), the one just below the element in z (its own frame, not
 * the copy above it), or else the lowest.
 */
function ownerFrame(el: BoardElement, b: Rect, frames: FrameElement[]): FrameElement | null {
	// a frame belongs only to bigger frames, never to one of the same size over it
	const holding = frames.filter((f) => f.id !== el.id && inside(b, f) && (el.type !== 'frame' || f.w * f.h > b.w * b.h + 1))
	if (!holding.length) return null
	const area = Math.min(...holding.map((f) => f.w * f.h))
	const smallest = holding.filter((f) => f.w * f.h <= area + 1)
	const below = smallest.filter((f) => f.z < el.z).sort((a, c) => c.z - a.z)[0]
	return below ?? smallest.sort((a, c) => a.z - c.z)[0]
}

/**
 * What a frame holds: the elements completely inside it that belong to it (or to frames inside it). Something
 * inside two frames goes with the one it belongs to (see ownerFrame), so moving a copy doesn't take the original's.
 */
export function frameContents(frame: Rect & { id: string }, elements: ElementMap): string[] {
	const frames = [...elements.values()].filter(isFrame)
	const ids: string[] = []
	for (const el of elements.values()) {
		if (el.id === frame.id) continue
		const b = elementBounds(el, elements)
		if (!inside(b, frame)) continue
		const owner = ownerFrame(el, b, frames)
		// (a frame of the same size over this one has no owner: it isn't held by it)
		if (owner && (owner.id === frame.id || (inside(owner, frame) && owner.w * owner.h < frame.w * frame.h))) ids.push(el.id)
	}
	return ids
}

/** The selection plus whatever is inside the selected frames. */
export function withFrameContents(ids: string[], elements: ElementMap): string[] {
	const result = new Set(ids)
	for (const id of ids) {
		const el = elements.get(id)
		if (el?.type === 'frame') for (const inner of frameContents(el, elements)) result.add(inner)
	}
	return [...result]
}

/** Frame tints are light; in dark mode they are mixed into the dark panel color so they stay a hint. */
export function resolveFrameFill(fill: string, dark: boolean): string {
	if (!dark) return fill === 'auto' ? '#ffffff' : fill
	const panel = [0x1f, 0x23, 0x29]
	const m = /^#([0-9a-f]{6})$/i.exec(fill)
	if (!m) return '#1f2329'
	const n = Number.parseInt(m[1], 16)
	const mixed = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => Math.round(panel[i] * 0.86 + c * 0.14))
	return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
export const frameBorder = (dark: boolean) => (dark ? '#3a3f47' : '#d6d9de')

import type { BoardElement, BoxElement, Camera, ConnectorElement, Endpoint, Point, Rect, ShapeKind, TextBox } from './types'
import { isBox } from './types'

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

/** Where the line from the element's center toward `target` crosses its outline. */
export function outlinePoint(el: BoxElement, target: Point): Point {
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

export function sidePoint(el: Rect, side: Side): Point {
	switch (side) {
		case 'top':
			return { x: el.x + el.w / 2, y: el.y }
		case 'bottom':
			return { x: el.x + el.w / 2, y: el.y + el.h }
		case 'left':
			return { x: el.x, y: el.y + el.h / 2 }
		case 'right':
			return { x: el.x + el.w, y: el.y + el.h / 2 }
	}
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
		const start = fromEl ? outlinePoint(fromEl, toAim) : fromAim
		const end = toEl ? outlinePoint(toEl, fromAim) : toAim
		const angle = Math.atan2(end.y - start.y, end.x - start.x)
		return finish([start, end], `M${start.x} ${start.y}L${end.x} ${end.y}`, angle + Math.PI, angle, lerp(start, end, 0.5))
	}

	const fromSide = facingSide(fromAim, toAim)
	const toSide = facingSide(toAim, fromAim)
	const start = fromEl ? sidePoint(fromEl, fromSide) : fromAim
	const end = toEl ? sidePoint(toEl, toSide) : toAim
	const ds = sideVector[fromSide]
	const de = sideVector[toSide]

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

	const horizontalStart = ds.x !== 0
	const horizontalEnd = de.x !== 0
	let points: Point[]
	if (horizontalStart && horizontalEnd) {
		const midX = (start.x + end.x) / 2
		points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
	} else if (!horizontalStart && !horizontalEnd) {
		const midY = (start.y + end.y) / 2
		points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]
	} else if (horizontalStart) points = [start, { x: end.x, y: start.y }, end]
	else points = [start, { x: start.x, y: end.y }, end]
	points = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.01)
	if (points.length < 2) points = [start, end]
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
	if (isBox(el)) return { x: el.x, y: el.y, w: el.w, h: el.h }
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
export function frameContents(frame: Rect & { id: string }, elements: ElementMap): string[] {
	const ids: string[] = []
	for (const el of elements.values()) {
		if (el.id === frame.id) continue
		const b = elementBounds(el, elements)
		if (b.x >= frame.x && b.y >= frame.y && b.x + b.w <= frame.x + frame.w && b.y + b.h <= frame.y + frame.h) ids.push(el.id)
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

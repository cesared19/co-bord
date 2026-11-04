import { useEffect, useMemo, useRef } from 'react'
import { boxCorners, center, type ElementMap, elementBounds, intersects, unionBounds } from './geometry'
import { type Camera, isBox, type Point, type Rect } from './types'
import type { Peer } from './useBoardDoc'

const W = 240
const H = 156

/** The values of `xs` grouped where the gap between neighbors is bigger than `gap`; the biggest group's range. */
function mainRange(xs: number[], gap: number): [number, number] {
	const sorted = [...xs].sort((a, b) => a - b)
	let best: [number, number, number] = [sorted[0], sorted[0], 1]
	let start = 0
	for (let i = 1; i <= sorted.length; i++) {
		if (i < sorted.length && sorted[i] - sorted[i - 1] <= gap) continue
		const count = i - start
		if (count > best[2]) best = [sorted[start], sorted[i - 1], count]
		start = i
	}
	return [best[0], best[1]]
}

/** The main group of elements: a lone element far away would otherwise shrink everything else to nothing. */
export function mainGroup(elements: ElementMap): { main: Rect; boxes: Rect[] } | null {
	const boxes = [...elements.values()].filter(isBox).map((el) => elementBounds(el, elements))
	if (!boxes.length) return null
	const centers = boxes.map(center)
	// a gap this wide splits groups: wider than most of the board, and than a couple of screens
	const gap = (xs: number[]) => {
		const s = [...xs].sort((a, b) => a - b)
		const core = s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)]
		return Math.max(3000, core * 1.5)
	}
	const xs = centers.map((c) => c.x)
	const ys = centers.map((c) => c.y)
	const [x0, x1] = mainRange(xs, gap(xs))
	const [y0, y1] = mainRange(ys, gap(ys))
	const main = unionBounds(boxes.filter((_, i) => centers[i].x >= x0 && centers[i].x <= x1 && centers[i].y >= y0 && centers[i].y <= y1))
	return { main: main ?? unionBounds(boxes)!, boxes }
}

/** What the map shows: the main group and the view, or around the view when it's far from them; the rest is far. */
export function mapArea(group: ReturnType<typeof mainGroup>, view: Rect): { area: Rect; far: { at: Point }[] } {
	if (!group) return { area: view, far: [] }
	const { main, boxes } = group
	const near = { x: main.x - main.w, y: main.y - main.h, w: main.w * 3, h: main.h * 3 }
	const area = intersects(near, view)
		? unionBounds([main, view])!
		: { x: view.x - view.w, y: view.y - view.h, w: view.w * 3, h: view.h * 3 }
	return { area, far: boxes.filter((b) => !intersects(area, b)).map((b) => ({ at: center(b) })) }
}

export function Minimap({
	elements,
	camera,
	viewport,
	peers,
	dark,
	onMove,
}: {
	elements: ElementMap
	camera: Camera
	viewport: { w: number; h: number }
	peers: Peer[]
	dark: boolean
	/** Centers the view on a board point. */
	onMove: (p: Point) => void
}) {
	const ref = useRef<HTMLCanvasElement>(null)
	const view = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: viewport.w / camera.zoom, h: viewport.h / camera.zoom }
	const group = useMemo(() => mainGroup(elements), [elements])
	const { area, far } = mapArea(group, view)
	const pad = Math.max(area.w, area.h) * 0.06
	const scale = Math.min(W / (area.w + pad * 2), H / (area.h + pad * 2))
	const ox = (W - area.w * scale) / 2 - area.x * scale
	const oy = (H - area.h * scale) / 2 - area.y * scale
	const toMap = (p: Point) => ({ x: p.x * scale + ox, y: p.y * scale + oy })
	const ratio = window.devicePixelRatio || 1

	// the elements are drawn once per change into a layer; panning only redraws the view and cursors on top
	const layerKey = `${Math.round(scale * 1e6)}:${Math.round(ox)}:${Math.round(oy)}:${dark}`
	const layer = useMemo(() => {
		const canvas = document.createElement('canvas')
		canvas.width = W * ratio
		canvas.height = H * ratio
		const ctx = canvas.getContext('2d')
		if (!ctx) return canvas
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
		const muted = dark ? '#64748b' : '#94a3b8'
		for (const el of [...elements.values()].sort((a, b) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1))) {
			if (el.type === 'connector') continue
			if (el.type === 'frame') {
				const a = toMap(el)
				ctx.strokeStyle = muted
				ctx.lineWidth = 1
				ctx.strokeRect(a.x, a.y, el.w * scale, el.h * scale)
				continue
			}
			const fill =
				el.type === 'sticky' ? el.fill : el.type === 'shape' && el.fill !== 'transparent' && el.fill !== '#ffffff' ? el.fill : muted
			ctx.fillStyle = fill
			const corners = boxCorners(el).map(toMap)
			const b = { w: el.w * scale, h: el.h * scale }
			if (b.w < 3 || b.h < 3) {
				// too small to see: a dot of at least 3 pixels
				const c = toMap(center(el))
				ctx.fillRect(c.x - Math.max(1.5, b.w / 2), c.y - Math.max(1.5, b.h / 2), Math.max(3, b.w), Math.max(3, b.h))
				continue
			}
			ctx.beginPath()
			corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
			ctx.closePath()
			ctx.fill()
		}
		return canvas
		// toMap follows the key's numbers
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [elements, layerKey, ratio])

	useEffect(() => {
		const canvas = ref.current
		const ctx = canvas?.getContext('2d')
		if (!canvas || !ctx) return
		if (canvas.width !== W * ratio) {
			canvas.width = W * ratio
			canvas.height = H * ratio
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.drawImage(layer, 0, 0)
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
		for (const peer of peers) {
			if (!peer.cursor) continue
			const p = toMap(peer.cursor)
			ctx.fillStyle = peer.user.color
			ctx.beginPath()
			ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
			ctx.fill()
		}
		// what's far away: a marker on the edge, toward it
		ctx.fillStyle = dark ? '#cbd5e1' : '#475569'
		for (const m of edgeMarkers) {
			ctx.beginPath()
			ctx.arc(m.x, m.y, 3.5, 0, Math.PI * 2)
			ctx.fill()
		}
		const v = toMap(view)
		ctx.strokeStyle = '#c01c37'
		ctx.lineWidth = 1.5
		ctx.fillStyle = 'rgb(192 28 55 / .08)'
		ctx.fillRect(v.x, v.y, view.w * scale, view.h * scale)
		ctx.strokeRect(v.x, v.y, view.w * scale, view.h * scale)
	})

	const edgeMarkers = far.map((f) => {
		const p = toMap(f.at)
		return { x: Math.min(W - 5, Math.max(5, p.x)), y: Math.min(H - 5, Math.max(5, p.y)), target: f.at }
	})

	const moveTo = (e: React.PointerEvent<HTMLCanvasElement>, allowMarkers: boolean) => {
		const rect = e.currentTarget.getBoundingClientRect()
		const x = e.clientX - rect.left
		const y = e.clientY - rect.top
		// a click on an edge marker goes to what's far away
		const marker = allowMarkers ? edgeMarkers.find((m) => Math.hypot(m.x - x, m.y - y) <= 7) : undefined
		onMove(marker ? marker.target : { x: (x - ox) / scale, y: (y - oy) / scale })
	}

	return (
		<div
			data-ui
			className="absolute right-3 bottom-16 z-10 overflow-hidden rounded-xl border border-gray-200 bg-white/90 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/90"
		>
			<canvas
				ref={ref}
				role="img"
				aria-label={`Minimap: click to move the view${far.length ? `; ${far.length} far away, shown on the edge` : ''}`}
				style={{ width: W, height: H, display: 'block', cursor: 'pointer', touchAction: 'none' }}
				onPointerDown={(e) => {
					e.stopPropagation()
					e.currentTarget.setPointerCapture(e.pointerId)
					moveTo(e, true)
				}}
				onPointerMove={(e) => {
					if (e.buttons & 1) moveTo(e, false)
				}}
			/>
		</div>
	)
}

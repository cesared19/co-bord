import { useEffect, useMemo, useRef } from 'react'
import { boxCorners, type ElementMap, elementBounds, unionBounds } from './geometry'
import type { Camera, Point } from './types'
import type { Peer } from './useBoardDoc'

const W = 200
const H = 132

/**
 * The whole board in small: elements, the part on screen and teammates' cursors. Clicking or dragging on it
 * moves the view there.
 */
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
	const content = useMemo(() => unionBounds([...elements.values()].map((el) => elementBounds(el, elements))), [elements])
	const area = unionBounds(content ? [content, view] : [view])!
	const pad = Math.max(area.w, area.h) * 0.04
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
		const muted = dark ? '#4b5563' : '#cbd5e1'
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
		const v = toMap(view)
		ctx.strokeStyle = '#c01c37'
		ctx.lineWidth = 1.5
		ctx.fillStyle = 'rgb(192 28 55 / .08)'
		ctx.fillRect(v.x, v.y, view.w * scale, view.h * scale)
		ctx.strokeRect(v.x, v.y, view.w * scale, view.h * scale)
	})

	const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const rect = e.currentTarget.getBoundingClientRect()
		onMove({ x: (e.clientX - rect.left - ox) / scale, y: (e.clientY - rect.top - oy) / scale })
	}

	return (
		<div
			data-ui
			className="absolute right-3 bottom-16 z-10 overflow-hidden rounded-xl border border-gray-200 bg-white/90 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/90"
		>
			<canvas
				ref={ref}
				role="img"
				aria-label="Minimap: click to move the view"
				style={{ width: W, height: H, display: 'block', cursor: 'pointer', touchAction: 'none' }}
				onPointerDown={(e) => {
					e.stopPropagation()
					e.currentTarget.setPointerCapture(e.pointerId)
					moveTo(e)
				}}
				onPointerMove={(e) => {
					if (e.buttons & 1) moveTo(e)
				}}
			/>
		</div>
	)
}

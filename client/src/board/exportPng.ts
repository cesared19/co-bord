import { LINE_HEIGHT } from './ElementView'
import {
	arrowHead,
	connectorGeometry,
	elementBounds,
	type ElementMap,
	resolveStroke,
	resolveTextColor,
	shapePath,
	textInsets,
	unionBounds,
} from './geometry'
import type { BoardElement, BoxElement } from './types'

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const PADDING = 40
const MAX_SIDE = 8000

/** Draws the board (or just `ids`) on a canvas and returns it as a PNG. */
export async function renderPng(elements: ElementMap, dark: boolean, ids?: string[]): Promise<Blob | null> {
	const list = (ids?.length ? ids.map((id) => elements.get(id)).filter((e): e is BoardElement => !!e) : [...elements.values()]).sort(
		(a, b) => a.z - b.z,
	)
	const bounds = unionBounds(list.map((el) => elementBounds(el, elements)))
	if (!bounds) return null
	const width = bounds.w + PADDING * 2
	const height = bounds.h + PADDING * 2
	const scale = Math.min(2, MAX_SIDE / width, MAX_SIDE / height)
	const canvas = document.createElement('canvas')
	canvas.width = Math.ceil(width * scale)
	canvas.height = Math.ceil(height * scale)
	const ctx = canvas.getContext('2d')!
	ctx.scale(scale, scale)
	ctx.fillStyle = dark ? '#16181d' : '#ffffff'
	ctx.fillRect(0, 0, width, height)
	ctx.translate(PADDING - bounds.x, PADDING - bounds.y)
	await document.fonts?.ready

	for (const el of list) {
		if (el.type === 'connector') drawConnector(ctx, el, elements, dark)
		else drawBox(ctx, el, dark)
	}
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

function drawBox(ctx: CanvasRenderingContext2D, el: BoxElement, dark: boolean) {
	ctx.save()
	ctx.translate(el.x, el.y)
	if (el.type === 'shape') {
		const path = new Path2D(shapePath(el.shape, el.w, el.h))
		if (el.fill !== 'transparent') {
			ctx.fillStyle = el.fill
			ctx.fill(path)
		}
		if (el.strokeWidth > 0) {
			ctx.strokeStyle = resolveStroke(el.stroke, dark)
			ctx.lineWidth = el.strokeWidth
			ctx.lineJoin = 'round'
			ctx.stroke(path)
		}
	} else if (el.type === 'sticky') {
		ctx.save()
		ctx.shadowColor = 'rgba(0,0,0,0.18)'
		ctx.shadowBlur = 10
		ctx.shadowOffsetY = 3
		ctx.fillStyle = el.fill
		ctx.fillRect(0, 0, el.w, el.h)
		ctx.restore()
	}
	if (el.text) {
		const inset = textInsets(el)
		const innerW = el.w - inset.left - inset.right
		const innerH = el.h - inset.top - inset.bottom
		ctx.font = `${el.bold ? 700 : 400} ${el.fontSize}px ${FONT}`
		ctx.fillStyle = resolveTextColor(el, dark)
		ctx.textBaseline = 'top'
		ctx.textAlign = el.align
		const lineH = el.fontSize * LINE_HEIGHT
		const lines = wrap(ctx, el.text, innerW)
		const total = lines.length * lineH
		let y = inset.top + (el.type === 'text' ? 0 : Math.max(0, (innerH - total) / 2))
		const x = el.align === 'left' ? inset.left : el.align === 'right' ? el.w - inset.right : inset.left + innerW / 2
		if (el.type !== 'text') {
			ctx.beginPath()
			ctx.rect(inset.left - 2, inset.top - 2, innerW + 4, innerH + 4)
			ctx.clip()
		}
		const pad = (lineH - el.fontSize) / 2
		for (const line of lines) {
			ctx.fillText(line, x, y + pad)
			y += lineH
		}
	}
	ctx.restore()
}

function drawConnector(
	ctx: CanvasRenderingContext2D,
	el: Extract<BoardElement, { type: 'connector' }>,
	elements: ElementMap,
	dark: boolean,
) {
	const g = connectorGeometry(el, elements)
	const color = resolveStroke(el.stroke, dark)
	ctx.save()
	ctx.strokeStyle = color
	ctx.fillStyle = color
	ctx.lineWidth = el.strokeWidth
	ctx.lineJoin = 'round'
	ctx.lineCap = 'round'
	if (el.dash) ctx.setLineDash([el.strokeWidth * 4, el.strokeWidth * 3])
	ctx.stroke(new Path2D(g.path))
	ctx.setLineDash([])
	const head = 8 + el.strokeWidth * 2.5
	if (el.endArrow) ctx.fill(new Path2D(arrowHead(g.end, g.endAngle, head)))
	if (el.startArrow) ctx.fill(new Path2D(arrowHead(g.start, g.startAngle + Math.PI, head)))
	if (el.label) {
		ctx.font = `400 14px ${FONT}`
		const w = ctx.measureText(el.label).width + 12
		const h = 14 * LINE_HEIGHT + 4
		ctx.fillStyle = dark ? '#16181d' : '#ffffff'
		ctx.fillRect(g.mid.x - w / 2, g.mid.y - h / 2, w, h)
		ctx.fillStyle = dark ? '#e5e7eb' : '#1f2937'
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.fillText(el.label, g.mid.x, g.mid.y)
	}
	ctx.restore()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
	const lines: string[] = []
	for (const paragraph of text.split('\n')) {
		let line = ''
		for (const word of paragraph.split(/(\s+)/)) {
			const candidate = line + word
			if (ctx.measureText(candidate).width <= width || !line) {
				if (ctx.measureText(candidate).width > width && !line.trim()) {
					// a word longer than the line: break it
					for (const ch of word) {
						if (ctx.measureText(line + ch).width > width && line) {
							lines.push(line)
							line = ''
						}
						line += ch
					}
				} else line = candidate
			} else {
				lines.push(line.trimEnd())
				line = word.trimStart()
			}
		}
		lines.push(line.trimEnd())
	}
	return lines
}

export function download(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = name
	document.body.append(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

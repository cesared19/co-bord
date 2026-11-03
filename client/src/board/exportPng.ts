import { LINE_HEIGHT } from './ElementView'
import {
	arrowHead,
	connectorGeometry,
	elementBounds,
	type ElementMap,
	frameBorder,
	resolveFrameFill,
	resolveStroke,
	resolveTextColor,
	shapePath,
	textInsets,
	unionBounds,
} from './geometry'
import { MEDIA_HEADER, mediaUrl, safeUrl } from './media'
import { loadPdf, renderPage } from './pdf'
import { type BoardElement, drawOrder, type FrameElement, type MediaElement, type TextBox } from './types'

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const PADDING = 40
const MAX_SIDE = 8000

/** Draws the board (or just `ids`) on a canvas and returns it as a PNG. */
export async function renderPng(elements: ElementMap, dark: boolean, ids?: string[]): Promise<Blob | null> {
	const list = (ids?.length ? ids.map((id) => elements.get(id)).filter((e): e is BoardElement => !!e) : [...elements.values()]).sort(
		drawOrder,
	)
	// frames keep room above for their titles
	const bounds = unionBounds(
		list.map((el) => {
			const b = elementBounds(el, elements)
			return el.type === 'frame' ? { ...b, y: b.y - FRAME_TITLE, h: b.h + FRAME_TITLE } : b
		}),
	)
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
	const pictures = await loadPictures(list)

	for (const el of list) {
		if (el.type === 'connector') drawConnector(ctx, el, elements, dark)
		else if (el.type === 'media') drawMedia(ctx, el, pictures.get(el.id) ?? null, dark)
		else if (el.type === 'frame') drawFrame(ctx, el, dark)
		else drawBox(ctx, el, dark)
	}
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

function drawBox(ctx: CanvasRenderingContext2D, el: TextBox, dark: boolean) {
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

/** Frames get their title above them, so the bounds leave room for it. */
const FRAME_TITLE = 28

function drawFrame(ctx: CanvasRenderingContext2D, el: FrameElement, dark: boolean) {
	ctx.save()
	ctx.beginPath()
	ctx.roundRect(el.x, el.y, el.w, el.h, 6)
	ctx.fillStyle = resolveFrameFill(el.fill, dark)
	ctx.fill()
	ctx.strokeStyle = frameBorder(dark)
	ctx.lineWidth = 1
	ctx.stroke()
	ctx.font = `600 16px ${FONT}`
	ctx.fillStyle = dark ? '#d1d5db' : '#4b5563'
	ctx.textBaseline = 'bottom'
	ctx.textAlign = 'left'
	ctx.fillText(ellipsis(ctx, el.title || 'Frame', el.w), el.x, el.y - 8)
	ctx.restore()
}

type Picture = HTMLImageElement | HTMLCanvasElement

/**
 * Images, and the first page of uploaded PDFs. Images from other sites are only drawn when they allow it
 * (CORS); otherwise the canvas could not be saved.
 */
async function loadPictures(list: BoardElement[]): Promise<Map<string, Picture>> {
	const result = new Map<string, Picture>()
	await Promise.all(
		list.map(async (el) => {
			if (el.type !== 'media') return
			const url = safeUrl(mediaUrl(el))
			if (!url) return
			try {
				if (el.kind === 'image') {
					const img = new Image()
					if (!url.startsWith('/')) img.crossOrigin = 'anonymous'
					img.src = url
					await img.decode()
					result.set(el.id, img)
				} else if (el.kind === 'pdf') {
					const canvas = document.createElement('canvas')
					await renderPage(await loadPdf(url), 1, canvas, Math.min(1600, el.w * 2))
					result.set(el.id, canvas)
				}
			} catch {
				/* drawn as a card instead */
			}
		}),
	)
	return result
}

function drawMedia(ctx: CanvasRenderingContext2D, el: MediaElement, picture: Picture | null, dark: boolean) {
	ctx.save()
	ctx.translate(el.x, el.y)
	if (el.kind === 'image' && picture) {
		const scale = Math.min(el.w / picture.width, el.h / picture.height)
		const w = picture.width * scale
		const h = picture.height * scale
		ctx.drawImage(picture, (el.w - w) / 2, (el.h - h) / 2, w, h)
		ctx.restore()
		return
	}
	const header = el.kind === 'image' ? 0 : MEDIA_HEADER
	ctx.beginPath()
	ctx.roundRect(0, 0, el.w, el.h, 8)
	ctx.fillStyle = dark ? '#1f2937' : '#ffffff'
	ctx.fill()
	ctx.strokeStyle = dark ? '#374151' : '#d1d5db'
	ctx.lineWidth = 1
	ctx.stroke()
	ctx.clip()
	if (header) {
		ctx.fillStyle = dark ? '#111827' : '#f9fafb'
		ctx.fillRect(0, 0, el.w, header)
		ctx.fillStyle = dark ? '#e5e7eb' : '#1f2937'
		ctx.font = `600 13px ${FONT}`
		ctx.textBaseline = 'middle'
		ctx.textAlign = 'left'
		ctx.fillText(ellipsis(ctx, el.kind === 'confluence' ? 'Confluence' : el.name, el.w - 20), 10, header / 2)
	}
	const body = { y: header, h: el.h - header }
	if (el.kind === 'pdf' && picture) {
		ctx.fillStyle = dark ? '#111827' : '#f3f4f6'
		ctx.fillRect(0, body.y, el.w, body.h)
		const scale = Math.min(el.w / picture.width, body.h / picture.height)
		const w = picture.width * scale
		const h = picture.height * scale
		ctx.drawImage(picture, (el.w - w) / 2, body.y + (body.h - h) / 2, w, h)
	} else if (el.kind === 'confluence') {
		ctx.fillStyle = dark ? '#e5e7eb' : '#1f2937'
		ctx.font = `600 16px ${FONT}`
		ctx.textBaseline = 'top'
		ctx.fillText(ellipsis(ctx, el.name, el.w - 24), 12, body.y + 12)
		ctx.fillStyle = '#6b7280'
		ctx.font = `400 13px ${FONT}`
		ctx.fillText('Confluence page', 12, body.y + 36)
	} else if (el.kind === 'link') {
		ctx.fillStyle = '#c01c37'
		ctx.font = `400 13px ${FONT}`
		ctx.textBaseline = 'middle'
		ctx.fillText(ellipsis(ctx, el.src, el.w - 20), 10, body.y + body.h / 2)
	} else {
		// videos and pictures that could not be loaded: a dark panel with a play sign
		ctx.fillStyle = '#111827'
		ctx.fillRect(0, body.y, el.w, body.h)
		const r = Math.min(28, body.h / 4)
		const cx = el.w / 2
		const cy = body.y + body.h / 2
		ctx.fillStyle = 'rgba(255,255,255,0.9)'
		ctx.beginPath()
		if (el.kind === 'pdf' || el.kind === 'image') {
			ctx.font = `400 13px ${FONT}`
			ctx.textAlign = 'center'
			ctx.textBaseline = 'middle'
			ctx.fillText(el.kind === 'pdf' ? 'PDF' : 'Image', cx, cy)
		} else {
			ctx.moveTo(cx - r * 0.5, cy - r * 0.7)
			ctx.lineTo(cx + r * 0.8, cy)
			ctx.lineTo(cx - r * 0.5, cy + r * 0.7)
			ctx.closePath()
			ctx.fill()
		}
	}
	ctx.restore()
}

function ellipsis(ctx: CanvasRenderingContext2D, text: string, width: number): string {
	if (ctx.measureText(text).width <= width) return text
	let out = text
	while (out.length > 1 && ctx.measureText(`${out}…`).width > width) out = out.slice(0, -1)
	return `${out}…`
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

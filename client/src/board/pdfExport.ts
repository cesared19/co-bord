import { renderPng } from './exportPng'
import { type ElementMap, withFrameContents } from './geometry'
import type { FrameElement } from './types'

/** A4 landscape, in points. */
const PAGE_W = 842
const PAGE_H = 595
const MARGIN = 32
const TITLE = 34

interface Page {
	title: string
	jpeg: Uint8Array
	width: number
	height: number
}

/** A PNG drawn by renderPng, as a JPEG on white (PDF pages embed JPEG directly). */
async function toJpeg(png: Blob): Promise<{ bytes: Uint8Array; width: number; height: number }> {
	const bitmap = await createImageBitmap(png)
	const canvas = document.createElement('canvas')
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	const ctx = canvas.getContext('2d')!
	ctx.fillStyle = '#ffffff'
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	ctx.drawImage(bitmap, 0, 0)
	bitmap.close()
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
	if (!blob) throw new Error('The picture could not be made')
	return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
}

/** Text for PDF's standard fonts (WinAnsi): Latin-1 characters as they are, the rest as '?'. */
function pdfText(text: string): Uint8Array {
	const out: number[] = []
	for (const ch of text.normalize('NFC')) {
		const code = ch.codePointAt(0)!
		const byte = code < 256 && code >= 32 ? code : ch === '—' || ch === '–' ? 45 : 63
		if (byte === 40 || byte === 41 || byte === 92) out.push(92)
		out.push(byte)
	}
	return new Uint8Array(out)
}

const ascii = (s: string) => new TextEncoder().encode(s)

/** A PDF with one picture per page, each with its title above it. */
export function buildPdf(pages: Page[]): Blob {
	const chunks: Uint8Array[] = []
	const offsets: number[] = []
	let length = 0
	const push = (data: Uint8Array | string) => {
		const bytes = typeof data === 'string' ? ascii(data) : data
		chunks.push(bytes)
		length += bytes.length
	}
	const object = (n: number, parts: (Uint8Array | string)[]) => {
		offsets[n] = length
		push(`${n} 0 obj\n`)
		for (const p of parts) push(p)
		push('\nendobj\n')
	}
	push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
	// 1 catalog, 2 pages, 3 font; then three objects per page: page, content, image
	const pageNumbers = pages.map((_, i) => 4 + i * 3)
	object(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
	object(2, [`<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`])
	object(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'])
	pages.forEach((page, i) => {
		const n = pageNumbers[i]
		const top = page.title ? TITLE : 0
		const boxW = PAGE_W - MARGIN * 2
		const boxH = PAGE_H - MARGIN * 2 - top
		const scale = Math.min(boxW / page.width, boxH / page.height)
		const w = page.width * scale
		const h = page.height * scale
		const x = MARGIN + (boxW - w) / 2
		const y = MARGIN + (boxH - h) / 2
		const contentParts: Uint8Array[] = [ascii(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q\n`)]
		if (page.title)
			contentParts.push(
				ascii(`BT /F1 16 Tf 0.12 0.16 0.22 rg ${MARGIN} ${PAGE_H - MARGIN - 16} Td (`),
				pdfText(page.title),
				ascii(') Tj ET\n'),
			)
		const contentLength = contentParts.reduce((sum, p) => sum + p.length, 0)
		object(n, [
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`,
		])
		object(n + 1, [`<< /Length ${contentLength} >>\nstream\n`, ...contentParts, '\nendstream'])
		object(n + 2, [
			`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
			page.jpeg,
			'\nendstream',
		])
	})
	const count = 4 + pages.length * 3
	const xref = length
	push(`xref\n0 ${count}\n0000000000 65535 f \n`)
	for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
	push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
	return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

/** Frames in reading order: top to bottom, then left to right. */
export const framesInOrder = (elements: ElementMap) =>
	[...elements.values()]
		.filter((el): el is FrameElement => el.type === 'frame')
		.sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x))

/** The whole board on one page, or each frame on its own page (frames inside frames too). Always light. */
export async function exportPdf(elements: ElementMap, boardName: string, perFrame: boolean): Promise<Blob | null> {
	const pages: Page[] = []
	const add = async (title: string, ids?: string[]) => {
		const png = await renderPng(elements, false, ids)
		if (!png) return
		const jpeg = await toJpeg(png)
		pages.push({ title, jpeg: jpeg.bytes, width: jpeg.width, height: jpeg.height })
	}
	if (perFrame)
		for (const frame of framesInOrder(elements)) await add(frame.title || 'Untitled frame', withFrameContents([frame.id], elements))
	else await add(boardName)
	return pages.length ? buildPdf(pages) : null
}

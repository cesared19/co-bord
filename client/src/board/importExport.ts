import { newId } from '../lib/id'
import { type ElementMap, frameContents, withFrameContents } from './geometry'
import { mediaUrl } from './media'
import { type BoardElement, type FrameElement, type MediaElement, STICKY_COLORS, type StickyElement } from './types'
import { uploadAsset } from './upload'

// ---------- CSV ----------

/** Rows of a CSV (commas or semicolons, quotes with "" inside), without empty rows. */
export function parseCsv(text: string): string[][] {
	const source = text.replace(/^\uFEFF/, '')
	const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
	const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
	const rows: string[][] = []
	let row: string[] = []
	let cell = ''
	let quoted = false
	for (let i = 0; i < source.length; i++) {
		const ch = source[i]
		if (quoted) {
			if (ch === '"' && source[i + 1] === '"') {
				cell += '"'
				i++
			} else if (ch === '"') quoted = false
			else cell += ch
		} else if (ch === '"') quoted = true
		else if (ch === sep) {
			row.push(cell)
			cell = ''
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && source[i + 1] === '\n') i++
			row.push(cell)
			rows.push(row)
			row = []
			cell = ''
		} else cell += ch
	}
	row.push(cell)
	rows.push(row)
	return rows.filter((r) => r.some((c) => c.trim()))
}

const COLUMNS = {
	text: ['text', 'content', 'sticky', 'sticky note', 'sticky note content', 'note', 'notes', 'idea', 'card', 'title', 'body'],
	color: ['color', 'colour', 'sticky note color', 'background', 'fill'],
	group: ['frame', 'column', 'group', 'category', 'section', 'lane', 'board'],
	tags: ['tags', 'tag', 'labels', 'label'],
}

/** Color names (including Miro's) to the sticky note colors. */
function stickyColor(value: string | undefined): string {
	const v = (value ?? '').trim().toLowerCase()
	if (/^#[0-9a-f]{6}$/.test(v)) return v
	const name = v.replace(/^(light|dark)[ _-]?/, '').replace(/[ _-]/g, '')
	const map: Record<string, string> = {
		yellow: STICKY_COLORS[0],
		orange: STICKY_COLORS[1],
		red: STICKY_COLORS[2],
		pink: STICKY_COLORS[2],
		magenta: STICKY_COLORS[3],
		violet: STICKY_COLORS[3],
		purple: STICKY_COLORS[3],
		blue: STICKY_COLORS[4],
		cyan: STICKY_COLORS[5],
		turquoise: STICKY_COLORS[5],
		green: STICKY_COLORS[6],
		lime: STICKY_COLORS[6],
		gray: STICKY_COLORS[7],
		grey: STICKY_COLORS[7],
		black: STICKY_COLORS[7],
		white: STICKY_COLORS[7],
	}
	return map[name] ?? STICKY_COLORS[0]
}

const NOTE = 200
const GAP = 24

const note = (x: number, y: number, text: string, fill: string, z: number): StickyElement => ({
	id: newId(),
	type: 'sticky',
	z,
	x,
	y,
	w: NOTE,
	h: NOTE,
	text,
	fill,
	fontSize: 18,
	bold: false,
	align: 'center',
	textColor: 'auto',
})

export const MAX_ROWS = 2000

/**
 * Sticky notes from CSV rows: a text column, and optional color, frame (or column, group…) and tags. Without a
 * header, the first column is the text and the second the tags (like Miro's export of sticky notes). Notes with a
 * frame go in a frame per value, side by side; the others in a grid.
 */
export function csvToElements(rows: string[][]): { elements: BoardElement[]; notes: number; skipped: number } {
	if (!rows.length) return { elements: [], notes: 0, skipped: 0 }
	const header = rows[0].map((h) => h.trim().toLowerCase())
	const find = (names: string[]) => header.findIndex((h) => names.includes(h))
	const hasHeader = find(COLUMNS.text) >= 0
	const col = hasHeader
		? { text: find(COLUMNS.text), color: find(COLUMNS.color), group: find(COLUMNS.group), tags: find(COLUMNS.tags) }
		: { text: 0, color: -1, group: -1, tags: rows.some((r) => r.length > 1) ? 1 : -1 }
	const data = (hasHeader ? rows.slice(1) : rows).slice(0, MAX_ROWS)
	const skipped = Math.max(0, (hasHeader ? rows.length - 1 : rows.length) - MAX_ROWS)
	const groups = new Map<string, { text: string; fill: string }[]>()
	const loose: { text: string; fill: string }[] = []
	for (const r of data) {
		const text = (r[col.text] ?? '').trim()
		if (!text) continue
		const tags =
			col.tags >= 0
				? (r[col.tags] ?? '')
						.split(/[,;|]/)
						.map((t) => t.trim())
						.filter(Boolean)
				: []
		const item = {
			text: tags.length ? `${text}\n${tags.map((t) => `#${t.replace(/\s+/g, '_')}`).join(' ')}` : text,
			fill: stickyColor(r[col.color]),
		}
		const group = col.group >= 0 ? (r[col.group] ?? '').trim() : ''
		if (group) groups.set(group, [...(groups.get(group) ?? []), item])
		else loose.push(item)
	}
	const elements: BoardElement[] = []
	let z = 1
	let x = 0
	const perRow = 3
	for (const [title, items] of groups) {
		const rowsIn = Math.ceil(items.length / perRow)
		const w = GAP + perRow * (NOTE + GAP)
		const frame: FrameElement = { id: newId(), type: 'frame', z: z++, x, y: 0, w, h: GAP + rowsIn * (NOTE + GAP), title, fill: 'auto' }
		elements.push(frame)
		items.forEach((it, i) =>
			elements.push(note(x + GAP + (i % perRow) * (NOTE + GAP), GAP + Math.floor(i / perRow) * (NOTE + GAP), it.text, it.fill, z++)),
		)
		x += w + GAP * 3
	}
	const cols = 6
	loose.forEach((it, i) => elements.push(note(x + (i % cols) * (NOTE + GAP), Math.floor(i / cols) * (NOTE + GAP), it.text, it.fill, z++)))
	return { elements, notes: elements.filter((e) => e.type === 'sticky').length, skipped }
}

// ---------- zip (stored or deflated), for co-bord files ----------

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

function crc32(data: Uint8Array) {
	let c = 0xffffffff
	for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

/** A zip with the files stored as they are (images and videos are compressed already). */
export function makeZip(files: { name: string; data: Uint8Array }[]): Blob {
	const encoder = new TextEncoder()
	const parts: Uint8Array[] = []
	const central: Uint8Array[] = []
	let offset = 0
	for (const f of files) {
		const name = encoder.encode(f.name)
		const crc = crc32(f.data)
		const local = new DataView(new ArrayBuffer(30))
		local.setUint32(0, 0x04034b50, true)
		local.setUint16(4, 20, true)
		local.setUint16(6, 0x0800, true) // UTF-8 names
		local.setUint32(14, crc, true)
		local.setUint32(18, f.data.length, true)
		local.setUint32(22, f.data.length, true)
		local.setUint16(26, name.length, true)
		parts.push(new Uint8Array(local.buffer), name, f.data)
		const entry = new DataView(new ArrayBuffer(46))
		entry.setUint32(0, 0x02014b50, true)
		entry.setUint16(4, 20, true)
		entry.setUint16(6, 20, true)
		entry.setUint16(8, 0x0800, true)
		entry.setUint32(16, crc, true)
		entry.setUint32(20, f.data.length, true)
		entry.setUint32(24, f.data.length, true)
		entry.setUint16(28, name.length, true)
		entry.setUint32(42, offset, true)
		central.push(new Uint8Array(entry.buffer), name)
		offset += 30 + name.length + f.data.length
	}
	const size = central.reduce((s, p) => s + p.length, 0)
	const end = new DataView(new ArrayBuffer(22))
	end.setUint32(0, 0x06054b50, true)
	end.setUint16(8, files.length, true)
	end.setUint16(10, files.length, true)
	end.setUint32(12, size, true)
	end.setUint32(16, offset, true)
	return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' })
}

/** The files in a zip; stored and deflated entries (as other tools write them). */
export async function readZip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
	const view = new DataView(buffer)
	const bytes = new Uint8Array(buffer)
	let end = -1
	for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--)
		if (view.getUint32(i, true) === 0x06054b50) {
			end = i
			break
		}
	if (end < 0) throw new Error("This isn't a zip file")
	const count = view.getUint16(end + 10, true)
	let p = view.getUint32(end + 16, true)
	const out = new Map<string, Uint8Array>()
	const decoder = new TextDecoder()
	for (let n = 0; n < count; n++) {
		if (view.getUint32(p, true) !== 0x02014b50) throw new Error('The zip file is damaged')
		const method = view.getUint16(p + 10, true)
		const compressed = view.getUint32(p + 20, true)
		const nameLength = view.getUint16(p + 28, true)
		const extra = view.getUint16(p + 30, true)
		const comment = view.getUint16(p + 32, true)
		const local = view.getUint32(p + 42, true)
		const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength))
		p += 46 + nameLength + extra + comment
		if (name.endsWith('/')) continue
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
		const raw = bytes.subarray(start, start + compressed)
		if (method === 0) out.set(name, raw)
		else if (method === 8) {
			const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
			out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()))
		} else throw new Error(`The zip file uses a compression co-bord can't read (${name})`)
	}
	return out
}

// ---------- co-bord files ----------

interface CoBordFile {
	format: 'co-bord'
	version: 1
	name: string
	elements: BoardElement[]
	/** Uploaded files: asset id → path in the zip, name and type. */
	files: Record<string, { path: string; name: string }>
}

/** Drops what belongs to this board only: Jira issues and done marks follow their own board. */
export const portable = (el: BoardElement): BoardElement => {
	if (el.type === 'connector') return el
	const copy = { ...el } as Record<string, unknown>
	delete copy.issue
	delete copy.done
	return copy as unknown as BoardElement
}

/** The board, or a frame with what's inside, as a co-bord file: a zip with board.json and its uploaded files. */
export async function exportCoBordFile(elements: ElementMap, name: string, frameId?: string): Promise<Blob> {
	const ids = frameId ? withFrameContents([frameId], elements) : [...elements.keys()]
	const list = ids
		.map((id) => elements.get(id))
		.filter((e): e is BoardElement => !!e)
		.map(portable)
	const files: CoBordFile['files'] = {}
	const zipped: { name: string; data: Uint8Array }[] = []
	for (const el of list) {
		if (el.type !== 'media' || !el.assetId || files[el.assetId]) continue
		const res = await fetch(mediaUrl(el), { credentials: 'same-origin' })
		if (!res.ok) continue
		const path = `files/${el.assetId}-${el.name.replace(/[\\/:*?"<>|]+/g, '_')}`
		files[el.assetId] = { path, name: el.name }
		zipped.push({ name: path, data: new Uint8Array(await res.arrayBuffer()) })
	}
	const doc: CoBordFile = { format: 'co-bord', version: 1, name, elements: list, files }
	return makeZip([{ name: 'board.json', data: new TextEncoder().encode(JSON.stringify(doc)) }, ...zipped])
}

const TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	mp4: 'video/mp4',
	webm: 'video/webm',
	ogg: 'video/ogg',
	mov: 'video/quicktime',
	pdf: 'application/pdf',
}

/**
 * Elements from a co-bord file (.zip, or just its board.json): its uploaded files are uploaded to this board and
 * the elements point at the new copies.
 */
export async function importCoBordFile(file: File, boardId: string, onProgress: (text: string) => void): Promise<BoardElement[]> {
	const buffer = await file.arrayBuffer()
	const isZip = new DataView(buffer).byteLength > 4 && new DataView(buffer).getUint32(0, true) === 0x04034b50
	const entries = isZip ? await readZip(buffer) : new Map([['board.json', new Uint8Array(buffer)]])
	const json = entries.get('board.json')
	if (!json) throw new Error("This zip isn't a co-bord file: it has no board.json")
	let doc: CoBordFile
	try {
		doc = JSON.parse(new TextDecoder().decode(json))
	} catch {
		throw new Error("The co-bord file can't be read")
	}
	if (doc.format !== 'co-bord' || !Array.isArray(doc.elements)) throw new Error("This isn't a co-bord file")
	const uploaded = new Map<string, { id: string; url: string }>()
	const assets = Object.entries(doc.files ?? {})
	for (const [i, [assetId, info]] of assets.entries()) {
		const data = entries.get(info.path)
		if (!data) continue
		onProgress(`Uploading ${i + 1} of ${assets.length}: ${info.name}`)
		const ext = info.name.split('.').pop()?.toLowerCase() ?? ''
		const asset = await uploadAsset(
			boardId,
			new File([data as BlobPart], info.name, { type: TYPES[ext] ?? 'application/octet-stream' }),
			() => {},
		)
		uploaded.set(assetId, { id: asset.id, url: asset.url })
	}
	return doc.elements.map((el) => {
		if (el.type !== 'media' || !el.assetId) return el
		const copy = uploaded.get(el.assetId)
		if (!copy) return el
		return { ...el, assetId: copy.id, src: copy.url } satisfies MediaElement
	})
}

/** What a template keeps of a board or a frame. */
export function templateElements(elements: ElementMap, frameId: string | null): BoardElement[] {
	const frame = frameId ? elements.get(frameId) : undefined
	const ids = frame?.type === 'frame' ? [frame.id, ...frameContents(frame, elements)] : [...elements.keys()]
	return ids
		.map((id) => elements.get(id))
		.filter((e): e is BoardElement => !!e)
		.map(portable)
}

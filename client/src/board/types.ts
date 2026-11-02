export type ShapeKind =
	| 'rect'
	| 'rounded'
	| 'ellipse'
	| 'diamond'
	| 'terminator'
	| 'parallelogram'
	| 'hexagon'
	| 'triangle'
	| 'cylinder'
	| 'document'

export type Align = 'left' | 'center' | 'right'

interface Box {
	id: string
	z: number
	x: number
	y: number
	w: number
	h: number
}

export interface TextStyle {
	text: string
	fontSize: number
	bold: boolean
	align: Align
	/** A hex color, or 'auto' to contrast with the fill or the board. */
	textColor: string
}

export interface ShapeElement extends Box, TextStyle {
	type: 'shape'
	shape: ShapeKind
	/** A hex color or 'transparent'. */
	fill: string
	/** A hex color, or 'auto' for the board's foreground. */
	stroke: string
	strokeWidth: number
}

export interface StickyElement extends Box, TextStyle {
	type: 'sticky'
	fill: string
}

export interface TextElement extends Box, TextStyle {
	type: 'text'
}

/** A connector end: attached to an element (id), or free at x, y. x, y also keep the last place when attached. */
export interface Endpoint {
	id?: string
	x: number
	y: number
}

export type Route = 'straight' | 'elbow' | 'curved'

export interface ConnectorElement {
	id: string
	z: number
	type: 'connector'
	from: Endpoint
	to: Endpoint
	route: Route
	stroke: string
	strokeWidth: number
	dash: boolean
	startArrow: boolean
	endArrow: boolean
	label: string
}

export type MediaKind = 'image' | 'video' | 'pdf' | 'youtube' | 'drive' | 'vimeo' | 'link'

/**
 * Embedded content shown as a resizable block. Uploads keep `assetId` (served at /api/assets/:id);
 * YouTube, Drive and Vimeo keep the video id in `src`; the other kinds keep a URL.
 */
export interface MediaElement extends Box {
	type: 'media'
	kind: MediaKind
	src: string
	assetId?: string
	name: string
	/** YouTube start time, in seconds. */
	start?: number
}

/** Elements with text: shapes, sticky notes and text. */
export type TextBox = ShapeElement | StickyElement | TextElement
/** Every element with a position and a size. */
export type BoxElement = TextBox | MediaElement
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type NewBox = DistributiveOmit<TextBox, 'id' | 'z' | 'x' | 'y'>
export type BoardElement = BoxElement | ConnectorElement

export const isBox = (el: BoardElement | undefined): el is BoxElement => !!el && el.type !== 'connector'
export const hasText = (el: BoardElement | undefined): el is TextBox =>
	!!el && (el.type === 'shape' || el.type === 'sticky' || el.type === 'text')

export interface Point {
	x: number
	y: number
}

export interface Rect {
	x: number
	y: number
	w: number
	h: number
}

export interface Camera {
	x: number
	y: number
	zoom: number
}

export type Tool = 'select' | 'hand' | 'sticky' | 'text' | 'shape' | 'connector'

export const STICKY_COLORS = ['#fef08a', '#fed7aa', '#fecdd3', '#f5d0fe', '#c7d2fe', '#bae6fd', '#bbf7d0', '#e5e7eb']

export const PALETTE = [
	'#ffffff',
	'#1f2937',
	'#6b7280',
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#14b8a6',
	'#3b82f6',
	'#6366f1',
	'#a855f7',
	'#ec4899',
	'#fee2e2',
	'#fef3c7',
	'#dcfce7',
	'#dbeafe',
]

export const FONT_SIZES = [
	{ label: 'S', value: 14 },
	{ label: 'M', value: 18 },
	{ label: 'L', value: 28 },
	{ label: 'XL', value: 44 },
]

export function defaultElement(type: 'shape' | 'sticky' | 'text', shape: ShapeKind = 'rect'): NewBox {
	const text = { text: '', bold: false, align: 'center' as Align, textColor: 'auto' }
	if (type === 'sticky') return { type, w: 200, h: 200, fill: STICKY_COLORS[0], fontSize: 18, ...text }
	if (type === 'text') return { type, w: 240, h: 40, fontSize: 18, ...text, align: 'left' }
	const size: Partial<Record<ShapeKind, [number, number]>> = {
		diamond: [180, 120],
		ellipse: [140, 140],
		triangle: [140, 120],
		terminator: [180, 70],
		cylinder: [120, 140],
	}
	const [w, h] = size[shape] ?? [180, 100]
	return { type, shape, w, h, fill: '#ffffff', stroke: 'auto', strokeWidth: 2, fontSize: 16, ...text }
}

export const SHAPES: { kind: ShapeKind; label: string }[] = [
	{ kind: 'rect', label: 'Rectangle (process)' },
	{ kind: 'rounded', label: 'Rounded rectangle' },
	{ kind: 'ellipse', label: 'Ellipse' },
	{ kind: 'diamond', label: 'Diamond (decision)' },
	{ kind: 'terminator', label: 'Terminator (start / end)' },
	{ kind: 'parallelogram', label: 'Parallelogram (input / output)' },
	{ kind: 'hexagon', label: 'Hexagon (preparation)' },
	{ kind: 'document', label: 'Document' },
	{ kind: 'cylinder', label: 'Cylinder (database)' },
	{ kind: 'triangle', label: 'Triangle' },
]

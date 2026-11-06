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

/** A SparkyTC test case (id = its number), section or suite (id = section id) or test plan (id = plan id). */
export interface SparkyLink {
	kind: 'case' | 'section' | 'plan'
	id: string
	label: string
}

interface Box {
	id: string
	z: number
	x: number
	y: number
	w: number
	h: number
	/** What this element is tested by, in SparkyTC. */
	links?: SparkyLink[]
	/** Marks elements co-bord adds and may replace, like the headings of grouped retro notes. */
	tag?: string
	/** Clockwise, in degrees, around the center (not for frames). */
	rotation?: number
	/** Done: shown with a check and struck-through text. Set by people, rules, or when the linked Jira issue closes. */
	done?: boolean
	/** The Jira issue created for this card, with its status as last checked. */
	issue?: JiraIssue
	/** Can't be moved, resized, edited or deleted until unlocked; a click still selects it. */
	locked?: boolean
	/** The groups it belongs to, outermost first: a click selects the outermost one, a double-click goes in. */
	groups?: string[]
}

export interface JiraIssue {
	key: string
	url: string
	status: string
	/** Jira's status category: new, indeterminate or done. */
	category: string
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
	/** The side of the element it was attached to; without it, the side facing the other end. */
	side?: 'top' | 'right' | 'bottom' | 'left'
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
	locked?: boolean
	groups?: string[]
}

export type MediaKind = 'image' | 'video' | 'pdf' | 'youtube' | 'drive' | 'vimeo' | 'link' | 'confluence'

/**
 * Embedded content shown as a resizable block. Uploads keep `assetId` (served at /api/assets/:id);
 * YouTube, Drive and Vimeo keep the video id in `src`, Confluence pages their page id (read through the project's
 * connection); the other kinds keep a URL.
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

/**
 * A titled area that groups what is inside it: moving a frame moves the elements within it.
 * Frames are always drawn below the other elements.
 */
export interface FrameElement extends Box {
	type: 'frame'
	title: string
	/** A hex color, or 'auto' for the board's panel color. */
	fill: string
}

/**
 * A pen or highlighter stroke. `points` are x, y pairs in a `vw` x `vh` area, the box's size when it was drawn,
 * stretched to the box when it's resized.
 */
export interface DrawElement extends Box {
	type: 'draw'
	points: number[]
	vw: number
	vh: number
	/** A hex color, or 'auto' for the board's foreground. */
	stroke: string
	strokeWidth: number
	/** See-through, wide and below everything but frames. */
	highlighter?: boolean
}

/** Elements with text: shapes, sticky notes and text. */
export type TextBox = ShapeElement | StickyElement | TextElement
/** Every element with a position and a size. */
export type BoxElement = TextBox | MediaElement | FrameElement | DrawElement
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

export type Tool = 'select' | 'hand' | 'sticky' | 'text' | 'shape' | 'connector' | 'frame' | 'comment' | 'draw'

/** What the draw tool does. Laser strokes aren't kept: everyone sees them fade away in a moment. */
export type InkMode = 'pen' | 'highlighter' | 'eraser' | 'laser'

export const INK_COLORS = ['auto', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']
/** Stroke widths, thin to thick, for the pen and the highlighter. */
export const INK_WIDTHS = { pen: [2, 4, 8], highlighter: [14, 24, 36] }

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

export const isFrame = (el: BoardElement | undefined): el is FrameElement => el?.type === 'frame'

/** Light tints for frames; 'auto' follows the theme. */
export const FRAME_COLORS = ['auto', '#f8fafc', '#fef2f2', '#fff7ed', '#fefce8', '#f0fdf4', '#ecfeff', '#eff6ff', '#f5f3ff', '#fdf2f8']

const layer = (el: BoardElement) => (el.type === 'frame' ? 0 : el.type === 'draw' && el.highlighter ? 1 : 2)
/** Frames first, then highlighter strokes, then everything else, each by z. */
export const drawOrder = (a: BoardElement, b: BoardElement) => layer(a) - layer(b) || a.z - b.z

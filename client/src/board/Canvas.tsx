import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoxView, ConnectorView, DrawView, FrameView } from './ElementView'
import { FacilitationMenu, TimerPill, VoteBadges, VoteRanking, VotingBanner } from './Facilitation'
import { useServerClock, useSession } from './session'
import { SaveTemplateDialog, TemplatePicker } from './TemplatePicker'
import { boardLinks, canWriteSparky, type SparkyInfo, useLinkResults } from './sparky'
import { CoveragePanel, LinkBadges, LinkEditor, LinksPopover } from './SparkyLinks'
import { TestCasePanel } from './TestCasePanel'
import {
	BookOpenText,
	ChevronLeft,
	ChevronRight,
	Eye,
	FlaskConical,
	Grid3x3,
	History,
	Lock,
	Map as MapIcon,
	MessageSquare,
	Presentation,
	RotateCw,
	Zap,
} from 'lucide-react'
import { anchorFor, CommentPins, CommentsPanel, Composer, pinPoint, type Thread, ThreadPopover, useComments } from './Comments'
import { HistoryPanel } from './HistoryPanel'
import { MediaSync, MediaSyncContext } from './mediaSync'
import { framesInOrder } from './pdfExport'
import { type Match, SearchBar } from './Search'
import { GenerateTestsDialog } from './GenerateTestsDialog'
import { IssueBadges } from './IssueBadges'
import { RulesPanel } from './RulesPanel'
import { type ConfluenceInfo, confluencePageId, searchConfluence, useBoardEnv } from './confluence'
import { PublishDialog } from './PublishDialog'
import { RetroPanel } from './RetroPanel'
import type { SummarySection } from './retro'
import type { Follows } from './follows'
import { api } from '../lib/api'
import { download, renderPng } from './exportPng'
import { ContextToolbar } from './ContextToolbar'
import { fitSize, keepsRatio, MEDIA_HEADER, type NewMedia, parseMediaUrl } from './media'
import { MediaView } from './MediaView'
import { readMediaSize, uploadAsset } from './upload'
import {
	type ConnectorGeometry,
	connectorGeometry,
	center,
	containsRotated,
	elementBounds,
	type ElementMap,
	clampZoom,
	fitCamera,
	intersects,
	rectFromPoints,
	rotatePoint,
	resolveStroke,
	rotationOf,
	type Side,
	sideOf,
	BoxGrid,
	routeRegion,
	sidePoint,
	toScreen,
	toWorld,
	unionBounds,
	withFrameContents,
	zoomAt,
} from './geometry'
import { RemoteCursors, RemoteSelections } from './Presence'
import {
	expandToUnits,
	groupMembers,
	groupPatches,
	insideEntered,
	selectedGroups,
	ungroupPatches,
	unitCount,
	unitGroup,
	unitOf,
} from './groups'
import { addInkPoint, inkPath, type InkSettings, LaserTrail, loadInk, saveInk, strokeElement, touchesStroke } from './ink'
import { LaserOverlay } from './Laser'
import { type Gap, GRID, type Guide, snapEdges, snapMove } from './snap'
import { Minimap } from './Minimap'
import type { BoardStore } from './store'
import { FramesMenu, Toolbar, ZoomControls } from './Toolbar'
import {
	type BoardElement,
	type BoxElement,
	type Camera,
	type ConnectorElement,
	defaultElement,
	drawOrder,
	type Endpoint,
	hasText,
	INK_WIDTHS,
	isBox,
	isFrame,
	type Point,
	type Rect,
	type ShapeKind,
	type TextBox,
	type Tool,
} from './types'
import type { Peer } from './useBoardDoc'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const MIN_SIZE = 20
/** How close, in screen pixels, an edge has to come to snap to a guide. */
const SNAP_PX = 6

function readFlag(key: string, fallback: boolean) {
	try {
		const v = localStorage.getItem(key)
		return v === null ? fallback : v === '1'
	} catch {
		return fallback
	}
}

function writeFlag(key: string, on: boolean) {
	try {
		localStorage.setItem(key, on ? '1' : '0')
	} catch {
		/* storage unavailable */
	}
}

/** Which edges a resize handle moves. */
const handleEdges = (h: Handle) => ({
	x: h.includes('w') ? ('start' as const) : h.includes('e') ? ('end' as const) : undefined,
	y: h.includes('n') ? ('start' as const) : h.includes('s') ? ('end' as const) : undefined,
})

const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })

/** The resize cursor for a handle of a box rotated by `rotation` degrees. */
function handleCursor(h: Handle, rotation: number) {
	const angles: Record<Handle, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 }
	const a = (((angles[h] + rotation) % 180) + 180) % 180
	return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][Math.round(a / 45) % 4]
}
const CLIPBOARD_PREFIX = 'co-bord/elements:'

type Drag =
	| { kind: 'pan'; startScreen: Point; startCam: Camera }
	| {
			kind: 'move'
			startWorld: Point
			originals: BoardElement[]
			moved: boolean
			clickedId: string
			/** A click (no drag) on one of several selected things selects just that one. */
			collapseTo: string[] | null
			/** Where the moved elements started, and what they can line up with. */
			bounds: Rect | null
			others: Rect[]
	  }
	| { kind: 'resize'; handle: Handle; original: BoxElement; startWorld: Point; keepRatio: boolean; others: Rect[] }
	/** Resizing several elements at once: everything scales, text included. */
	| { kind: 'scale'; handle: Handle; bounds: Rect; originals: BoardElement[]; startWorld: Point; others: Rect[] }
	/** Rotation follows the pointer around the center, from where the handle was grabbed. */
	| { kind: 'rotate'; id: string; center: Point; startAngle: number; original: number }
	| { kind: 'marquee'; startWorld: Point; current: Point; base: string[]; started: boolean }
	/** A pen or highlighter stroke being drawn, in board units. */
	| { kind: 'ink'; points: Point[] }
	| { kind: 'erase'; erased: Set<string> }
	| { kind: 'laser' }
	| { kind: 'create'; type: 'shape' | 'sticky' | 'text' | 'frame'; startWorld: Point; current: Point }
	| { kind: 'connect'; from: Endpoint; startWorld: Point; current: Point; target: string | null }
	| { kind: 'endpoint'; id: string; which: 'from' | 'to'; target: string | null }
	| { kind: 'pinch'; startDist: number; startMid: Point; startCam: Camera }

interface Props {
	store: BoardStore
	elements: ElementMap
	peers: Peer[]
	provider: HocuspocusProvider
	readOnly: boolean
	boardId: string
	dark: boolean
	/** Centers the view on a teammate's cursor. */
	/** The teammate whose view this person follows (their awareness client id). */
	following: number | null
	onFollow: (clientId: number | null) => void
	/** Opened with a share link: read-only, without comments, rules, history or the project's integrations. */
	guest?: boolean
	/** The user owns the project (deletes anyone's templates). */
	owner?: boolean
	user: { id: number; displayName: string }
	boardName: string
	projectId: number
	/** The project's SparkyTC connection, once loaded. */
	sparky: SparkyInfo | null
	/** The project's Confluence connection, once loaded. */
	confluence: ConfluenceInfo | null
	follows: Follows
	/** An element to show when the board opens (from a notification). */
	focusId: string | null
}

const viewKey = (boardId: string) => `co-bord:view:${boardId}`

function loadCamera(boardId: string): Camera | null {
	try {
		const raw = localStorage.getItem(viewKey(boardId))
		const cam = raw ? (JSON.parse(raw) as Camera) : null
		return cam && Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.zoom) ? cam : null
	} catch {
		return null
	}
}

const isTyping = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.closest('dialog'))

export function Canvas({
	store,
	elements,
	peers,
	provider,
	readOnly,
	boardId,
	dark,
	following,
	onFollow,
	guest = false,
	owner = false,
	user,
	boardName,
	projectId,
	sparky,
	confluence,
	follows,
	focusId,
}: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [size, setSize] = useState({ w: 0, h: 0 })
	const savedCamera = useRef(loadCamera(boardId))
	const [camera, setCamera] = useState<Camera>(savedCamera.current ?? { x: 0, y: 0, zoom: 1 })
	const [tool, setTool] = useState<Tool>('select')
	const [shapeKind, setShapeKind] = useState<ShapeKind>('rect')
	const [selection, setSelection] = useState<string[]>([])
	const [editing, setEditing] = useState<string | null>(null)
	/** The groups double-clicked into, outermost first: clicks pick what's one level inside. */
	const [entered, setEntered] = useState<string[]>([])
	const enteredRef = useRef(entered)
	enteredRef.current = entered
	/** The draw tool's mode, colors and widths, remembered per person. */
	const [ink, setInkState] = useState<InkSettings>(loadInk)
	const inkRef = useRef(ink)
	inkRef.current = ink
	const setInk = useCallback((next: InkSettings) => {
		setInkState(next)
		saveInk(next)
	}, [])
	const laser = useMemo(() => new LaserTrail(), [])
	const publishLaser = useCallback((strokes: number[][] | null) => provider.setAwarenessField('laser', strokes), [provider])
	const [, setTick] = useState(0)
	const drag = useRef<Drag | null>(null)
	/** Alignment guides and equal gaps shown while dragging. */
	const [snapShown, setSnapShown] = useState<{ guides: Guide[]; gaps: Gap[] } | null>(null)
	const [gridOn, setGridOn] = useState(() => readFlag('co-bord:grid', false))
	const gridRef = useRef(gridOn)
	gridRef.current = gridOn
	const [minimapOn, setMinimapOn] = useState(() => readFlag('co-bord:minimap', window.innerWidth >= 768))
	const pointers = useRef(new Map<number, Point>())
	const spaceDown = useRef(false)
	const lastWorld = useRef<Point | null>(null)
	const createdText = useRef<string | null>(null)
	const frame = useRef<number | null>(null)
	const pendingCursor = useRef<Point | null | undefined>(undefined)

	const cameraRef = useRef(camera)
	cameraRef.current = camera
	const elementsRef = useRef(elements)
	elementsRef.current = elements
	const selectionRef = useRef(selection)
	selectionRef.current = selection

	const rerender = () => setTick((t) => t + 1)

	// keep the viewport size, and start centered on the content when there is no saved view
	useLayoutEffect(() => {
		const el = containerRef.current
		if (!el) return
		const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
		observer.observe(el)
		setSize({ w: el.clientWidth, h: el.clientHeight })
		return () => observer.disconnect()
	}, [])

	const centered = useRef(!!savedCamera.current)
	useEffect(() => {
		if (centered.current || !size.w) return
		const bounds = unionBounds([...elements.values()].map((el) => elementBounds(el, elements)))
		if (bounds) setCamera(fitCamera(bounds, size.w, size.h))
		else setCamera({ x: size.w / 2, y: size.h / 2, zoom: 1 })
		if (bounds || size.w) centered.current = true
	}, [elements, size])

	useEffect(() => {
		const id = setTimeout(() => {
			try {
				localStorage.setItem(viewKey(boardId), JSON.stringify(camera))
			} catch {
				/* storage unavailable */
			}
		}, 300)
		return () => clearTimeout(id)
	}, [boardId, camera])

	/** Stops following someone when the person moves the view themselves; set below. */
	const stopFollowRef = useRef<() => void>(() => {})
	/** Arrow keys while presenting; set below. */
	const presentKeysRef = useRef<(e: KeyboardEvent) => boolean>(() => false)

	// drop selected ids that someone else deleted
	const liveSelection = useMemo(() => selection.filter((id) => elements.has(id)), [selection, elements])
	useEffect(() => {
		if (liveSelection.length !== selection.length) setSelection(liveSelection)
		if (editing && !elements.has(editing)) setEditing(null)
	}, [liveSelection, selection.length, editing, elements])

	useEffect(() => {
		provider.setAwarenessField('selection', liveSelection)
	}, [provider, liveSelection])
	useEffect(() => {
		provider.setAwarenessField('editing', editing)
	}, [provider, editing])

	const sorted = useMemo(() => [...elements.values()].sort(drawOrder), [elements])
	const frames = useMemo(
		() =>
			sorted
				.filter(isFrame)
				.sort((a, b) => a.y - b.y || a.x - b.x)
				.map((f) => ({ id: f.id, title: f.title })),
		[sorted],
	)

	useServerClock()
	const session = useSession(store, user.id)
	const voting = session.voting?.active ?? false
	const [showRanking, setShowRanking] = useState(false)
	const [showTemplates, setShowTemplates] = useState(false)
	/** Saving the board (frameId null) or a frame as a project template. */
	const [savingTemplate, setSavingTemplate] = useState<{ frameId: string | null } | null>(null)

	// SparkyTC: results of everything linked on the board, in the current build
	const sparkyReady = !!sparky?.connected && !sparky.error
	const allLinks = useMemo(() => boardLinks(elements.values()), [elements])
	const linkResults = useLinkResults(projectId, allLinks, sparkyReady)
	const [openLinks, setOpenLinks] = useState<string | null>(null)
	/** A linked test case shown with its history, by number. */
	const [caseHistory, setCaseHistory] = useState<number | null>(null)
	const [panel, setPanel] = useState<'coverage' | 'retro' | 'rules' | 'comments' | 'history' | null>(null)
	const comments = useComments(boardId, provider, !guest)
	/** A comment being written: where it goes, and where on screen it was started. */
	const [composer, setComposer] = useState<{ elementId: string | null; x: number; y: number } | null>(null)
	const [openThread, setOpenThread] = useState<number | null>(null)
	const [showResolved, setShowResolved] = useState(false)
	const mediaSync = useMemo(() => new MediaSync(store.doc, !readOnly, user.displayName), [store, readOnly, user.displayName])
	const showCoverage = panel === 'coverage'
	const setShowCoverage = (on: boolean) => setPanel(on ? 'coverage' : null)
	const openPanel = (which: 'coverage' | 'retro') => setPanel(which)
	/** The generate tests dialog, for the whole board ('') or a frame. */
	const [generating, setGenerating] = useState<string | null>(null)
	const { jira } = useBoardEnv()
	const jiraReady = !!jira?.connected
	/** The retrospective summary to publish with the page, when publishing from the retro panel. */
	const [publishSummary, setPublishSummary] = useState<SummarySection[] | null>(null)
	const confluenceReady = !!confluence?.connected && !confluence.error
	/** The publish dialog, for the whole board ('') or a frame. */
	const [publishing, setPublishing] = useState<string | null>(null)

	const localPoint = (e: { clientX: number; clientY: number }): Point => {
		const rect = containerRef.current!.getBoundingClientRect()
		return { x: e.clientX - rect.left, y: e.clientY - rect.top }
	}

	const sendCursor = useCallback(
		(p: Point | null) => {
			pendingCursor.current = p
			if (frame.current !== null) return
			frame.current = requestAnimationFrame(() => {
				frame.current = null
				if (pendingCursor.current !== undefined) provider.setAwarenessField('cursor', pendingCursor.current)
				pendingCursor.current = undefined
			})
		},
		[provider],
	)

	/** Topmost box under a world point. */
	const boxAt = useCallback((p: Point, exclude?: string): BoxElement | null => {
		const list = [...elementsRef.current.values()]
			.filter((el): el is BoxElement => isBox(el) && el.type !== 'frame' && el.type !== 'draw')
			.sort((a, b) => b.z - a.z)
		return list.find((el) => el.id !== exclude && containsRotated(el, p)) ?? null
	}, [])

	/** What a dragged selection can line up with: the other elements near the view. */
	const snapTargets = useCallback(
		(exclude: Set<string>): Rect[] => {
			const c = cameraRef.current
			const view = { x: -c.x / c.zoom, y: -c.y / c.zoom, w: size.w / c.zoom, h: size.h / c.zoom }
			const near = { x: view.x - view.w, y: view.y - view.h, w: view.w * 3, h: view.h * 3 }
			const all = elementsRef.current
			return [...all.values()]
				.filter((el) => isBox(el) && !exclude.has(el.id))
				.map((el) => elementBounds(el, all))
				.filter((b) => intersects(near, b))
				.slice(0, 400)
		},
		[size],
	)

	const select = useCallback((ids: string[]) => {
		setSelection(ids)
		setEditing(null)
	}, [])

	// ---------- edits ----------

	const finishEditing = useCallback(() => {
		const id = createdText.current
		createdText.current = null
		setEditing(null)
		if (id) {
			const el = store.get(id)
			if (el && hasText(el) && !el.text.trim()) store.remove([id])
		}
		store.checkpoint()
	}, [store])

	const onText = useCallback(
		(id: string, text: string, height?: number) => {
			const el = store.get(id)
			if (!el || !hasText(el)) return
			const patch: Partial<TextBox> = { text }
			if (height !== undefined && el.type === 'text') patch.h = Math.max(32, Math.ceil(height))
			store.update([[id, patch]])
		},
		[store],
	)

	const onLabel = useCallback((id: string, label: string) => store.update([[id, { label }]]), [store])
	const onTitle = useCallback((id: string, title: string) => store.update([[id, { title }]]), [store])

	const startEditing = useCallback(
		(id: string) => {
			const el = elementsRef.current.get(id)
			if (readOnly || !el || el.type === 'media' || el.type === 'draw' || el.locked) return
			store.checkpoint()
			setSelection([id])
			setEditing(id)
		},
		[readOnly, store],
	)

	/** A frame; drawn around what it covers, or 800 x 560 where clicked. */
	const createFrame = useCallback(
		(rect: Rect | Point, title = 'Frame') => {
			const r: Rect = 'w' in rect ? rect : { x: rect.x - 400, y: rect.y - 280, w: 800, h: 560 }
			store.checkpoint()
			const [id] = store.add([
				{ type: 'frame', title, fill: 'auto', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
			])
			store.checkpoint()
			setTool('select')
			setSelection([id])
			return id
		},
		[store],
	)

	const createBox = useCallback(
		(type: 'shape' | 'sticky' | 'text', rect: Rect | Point, edit: boolean) => {
			const base = defaultElement(type, shapeKind)
			const r: Rect =
				'w' in rect ? rect : { x: rect.x - base.w / 2, y: rect.y - (type === 'text' ? base.h / 2 : base.h / 2), w: base.w, h: base.h }
			store.checkpoint()
			const [id] = store.add([{ ...base, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }])
			setTool('select')
			setSelection([id])
			if (edit) {
				if (type === 'text') createdText.current = id
				setEditing(id)
			}
			return id
		},
		[store, shapeKind],
	)

	const deleteSelection = useCallback(() => {
		if (readOnly || !selectionRef.current.length) return
		const all = elementsRef.current
		const unlocked = selectionRef.current.filter((id) => !all.get(id)?.locked)
		if (!unlocked.length) return
		store.checkpoint()
		store.remove(unlocked)
		setSelection(selectionRef.current.filter((id) => !unlocked.includes(id)))
	}, [readOnly, store])

	// ---------- groups and locking ----------

	const groupSelection = useCallback(() => {
		const all = elementsRef.current
		const els = selectionRef.current.map((id) => all.get(id)).filter((el): el is BoardElement => !!el)
		if (readOnly || unitCount(selectionRef.current, enteredRef.current, all) < 2) return
		store.checkpoint()
		store.update(groupPatches(els, enteredRef.current))
		store.checkpoint()
	}, [readOnly, store])

	const ungroupSelection = useCallback(() => {
		const all = elementsRef.current
		const groups = selectedGroups(selectionRef.current, enteredRef.current, all)
		if (readOnly || !groups.length) return
		const els = selectionRef.current.map((id) => all.get(id)).filter((el): el is BoardElement => !!el)
		store.checkpoint()
		store.update(ungroupPatches(els, enteredRef.current, groups))
		store.checkpoint()
	}, [readOnly, store])

	/** Locks the selection, or unlocks it when all of it is locked. */
	const toggleLock = useCallback(() => {
		const all = elementsRef.current
		const els = selectionRef.current.map((id) => all.get(id)).filter((el): el is BoardElement => !!el)
		if (readOnly || !els.length) return
		const lock = !els.every((el) => el.locked)
		store.checkpoint()
		store.update(els.map((el) => [el.id, { locked: lock }]))
		store.checkpoint()
	}, [readOnly, store])

	/** Erases the strokes under a board point (not locked ones). */
	const eraseAt = useCallback(
		(p: Point, erased: Set<string>) => {
			const radius = 8 / cameraRef.current.zoom
			const hit = [...elementsRef.current.values()].filter(
				(el) => el.type === 'draw' && !el.locked && !erased.has(el.id) && touchesStroke(el, p, radius),
			)
			if (!hit.length) return
			for (const el of hit) erased.add(el.id)
			store.remove(hit.map((el) => el.id))
		},
		[store],
	)

	/** The selected elements, with connector ends that point outside the selection made free. */
	const detachedSelection = useCallback((): BoardElement[] => {
		const all = elementsRef.current
		const selected = withFrameContents(selectionRef.current, all)
		const ids = new Set(selected)
		return selected
			.map((id) => all.get(id))
			.filter((el): el is BoardElement => !!el)
			.map((el) => {
				if (isBox(el)) return el
				const g = connectorGeometry(el, all)
				return {
					...el,
					from: el.from.id && ids.has(el.from.id) ? el.from : { x: g.start.x, y: g.start.y },
					to: el.to.id && ids.has(el.to.id) ? el.to : { x: g.end.x, y: g.end.y },
				}
			})
	}, [])

	// ---------- media ----------

	const [uploads, setUploads] = useState<{ id: string; name: string; progress: number; error?: string }[]>([])
	const [dropping, setDropping] = useState(false)

	const viewCenter = () => toWorld(cameraRef.current, { x: size.w / 2, y: size.h / 2 })

	/** Moves `rect` right, then down, until it doesn't cover anything on the board. */
	const freeSpot = useCallback((rect: Rect): Point => {
		const all = elementsRef.current
		const taken = [...all.values()].map((el) => elementBounds(el, all))
		const gap = 40
		const free = (r: Rect) => !taken.some((t) => intersects({ x: r.x - gap / 2, y: r.y - gap / 2, w: r.w + gap, h: r.h + gap }, t))
		for (let row = 0; row < 12; row++) {
			for (let col = 0; col < 12; col++) {
				const candidate = { ...rect, x: rect.x + col * (rect.w / 2 + gap), y: rect.y + row * (rect.h / 2 + gap) }
				if (free(candidate)) return { x: candidate.x, y: candidate.y }
			}
		}
		return { x: rect.x, y: rect.y }
	}, [])

	/**
	 * A copy of the selection: next to it, a little down and right; frames go beside the original, in free space,
	 * so the copy doesn't sit on top of the original's contents.
	 */
	const duplicate = useCallback(() => {
		if (readOnly) return
		const items = detachedSelection()
		if (!items.length) return
		const source = new Map(items.map((el) => [el.id, el]))
		let offset = { x: 24, y: 24 }
		const bounds = unionBounds(items.map((el) => elementBounds(el, source)))
		if (bounds && items.some(isFrame)) {
			const spot = freeSpot({ x: bounds.x + bounds.w + 80, y: bounds.y, w: bounds.w, h: bounds.h })
			offset = { x: Math.round(spot.x - bounds.x), y: Math.round(spot.y - bounds.y) }
		}
		store.checkpoint()
		setSelection(store.clone(items, offset, source))
	}, [readOnly, store, detachedSelection, freeSpot])

	/**
	 * Adds media blocks in a row centered on `at`. With `exact` they stay there (a drop);
	 * otherwise the row moves to free space nearby.
	 */
	const insertMedia = useCallback(
		(items: NewMedia[], at: Point, exact = false) => {
			if (readOnly || !items.length) return []
			const gap = 40
			const width = items.reduce((sum, m) => sum + m.w, 0) + gap * (items.length - 1)
			const height = Math.max(...items.map((m) => m.h))
			let origin = { x: at.x - width / 2, y: at.y - height / 2 }
			if (!exact) origin = freeSpot({ ...origin, w: width, h: height })
			let x = origin.x
			store.checkpoint()
			const ids = store.add(
				items.map((m) => {
					const el = {
						type: 'media' as const,
						kind: m.kind,
						src: m.src,
						name: m.name,
						...(m.assetId ? { assetId: m.assetId } : {}),
						...(m.start ? { start: m.start } : {}),
						w: m.w,
						h: m.h,
						x: Math.round(x),
						y: Math.round(origin.y + (height - m.h) / 2),
					}
					x += m.w + gap
					return el
				}),
			)
			store.checkpoint()
			setTool('select')
			setSelection(ids)
			return ids
		},
		[readOnly, store, freeSpot],
	)

	const insertFiles = useCallback(
		async (files: File[], at: Point, exact = false) => {
			if (readOnly) return
			// sizes first, so the files can be laid out in a row before they finish uploading
			const items = await Promise.all(
				files.map(async (file) => {
					const natural = await readMediaSize(file)
					let size: { w: number; h: number }
					if (file.type.startsWith('image/')) size = fitSize(natural?.w ?? 0, natural?.h ?? 0, 480)
					else if (file.type.startsWith('video/')) {
						const fitted = fitSize(natural?.w || 16, natural?.h || 9, 560)
						size = { w: fitted.w, h: fitted.h + MEDIA_HEADER }
					} else size = { w: 420, h: 560 + MEDIA_HEADER }
					return { file, size, id: `${file.name}-${Math.random()}` }
				}),
			)
			const gap = 40
			const total = items.reduce((sum, item) => sum + item.size.w, 0) + gap * (items.length - 1)
			const height = Math.max(...items.map((item) => item.size.h))
			const origin = exact
				? { x: at.x - total / 2, y: at.y - height / 2 }
				: freeSpot({ x: at.x - total / 2, y: at.y - height / 2, w: total, h: height })
			let x = origin.x
			const placed = items.map((item) => {
				const center = { x: x + item.size.w / 2, y: origin.y + height / 2 }
				x += item.size.w + gap
				return { ...item, center }
			})
			setUploads((list) => [...list, ...placed.map((p) => ({ id: p.id, name: p.file.name, progress: 0 }))])
			await Promise.all(
				placed.map(async ({ file, size, id, center }) => {
					try {
						const asset = await uploadAsset(boardId, file, (progress) =>
							setUploads((list) => list.map((u) => (u.id === id ? { ...u, progress } : u))),
						)
						insertMedia([{ kind: asset.kind, src: asset.url, assetId: asset.id, name: asset.name, ...size }], center, true)
						setUploads((list) => list.filter((u) => u.id !== id))
					} catch (e) {
						setUploads((list) => list.map((u) => (u.id === id ? { ...u, error: (e as Error).message } : u)))
					}
				}),
			)
		},
		[readOnly, boardId, insertMedia, freeSpot],
	)

	// ---------- frames and templates ----------

	const wrapInFrame = useCallback(() => {
		const all = elementsRef.current
		const bounds = unionBounds(
			selectionRef.current
				.map((id) => all.get(id))
				.filter((el): el is BoardElement => !!el)
				.map((el) => elementBounds(el, all)),
		)
		if (!bounds) return
		const pad = 40
		const id = createFrame({ x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 })
		setEditing(id)
	}, [createFrame])

	const exportFrame = useCallback(
		async (id: string) => {
			const all = elementsRef.current
			const frame = all.get(id)
			if (frame?.type !== 'frame') return
			const blob = await renderPng(all, dark, withFrameContents([id], all))
			if (blob) download(blob, `${(frame.title || boardName).replace(/[\\/:*?"<>|]+/g, '_')}.png`)
		},
		[dark, boardName],
	)

	/** Files of elements from another project (pasted, a template, an import) copied into this one. */
	const localizeAssets = useCallback(
		async (items: BoardElement[]): Promise<BoardElement[]> => {
			const assetIds = items.flatMap((el) => (el.type === 'media' && el.assetId ? [el.assetId] : []))
			if (!assetIds.length) return items
			const assets = await api<{ assets: Record<string, { id: string; url: string }> }>(`/api/boards/${boardId}/assets/copy`, {
				method: 'POST',
				body: { ids: [...new Set(assetIds)] },
			})
				.then((r) => r.assets)
				.catch(() => ({}) as Record<string, { id: string; url: string }>)
			return items.map((el) => {
				if (el.type !== 'media' || !el.assetId) return el
				const copy = assets[el.assetId]
				if (!copy) return el
				return { ...el, assetId: copy.id, src: el.src.split(`/api/assets/${el.assetId}`).join(copy.url) }
			})
		},
		[boardId],
	)

	/** Adds a template's or an import's elements in free space next to what's there, and shows them. */
	const insertItems = useCallback(
		async (raw: BoardElement[]) => {
			if (readOnly) return
			const items = await localizeAssets(raw)
			const source = new Map(items.map((el) => [el.id, el]))
			const bounds = unionBounds(items.map((el) => elementBounds(el, source)))
			if (!bounds) return
			const center = toWorld(cameraRef.current, { x: size.w / 2, y: size.h / 2 })
			const spot = freeSpot({ x: center.x - bounds.w / 2, y: center.y - bounds.h / 2, w: bounds.w, h: bounds.h + 40 })
			store.checkpoint()
			store.clone(items, { x: Math.round(spot.x - bounds.x), y: Math.round(spot.y + 40 - bounds.y) }, source)
			store.checkpoint()
			setTool('select')
			setSelection([])
			setCamera(fitCamera({ x: spot.x, y: spot.y, w: bounds.w, h: bounds.h + 40 }, size.w, size.h, 60, 1))
		},
		[readOnly, store, size, freeSpot, localizeAssets],
	)

	/** A Confluence page card, named after the page. */
	const insertConfluence = useCallback(
		async (pageId: string, at: Point, title?: string) => {
			let name = title
			if (!name) {
				try {
					name = (await api<{ title: string }>(`/api/projects/${projectId}/confluence/pages/${pageId}`)).title
				} catch {
					name = 'Confluence page'
				}
			}
			insertMedia([{ kind: 'confluence', src: pageId, name, w: 420, h: 240 }], at)
		},
		[projectId, insertMedia],
	)

	// ---------- camera ----------

	const zoomBy = useCallback(
		(factor: number, at?: Point) => {
			stopFollowRef.current()
			const c = cameraRef.current
			setCamera(zoomAt(c, at ?? { x: size.w / 2, y: size.h / 2 }, c.zoom * factor))
		},
		[size],
	)

	const fit = useCallback(
		(ids?: string[]) => {
			const all = elementsRef.current
			const list = ids?.length ? ids.map((id) => all.get(id)).filter((e): e is BoardElement => !!e) : [...all.values()]
			const bounds = unionBounds(list.map((el) => elementBounds(el, all)))
			if (bounds) setCamera(fitCamera(bounds, size.w, size.h, 80, 2))
		},
		[size],
	)

	const focused = useRef<string | null>(null)
	useEffect(() => {
		if (focusId?.startsWith('comment:') && focused.current !== focusId && size.w && comments.loaded) {
			focused.current = focusId
			const thread = comments.threads.find((t) => t.id === Number(focusId.slice(8)))
			const p = thread && pinPoint(thread, elements)
			if (thread && p) {
				setCamera((c) => ({ ...c, x: size.w / 2 - p.x * c.zoom, y: size.h / 2 - p.y * c.zoom }))
				setOpenThread(thread.id)
			}
			return
		}
		if (!focusId || focused.current === focusId || !size.w || !elements.has(focusId)) return
		focused.current = focusId
		setSelection([focusId])
		fit([focusId])
	}, [focusId, elements, size.w, size.h, fit, comments.loaded, comments.threads])

	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		const onWheel = (e: WheelEvent) => {
			e.preventDefault()
			stopFollowRef.current()
			const p = localPoint(e)
			if (e.ctrlKey || e.metaKey) {
				const c = cameraRef.current
				setCamera(zoomAt(c, p, c.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 4 : 1))))
			} else {
				const scale = e.deltaMode === 1 ? 16 : 1
				setCamera((c) => ({ ...c, x: c.x - e.deltaX * scale, y: c.y - e.deltaY * scale }))
			}
		}
		el.addEventListener('wheel', onWheel, { passive: false })
		return () => el.removeEventListener('wheel', onWheel)
	}, [])

	// ---------- pointer ----------

	function onPointerDown(e: React.PointerEvent) {
		const container = containerRef.current!
		const screen = localPoint(e)
		// a selected player or PDF handles its own clicks
		if ((e.target as Element).closest('[data-interactive]')) return
		pointers.current.set(e.pointerId, screen)
		container.setPointerCapture(e.pointerId)

		if (pointers.current.size === 2) {
			stopFollowRef.current()
			const [a, b] = [...pointers.current.values()]
			drag.current = {
				kind: 'pinch',
				startDist: Math.hypot(a.x - b.x, a.y - b.y),
				startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
				startCam: cameraRef.current,
			}
			return
		}
		if (pointers.current.size > 2) return

		const world = toWorld(cameraRef.current, screen)
		const target = e.target as Element
		const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle
		const id = target.closest<HTMLElement>('[data-el]')?.dataset.el ?? null
		if (editing && id === editing) return
		if (editing) finishEditing()

		const panning =
			e.button === 1 || tool === 'hand' || spaceDown.current || (e.pointerType === 'touch' && tool === 'select' && !id && !handle)
		if (panning) {
			stopFollowRef.current()
			drag.current = { kind: 'pan', startScreen: screen, startCam: cameraRef.current }
			rerender()
			return
		}
		if (e.button !== 0) return

		if (handle && !readOnly) {
			const [type, value] = handle.split(':')
			const selected = elementsRef.current.get(selectionRef.current[0])
			store.checkpoint()
			if (type === 'resize' && isBox(selected)) {
				drag.current = {
					kind: 'resize',
					handle: value as Handle,
					original: selected,
					startWorld: world,
					keepRatio: keepsRatio(selected),
					others: snapTargets(new Set([selected.id])),
				}
			} else if (type === 'scale') {
				const all = elementsRef.current
				const originals = withFrameContents(selectionRef.current, all)
					.map((x) => all.get(x))
					.filter((x): x is BoardElement => !!x)
				const bounds = unionBounds(originals.map((el) => elementBounds(el, all)))
				if (bounds)
					drag.current = {
						kind: 'scale',
						handle: value as Handle,
						bounds,
						originals,
						startWorld: world,
						others: snapTargets(new Set(originals.map((el) => el.id))),
					}
			} else if (type === 'rotate' && isBox(selected)) {
				const c = center(selected)
				drag.current = {
					kind: 'rotate',
					id: selected.id,
					center: c,
					startAngle: (Math.atan2(world.y - c.y, world.x - c.x) * 180) / Math.PI,
					original: rotationOf(selected),
				}
			} else if (type === 'connect' && isBox(selected)) {
				drag.current = {
					kind: 'connect',
					from: { id: selected.id, ...sidePoint(selected, value as Side), side: value as Side },
					startWorld: world,
					current: world,
					target: null,
				}
			} else if (type === 'end' && selected?.type === 'connector') {
				drag.current = { kind: 'endpoint', id: selected.id, which: value as 'from' | 'to', target: null }
			}
			return
		}

		if (tool === 'draw') {
			if (readOnly) return
			if (ink.mode === 'laser') {
				laser.start(world)
				drag.current = { kind: 'laser' }
			} else if (ink.mode === 'eraser') {
				store.checkpoint()
				const erased = new Set<string>()
				eraseAt(world, erased)
				drag.current = { kind: 'erase', erased }
			} else drag.current = { kind: 'ink', points: [world] }
			rerender()
			return
		}
		if (tool === 'comment') {
			setComposer(anchorFor(world, id, elementsRef.current))
			setOpenThread(null)
			setTool('select')
			return
		}
		if (tool === 'sticky' || tool === 'text' || tool === 'shape' || tool === 'frame') {
			if (readOnly) return
			drag.current = { kind: 'create', type: tool, startWorld: world, current: world }
			return
		}
		if (tool === 'connector') {
			if (readOnly) return
			const box = boxAt(world)
			drag.current = {
				kind: 'connect',
				from: box ? { id: box.id, x: world.x, y: world.y, ...sideOf(box, world) } : { x: world.x, y: world.y },
				startWorld: world,
				current: world,
				target: null,
			}
			return
		}

		// select tool
		if (id) {
			// while voting, a click is a vote
			const target = elementsRef.current.get(id)
			if (
				voting &&
				!readOnly &&
				target &&
				target.type !== 'connector' &&
				target.type !== 'frame' &&
				target.type !== 'draw' &&
				!e.shiftKey
			) {
				session.session.vote(user.id, id)
				return
			}
			const all = elementsRef.current
			// a click outside the groups double-clicked into leaves them
			let inGroup = enteredRef.current
			if (inGroup.length && !insideEntered(target, inGroup)) {
				inGroup = []
				setEntered([])
			}
			const unit = unitOf(id, inGroup, all)
			const current = selectionRef.current
			let next = current
			let collapseTo: string[] | null = null
			if (e.shiftKey || e.metaKey || e.ctrlKey)
				next = unit.every((x) => current.includes(x)) ? current.filter((x) => !unit.includes(x)) : [...new Set([...current, ...unit])]
			else if (!current.includes(id)) next = unit
			else if (current.length > unit.length) collapseTo = unit
			setSelection(next)
			if (readOnly || !next.includes(id)) return
			// locked: a click selects it, a drag selects with a box as if on the board
			if (target?.locked) {
				drag.current = { kind: 'marquee', startWorld: world, current: world, base: [], started: false }
				return
			}
			store.checkpoint()
			const originals = withFrameContents(
				next.filter((x) => !all.get(x)?.locked),
				all,
			)
				.map((x) => all.get(x))
				.filter((x): x is BoardElement => !!x)
			drag.current = {
				kind: 'move',
				startWorld: world,
				originals,
				moved: false,
				clickedId: id,
				collapseTo,
				bounds: unionBounds(originals.map((el) => elementBounds(el, all))),
				others: snapTargets(new Set(originals.map((el) => el.id))),
			}
		} else {
			const base = e.shiftKey ? selectionRef.current : []
			if (!e.shiftKey) {
				setSelection([])
				setEntered([])
			}
			drag.current = { kind: 'marquee', startWorld: world, current: world, base, started: true }
		}
	}

	function onPointerMove(e: React.PointerEvent) {
		const screen = localPoint(e)
		if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, screen)
		const world = toWorld(cameraRef.current, screen)
		lastWorld.current = world
		sendCursor(world)
		const d = drag.current
		if (!d) return

		switch (d.kind) {
			case 'pinch': {
				if (pointers.current.size < 2) return
				const [a, b] = [...pointers.current.values()]
				const dist = Math.hypot(a.x - b.x, a.y - b.y)
				const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
				const zoom = Math.min(4, Math.max(0.1, (d.startCam.zoom * dist) / Math.max(d.startDist, 1)))
				const anchor = toWorld(d.startCam, d.startMid)
				setCamera({ zoom, x: mid.x - anchor.x * zoom, y: mid.y - anchor.y * zoom })
				return
			}
			case 'pan':
				setCamera({ ...d.startCam, x: d.startCam.x + screen.x - d.startScreen.x, y: d.startCam.y + screen.y - d.startScreen.y })
				return
			case 'move': {
				let dx = world.x - d.startWorld.x
				let dy = world.y - d.startWorld.y
				if (!d.moved && Math.hypot(dx, dy) * cameraRef.current.zoom < 3) return
				d.moved = true
				// Alt moves freely; otherwise line up with what's around, or the grid
				if (d.bounds && !e.altKey) {
					const snapped = snapMove(
						{ ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy },
						d.others,
						SNAP_PX / cameraRef.current.zoom,
						gridRef.current,
					)
					dx += snapped.dx
					dy += snapped.dy
					setSnapShown(snapped.guides.length || snapped.gaps.length ? { guides: snapped.guides, gaps: snapped.gaps } : null)
				} else setSnapShown(null)
				store.update(
					d.originals.map((el): [string, Partial<BoardElement>] => {
						if (isBox(el)) return [el.id, { x: Math.round(el.x + dx), y: Math.round(el.y + dy) }]
						const shift = (end: Endpoint) => (end.id && elementsRef.current.has(end.id) ? end : { ...end, x: end.x + dx, y: end.y + dy })
						return [el.id, { from: shift(el.from), to: shift(el.to) } as Partial<ConnectorElement>]
					}),
				)
				return
			}
			case 'resize': {
				const o = d.original
				const keep = d.keepRatio || e.shiftKey
				const r = rotationOf(o)
				if (r) {
					// resize in the element's own frame, keeping the opposite side in place
					const local = rotatePoint({ x: world.x - d.startWorld.x, y: world.y - d.startWorld.y }, { x: 0, y: 0 }, -r)
					const next = resize(o, d.handle, local.x, local.y, keep) as Rect
					const c = rotatePoint(center(next), center(o), r)
					store.update([[o.id, { w: next.w, h: next.h, x: Math.round(c.x - next.w / 2), y: Math.round(c.y - next.h / 2) }]])
					return
				}
				let next = resize(o, d.handle, world.x - d.startWorld.x, world.y - d.startWorld.y, keep) as Rect
				if (!keep && !e.altKey) {
					const snapped = snapEdges(next, handleEdges(d.handle), d.others, SNAP_PX / cameraRef.current.zoom, gridRef.current, MIN_SIZE)
					next = roundRect(snapped.rect)
					setSnapShown(snapped.guides.length ? { guides: snapped.guides, gaps: [] } : null)
				} else setSnapShown(null)
				store.update([[o.id, { ...next }]])
				return
			}
			case 'scale': {
				const b = d.bounds
				let next = resize({ ...b } as BoxElement, d.handle, world.x - d.startWorld.x, world.y - d.startWorld.y, e.shiftKey) as Rect
				if (!e.shiftKey && !e.altKey) {
					const snapped = snapEdges(next, handleEdges(d.handle), d.others, SNAP_PX / cameraRef.current.zoom, gridRef.current, MIN_SIZE)
					next = snapped.rect
					setSnapShown(snapped.guides.length ? { guides: snapped.guides, gaps: [] } : null)
				} else setSnapShown(null)
				const sx = b.w > 1 ? next.w / b.w : 1
				const sy = b.h > 1 ? next.h / b.h : 1
				const font = Math.min(sx, sy)
				const at = (p: Point) => ({ x: next.x + (p.x - b.x) * sx, y: next.y + (p.y - b.y) * sy })
				store.update(
					d.originals.map((el): [string, Partial<BoardElement>] => {
						if (isBox(el)) {
							// rotated boxes scale around their center
							const c = at(center(el))
							const w = Math.max(MIN_SIZE / 2, el.w * sx)
							const h = Math.max(MIN_SIZE / 2, el.h * sy)
							const patch: Record<string, number> = {
								x: Math.round(c.x - w / 2),
								y: Math.round(c.y - h / 2),
								w: Math.round(w),
								h: Math.round(h),
							}
							if ('fontSize' in el) patch.fontSize = Math.max(6, Math.round(el.fontSize * font))
							return [el.id, patch as Partial<BoardElement>]
						}
						const end = (p: Endpoint) => (p.id && elementsRef.current.has(p.id) ? p : { ...p, ...at(p) })
						return [el.id, { from: end(el.from), to: end(el.to) } as Partial<ConnectorElement>]
					}),
				)
				return
			}
			case 'rotate': {
				let deg = d.original + (Math.atan2(world.y - d.center.y, world.x - d.center.x) * 180) / Math.PI - d.startAngle
				if (e.shiftKey) deg = Math.round(deg / 15) * 15
				else if (Math.abs(deg - Math.round(deg / 90) * 90) < 4) deg = Math.round(deg / 90) * 90
				deg = (((Math.round(deg * 10) / 10) % 360) + 360) % 360
				store.update([[d.id, { rotation: deg } as Partial<BoardElement>]])
				rerender()
				return
			}
			case 'marquee': {
				d.current = world
				if (!d.started && Math.hypot(world.x - d.startWorld.x, world.y - d.startWorld.y) * cameraRef.current.zoom < 4) return
				d.started = true
				const r = rectFromPoints(d.startWorld, world)
				const all = elementsRef.current
				// frames only when the box covers them whole, so selecting inside a frame doesn't pick it; never locked ones
				const hit = [...all.values()]
					.filter((el) => {
						if (el.locked) return false
						const b = elementBounds(el, all)
						return el.type === 'frame' ? b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h : intersects(r, b)
					})
					.map((el) => el.id)
				const units = expandToUnits(hit, enteredRef.current, all).filter((x) => !all.get(x)?.locked)
				setSelection([...new Set([...d.base, ...units])])
				rerender()
				return
			}
			case 'ink':
				addInkPoint(d.points, world, 1.5 / cameraRef.current.zoom)
				rerender()
				return
			case 'erase':
				eraseAt(world, d.erased)
				return
			case 'laser':
				laser.add(world)
				return
			case 'create':
				d.current = world
				rerender()
				return
			case 'connect': {
				d.current = world
				const box = boxAt(world, d.from.id)
				d.target = box?.id ?? null
				rerender()
				return
			}
			case 'endpoint': {
				const conn = elementsRef.current.get(d.id)
				if (conn?.type !== 'connector') return
				const other = d.which === 'from' ? conn.to : conn.from
				const box = boxAt(world, other.id)
				d.target = box?.id ?? null
				// it keeps the side it's dropped on, so it doesn't land on a side other lines already use
				const end: Endpoint = box ? { id: box.id, x: world.x, y: world.y, ...sideOf(box, world) } : { x: world.x, y: world.y }
				store.update([[d.id, { [d.which]: end } as Partial<ConnectorElement>]])
				rerender()
				return
			}
		}
	}

	function onPointerUp(e: React.PointerEvent) {
		pointers.current.delete(e.pointerId)
		const d = drag.current
		if (!d) return
		if (d.kind === 'pinch') {
			if (pointers.current.size === 0) drag.current = null
			return
		}
		drag.current = null
		setSnapShown(null)
		const world = toWorld(cameraRef.current, localPoint(e))
		const zoom = cameraRef.current.zoom

		switch (d.kind) {
			case 'move':
				if (!d.moved && d.collapseTo) setSelection(d.collapseTo)
				store.checkpoint()
				break
			case 'ink': {
				addInkPoint(d.points, world, 0.5 / zoom)
				const highlighter = ink.mode === 'highlighter'
				const style = highlighter ? ink.highlighter : ink.pen
				store.checkpoint()
				store.add([
					strokeElement(d.points, {
						stroke: style.color,
						strokeWidth: (highlighter ? INK_WIDTHS.highlighter : INK_WIDTHS.pen)[style.width] ?? 4,
						highlighter,
					}),
				])
				store.checkpoint()
				break
			}
			case 'erase':
				store.checkpoint()
				break
			case 'laser':
				laser.end()
				break
			case 'resize':
			case 'scale':
			case 'rotate':
			case 'endpoint':
				store.checkpoint()
				break
			case 'create': {
				const r = rectFromPoints(d.startWorld, world)
				const dragged = r.w * zoom > 8 && r.h * zoom > 8
				const rect = dragged ? { ...r, w: Math.max(r.w, MIN_SIZE), h: Math.max(r.h, MIN_SIZE) } : d.startWorld
				if (dragged && d.type === 'sticky') {
					const side = Math.max(r.w, r.h)
					;(rect as Rect).w = side
					;(rect as Rect).h = side
				}
				if (d.type === 'frame') createFrame(dragged ? (rect as Rect) : d.startWorld)
				else createBox(d.type, rect, d.type !== 'shape')
				break
			}
			case 'connect': {
				if (Math.hypot(world.x - d.startWorld.x, world.y - d.startWorld.y) * zoom < 8 && !d.target) break
				const target = d.target ? elementsRef.current.get(d.target) : undefined
				const to: Endpoint =
					d.target && isBox(target) ? { id: d.target, x: world.x, y: world.y, ...sideOf(target, world) } : { x: world.x, y: world.y }
				store.checkpoint()
				const [id] = store.add([
					{
						type: 'connector',
						from: d.from,
						to,
						route: 'elbow',
						stroke: 'auto',
						strokeWidth: 2,
						dash: false,
						startArrow: false,
						endArrow: true,
						label: '',
					},
				])
				store.checkpoint()
				setTool('select')
				setSelection([id])
				break
			}
		}
		rerender()
	}

	function onDoubleClick(e: React.MouseEvent) {
		if (readOnly) return
		// the board captures the pointer, so the event's target can be the board itself: look at what's under it
		const under = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element)
		const id = under.closest<HTMLElement>('[data-el]')?.dataset.el
		if (tool === 'draw') return
		if (id) {
			// in a group: go one level in, and pick what was clicked there
			const all = elementsRef.current
			const el = all.get(id)
			const level = insideEntered(el, enteredRef.current) ? enteredRef.current.length : 0
			if (unitGroup(el, enteredRef.current) && el?.groups) {
				const inside = el.groups.slice(0, level + 1)
				setEntered(inside)
				setSelection(unitOf(id, inside, all))
				return
			}
			return startEditing(id)
		}
		if (tool === 'select' && !under.closest('[data-handle],[data-ui]')) createBox('text', toWorld(cameraRef.current, localPoint(e)), true)
	}

	// ---------- following and presenting ----------

	const [searchOpen, setSearchOpen] = useState(false)
	const presenting = session.presenting
	const myClient = provider.awareness?.clientID ?? -1
	const presentingMine = !!presenting && presenting.clientId === myClient
	/** The presentation this person stepped out of. */
	const [leftPresentation, setLeftPresentation] = useState<string | null>(null)
	const presenterHere = !!presenting && (presentingMine || peers.some((p) => p.clientId === presenting.clientId))
	const followId =
		following ?? (presenting && presenterHere && !presentingMine && leftPresentation !== presenting.id ? presenting.clientId : null)
	const followed = followId !== null ? (peers.find((p) => p.clientId === followId) ?? null) : null
	stopFollowRef.current =
		followId === null
			? () => {}
			: () => {
					if (following !== null) onFollow(null)
					else if (presenting) setLeftPresentation(presenting.id)
				}

	// share the part of the board on screen, so others can follow
	useEffect(() => {
		if (!size.w) return
		const id = setTimeout(
			() =>
				provider.setAwarenessField('view', {
					x: -camera.x / camera.zoom,
					y: -camera.y / camera.zoom,
					w: size.w / camera.zoom,
					h: size.h / camera.zoom,
				}),
			80,
		)
		return () => clearTimeout(id)
	}, [provider, camera, size])

	const followedView = followed?.view
	useEffect(() => {
		if (!followedView || !size.w) return
		const zoom = clampZoom(Math.min(size.w / followedView.w, size.h / followedView.h))
		setCamera({
			zoom,
			x: size.w / 2 - (followedView.x + followedView.w / 2) * zoom,
			y: size.h / 2 - (followedView.y + followedView.h / 2) * zoom,
		})
	}, [followedView, size])

	const slides = useMemo(() => framesInOrder(elements), [elements])
	const [slide, setSlide] = useState(0)
	const goSlide = (i: number) => {
		if (!slides.length) return
		const next = Math.min(Math.max(0, i), slides.length - 1)
		setSlide(next)
		fit([slides[next].id])
	}
	presentKeysRef.current = (e) => {
		if (!presentingMine || selectionRef.current.length) return false
		if (e.key === 'ArrowRight' || e.key === 'PageDown') goSlide(slide + 1)
		else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goSlide(slide - 1)
		else return false
		e.preventDefault()
		return true
	}
	const startPresenting = () => {
		session.session.startPresenting(
			myClient,
			user.displayName,
			(provider.awareness?.getLocalState()?.user?.color as string | undefined) ?? '#c01c37',
		)
		document.documentElement.requestFullscreen?.().catch(() => {})
		onFollow(null)
		if (slides.length) goSlide(0)
	}
	const stopPresenting = () => {
		session.session.stopPresenting()
		if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
	}
	// leaving the board ends one's own presentation
	const presentingMineRef = useRef(presentingMine)
	presentingMineRef.current = presentingMine
	useEffect(
		() => () => {
			if (presentingMineRef.current) session.session.stopPresenting()
		},
		[session.session],
	)

	const searchPin = useCallback((t: Thread) => pinPoint(t, elements), [elements])
	const goToMatch = (m: Match) => {
		stopFollowRef.current()
		setCamera((c) => {
			const zoom = Math.max(c.zoom, 0.6)
			return { zoom, x: size.w / 2 - m.at.x * zoom, y: size.h / 2 - m.at.y * zoom }
		})
		if (m.kind === 'element') {
			setOpenThread(null)
			setSelection([m.id])
		} else {
			setSelection([])
			setComposer(null)
			setOpenThread(Number(m.id))
		}
	}

	// ---------- keyboard and clipboard ----------

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (isTyping(e.target)) return
			const mod = e.metaKey || e.ctrlKey
			const key = e.key.toLowerCase()
			if (mod && key === 'f') {
				e.preventDefault()
				setSearchOpen(true)
				return
			}
			if (presentKeysRef.current(e)) return
			if (e.key === ' ') {
				spaceDown.current = true
				e.preventDefault()
				return
			}
			if (mod && key === 'z') {
				e.preventDefault()
				if (readOnly) return
				if (e.shiftKey) store.undo.redo()
				else store.undo.undo()
				return
			}
			if (mod && key === 'y') {
				e.preventDefault()
				if (!readOnly) store.undo.redo()
				return
			}
			if (mod && key === 'a') {
				e.preventDefault()
				select([...elementsRef.current.values()].filter((el) => !el.locked).map((el) => el.id))
				return
			}
			if (mod && key === 'g') {
				e.preventDefault()
				if (e.shiftKey) ungroupSelection()
				else groupSelection()
				return
			}
			if (mod && e.shiftKey && key === 'l') {
				e.preventDefault()
				toggleLock()
				return
			}
			if (mod && key === 'd') {
				e.preventDefault()
				duplicate()
				return
			}
			if (mod && (key === '=' || key === '+')) {
				e.preventDefault()
				zoomBy(1.2)
				return
			}
			if (mod && key === '-') {
				e.preventDefault()
				zoomBy(1 / 1.2)
				return
			}
			if (mod && key === '0') {
				e.preventDefault()
				stopFollowRef.current()
				setCamera((c) => zoomAt(c, { x: size.w / 2, y: size.h / 2 }, 1))
				return
			}
			if (mod) return
			if (e.shiftKey && e.code === 'Digit1') {
				stopFollowRef.current()
				return fit()
			}
			if (e.shiftKey && e.code === 'Digit2') {
				stopFollowRef.current()
				return fit(selectionRef.current)
			}
			switch (e.key) {
				case 'Delete':
				case 'Backspace':
					e.preventDefault()
					return deleteSelection()
				case 'Escape': {
					stopFollowRef.current()
					setTool('select')
					// out of a group: back to the group as a whole
					const inside = enteredRef.current
					if (inside.length) {
						setEntered(inside.slice(0, -1))
						return select(groupMembers(inside[inside.length - 1], elementsRef.current))
					}
					return select([])
				}
				case 'Enter':
					if (selectionRef.current.length === 1) {
						e.preventDefault()
						startEditing(selectionRef.current[0])
					}
					return
				case 'ArrowUp':
				case 'ArrowDown':
				case 'ArrowLeft':
				case 'ArrowRight': {
					if (readOnly || !selectionRef.current.length) return
					e.preventDefault()
					const step = e.shiftKey ? 10 : 1
					const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
					const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
					const all = elementsRef.current
					store.update(
						withFrameContents(
							selectionRef.current.filter((id) => !all.get(id)?.locked),
							all,
						)
							.map((id) => all.get(id))
							.filter((el): el is BoardElement => !!el)
							.map((el): [string, Partial<BoardElement>] => {
								if (isBox(el)) return [el.id, { x: el.x + dx, y: el.y + dy }]
								const shift = (end: Endpoint) => (end.id && all.has(end.id) ? end : { ...end, x: end.x + dx, y: end.y + dy })
								return [el.id, { from: shift(el.from), to: shift(el.to) } as Partial<ConnectorElement>]
							}),
					)
					return
				}
			}
			const tools: Record<string, Tool> = {
				v: 'select',
				h: 'hand',
				n: 'sticky',
				t: 'text',
				s: 'shape',
				r: 'shape',
				l: 'connector',
				f: 'frame',
				c: 'comment',
				p: 'draw',
				e: 'draw',
				k: 'draw',
			}
			if (tools[key] && (!readOnly || key === 'v' || key === 'h' || (key === 'c' && !guest))) {
				if (key === 'r') setShapeKind('rect')
				if (key === 'p') setInk({ ...inkRef.current, mode: inkRef.current.mode === 'highlighter' ? 'highlighter' : 'pen' })
				if (key === 'e') setInk({ ...inkRef.current, mode: 'eraser' })
				if (key === 'k') setInk({ ...inkRef.current, mode: 'laser' })
				setTool(tools[key])
			}
		}
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === ' ') spaceDown.current = false
		}
		const onCopy = (e: ClipboardEvent) => {
			if (isTyping(e.target) || !selectionRef.current.length) return
			e.preventDefault()
			e.clipboardData?.setData('text/plain', CLIPBOARD_PREFIX + JSON.stringify(detachedSelection()))
			if (e.type === 'cut' && !readOnly) deleteSelection()
		}
		const onPaste = (e: ClipboardEvent) => {
			if (isTyping(e.target) || readOnly) return
			const at = lastWorld.current ?? toWorld(cameraRef.current, { x: size.w / 2, y: size.h / 2 })
			const files = [...(e.clipboardData?.files ?? [])]
			if (files.length) {
				e.preventDefault()
				void insertFiles(files, at)
				return
			}
			const text = e.clipboardData?.getData('text/plain') ?? ''
			if (!text) return
			e.preventDefault()
			const pageId = confluencePageId(text, confluence)
			if (pageId) {
				void insertConfluence(pageId, at)
				return
			}
			const media = !/\s/.test(text.trim()) ? parseMediaUrl(text) : null
			if (media) {
				insertMedia([media], at)
				return
			}
			store.checkpoint()
			if (text.startsWith(CLIPBOARD_PREFIX)) {
				let items: BoardElement[]
				try {
					items = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as BoardElement[]
				} catch {
					return /* not ours after all */
				}
				const place = (list: BoardElement[]) => {
					const source = new Map(list.map((el) => [el.id, el]))
					const bounds = unionBounds(list.map((el) => elementBounds(el, source)))
					if (!bounds) return
					const offset = { x: Math.round(at.x - bounds.x - bounds.w / 2), y: Math.round(at.y - bounds.y - bounds.h / 2) }
					setSelection(store.clone(list, offset, source))
				}
				// uploaded files from another project's board are copied into this one, so everyone here can see them
				if (!items.some((el) => el.type === 'media' && el.assetId)) place(items)
				else
					void localizeAssets(items).then((list) => {
						store.checkpoint()
						place(list)
					})
				return
			}
			const base = defaultElement('text')
			const [id] = store.add([{ ...base, text: text.slice(0, 5000), w: 320, x: Math.round(at.x - 160), y: Math.round(at.y - 20) }])
			setSelection([id])
		}
		window.addEventListener('keydown', onKeyDown)
		window.addEventListener('keyup', onKeyUp)
		window.addEventListener('copy', onCopy)
		window.addEventListener('cut', onCopy)
		window.addEventListener('paste', onPaste)
		return () => {
			window.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('keyup', onKeyUp)
			window.removeEventListener('copy', onCopy)
			window.removeEventListener('cut', onCopy)
			window.removeEventListener('paste', onPaste)
		}
	}, [
		boardId,
		guest,
		localizeAssets,
		store,
		readOnly,
		size,
		select,
		duplicate,
		deleteSelection,
		groupSelection,
		ungroupSelection,
		toggleLock,
		setInk,
		startEditing,
		detachedSelection,
		fit,
		zoomBy,
		insertFiles,
		insertMedia,
		insertConfluence,
		confluence,
	])

	// ---------- render ----------

	const d = drag.current
	const selectedEls = liveSelection.map((id) => elements.get(id)).filter((el): el is BoardElement => !!el)
	const single = selectedEls.length === 1 ? selectedEls[0] : null
	const selectionBounds = unionBounds(selectedEls.map((el) => elementBounds(el, elements)))
	const highlight = d?.kind === 'connect' || d?.kind === 'endpoint' ? d.target : null
	const highlightEl = highlight ? elements.get(highlight) : null

	const cursor =
		d?.kind === 'pan'
			? 'grabbing'
			: tool === 'hand' || spaceDown.current
				? 'grab'
				: tool === 'select'
					? 'default'
					: tool === 'draw' && ink.mode === 'eraser'
						? 'cell'
						: 'crosshair'
	const anyLocked = selectedEls.some((el) => el.locked)
	/** The group double-clicked into, outlined while working inside it. */
	const enteredBounds = entered.length
		? unionBounds(
				groupMembers(entered[entered.length - 1], elements)
					.map((id) => elements.get(id))
					.filter((el): el is BoardElement => !!el)
					.map((el) => elementBounds(el, elements)),
			)
		: null
	const inkStyle = ink.mode === 'highlighter' ? ink.highlighter : ink.pen
	const inkWidth = (ink.mode === 'highlighter' ? INK_WIDTHS.highlighter : INK_WIDTHS.pen)[inkStyle.width] ?? 4

	const screenRect = (r: Rect) => {
		const p = toScreen(camera, r)
		return { left: p.x, top: p.y, width: r.w * camera.zoom, height: r.h * camera.zoom }
	}

	/** The elements a connector is attached to; the same map while they don't change, so its view isn't redrawn. */
	// elbows keep clear of the shapes around them: those come along with the ends
	const boxGrid = useMemo(() => new BoxGrid(elements), [elements])
	const endsCache = useRef(new Map<string, { from?: BoardElement; to?: BoardElement; near: BoardElement[]; map: ElementMap }>())
	const endsFor = (el: ConnectorElement): ElementMap => {
		const from = el.from.id ? elements.get(el.from.id) : undefined
		const to = el.to.id ? elements.get(el.to.id) : undefined
		const near = el.route === 'elbow' ? boxGrid.query(routeRegion(el, elements)).filter((b) => b !== from && b !== to) : []
		const hit = endsCache.current.get(el.id)
		if (hit && hit.from === from && hit.to === to && hit.near.length === near.length && hit.near.every((b, i) => b === near[i]))
			return hit.map
		const m: ElementMap = new Map()
		if (from) m.set(from.id, from)
		if (to) m.set(to.id, to)
		for (const b of near) m.set(b.id, b)
		endsCache.current.set(el.id, { from, to, near, map: m })
		return m
	}

	// only what's on screen, with a margin, is drawn: big boards stay smooth. The selection, the element being
	// edited and players (so they keep playing) are always there.
	const viewRect = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: size.w / camera.zoom, h: size.h / camera.zoom }
	const margin = Math.max(viewRect.w, viewRect.h) * 0.5
	const cullRect = { x: viewRect.x - margin, y: viewRect.y - margin, w: viewRect.w + margin * 2, h: viewRect.h + margin * 2 }
	const keep = new Set(liveSelection)
	if (editing) keep.add(editing)
	const roughBounds = (el: BoardElement): Rect => {
		if (isBox(el)) return elementBounds(el, elements)
		const end = (e: Endpoint) => {
			const box = e.id ? elements.get(e.id) : undefined
			return isBox(box) ? elementBounds(box, elements) : { x: e.x, y: e.y, w: 0, h: 0 }
		}
		const b = unionBounds([end(el.from), end(el.to)])!
		// curves bulge out of the box between their ends
		return { x: b.x - 120, y: b.y - 120, w: b.w + 240, h: b.h + 240 }
	}
	const drawn = size.w
		? sorted.filter(
				(el) =>
					keep.has(el.id) ||
					(el.type === 'media' && (el.kind === 'video' || el.kind === 'youtube' || el.kind === 'vimeo' || el.kind === 'drive')) ||
					intersects(cullRect, roughBounds(el)),
			)
		: sorted

	let connectPreview: ConnectorGeometry | null = null
	if (d?.kind === 'connect') {
		const temp: ConnectorElement = {
			id: '__preview',
			z: 0,
			type: 'connector',
			from: d.from,
			to: d.target
				? {
						id: d.target,
						...d.current,
						...(isBox(elements.get(d.target)) ? sideOf(elements.get(d.target) as BoxElement, d.current) : {}),
					}
				: d.current,
			route: 'elbow',
			stroke: 'auto',
			strokeWidth: 2,
			dash: false,
			startArrow: false,
			endArrow: true,
			label: '',
		}
		connectPreview = connectorGeometry(temp, elements)
	}

	const gridSize = GRID * camera.zoom
	const showGrid = gridSize >= 8

	return (
		<MediaSyncContext.Provider value={mediaSync}>
			<div className="relative h-full w-full overflow-hidden select-none" style={{ background: 'var(--board-bg)' }}>
				<div
					ref={containerRef}
					className="absolute inset-0 touch-none"
					style={{
						cursor,
						backgroundImage: showGrid ? 'radial-gradient(var(--board-dot) 1.2px, transparent 1.2px)' : undefined,
						backgroundSize: `${gridSize}px ${gridSize}px`,
						backgroundPosition: `${camera.x}px ${camera.y}px`,
					}}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={onPointerUp}
					onPointerLeave={() => sendCursor(null)}
					onDoubleClick={onDoubleClick}
					onDragOver={(e) => {
						if (readOnly || !e.dataTransfer.types.some((t) => t === 'Files' || t === 'text/uri-list')) return
						e.preventDefault()
						setDropping(true)
					}}
					onDragLeave={(e) => {
						if (e.currentTarget === e.target) setDropping(false)
					}}
					onDrop={(e) => {
						setDropping(false)
						if (readOnly) return
						e.preventDefault()
						const at = toWorld(cameraRef.current, localPoint(e))
						const files = [...e.dataTransfer.files]
						if (files.length) return void insertFiles(files, at, true)
						const media = parseMediaUrl(e.dataTransfer.getData('text/uri-list').split('\n')[0] ?? '')
						if (media) insertMedia([media], at, true)
					}}
					onContextMenu={(e) => e.preventDefault()}
				>
					<div
						className="absolute top-0 left-0 origin-top-left"
						style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
					>
						{drawn.map((el) =>
							el.type === 'connector' ? (
								<ConnectorView
									key={el.id}
									el={el}
									ends={endsFor(el)}
									dark={dark}
									editing={editing === el.id}
									onLabel={onLabel}
									onEditEnd={finishEditing}
								/>
							) : el.type === 'frame' ? (
								<FrameView
									key={el.id}
									el={el}
									zoom={camera.zoom}
									dark={dark}
									editing={editing === el.id}
									onTitle={onTitle}
									onEditEnd={finishEditing}
								/>
							) : el.type === 'media' ? (
								<MediaView key={el.id} el={el} dark={dark} active={!d && liveSelection.length === 1 && liveSelection[0] === el.id} />
							) : el.type === 'draw' ? (
								<DrawView key={el.id} el={el} dark={dark} />
							) : (
								<BoxView key={el.id} el={el} dark={dark} editing={editing === el.id} onText={onText} onEditEnd={finishEditing} />
							),
						)}
						{d?.kind === 'ink' && (
							<svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }} width={1} height={1} aria-hidden>
								<path
									d={inkPath(d.points.flatMap((p) => [p.x, p.y]))}
									fill="none"
									stroke={resolveStroke(inkStyle.color, dark)}
									strokeOpacity={ink.mode === 'highlighter' ? 0.4 : 1}
									strokeWidth={inkWidth}
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						)}
						{connectPreview && (
							<svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }} width={1} height={1} aria-hidden>
								<path
									d={connectPreview.path}
									fill="none"
									stroke="#c01c37"
									strokeWidth={2 / camera.zoom}
									strokeDasharray={`${6 / camera.zoom} ${4 / camera.zoom}`}
								/>
							</svg>
						)}
					</div>

					{/* overlays in screen space */}
					<div className="pointer-events-none absolute inset-0">
						<RemoteSelections peers={peers} elements={elements} camera={camera} />
						{enteredBounds && (
							<div
								className="absolute rounded-md border border-dashed border-gray-400 dark:border-gray-500"
								style={screenRect({
									x: enteredBounds.x - 12 / camera.zoom,
									y: enteredBounds.y - 12 / camera.zoom,
									w: enteredBounds.w + 24 / camera.zoom,
									h: enteredBounds.h + 24 / camera.zoom,
								})}
							/>
						)}
						{anyLocked && selectionBounds && !d && (
							<div
								className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gray-900 text-white shadow dark:bg-gray-100 dark:text-gray-900"
								style={{
									left: toScreen(camera, selectionBounds).x + selectionBounds.w * camera.zoom,
									top: toScreen(camera, selectionBounds).y,
								}}
								title="Locked"
							>
								<Lock size={11} strokeWidth={2.5} />
							</div>
						)}
						{highlightEl && isBox(highlightEl) && (
							<div className="absolute rounded-sm ring-2 ring-brand-500 ring-offset-2" style={screenRect(highlightEl)} />
						)}
						{selectedEls.map((el) =>
							isBox(el) ? (
								<div
									key={el.id}
									className="absolute border-2 border-brand-500"
									style={{
										...screenRect({
											x: el.x - 2 / camera.zoom,
											y: el.y - 2 / camera.zoom,
											w: el.w + 4 / camera.zoom,
											h: el.h + 4 / camera.zoom,
										}),
										...(rotationOf(el) ? { transform: `rotate(${rotationOf(el)}deg)` } : {}),
									}}
								/>
							) : null,
						)}
						{selectedEls.length > 1 && selectionBounds && (
							<div
								className="absolute border border-dashed border-brand-500"
								style={screenRect({
									x: selectionBounds.x - 6 / camera.zoom,
									y: selectionBounds.y - 6 / camera.zoom,
									w: selectionBounds.w + 12 / camera.zoom,
									h: selectionBounds.h + 12 / camera.zoom,
								})}
							/>
						)}
						{selectedEls.length > 1 &&
							selectionBounds &&
							!readOnly &&
							!anyLocked &&
							!d &&
							HANDLES.map((h) => {
								const s = toScreen(camera, handlePoint(selectionBounds, h))
								return (
									<div
										key={h}
										data-handle={`scale:${h}`}
										title="Drag to resize everything selected"
										className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-brand-500 bg-white"
										style={{ left: s.x, top: s.y, cursor: handleCursor(h, 0) }}
									/>
								)
							})}
						{single && isBox(single) && !readOnly && !single.locked && editing !== single.id && (
							<>
								{HANDLES.map((h) => {
									const p = rotatePoint(handlePoint(single, h), center(single), rotationOf(single))
									const s = toScreen(camera, p)
									return (
										<div
											key={h}
											data-handle={`resize:${h}`}
											className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-brand-500 bg-white"
											style={{ left: s.x, top: s.y, cursor: handleCursor(h, rotationOf(single)) }}
										/>
									)
								})}
								{single.type !== 'frame' &&
									(() => {
										const c = center(single)
										const r = rotationOf(single)
										// beyond the top right corner: clear of the connect handles and the toolbar
										const top = rotatePoint({ x: single.x + single.w + 18 / camera.zoom, y: single.y - 18 / camera.zoom }, c, r)
										const s = toScreen(camera, top)
										return (
											<div
												data-handle="rotate:0"
												title={`Rotate (Shift: 15° steps)${r ? ` · ${Math.round(r)}°` : ''}`}
												className="pointer-events-auto absolute flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-brand-500 bg-white text-brand-600"
												style={{ left: s.x, top: s.y }}
											>
												<RotateCw size={11} strokeWidth={3} />
											</div>
										)
									})()}
								{d?.kind === 'rotate' && (
									<div
										className="absolute -translate-x-1/2 rounded bg-gray-900 px-1.5 py-0.5 text-xs text-white tabular-nums"
										style={{ left: toScreen(camera, center(single)).x, top: toScreen(camera, center(single)).y }}
									>
										{Math.round(rotationOf(single))}°
									</div>
								)}
								{single.type !== 'frame' &&
									single.type !== 'draw' &&
									SIDES.map((side) => {
										const p = toScreen(camera, sidePoint(single, side))
										const off = 22
										const normal = rotatePoint(
											side === 'top'
												? { x: 0, y: -1 }
												: side === 'bottom'
													? { x: 0, y: 1 }
													: side === 'left'
														? { x: -1, y: 0 }
														: { x: 1, y: 0 },
											{ x: 0, y: 0 },
											rotationOf(single),
										)
										const pos = { x: p.x + normal.x * off, y: p.y + normal.y * off }
										return (
											<div
												key={side}
												data-handle={`connect:${side}`}
												title="Drag to connect"
												className="pointer-events-auto absolute flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border-2 border-brand-500 bg-white text-[10px] leading-none font-bold text-brand-600 hover:scale-125"
												style={{ left: pos.x, top: pos.y }}
											>
												+
											</div>
										)
									})}
							</>
						)}
						{single?.type === 'connector' &&
							!readOnly &&
							!single.locked &&
							(() => {
								const g = connectorGeometry(single, elements)
								return (['from', 'to'] as const).map((which) => {
									const s = toScreen(camera, which === 'from' ? g.start : g.end)
									const attachedEnd = !!single[which].id
									return (
										<div
											key={which}
											data-handle={`end:${which}`}
											title="Drag to reconnect"
											className={`pointer-events-auto absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-brand-500 ${attachedEnd ? 'bg-brand-500' : 'bg-white'}`}
											style={{ left: s.x, top: s.y }}
										/>
									)
								})
							})()}
						{d?.kind === 'marquee' && (
							<div
								className="absolute border border-brand-500 bg-brand-500/10"
								style={screenRect(rectFromPoints(d.startWorld, d.current))}
							/>
						)}
						{d?.kind === 'create' && (
							<div
								className="absolute border-2 border-dashed border-brand-500"
								style={screenRect(rectFromPoints(d.startWorld, d.current))}
							/>
						)}
						<VoteBadges session={session.session} state={session} elements={elements} camera={camera} userId={user.id} />
						{sparkyReady && (
							<LinkBadges elements={elements} results={linkResults.results} camera={camera} open={openLinks} onOpen={setOpenLinks} />
						)}
						{sparkyReady && openLinks && elements.get(openLinks) && (
							<LinksPopover
								el={elements.get(openLinks)!}
								results={linkResults.results}
								info={sparky!}
								camera={camera}
								elements={elements}
								buildNumber={linkResults.build?.buildNumber}
								onHistory={(n) => {
									setPanel(null)
									setCaseHistory(n)
								}}
								onClose={() => setOpenLinks(null)}
							/>
						)}
						<IssueBadges elements={elements} camera={camera} />
						{snapShown && <SnapOverlay shown={snapShown} camera={camera} />}
						<CommentPins
							threads={comments.threads}
							elements={elements}
							camera={camera}
							openId={openThread}
							showResolved={panel === 'comments' && showResolved}
							onOpen={(id) => {
								setComposer(null)
								setOpenThread(id)
							}}
						/>
						<LaserOverlay trail={laser} peers={peers} camera={camera} publish={publishLaser} />
						<RemoteCursors peers={peers} camera={camera} />
					</div>
				</div>

				{uploads.length > 0 && (
					<div data-ui className="absolute bottom-16 left-1/2 z-20 w-72 max-w-[calc(100%-32px)] -translate-x-1/2 space-y-1.5">
						{uploads.map((u) => (
							<div
								key={u.id}
								role="status"
								className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate font-medium">{u.name}</span>
									{u.error ? (
										<button
											type="button"
											className="text-gray-500 hover:text-gray-900 dark:hover:text-white"
											onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
										>
											Dismiss
										</button>
									) : (
										<span className="tabular-nums text-gray-500">{Math.round(u.progress * 100)}%</span>
									)}
								</div>
								{u.error ? (
									<p className="mt-1 text-red-600 dark:text-red-400">{u.error}</p>
								) : (
									<div className="mt-1.5 h-1 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
										<div className="h-full bg-brand-600 transition-[width]" style={{ width: `${u.progress * 100}%` }} />
									</div>
								)}
							</div>
						))}
					</div>
				)}
				{dropping && (
					<div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-500 bg-brand-500/5 text-sm font-medium text-brand-700 dark:text-brand-300">
						Drop images, videos or PDFs to add them to the board
					</div>
				)}

				{(session.timer || session.voting || showRanking) && (
					<div data-ui className="absolute top-3 left-1/2 z-20 flex max-w-[calc(100%-120px)] -translate-x-1/2 flex-col items-center gap-2">
						<TimerPill session={session.session} state={session} canControl={!readOnly} />
						<VotingBanner
							session={session.session}
							state={session}
							canControl={!readOnly}
							onResults={() => setShowRanking(!showRanking)}
							onSummary={() => openPanel('retro')}
						/>
						{showRanking && session.voting && !session.voting.active && (
							<VoteRanking
								state={session}
								elements={elements}
								onClose={() => setShowRanking(false)}
								onPick={(id) => {
									setSelection([id])
									fit([id])
								}}
							/>
						)}
					</div>
				)}
				{followed && (
					<div className="pointer-events-none absolute inset-0 z-10 border-4" style={{ borderColor: followed.user.color }} aria-hidden />
				)}
				{(followed || presentingMine || (presenting && presenterHere && !presentingMine && leftPresentation === presenting.id)) && (
					<div
						data-ui
						role="status"
						className="absolute bottom-16 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pr-1 pl-3 text-sm whitespace-nowrap shadow-lg sm:bottom-3 dark:border-gray-700 dark:bg-gray-900"
					>
						{presentingMine ? (
							<>
								<Presentation size={16} className="shrink-0 text-brand-600" />
								<span className="truncate">You're presenting</span>
								{slides.length > 0 && (
									<span className="flex items-center gap-0.5">
										<button
											type="button"
											onClick={() => goSlide(slide - 1)}
											disabled={slide <= 0}
											className="rounded-full p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
											title="Previous frame (←)"
										>
											<ChevronLeft size={16} />
											<span className="sr-only">Previous frame</span>
										</button>
										<span className="text-xs tabular-nums">
											{slide + 1} / {slides.length}
										</span>
										<button
											type="button"
											onClick={() => goSlide(slide + 1)}
											disabled={slide >= slides.length - 1}
											className="rounded-full p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
											title="Next frame (→)"
										>
											<ChevronRight size={16} />
											<span className="sr-only">Next frame</span>
										</button>
									</span>
								)}
								<button
									type="button"
									onClick={stopPresenting}
									className="rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
								>
									Stop presenting
								</button>
							</>
						) : followed ? (
							<>
								<Eye size={16} className="shrink-0" style={{ color: followed.user.color }} />
								<span className="truncate">
									{following === null && presenting ? `${followed.user.name} is presenting` : `Following ${followed.user.name}`}
								</span>
								<button
									type="button"
									onClick={() => stopFollowRef.current()}
									className="rounded-full px-3 py-1 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
								>
									Stop (Esc)
								</button>
							</>
						) : (
							presenting && (
								<>
									<Presentation size={16} className="shrink-0" style={{ color: presenting.color }} />
									<span className="truncate">{presenting.name} is presenting</span>
									<button
										type="button"
										onClick={() => setLeftPresentation(null)}
										className="rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
									>
										Follow along
									</button>
								</>
							)
						)}
					</div>
				)}
				{searchOpen && (
					<SearchBar elements={elements} threads={comments.threads} pin={searchPin} onGo={goToMatch} onClose={() => setSearchOpen(false)} />
				)}
				{composer &&
					(() => {
						const p = pinPoint(composer, elements)
						return p ? (
							<Composer
								boardId={boardId}
								anchor={composer}
								at={toScreen(camera, p)}
								viewport={size}
								onCancel={() => setComposer(null)}
								onDone={(id) => {
									setComposer(null)
									void comments.reload().then(() => setOpenThread(id))
								}}
							/>
						) : null
					})()}
				{openThread !== null &&
					(() => {
						const thread = comments.threads.find((t) => t.id === openThread)
						const p = thread && pinPoint(thread, elements)
						return thread && p ? (
							<ThreadPopover
								boardId={boardId}
								thread={thread}
								at={toScreen(camera, p)}
								viewport={size}
								userId={user.id}
								canModerate={!readOnly}
								onChanged={() => void comments.reload()}
								onClose={() => setOpenThread(null)}
							/>
						) : null
					})()}
				{!panel && caseHistory === null && !guest && (
					<div data-ui className="absolute top-3 right-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap justify-end gap-2">
						<button
							type="button"
							onClick={() => setPanel('comments')}
							title="Comments (C to add one)"
							className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
						>
							<MessageSquare size={16} /> <span className="hidden sm:inline">Comments</span>
							{comments.threads.some((t) => !t.resolvedAt) && (
								<span className="rounded-full bg-brand-600 px-1.5 text-xs text-white tabular-nums">
									{comments.threads.filter((t) => !t.resolvedAt).length}
								</span>
							)}
							<span className="sr-only sm:hidden">Comments</span>
						</button>
						{!readOnly && !presenting && (
							<button
								type="button"
								onClick={startPresenting}
								title={
									slides.length ? 'Present: everyone follows your view; ← → go through the frames' : 'Present: everyone follows your view'
								}
								className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
							>
								<Presentation size={16} /> <span className="hidden sm:inline">Present</span>
								<span className="sr-only sm:hidden">Present</span>
							</button>
						)}
						<button
							type="button"
							onClick={() => setPanel('history')}
							title="Version history"
							className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
						>
							<History size={16} /> <span className="hidden sm:inline">History</span>
							<span className="sr-only sm:hidden">Version history</span>
						</button>
						<button
							type="button"
							onClick={() => setPanel('rules')}
							className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
						>
							<Zap size={16} /> Rules
						</button>
						{confluenceReady && !readOnly && (
							<button
								type="button"
								onClick={() => setPublishing('')}
								className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
							>
								<BookOpenText size={16} /> Publish
							</button>
						)}
						{sparkyReady && (
							<button
								type="button"
								onClick={() => setShowCoverage(true)}
								className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
							>
								<FlaskConical size={16} /> Coverage
							</button>
						)}
					</div>
				)}
				{panel === 'comments' && (
					<CommentsPanel
						threads={comments.threads}
						elements={elements}
						showResolved={showResolved}
						onShowResolved={setShowResolved}
						onNew={() => {
							setTool('comment')
							setPanel(null)
						}}
						onShow={(t) => {
							const p = pinPoint(t, elements)
							if (!p) return
							setCamera((c) => ({ ...c, x: (size.w - 384) / 2 - p.x * c.zoom, y: size.h / 2 - p.y * c.zoom }))
							setComposer(null)
							setOpenThread(t.id)
						}}
						onClose={() => setPanel(null)}
					/>
				)}
				{sparkyReady && caseHistory !== null && !panel && (
					<TestCasePanel projectId={projectId} info={sparky!} testCaseNumber={caseHistory} onClose={() => setCaseHistory(null)} />
				)}
				{panel === 'history' && <HistoryPanel boardId={boardId} readOnly={readOnly} dark={dark} onClose={() => setPanel(null)} />}
				{panel === 'rules' && (
					<RulesPanel
						boardId={boardId}
						elements={elements}
						readOnly={readOnly}
						sparky={{ connected: sparkyReady, canWrite: canWriteSparky(sparky) }}
						onShow={(id) => {
							setSelection([id])
							fit([id])
						}}
						onClose={() => setPanel(null)}
					/>
				)}
				{generating !== null && sparky && (
					<GenerateTestsDialog
						boardId={boardId}
						boardName={boardName}
						elements={elements}
						store={store}
						info={sparky}
						initialFrameId={generating || null}
						onClose={() => setGenerating(null)}
					/>
				)}
				{panel === 'retro' && (
					<RetroPanel
						store={store}
						elements={elements}
						boardId={boardId}
						votes={session.counts}
						voters={session.voters}
						readOnly={readOnly}
						canPublish={confluenceReady && !readOnly}
						onPublish={(scopeId, sections) => {
							setPublishSummary(sections)
							setPublishing(scopeId)
						}}
						onShow={(id) => {
							setSelection([id])
							fit([id])
						}}
						onClose={() => setPanel(null)}
					/>
				)}
				{publishing !== null && confluence && (
					<PublishDialog
						boardId={boardId}
						boardName={boardName}
						projectId={projectId}
						elements={elements}
						confluence={confluence}
						withCoverage={sparkyReady}
						initialFrameId={publishing || null}
						summary={publishSummary}
						onClose={() => {
							setPublishing(null)
							setPublishSummary(null)
						}}
					/>
				)}
				{sparkyReady && showCoverage && (
					<CoveragePanel
						projectId={projectId}
						info={sparky!}
						elements={elements}
						boardName={boardName}
						onGenerate={readOnly ? undefined : (frameId) => setGenerating(frameId ?? '')}
						onClose={() => setShowCoverage(false)}
						onShow={(id) => {
							setSelection([id])
							fit([id])
						}}
					/>
				)}
				{showTemplates && (
					<TemplatePicker
						projectId={projectId}
						boardId={boardId}
						userId={user.id}
						owner={owner}
						onClose={() => setShowTemplates(false)}
						onSaveBoard={() => {
							setShowTemplates(false)
							setSavingTemplate({ frameId: null })
						}}
						onInsert={async (items) => {
							await insertItems(items)
							setShowTemplates(false)
						}}
					/>
				)}
				{savingTemplate && (
					<SaveTemplateDialog
						projectId={projectId}
						elements={elements}
						frameId={savingTemplate.frameId}
						boardName={boardName}
						onClose={() => setSavingTemplate(null)}
					/>
				)}

				{elements.size === 0 && !readOnly && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-gray-500">
						Pick a tool on the left to add sticky notes, shapes, text and connectors.
						<br />
						Double-click the board to write.
					</div>
				)}

				{!readOnly && (
					<Toolbar
						tool={tool}
						shapeKind={shapeKind}
						ink={ink}
						onInk={setInk}
						onTool={setTool}
						onShape={(kind) => {
							setShapeKind(kind)
							setTool('shape')
						}}
						onUndo={() => store.undo.undo()}
						onRedo={() => store.undo.redo()}
						onFiles={(files) => insertFiles(files, viewCenter())}
						onLink={(url) => {
							const pageId = confluencePageId(url, confluence)
							if (pageId) {
								void insertConfluence(pageId, viewCenter())
								return null
							}
							const media = parseMediaUrl(url)
							if (!media) return 'Paste a web address starting with http:// or https://'
							insertMedia([media], viewCenter())
							return null
						}}
						onTemplates={() => setShowTemplates(true)}
						confluence={
							confluenceReady
								? {
										search: (q) => searchConfluence(projectId, q),
										onPick: (page) => void insertConfluence(page.id, viewCenter(), page.title),
									}
								: undefined
						}
						facilitation={
							<FacilitationMenu session={session.session} state={session} userName={user.displayName} onRetro={() => openPanel('retro')} />
						}
					/>
				)}
				<ZoomControls
					zoom={camera.zoom}
					onZoom={(f) => zoomBy(f)}
					onReset={() => {
						stopFollowRef.current()
						setCamera((c) => zoomAt(c, { x: size.w / 2, y: size.h / 2 }, 1))
					}}
					onFit={() => {
						stopFollowRef.current()
						fit()
					}}
				>
					<button
						type="button"
						aria-pressed={gridOn}
						title={gridOn ? 'Snapping to the grid (Alt while dragging moves freely)' : 'Snap to the grid'}
						onClick={() => {
							writeFlag('co-bord:grid', !gridOn)
							setGridOn(!gridOn)
						}}
						className={`flex size-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 ${gridOn ? 'bg-gray-100 text-brand-600 dark:bg-gray-800 dark:text-brand-300' : 'text-gray-700 dark:text-gray-200'}`}
					>
						<Grid3x3 size={16} />
						<span className="sr-only">Snap to the grid</span>
					</button>
					<button
						type="button"
						aria-pressed={minimapOn}
						title={minimapOn ? 'Hide the minimap' : 'Show the minimap'}
						onClick={() => {
							writeFlag('co-bord:minimap', !minimapOn)
							setMinimapOn(!minimapOn)
						}}
						className={`flex size-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 ${minimapOn ? 'bg-gray-100 text-brand-600 dark:bg-gray-800 dark:text-brand-300' : 'text-gray-700 dark:text-gray-200'}`}
					>
						<MapIcon size={16} />
						<span className="sr-only">Minimap</span>
					</button>
					<FramesMenu
						frames={frames}
						onPick={(id) => {
							setSelection([id])
							fit([id])
						}}
					/>
				</ZoomControls>
				{minimapOn && elements.size > 0 && (
					<Minimap
						elements={elements}
						camera={camera}
						viewport={size}
						peers={peers}
						dark={dark}
						onMove={(p) => {
							stopFollowRef.current()
							setCamera((c) => ({ ...c, x: size.w / 2 - p.x * c.zoom, y: size.h / 2 - p.y * c.zoom }))
						}}
					/>
				)}
				{!readOnly && selectedEls.length > 0 && selectionBounds && !d && editing === null && (
					<ContextToolbar
						store={store}
						selected={selectedEls}
						anchor={screenRect(selectionBounds)}
						viewport={size}
						onDelete={deleteSelection}
						onDuplicate={duplicate}
						onLock={toggleLock}
						onGroup={unitCount(liveSelection, entered, elements) > 1 ? groupSelection : undefined}
						onUngroup={selectedGroups(liveSelection, entered, elements).length ? ungroupSelection : undefined}
						onEditText={() => single && startEditing(single.id)}
						onWrapInFrame={wrapInFrame}
						onExportFrame={exportFrame}
						onPublishFrame={confluenceReady ? (id) => setPublishing(id) : undefined}
						onGenerateTests={sparkyReady ? (id) => setGenerating(id) : undefined}
						onSaveTemplate={(id) => setSavingTemplate({ frameId: id })}
						onCreateIssue={
							jiraReady
								? (id) => api(`/api/boards/${boardId}/elements/${encodeURIComponent(id)}/jira`, { method: 'POST' }).then(() => undefined)
								: undefined
						}
						following={single ? follows.elements.has(single.id) : false}
						onToggleFollow={single && single.type !== 'connector' ? () => follows.toggleElement(single.id) : undefined}
						linkEditor={
							sparkyReady
								? (el) => (
										<LinkEditor
											projectId={projectId}
											links={'links' in el ? (el.links ?? []) : []}
											onChange={(links) => {
												store.checkpoint()
												store.update([[el.id, { links }]])
												store.checkpoint()
											}}
										/>
									)
								: undefined
						}
					/>
				)}
			</div>
		</MediaSyncContext.Provider>
	)
}

function handlePoint(el: Rect, h: Handle): Point {
	const x = h.includes('w') ? el.x : h.includes('e') ? el.x + el.w : el.x + el.w / 2
	const y = h.includes('n') ? el.y : h.includes('s') ? el.y + el.h : el.y + el.h / 2
	return { x, y }
}

function resize(o: BoxElement, h: Handle, dx: number, dy: number, keepRatio: boolean): Partial<BoxElement> {
	let left = o.x
	let top = o.y
	let right = o.x + o.w
	let bottom = o.y + o.h
	if (h.includes('w')) left = Math.min(o.x + dx, right - MIN_SIZE)
	if (h.includes('e')) right = Math.max(o.x + o.w + dx, left + MIN_SIZE)
	if (h.includes('n')) top = Math.min(o.y + dy, bottom - MIN_SIZE)
	if (h.includes('s')) bottom = Math.max(o.y + o.h + dy, top + MIN_SIZE)
	if (keepRatio && h.length === 2) {
		const scale = Math.max((right - left) / o.w, (bottom - top) / o.h)
		const w = o.w * scale
		const hh = o.h * scale
		if (h.includes('w')) left = right - w
		else right = left + w
		if (h.includes('n')) top = bottom - hh
		else bottom = top + hh
	}
	return { x: Math.round(left), y: Math.round(top), w: Math.round(right - left), h: Math.round(bottom - top) }
}

/** Alignment guides and equal-gap markers, in screen space. */
function SnapOverlay({ shown, camera }: { shown: { guides: Guide[]; gaps: Gap[] }; camera: Camera }) {
	const color = '#e11d48'
	return (
		<svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
			{shown.guides.map((g, i) => {
				const a = toScreen(camera, g.axis === 'x' ? { x: g.at, y: g.from } : { x: g.from, y: g.at })
				const b = toScreen(camera, g.axis === 'x' ? { x: g.at, y: g.to } : { x: g.to, y: g.at })
				return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1} strokeDasharray="4 3" />
			})}
			{shown.gaps.flatMap((gap, i) =>
				gap.spans.map((span, j) => {
					const a = toScreen(camera, gap.axis === 'x' ? { x: span.from, y: span.at } : { x: span.at, y: span.from })
					const b = toScreen(camera, gap.axis === 'x' ? { x: span.to, y: span.at } : { x: span.at, y: span.to })
					const tick = gap.axis === 'x' ? { x: 0, y: 5 } : { x: 5, y: 0 }
					return (
						<g key={`${i}-${j}`} stroke={color} strokeWidth={1.5}>
							<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
							<line x1={a.x - tick.x} y1={a.y - tick.y} x2={a.x + tick.x} y2={a.y + tick.y} />
							<line x1={b.x - tick.x} y1={b.y - tick.y} x2={b.x + tick.x} y2={b.y + tick.y} />
						</g>
					)
				}),
			)}
		</svg>
	)
}

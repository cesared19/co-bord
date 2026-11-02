import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoxView, ConnectorView, FrameView } from './ElementView'
import { FacilitationMenu, TimerPill, VoteBadges, VoteRanking, VotingBanner } from './Facilitation'
import { useServerClock, useSession } from './session'
import { TemplatePicker } from './TemplatePicker'
import { boardLinks, type SparkyInfo, useLinkResults } from './sparky'
import { CoveragePanel, LinkBadges, LinkEditor, LinksPopover } from './SparkyLinks'
import { FlaskConical } from 'lucide-react'
import type { Template } from './templates'
import { download, renderPng } from './exportPng'
import { ContextToolbar } from './ContextToolbar'
import { fitSize, keepsRatio, MEDIA_HEADER, type NewMedia, parseMediaUrl } from './media'
import { MediaView } from './MediaView'
import { readMediaSize, uploadAsset } from './upload'
import {
	type ConnectorGeometry,
	connectorGeometry,
	contains,
	elementBounds,
	type ElementMap,
	fitCamera,
	intersects,
	rectFromPoints,
	type Side,
	sidePoint,
	toScreen,
	toWorld,
	unionBounds,
	withFrameContents,
	zoomAt,
} from './geometry'
import { RemoteCursors, RemoteSelections } from './Presence'
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
const CLIPBOARD_PREFIX = 'co-bord/elements:'

type Drag =
	| { kind: 'pan'; startScreen: Point; startCam: Camera }
	| { kind: 'move'; startWorld: Point; originals: BoardElement[]; moved: boolean; clickedId: string; collapseTo: string | null }
	| { kind: 'resize'; handle: Handle; original: BoxElement; startWorld: Point; keepRatio: boolean }
	| { kind: 'marquee'; startWorld: Point; current: Point; base: string[] }
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
	jumpTo: Peer | null
	user: { id: number; displayName: string }
	boardName: string
	projectId: number
	/** The project's SparkyTC connection, once loaded. */
	sparky: SparkyInfo | null
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

export function Canvas({ store, elements, peers, provider, readOnly, boardId, dark, jumpTo, user, boardName, projectId, sparky }: Props) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [size, setSize] = useState({ w: 0, h: 0 })
	const savedCamera = useRef(loadCamera(boardId))
	const [camera, setCamera] = useState<Camera>(savedCamera.current ?? { x: 0, y: 0, zoom: 1 })
	const [tool, setTool] = useState<Tool>('select')
	const [shapeKind, setShapeKind] = useState<ShapeKind>('rect')
	const [selection, setSelection] = useState<string[]>([])
	const [editing, setEditing] = useState<string | null>(null)
	const [, setTick] = useState(0)
	const drag = useRef<Drag | null>(null)
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

	useEffect(() => {
		const target = jumpTo && peers.find((p) => p.clientId === jumpTo.clientId)?.cursor
		if (target) setCamera((c) => ({ ...c, x: size.w / 2 - target.x * c.zoom, y: size.h / 2 - target.y * c.zoom }))
		// only when a teammate is picked, not on every cursor move
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [jumpTo])

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

	// SparkyTC: results of everything linked on the board, in the current build
	const sparkyReady = !!sparky?.connected && !sparky.error
	const allLinks = useMemo(() => boardLinks(elements.values()), [elements])
	const linkResults = useLinkResults(projectId, allLinks, sparkyReady)
	const [openLinks, setOpenLinks] = useState<string | null>(null)
	const [showCoverage, setShowCoverage] = useState(false)

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
			.filter((el): el is BoxElement => isBox(el) && el.type !== 'frame')
			.sort((a, b) => b.z - a.z)
		return list.find((el) => el.id !== exclude && contains(el, p)) ?? null
	}, [])

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
			if (readOnly || !el || el.type === 'media') return
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
		store.checkpoint()
		store.remove(selectionRef.current)
		setSelection([])
	}, [readOnly, store])

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

	const duplicate = useCallback(() => {
		if (readOnly) return
		const items = detachedSelection()
		if (!items.length) return
		store.checkpoint()
		setSelection(store.clone(items, { x: 24, y: 24 }, new Map(items.map((el) => [el.id, el]))))
	}, [readOnly, store, detachedSelection])

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

	const insertTemplate = useCallback(
		(template: Template) => {
			if (readOnly) return
			const items = template.build()
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
		[readOnly, store, size, freeSpot],
	)

	// ---------- camera ----------

	const zoomBy = useCallback(
		(factor: number, at?: Point) => {
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

	useEffect(() => {
		const el = containerRef.current
		if (!el) return
		const onWheel = (e: WheelEvent) => {
			e.preventDefault()
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
				}
			} else if (type === 'connect' && isBox(selected)) {
				drag.current = {
					kind: 'connect',
					from: { id: selected.id, ...sidePoint(selected, value as Side) },
					startWorld: world,
					current: world,
					target: null,
				}
			} else if (type === 'end' && selected?.type === 'connector') {
				drag.current = { kind: 'endpoint', id: selected.id, which: value as 'from' | 'to', target: null }
			}
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
				from: box ? { id: box.id, x: world.x, y: world.y } : { x: world.x, y: world.y },
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
			if (voting && !readOnly && target && target.type !== 'connector' && target.type !== 'frame' && !e.shiftKey) {
				session.session.vote(user.id, id)
				return
			}
			const current = selectionRef.current
			let next = current
			let collapseTo: string | null = null
			if (e.shiftKey || e.metaKey || e.ctrlKey) next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
			else if (!current.includes(id)) next = [id]
			else if (current.length > 1) collapseTo = id
			setSelection(next)
			if (readOnly || !next.includes(id)) return
			store.checkpoint()
			const all = elementsRef.current
			drag.current = {
				kind: 'move',
				startWorld: world,
				originals: withFrameContents(next, all)
					.map((x) => all.get(x))
					.filter((x): x is BoardElement => !!x),
				moved: false,
				clickedId: id,
				collapseTo,
			}
		} else {
			const base = e.shiftKey ? selectionRef.current : []
			if (!e.shiftKey) setSelection([])
			drag.current = { kind: 'marquee', startWorld: world, current: world, base }
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
				const dx = world.x - d.startWorld.x
				const dy = world.y - d.startWorld.y
				if (!d.moved && Math.hypot(dx, dy) * cameraRef.current.zoom < 3) return
				d.moved = true
				store.update(
					d.originals.map((el): [string, Partial<BoardElement>] => {
						if (isBox(el)) return [el.id, { x: Math.round(el.x + dx), y: Math.round(el.y + dy) }]
						const shift = (end: Endpoint) => (end.id && elementsRef.current.has(end.id) ? end : { ...end, x: end.x + dx, y: end.y + dy })
						return [el.id, { from: shift(el.from), to: shift(el.to) } as Partial<ConnectorElement>]
					}),
				)
				return
			}
			case 'resize':
				store.update([
					[d.original.id, resize(d.original, d.handle, world.x - d.startWorld.x, world.y - d.startWorld.y, d.keepRatio || e.shiftKey)],
				])
				return
			case 'marquee': {
				d.current = world
				const r = rectFromPoints(d.startWorld, world)
				const all = elementsRef.current
				// frames only when the box covers them whole, so selecting inside a frame doesn't pick it
				const hit = [...all.values()]
					.filter((el) => {
						const b = elementBounds(el, all)
						return el.type === 'frame' ? b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h : intersects(r, b)
					})
					.map((el) => el.id)
				setSelection([...new Set([...d.base, ...hit])])
				rerender()
				return
			}
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
				const end: Endpoint = box ? { id: box.id, x: world.x, y: world.y } : { x: world.x, y: world.y }
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
		const world = toWorld(cameraRef.current, localPoint(e))
		const zoom = cameraRef.current.zoom

		switch (d.kind) {
			case 'move':
				if (!d.moved && d.collapseTo) setSelection([d.collapseTo])
				store.checkpoint()
				break
			case 'resize':
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
				const to: Endpoint = d.target ? { id: d.target, x: world.x, y: world.y } : { x: world.x, y: world.y }
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
		const id = (e.target as Element).closest<HTMLElement>('[data-el]')?.dataset.el
		if (id) return startEditing(id)
		if (tool === 'select' && !(e.target as Element).closest('[data-handle],[data-ui]'))
			createBox('text', toWorld(cameraRef.current, localPoint(e)), true)
	}

	// ---------- keyboard and clipboard ----------

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (isTyping(e.target)) return
			const mod = e.metaKey || e.ctrlKey
			const key = e.key.toLowerCase()
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
				select([...elementsRef.current.keys()])
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
				setCamera((c) => zoomAt(c, { x: size.w / 2, y: size.h / 2 }, 1))
				return
			}
			if (mod) return
			if (e.shiftKey && e.code === 'Digit1') return fit()
			if (e.shiftKey && e.code === 'Digit2') return fit(selectionRef.current)
			switch (e.key) {
				case 'Delete':
				case 'Backspace':
					e.preventDefault()
					return deleteSelection()
				case 'Escape':
					setTool('select')
					return select([])
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
						withFrameContents(selectionRef.current, all)
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
			}
			if (tools[key] && (!readOnly || key === 'v' || key === 'h')) {
				if (key === 'r') setShapeKind('rect')
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
			const media = !/\s/.test(text.trim()) ? parseMediaUrl(text) : null
			if (media) {
				insertMedia([media], at)
				return
			}
			store.checkpoint()
			if (text.startsWith(CLIPBOARD_PREFIX)) {
				try {
					const items = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as BoardElement[]
					const source = new Map(items.map((el) => [el.id, el]))
					const bounds = unionBounds(items.map((el) => elementBounds(el, source)))
					if (!bounds) return
					const offset = { x: Math.round(at.x - bounds.x - bounds.w / 2), y: Math.round(at.y - bounds.y - bounds.h / 2) }
					setSelection(store.clone(items, offset, source))
				} catch {
					/* not ours after all */
				}
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
	}, [store, readOnly, size, select, duplicate, deleteSelection, startEditing, detachedSelection, fit, zoomBy, insertFiles, insertMedia])

	// ---------- render ----------

	const d = drag.current
	const selectedEls = liveSelection.map((id) => elements.get(id)).filter((el): el is BoardElement => !!el)
	const single = selectedEls.length === 1 ? selectedEls[0] : null
	const selectionBounds = unionBounds(selectedEls.map((el) => elementBounds(el, elements)))
	const highlight = d?.kind === 'connect' || d?.kind === 'endpoint' ? d.target : null
	const highlightEl = highlight ? elements.get(highlight) : null

	const cursor =
		d?.kind === 'pan' ? 'grabbing' : tool === 'hand' || spaceDown.current ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

	const screenRect = (r: Rect) => {
		const p = toScreen(camera, r)
		return { left: p.x, top: p.y, width: r.w * camera.zoom, height: r.h * camera.zoom }
	}

	const endsFor = (el: ConnectorElement): ElementMap => {
		const m: ElementMap = new Map()
		if (el.from.id && elements.has(el.from.id)) m.set(el.from.id, elements.get(el.from.id)!)
		if (el.to.id && elements.has(el.to.id)) m.set(el.to.id, elements.get(el.to.id)!)
		return m
	}

	let connectPreview: ConnectorGeometry | null = null
	if (d?.kind === 'connect') {
		const temp: ConnectorElement = {
			id: '__preview',
			z: 0,
			type: 'connector',
			from: d.from,
			to: d.target ? { id: d.target, ...d.current } : d.current,
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

	const gridSize = 24 * camera.zoom
	const showGrid = gridSize >= 8

	return (
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
					{sorted.map((el) =>
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
						) : (
							<BoxView key={el.id} el={el} dark={dark} editing={editing === el.id} onText={onText} onEditEnd={finishEditing} />
						),
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
					{highlightEl && isBox(highlightEl) && (
						<div className="absolute rounded-sm ring-2 ring-brand-500 ring-offset-2" style={screenRect(highlightEl)} />
					)}
					{selectedEls.map((el) =>
						isBox(el) ? (
							<div
								key={el.id}
								className="absolute border-2 border-brand-500"
								style={screenRect({
									x: el.x - 2 / camera.zoom,
									y: el.y - 2 / camera.zoom,
									w: el.w + 4 / camera.zoom,
									h: el.h + 4 / camera.zoom,
								})}
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
					{single && isBox(single) && !readOnly && editing !== single.id && (
						<>
							{HANDLES.map((h) => {
								const p = handlePoint(single, h)
								const s = toScreen(camera, p)
								return (
									<div
										key={h}
										data-handle={`resize:${h}`}
										className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-brand-500 bg-white"
										style={{ left: s.x, top: s.y, cursor: `${h}-resize` }}
									/>
								)
							})}
							{single.type !== 'frame' &&
								SIDES.map((side) => {
									const p = toScreen(camera, sidePoint(single, side))
									const off = 22
									const pos =
										side === 'top'
											? { x: p.x, y: p.y - off }
											: side === 'bottom'
												? { x: p.x, y: p.y + off }
												: side === 'left'
													? { x: p.x - off, y: p.y }
													: { x: p.x + off, y: p.y }
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
						<div className="absolute border border-brand-500 bg-brand-500/10" style={screenRect(rectFromPoints(d.startWorld, d.current))} />
					)}
					{d?.kind === 'create' && (
						<div className="absolute border-2 border-dashed border-brand-500" style={screenRect(rectFromPoints(d.startWorld, d.current))} />
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
							onClose={() => setOpenLinks(null)}
						/>
					)}
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
					<VotingBanner session={session.session} state={session} canControl={!readOnly} onResults={() => setShowRanking(!showRanking)} />
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
			{sparkyReady && !showCoverage && (
				<button
					type="button"
					data-ui
					onClick={() => setShowCoverage(true)}
					className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
				>
					<FlaskConical size={16} /> Coverage
				</button>
			)}
			{sparkyReady && showCoverage && (
				<CoveragePanel
					projectId={projectId}
					info={sparky!}
					elements={elements}
					boardName={boardName}
					onClose={() => setShowCoverage(false)}
					onShow={(id) => {
						setSelection([id])
						fit([id])
					}}
				/>
			)}
			{showTemplates && (
				<TemplatePicker
					onClose={() => setShowTemplates(false)}
					onPick={(template) => {
						setShowTemplates(false)
						insertTemplate(template)
					}}
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
					onTool={setTool}
					onShape={(kind) => {
						setShapeKind(kind)
						setTool('shape')
					}}
					onUndo={() => store.undo.undo()}
					onRedo={() => store.undo.redo()}
					onFiles={(files) => insertFiles(files, viewCenter())}
					onLink={(url) => {
						const media = parseMediaUrl(url)
						if (!media) return 'Paste a web address starting with http:// or https://'
						insertMedia([media], viewCenter())
						return null
					}}
					onTemplates={() => setShowTemplates(true)}
					facilitation={<FacilitationMenu session={session.session} state={session} userName={user.displayName} />}
				/>
			)}
			<ZoomControls
				zoom={camera.zoom}
				onZoom={(f) => zoomBy(f)}
				onReset={() => setCamera((c) => zoomAt(c, { x: size.w / 2, y: size.h / 2 }, 1))}
				onFit={() => fit()}
			>
				<FramesMenu
					frames={frames}
					onPick={(id) => {
						setSelection([id])
						fit([id])
					}}
				/>
			</ZoomControls>
			{!readOnly && selectedEls.length > 0 && selectionBounds && !d && editing === null && (
				<ContextToolbar
					store={store}
					selected={selectedEls}
					anchor={screenRect(selectionBounds)}
					viewport={size}
					onDelete={deleteSelection}
					onDuplicate={duplicate}
					onEditText={() => single && startEditing(single.id)}
					onWrapInFrame={wrapInFrame}
					onExportFrame={exportFrame}
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

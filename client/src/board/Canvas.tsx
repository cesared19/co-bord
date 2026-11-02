import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoxView, ConnectorView } from './ElementView'
import { ContextToolbar } from './ContextToolbar'
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
	zoomAt,
} from './geometry'
import { RemoteCursors, RemoteSelections } from './Presence'
import type { BoardStore } from './store'
import { Toolbar, ZoomControls } from './Toolbar'
import {
	type BoardElement,
	type BoxElement,
	type Camera,
	type ConnectorElement,
	defaultElement,
	type Endpoint,
	isBox,
	type Point,
	type Rect,
	type ShapeKind,
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
	| { kind: 'create'; type: 'shape' | 'sticky' | 'text'; startWorld: Point; current: Point }
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

export function Canvas({ store, elements, peers, provider, readOnly, boardId, dark, jumpTo }: Props) {
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

	const sorted = useMemo(() => [...elements.values()].sort((a, b) => a.z - b.z), [elements])

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
		const list = [...elementsRef.current.values()].filter(isBox).sort((a, b) => b.z - a.z)
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
			if (el && isBox(el) && !el.text.trim()) store.remove([id])
		}
		store.checkpoint()
	}, [store])

	const onText = useCallback(
		(id: string, text: string, height?: number) => {
			const el = store.get(id)
			if (!el || !isBox(el)) return
			const patch: Partial<BoxElement> = { text }
			if (height !== undefined && el.type === 'text') patch.h = Math.max(32, Math.ceil(height))
			store.update([[id, patch]])
		},
		[store],
	)

	const onLabel = useCallback((id: string, label: string) => store.update([[id, { label }]]), [store])

	const startEditing = useCallback(
		(id: string) => {
			if (readOnly) return
			store.checkpoint()
			setSelection([id])
			setEditing(id)
		},
		[readOnly, store],
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
		const ids = new Set(selectionRef.current)
		return selectionRef.current
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
					keepRatio: selected.type === 'sticky',
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

		if (tool === 'sticky' || tool === 'text' || tool === 'shape') {
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
				originals: next.map((x) => all.get(x)).filter((x): x is BoardElement => !!x),
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
				const hit = [...all.values()].filter((el) => intersects(r, elementBounds(el, all))).map((el) => el.id)
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
				createBox(d.type, rect, d.type !== 'shape')
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
						selectionRef.current
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
			const tools: Record<string, Tool> = { v: 'select', h: 'hand', n: 'sticky', t: 'text', s: 'shape', r: 'shape', l: 'connector' }
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
			const text = e.clipboardData?.getData('text/plain') ?? ''
			if (!text) return
			e.preventDefault()
			const at = lastWorld.current ?? toWorld(cameraRef.current, { x: size.w / 2, y: size.h / 2 })
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
	}, [store, readOnly, size, select, duplicate, deleteSelection, startEditing, detachedSelection, fit, zoomBy])

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
							{SIDES.map((side) => {
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
					<RemoteCursors peers={peers} camera={camera} />
				</div>
			</div>

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
				/>
			)}
			<ZoomControls
				zoom={camera.zoom}
				onZoom={(f) => zoomBy(f)}
				onReset={() => setCamera((c) => zoomAt(c, { x: size.w / 2, y: size.h / 2 }, 1))}
				onFit={() => fit()}
			/>
			{!readOnly && selectedEls.length > 0 && selectionBounds && !d && editing === null && (
				<ContextToolbar
					store={store}
					selected={selectedEls}
					anchor={screenRect(selectionBounds)}
					viewport={size}
					onDelete={deleteSelection}
					onDuplicate={duplicate}
					onEditText={() => single && startEditing(single.id)}
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

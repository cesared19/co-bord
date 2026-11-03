import {
	Bell,
	BellRing,
	BookOpenText,
	FlaskConical,
	Download,
	ExternalLink,
	Frame,
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowLeftRight,
	ArrowRight,
	BringToFront,
	Bold,
	Copy,
	PenLine,
	SendToBack,
	Spline,
	Trash2,
} from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { openUrl } from './media'
import type { BoardStore } from './store'
import { ShapeIcon } from './Toolbar'
import {
	type Align,
	type BoardElement,
	type ConnectorElement,
	FONT_SIZES,
	hasText,
	isFrame,
	FRAME_COLORS,
	PALETTE,
	type Route,
	SHAPES,
	STICKY_COLORS,
} from './types'

interface Props {
	store: BoardStore
	selected: BoardElement[]
	anchor: { left: number; top: number; width: number; height: number }
	viewport: { w: number; h: number }
	onDelete: () => void
	onDuplicate: () => void
	onEditText: () => void
	onWrapInFrame: () => void
	onExportFrame: (id: string) => void
	/** The user follows the selected element. */
	following?: boolean
	/** Follows or stops following the selected element, when one is selected. */
	onToggleFollow?: () => void
	/** Opens the publish dialog for a frame, when the project is connected to Confluence. */
	onPublishFrame?: (frameId: string) => void
	/** The SparkyTC link picker for one element, when the project is connected. */
	linkEditor?: (el: BoardElement) => ReactNode
}

const btn =
	'flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
const on = 'bg-gray-100 dark:bg-gray-800'

export function ContextToolbar({
	store,
	selected,
	anchor,
	viewport,
	onDelete,
	onDuplicate,
	onEditText,
	onWrapInFrame,
	onExportFrame,
	linkEditor,
	onPublishFrame,
	following,
	onToggleFollow,
}: Props) {
	const ref = useRef<HTMLDivElement>(null)
	const [pos, setPos] = useState({ left: 0, top: 0 })

	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const w = el.offsetWidth
		const h = el.offsetHeight
		let top = anchor.top - h - 40
		if (top < 8) top = anchor.top + anchor.height + 40
		if (top + h > viewport.h - 8) top = Math.max(8, viewport.h - h - 60)
		const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - w / 2), Math.max(8, viewport.w - w - 8))
		setPos({ left, top })
	}, [anchor.left, anchor.top, anchor.width, anchor.height, viewport.w, viewport.h, selected])

	const boxes = selected.filter(hasText)
	const shapes = boxes.filter((el) => el.type === 'shape')
	const stickies = boxes.filter((el) => el.type === 'sticky')
	const connectors = selected.filter((el): el is ConnectorElement => el.type === 'connector')
	const frames = selected.filter(isFrame)
	const first = <T,>(list: T[]) => list[0]

	const patch = (targets: BoardElement[], value: Record<string, unknown>) => {
		store.checkpoint()
		store.update(targets.map((el) => [el.id, value]))
		store.checkpoint()
	}

	const ids = selected.map((el) => el.id)

	return (
		<div
			ref={ref}
			data-ui
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute z-20 flex max-w-[calc(100%-16px)] flex-wrap items-center gap-0.5 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
			style={pos}
		>
			{shapes.length > 0 && (
				<>
					<Popover label="Shape" button={<ShapeIcon kind={shapes[0].shape} size={18} />}>
						{(close) => (
							<div className="grid grid-cols-5 gap-0.5">
								{SHAPES.map((s) => (
									<button
										key={s.kind}
										type="button"
										title={s.label}
										className={btn}
										onClick={() => (patch(shapes, { shape: s.kind }), close())}
									>
										<ShapeIcon kind={s.kind} size={18} />
									</button>
								))}
							</div>
						)}
					</Popover>
					<ColorPopover label="Fill" value={shapes[0].fill} allowTransparent onPick={(fill) => patch(shapes, { fill })} />
					<ColorPopover label="Border" value={shapes[0].stroke} allowAuto onPick={(stroke) => patch(shapes, { stroke })} border />
					<Popover label="Border width" button={<span className="text-xs tabular-nums">{shapes[0].strokeWidth}px</span>}>
						{(close) => (
							<div className="flex gap-0.5">
								{[0, 1, 2, 4, 6].map((w) => (
									<button
										key={w}
										type="button"
										className={`${btn} text-xs ${shapes[0].strokeWidth === w ? on : ''}`}
										onClick={() => (patch(shapes, { strokeWidth: w }), close())}
									>
										{w === 0 ? 'None' : `${w}px`}
									</button>
								))}
							</div>
						)}
					</Popover>
					<Divider />
				</>
			)}
			{stickies.length > 0 && (
				<>
					<Popover label="Sticky color" button={<Swatch color={stickies[0].fill} />}>
						{(close) => (
							<div className="grid grid-cols-4 gap-1">
								{STICKY_COLORS.map((c) => (
									<button
										key={c}
										type="button"
										title={c}
										className="rounded p-0.5 hover:ring-2 hover:ring-gray-300"
										onClick={() => (patch(stickies, { fill: c }), close())}
									>
										<Swatch color={c} size={26} />
									</button>
								))}
							</div>
						)}
					</Popover>
					<Divider />
				</>
			)}
			{boxes.length > 0 && (
				<>
					<Popover
						label="Text size"
						button={
							<span className="text-xs font-semibold">
								{FONT_SIZES.find((f) => f.value === boxes[0].fontSize)?.label ?? boxes[0].fontSize}
							</span>
						}
					>
						{(close) => (
							<div className="flex gap-0.5">
								{FONT_SIZES.map((f) => (
									<button
										key={f.value}
										type="button"
										className={`${btn} text-xs font-semibold ${boxes[0].fontSize === f.value ? on : ''}`}
										onClick={() => (patch(boxes, { fontSize: f.value }), close())}
									>
										{f.label}
									</button>
								))}
							</div>
						)}
					</Popover>
					<button
						type="button"
						title="Bold"
						aria-pressed={boxes[0].bold}
						className={`${btn} ${boxes[0].bold ? on : ''}`}
						onClick={() => patch(boxes, { bold: !boxes[0].bold })}
					>
						<Bold size={16} />
					</button>
					<Popover
						label="Alignment"
						button={
							boxes[0].align === 'left' ? (
								<AlignLeft size={16} />
							) : boxes[0].align === 'right' ? (
								<AlignRight size={16} />
							) : (
								<AlignCenter size={16} />
							)
						}
					>
						{(close) => (
							<div className="flex gap-0.5">
								{(['left', 'center', 'right'] as Align[]).map((a) => (
									<button
										key={a}
										type="button"
										title={a}
										className={`${btn} ${boxes[0].align === a ? on : ''}`}
										onClick={() => (patch(boxes, { align: a }), close())}
									>
										{a === 'left' ? <AlignLeft size={16} /> : a === 'right' ? <AlignRight size={16} /> : <AlignCenter size={16} />}
									</button>
								))}
							</div>
						)}
					</Popover>
					<ColorPopover label="Text color" value={boxes[0].textColor} allowAuto text onPick={(textColor) => patch(boxes, { textColor })} />
					{selected.length === 1 && (
						<button type="button" title="Edit text (Enter)" className={btn} onClick={onEditText}>
							<PenLine size={16} />
						</button>
					)}
					<Divider />
				</>
			)}
			{connectors.length > 0 && (
				<>
					<Popover label="Line type" button={<RouteIcon route={first(connectors)!.route} />}>
						{(close) => (
							<div className="flex gap-0.5">
								{(['straight', 'elbow', 'curved'] as Route[]).map((r) => (
									<button
										key={r}
										type="button"
										title={r}
										className={`${btn} ${connectors[0].route === r ? on : ''}`}
										onClick={() => (patch(connectors, { route: r }), close())}
									>
										<RouteIcon route={r} />
									</button>
								))}
							</div>
						)}
					</Popover>
					<ColorPopover
						label="Line color"
						value={connectors[0].stroke}
						allowAuto
						border
						onPick={(stroke) => patch(connectors, { stroke })}
					/>
					<Popover label="Line width" button={<span className="text-xs tabular-nums">{connectors[0].strokeWidth}px</span>}>
						{(close) => (
							<div className="flex gap-0.5">
								{[1, 2, 3, 5].map((w) => (
									<button
										key={w}
										type="button"
										className={`${btn} text-xs ${connectors[0].strokeWidth === w ? on : ''}`}
										onClick={() => (patch(connectors, { strokeWidth: w }), close())}
									>
										{w}px
									</button>
								))}
							</div>
						)}
					</Popover>
					<button
						type="button"
						title="Dashed"
						aria-pressed={connectors[0].dash}
						className={`${btn} ${connectors[0].dash ? on : ''}`}
						onClick={() => patch(connectors, { dash: !connectors[0].dash })}
					>
						<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
							<path d="M2 9h14" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.5" />
						</svg>
					</button>
					<button
						type="button"
						title="Arrows"
						className={btn}
						onClick={() => {
							const c = connectors[0]
							// cycle: end -> both -> none -> end
							const next =
								c.endArrow && !c.startArrow
									? { startArrow: true, endArrow: true }
									: c.endArrow
										? { startArrow: false, endArrow: false }
										: { startArrow: false, endArrow: true }
							patch(connectors, next)
						}}
					>
						{connectors[0].startArrow ? (
							<ArrowLeftRight size={16} />
						) : connectors[0].endArrow ? (
							<ArrowRight size={16} />
						) : (
							<span className="h-0.5 w-4 bg-current" />
						)}
					</button>
					{selected.length === 1 && (
						<button type="button" title="Label (Enter)" className={btn} onClick={onEditText}>
							<PenLine size={16} />
						</button>
					)}
					<Divider />
				</>
			)}
			{frames.length > 0 && (
				<>
					<ColorPopover label="Frame color" value={frames[0].fill} allowAuto frameColors onPick={(fill) => patch(frames, { fill })} />
					{selected.length === 1 && (
						<>
							<button type="button" title="Rename (Enter)" className={btn} onClick={onEditText}>
								<PenLine size={16} />
							</button>
							<button type="button" title="Download the frame as PNG" className={btn} onClick={() => onExportFrame(frames[0].id)}>
								<Download size={16} />
							</button>
							{onPublishFrame && (
								<button type="button" title="Publish to Confluence" className={btn} onClick={() => onPublishFrame(frames[0].id)}>
									<BookOpenText size={16} />
									<span className="sr-only">Publish to Confluence</span>
								</button>
							)}
						</>
					)}
					<Divider />
				</>
			)}
			{selected.length > 1 && frames.length === 0 && (
				<>
					<button type="button" title="Put in a frame" aria-label="Put in a frame" className={btn} onClick={onWrapInFrame}>
						<Frame size={16} />
						<span className="ml-1 text-xs">Frame</span>
					</button>
					<Divider />
				</>
			)}
			{selected.length === 1 && selected[0].type === 'media' && openUrl(selected[0]) && (
				<>
					<a href={openUrl(selected[0])!} target="_blank" rel="noopener noreferrer" title="Open in a new tab" className={btn}>
						<ExternalLink size={16} />
						<span className="sr-only">Open in a new tab</span>
					</a>
					<Divider />
				</>
			)}
			{linkEditor && selected.length === 1 && selected[0].type !== 'connector' && (
				<>
					<Popover
						label="Linked tests (SparkyTC)"
						button={
							<span className="flex items-center gap-1">
								<FlaskConical size={16} />
								{selected[0].links?.length ? <span className="text-xs tabular-nums">{selected[0].links.length}</span> : null}
							</span>
						}
					>
						{() => linkEditor(selected[0])}
					</Popover>
					<Divider />
				</>
			)}
			{onToggleFollow && (
				<button
					type="button"
					title={following ? 'Following: you are notified when it changes. Click to stop.' : 'Follow: be notified when it changes'}
					aria-pressed={following}
					className={`${btn} ${following ? on : ''}`}
					onClick={onToggleFollow}
				>
					{following ? <BellRing size={16} className="text-brand-600" /> : <Bell size={16} />}
					<span className="sr-only">{following ? 'Stop following' : 'Follow'}</span>
				</button>
			)}
			<button type="button" title="Bring to front" className={btn} onClick={() => (store.checkpoint(), store.bringToFront(ids))}>
				<BringToFront size={16} />
			</button>
			<button type="button" title="Send to back" className={btn} onClick={() => (store.checkpoint(), store.sendToBack(ids))}>
				<SendToBack size={16} />
			</button>
			<button type="button" title="Duplicate (Ctrl+D)" className={btn} onClick={onDuplicate}>
				<Copy size={16} />
			</button>
			<button type="button" title="Delete (Delete)" className={`${btn} hover:text-red-600`} onClick={onDelete}>
				<Trash2 size={16} />
			</button>
		</div>
	)
}

function Divider() {
	return <span className="mx-0.5 h-6 w-px bg-gray-200 dark:bg-gray-700" />
}

function Swatch({ color, size = 18 }: { color: string; size?: number }) {
	const transparent = color === 'transparent'
	const auto = color === 'auto'
	return (
		<span
			className="inline-block rounded-full border border-gray-300 dark:border-gray-600"
			style={{
				width: size,
				height: size,
				background: transparent
					? 'linear-gradient(135deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)'
					: auto
						? 'linear-gradient(135deg, #1f2937 50%, #f9fafb 50%)'
						: color,
			}}
		/>
	)
}

function RouteIcon({ route }: { route: Route }) {
	if (route === 'curved') return <Spline size={16} />
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<path
				d={route === 'straight' ? 'M2 14L14 2' : 'M2 14H8V2H14'}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

function Popover({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const close = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false)
		}
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [open])
	return (
		<div ref={ref} className="relative">
			<button type="button" title={label} aria-expanded={open} className={`${btn} ${open ? on : ''}`} onClick={() => setOpen(!open)}>
				{button}
				<span className="sr-only">{label}</span>
			</button>
			{open && (
				<div className="absolute top-full left-0 z-30 mt-1 w-max rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900">
					{children(() => setOpen(false))}
				</div>
			)}
		</div>
	)
}

function ColorPopover({
	label,
	value,
	onPick,
	allowTransparent,
	allowAuto,
	border,
	text,
	frameColors,
}: {
	label: string
	value: string
	onPick: (color: string) => void
	allowTransparent?: boolean
	allowAuto?: boolean
	border?: boolean
	text?: boolean
	/** Offer the light frame tints instead of the full palette. */
	frameColors?: boolean
}) {
	const extra = [...(allowAuto ? ['auto'] : []), ...(allowTransparent ? ['transparent'] : [])]
	const colors = frameColors ? FRAME_COLORS : [...extra, ...PALETTE]
	return (
		<Popover
			label={label}
			button={
				text ? (
					<span className="flex flex-col items-center text-xs leading-none font-bold">
						A<span className="mt-0.5 h-1 w-4 rounded-sm" style={{ background: value === 'auto' ? 'currentColor' : value }} />
					</span>
				) : border ? (
					<span
						className="inline-block size-[18px] rounded-full border-[3px]"
						style={{ borderColor: value === 'auto' ? 'currentColor' : value }}
					/>
				) : (
					<Swatch color={value} />
				)
			}
		>
			{(close) => (
				<div className="grid grid-cols-6 gap-1">
					{colors.map((c) => (
						<button
							key={c}
							type="button"
							title={c === 'auto' ? 'Automatic' : c === 'transparent' ? 'None' : c}
							className={`rounded-full p-0.5 ${value === c ? 'ring-2 ring-brand-500' : 'hover:ring-2 hover:ring-gray-300'}`}
							onClick={() => {
								onPick(c)
								close()
							}}
						>
							<Swatch color={c} size={22} />
						</button>
					))}
				</div>
			)}
		</Popover>
	)
}

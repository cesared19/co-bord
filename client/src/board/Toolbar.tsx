import {
	MessageSquare,
	Frame,
	Hand,
	ImagePlus,
	LayoutTemplate,
	Maximize,
	Minus,
	MousePointer2,
	MoveUpRight,
	Plus,
	Redo2,
	StickyNote,
	Timer,
	Type,
	Undo2,
	Upload,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { shapePath } from './geometry'
import { SHAPES, type ShapeKind, type Tool } from './types'

const panel = 'rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900'

function ToolButton({
	active,
	label,
	shortcut,
	onClick,
	children,
}: {
	active?: boolean
	label: string
	shortcut?: string
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			title={shortcut ? `${label} (${shortcut})` : label}
			aria-pressed={active}
			onClick={onClick}
			className={`flex size-10 items-center justify-center rounded-lg ${
				active
					? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
					: 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
			}`}
		>
			{children}
			<span className="sr-only">{label}</span>
		</button>
	)
}

export function ShapeIcon({ kind, size = 20 }: { kind: ShapeKind; size?: number }) {
	const w = size
	const h =
		kind === 'terminator'
			? size * 0.55
			: kind === 'rect' || kind === 'rounded' || kind === 'parallelogram' || kind === 'hexagon' || kind === 'document'
				? size * 0.7
				: size * 0.85
	return (
		<svg width={size + 2} height={size + 2} viewBox={`-1 -1 ${size + 2} ${size + 2}`} aria-hidden>
			<g transform={`translate(0 ${(size - h) / 2})`}>
				<path d={shapePath(kind, w, h)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
			</g>
		</svg>
	)
}

interface ToolbarProps {
	tool: Tool
	shapeKind: ShapeKind
	onTool: (tool: Tool) => void
	onShape: (kind: ShapeKind) => void
	onUndo: () => void
	onRedo: () => void
	onFiles: (files: File[]) => void
	onTemplates: () => void
	/** Search and add Confluence pages, when the project is connected. */
	confluence?: ConfluencePicker
	/** Timer and voting controls, shown in a popover. */
	facilitation: ReactNode
	/** Returns an error to show, or null when the link was added. */
	onLink: (url: string) => string | null
}

export function Toolbar({
	tool,
	shapeKind,
	onTool,
	onShape,
	onUndo,
	onRedo,
	onFiles,
	onLink,
	onTemplates,
	facilitation,
	confluence,
}: ToolbarProps) {
	const [shapesOpen, setShapesOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!shapesOpen) return
		const close = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setShapesOpen(false)
		}
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [shapesOpen])

	return (
		<div data-ui ref={ref} className="absolute top-1/2 left-3 z-10 flex -translate-y-1/2 flex-col gap-2">
			<div className={`${panel} flex flex-col gap-0.5 p-1`}>
				<ToolButton label="Select" shortcut="V" active={tool === 'select'} onClick={() => onTool('select')}>
					<MousePointer2 size={19} />
				</ToolButton>
				<ToolButton label="Hand" shortcut="H or hold Space" active={tool === 'hand'} onClick={() => onTool('hand')}>
					<Hand size={19} />
				</ToolButton>
				<ToolButton label="Sticky note" shortcut="N" active={tool === 'sticky'} onClick={() => onTool('sticky')}>
					<StickyNote size={19} />
				</ToolButton>
				<ToolButton label="Text" shortcut="T" active={tool === 'text'} onClick={() => onTool('text')}>
					<Type size={19} />
				</ToolButton>
				<div className="relative">
					<ToolButton label="Shapes" shortcut="S" active={tool === 'shape'} onClick={() => setShapesOpen(!shapesOpen)}>
						<ShapeIcon kind={shapeKind} />
					</ToolButton>
					{shapesOpen && (
						<div role="menu" className={`${panel} absolute top-0 left-12 grid w-max grid-cols-5 gap-0.5 p-1`}>
							{SHAPES.map((s) => (
								<button
									key={s.kind}
									type="button"
									role="menuitem"
									title={s.label}
									onClick={() => {
										onShape(s.kind)
										setShapesOpen(false)
									}}
									className={`flex size-10 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 ${shapeKind === s.kind ? 'text-brand-600' : ''}`}
								>
									<ShapeIcon kind={s.kind} />
									<span className="sr-only">{s.label}</span>
								</button>
							))}
						</div>
					)}
				</div>
				<ToolButton label="Connector" shortcut="L" active={tool === 'connector'} onClick={() => onTool('connector')}>
					<MoveUpRight size={19} />
				</ToolButton>
				<MediaMenu onFiles={onFiles} onLink={onLink} confluence={confluence} />
				<ToolButton label="Frame" shortcut="F" active={tool === 'frame'} onClick={() => onTool('frame')}>
					<Frame size={19} />
				</ToolButton>
				<ToolButton label="Comment" shortcut="C" active={tool === 'comment'} onClick={() => onTool('comment')}>
					<MessageSquare size={19} />
				</ToolButton>
				<ToolButton label="Templates" onClick={onTemplates}>
					<LayoutTemplate size={19} />
				</ToolButton>
				<PopoverTool label="Timer and voting" icon={<Timer size={19} />}>
					{facilitation}
				</PopoverTool>
			</div>
			<div className={`${panel} flex flex-col gap-0.5 p-1`}>
				<ToolButton label="Undo" shortcut="Ctrl+Z" onClick={onUndo}>
					<Undo2 size={18} />
				</ToolButton>
				<ToolButton label="Redo" shortcut="Ctrl+Shift+Z" onClick={onRedo}>
					<Redo2 size={18} />
				</ToolButton>
			</div>
		</div>
	)
}

export function ZoomControls({
	zoom,
	onZoom,
	onReset,
	onFit,
	children,
}: {
	zoom: number
	onZoom: (factor: number) => void
	onReset: () => void
	onFit: () => void
	/** Shown before the zoom buttons. */
	children?: ReactNode
}) {
	const btn = 'flex size-9 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
	return (
		<div data-ui className={`${panel} absolute right-3 bottom-3 z-10 flex items-center gap-0.5 p-1`}>
			{children}
			<button type="button" className={btn} title="Zoom out (Ctrl -)" onClick={() => onZoom(1 / 1.2)}>
				<Minus size={16} />
				<span className="sr-only">Zoom out</span>
			</button>
			<button
				type="button"
				className="h-9 min-w-14 rounded-lg px-1 text-xs font-medium tabular-nums hover:bg-gray-100 dark:hover:bg-gray-800"
				title="Zoom to 100% (Ctrl 0)"
				onClick={onReset}
			>
				{Math.round(zoom * 100)}%
			</button>
			<button type="button" className={btn} title="Zoom in (Ctrl +)" onClick={() => onZoom(1.2)}>
				<Plus size={16} />
				<span className="sr-only">Zoom in</span>
			</button>
			<button type="button" className={btn} title="Fit everything (Shift 1)" onClick={onFit}>
				<Maximize size={16} />
				<span className="sr-only">Fit everything</span>
			</button>
		</div>
	)
}

interface ConfluencePicker {
	search: (q: string) => Promise<{ id: string; title: string }[]>
	onPick: (page: { id: string; title: string }) => void
}

function MediaMenu({
	onFiles,
	onLink,
	confluence,
}: {
	onFiles: (files: File[]) => void
	onLink: (url: string) => string | null
	confluence?: ConfluencePicker
}) {
	const [open, setOpen] = useState(false)
	const [error, setError] = useState('')
	const ref = useRef<HTMLDivElement>(null)
	const fileRef = useRef<HTMLInputElement>(null)
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
			<ToolButton label="Images, videos and PDFs" active={open} onClick={() => setOpen(!open)}>
				<ImagePlus size={19} />
			</ToolButton>
			{open && (
				<div className={`${panel} absolute top-0 left-12 w-72 space-y-3 p-3`}>
					<button
						type="button"
						onClick={() => fileRef.current?.click()}
						className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-left text-sm hover:border-brand-500 hover:bg-brand-50 dark:border-gray-600 dark:hover:bg-brand-900/20"
					>
						<Upload size={18} className="shrink-0 text-brand-600" />
						<span>
							<span className="block font-medium">Upload files</span>
							<span className="block text-xs text-gray-500">Images, videos or PDFs. You can also drop or paste them on the board.</span>
						</span>
					</button>
					<input
						ref={fileRef}
						type="file"
						multiple
						hidden
						accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/webm,video/ogg,video/quicktime,application/pdf"
						onChange={(e) => {
							const files = [...(e.target.files ?? [])]
							e.target.value = ''
							if (files.length) {
								onFiles(files)
								setOpen(false)
							}
						}}
					/>
					<form
						className="space-y-1.5"
						onSubmit={(e) => {
							e.preventDefault()
							const url = String(new FormData(e.currentTarget).get('url') ?? '')
							const problem = onLink(url)
							setError(problem ?? '')
							if (!problem) setOpen(false)
						}}
					>
						<label htmlFor="media-url" className="block text-sm font-medium">
							Embed a link
						</label>
						<div className="flex gap-1.5">
							<input
								id="media-url"
								name="url"
								placeholder="https://"
								autoComplete="off"
								className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
							/>
							<button type="submit" className="rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
								Add
							</button>
						</div>
						{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
						<p className="text-xs text-gray-500">
							YouTube, Google Drive or Vimeo, or a link to an image, a video or a PDF. Drive files play for people who can open them in
							Google Drive.{confluence ? ' Confluence page addresses show the page.' : ''}
						</p>
					</form>
					{confluence && <ConfluenceSearch picker={confluence} onPicked={() => setOpen(false)} />}
				</div>
			)}
		</div>
	)
}

function PopoverTool({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
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
			<ToolButton label={label} active={open} onClick={() => setOpen(!open)}>
				{icon}
			</ToolButton>
			{open && <div className={`${panel} absolute bottom-0 left-12`}>{children}</div>}
		</div>
	)
}

/** Lists the board's frames; picking one shows it. */
export function FramesMenu({ frames, onPick }: { frames: { id: string; title: string }[]; onPick: (id: string) => void }) {
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
	if (!frames.length) return null
	return (
		<div ref={ref} data-ui className="relative">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
			>
				<Frame size={15} /> Frames <span className="text-gray-400 tabular-nums">{frames.length}</span>
			</button>
			{open && (
				<ul className={`${panel} absolute right-0 bottom-11 max-h-80 w-64 overflow-auto p-1`}>
					{frames.map((f) => (
						<li key={f.id}>
							<button
								type="button"
								onClick={() => {
									onPick(f.id)
									setOpen(false)
								}}
								className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
							>
								{f.title || 'Frame'}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

function ConfluenceSearch({ picker, onPicked }: { picker: ConfluencePicker; onPicked: () => void }) {
	const [query, setQuery] = useState('')
	const [pages, setPages] = useState<{ id: string; title: string }[] | null>(null)
	const [error, setError] = useState('')
	useEffect(() => {
		let cancelled = false
		const id = setTimeout(() => {
			picker
				.search(query)
				.then((p) => {
					if (cancelled) return
					setPages(p)
					setError('')
				})
				.catch((e) => !cancelled && setError(e.message))
		}, 250)
		return () => {
			cancelled = true
			clearTimeout(id)
		}
	}, [query, picker])
	return (
		<div className="space-y-1.5 border-t border-gray-200 pt-3 dark:border-gray-700">
			<label htmlFor="confluence-search" className="block text-sm font-medium">
				Confluence page
			</label>
			<input
				id="confluence-search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search by title"
				autoComplete="off"
				className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
			/>
			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
			<ul className="max-h-40 overflow-auto">
				{pages?.length === 0 && <li className="px-1 py-1 text-xs text-gray-500">No pages found.</li>}
				{pages?.map((p) => (
					<li key={p.id}>
						<button
							type="button"
							onClick={() => {
								picker.onPick(p)
								onPicked()
							}}
							className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
						>
							{p.title}
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}

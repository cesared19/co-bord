import { Hand, Maximize, Minus, MousePointer2, MoveUpRight, Plus, Redo2, StickyNote, Type, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
}

export function Toolbar({ tool, shapeKind, onTool, onShape, onUndo, onRedo }: ToolbarProps) {
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
}: {
	zoom: number
	onZoom: (factor: number) => void
	onReset: () => void
	onFit: () => void
}) {
	const btn = 'flex size-9 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
	return (
		<div data-ui className={`${panel} absolute right-3 bottom-3 z-10 flex items-center gap-0.5 p-1`}>
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

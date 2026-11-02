import { memo, useEffect, useRef } from 'react'
import { arrowHead, connectorGeometry, type ElementMap, resolveStroke, resolveTextColor, shapePath, textInsets } from './geometry'
import type { BoxElement, ConnectorElement } from './types'

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
export const LINE_HEIGHT = 1.3

interface BoxProps {
	el: BoxElement
	dark: boolean
	editing: boolean
	onText: (id: string, text: string, height?: number) => void
	onEditEnd: () => void
}

export const BoxView = memo(function BoxView({ el, dark, editing, onText, onEditEnd }: BoxProps) {
	const inset = textInsets(el)
	const color = resolveTextColor(el, dark)
	const justify = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'
	const textStyle: React.CSSProperties = {
		fontFamily: FONT,
		fontSize: el.fontSize,
		lineHeight: LINE_HEIGHT,
		fontWeight: el.bold ? 700 : 400,
		color,
		textAlign: el.align,
		whiteSpace: 'pre-wrap',
		overflowWrap: 'break-word',
	}
	const box: React.CSSProperties = {
		position: 'absolute',
		top: inset.top,
		left: inset.left,
		right: inset.right,
		bottom: inset.bottom,
		display: 'flex',
		alignItems: el.type === 'text' ? 'flex-start' : 'center',
		justifyContent: justify,
		overflow: el.type === 'text' ? 'visible' : 'hidden',
	}

	return (
		<div data-el={el.id} style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h }}>
			{el.type === 'shape' && (
				<svg width={el.w} height={el.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
					<path
						d={shapePath(el.shape, el.w, el.h)}
						fill={el.fill === 'transparent' ? 'none' : el.fill}
						stroke={el.strokeWidth > 0 ? resolveStroke(el.stroke, dark) : 'none'}
						strokeWidth={el.strokeWidth}
						strokeLinejoin="round"
						pointerEvents="none"
					/>
				</svg>
			)}
			{el.type === 'sticky' && (
				<div
					style={{
						position: 'absolute',
						inset: 0,
						background: el.fill,
						borderRadius: 3,
						boxShadow: '0 1px 2px rgb(0 0 0 / .12), 0 6px 14px -6px rgb(0 0 0 / .25)',
					}}
				/>
			)}
			{editing ? (
				<TextEditor
					el={el}
					style={{ ...textStyle, ...box, display: 'block' }}
					onText={onText}
					onEditEnd={onEditEnd}
					inset={inset.top + inset.bottom}
				/>
			) : (
				el.text && (
					<div style={box}>
						<div style={{ ...textStyle, width: '100%', maxHeight: el.type === 'text' ? undefined : '100%' }}>{el.text}</div>
					</div>
				)
			)}
		</div>
	)
})

function TextEditor({
	el,
	style,
	inset,
	onText,
	onEditEnd,
}: {
	el: BoxElement
	style: React.CSSProperties
	inset: number
	onText: BoxProps['onText']
	onEditEnd: () => void
}) {
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		const t = ref.current
		if (!t) return
		t.style.height = `${t.scrollHeight}px`
		t.focus()
		t.setSelectionRange(t.value.length, t.value.length)
	}, [])
	// vertically centered text: grow the textarea with its content
	const centered = el.type !== 'text'
	return (
		<div style={{ ...style, display: 'flex', alignItems: centered ? 'center' : 'flex-start' }}>
			<textarea
				ref={ref}
				value={el.text}
				rows={1}
				aria-label="Text"
				onPointerDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
						e.preventDefault()
						onEditEnd()
					}
				}}
				onBlur={onEditEnd}
				onChange={(e) => {
					const t = e.currentTarget
					t.style.height = 'auto'
					t.style.height = `${t.scrollHeight}px`
					onText(el.id, t.value, el.type === 'text' ? t.scrollHeight + inset : undefined)
				}}
				style={{
					font: 'inherit',
					color: 'inherit',
					textAlign: 'inherit',
					lineHeight: 'inherit',
					fontWeight: 'inherit',
					width: '100%',
					maxHeight: '100%',
					background: 'transparent',
					border: 'none',
					outline: 'none',
					resize: 'none',
					padding: 0,
					overflow: 'hidden',
					whiteSpace: 'pre-wrap',
				}}
			/>
		</div>
	)
}

interface ConnectorProps {
	el: ConnectorElement
	/** Only the elements this connector attaches to, so it re-renders when they move. */
	ends: ElementMap
	dark: boolean
	editing: boolean
	onLabel: (id: string, label: string) => void
	onEditEnd: () => void
}

export const ConnectorView = memo(
	function ConnectorView({ el, ends, dark, editing, onLabel, onEditEnd }: ConnectorProps) {
		const g = connectorGeometry(el, ends)
		const stroke = resolveStroke(el.stroke, dark)
		const head = 8 + el.strokeWidth * 2.5
		const labelColor = dark ? '#e5e7eb' : '#1f2937'
		return (
			<>
				<svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1} aria-hidden>
					<path
						d={g.path}
						data-el={el.id}
						fill="none"
						stroke="transparent"
						strokeWidth={Math.max(14, el.strokeWidth + 10)}
						pointerEvents="stroke"
					/>
					<path
						d={g.path}
						fill="none"
						stroke={stroke}
						strokeWidth={el.strokeWidth}
						strokeDasharray={el.dash ? `${el.strokeWidth * 4} ${el.strokeWidth * 3}` : undefined}
						strokeLinejoin="round"
						strokeLinecap="round"
					/>
					{el.endArrow && (
						<path d={arrowHead(g.end, g.endAngle, head)} fill={stroke} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
					)}
					{el.startArrow && (
						<path
							d={arrowHead(g.start, g.startAngle + Math.PI, head)}
							fill={stroke}
							stroke={stroke}
							strokeWidth={1}
							strokeLinejoin="round"
						/>
					)}
				</svg>
				{(el.label || editing) && (
					<div
						data-el={el.id}
						style={{
							position: 'absolute',
							left: g.mid.x,
							top: g.mid.y,
							transform: 'translate(-50%, -50%)',
							background: 'var(--board-bg)',
							color: labelColor,
							padding: '2px 6px',
							borderRadius: 4,
							fontFamily: FONT,
							fontSize: 14,
							lineHeight: LINE_HEIGHT,
							whiteSpace: 'pre',
						}}
					>
						{editing ? (
							<input
								autoFocus
								value={el.label}
								aria-label="Connector label"
								size={Math.max(6, el.label.length + 1)}
								onPointerDown={(e) => e.stopPropagation()}
								onKeyDown={(e) => {
									e.stopPropagation()
									if (e.key === 'Escape' || e.key === 'Enter') onEditEnd()
								}}
								onBlur={onEditEnd}
								onChange={(e) => onLabel(el.id, e.target.value)}
								style={{
									font: 'inherit',
									color: 'inherit',
									background: 'transparent',
									border: 'none',
									outline: 'none',
									padding: 0,
									textAlign: 'center',
								}}
							/>
						) : (
							el.label
						)}
					</div>
				)}
			</>
		)
	},
	(a, b) => {
		if (a.el !== b.el || a.dark !== b.dark || a.editing !== b.editing || a.onLabel !== b.onLabel || a.onEditEnd !== b.onEditEnd)
			return false
		if (a.ends.size !== b.ends.size) return false
		for (const [id, value] of a.ends) if (b.ends.get(id) !== value) return false
		return true
	},
)

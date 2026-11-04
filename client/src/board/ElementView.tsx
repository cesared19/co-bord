import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useBoardEnv } from './confluence'
import {
	arrowHead,
	connectorGeometry,
	type ElementMap,
	frameBorder,
	resolveFrameFill,
	resolveStroke,
	resolveTextColor,
	shapePath,
	textInsets,
} from './geometry'
import { inkPath } from './ink'
import type { ConnectorElement, DrawElement, FrameElement, TextBox } from './types'

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
export const LINE_HEIGHT = 1.3

interface BoxProps {
	el: TextBox
	dark: boolean
	editing: boolean
	onText: (id: string, text: string, height?: number) => void
	onEditEnd: () => void
}

export const BoxView = memo(function BoxView({ el, dark, editing, onText, onEditEnd }: BoxProps) {
	const inset = textInsets(el)
	const color = resolveTextColor(el, dark)
	const justify = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'
	// notes and shapes shrink their text to fit, whole words on a line, like other whiteboards
	const fitted = useFittedFontSize(el, editing)
	const textStyle: React.CSSProperties = {
		fontFamily: FONT,
		fontSize: fitted.size,
		lineHeight: LINE_HEIGHT,
		fontWeight: el.bold ? 700 : 400,
		color,
		textAlign: el.align,
		whiteSpace: 'pre-wrap',
		// words break only when even the smallest size can't hold them
		overflowWrap: fitted.breakWords ? 'anywhere' : 'normal',
		...(el.done ? { textDecoration: 'line-through', opacity: 0.6 } : {}),
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
		<div
			data-el={el.id}
			style={{
				position: 'absolute',
				left: el.x,
				top: el.y,
				width: el.w,
				height: el.h,
				...(el.rotation ? { transform: `rotate(${el.rotation}deg)` } : {}),
			}}
		>
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
					<div style={box} ref={fitted.boxRef}>
						<div ref={fitted.textRef} style={{ ...textStyle, width: '100%', maxHeight: el.type === 'text' ? undefined : '100%' }}>
							{withMentions(el.text)}
						</div>
					</div>
				)
			)}
			{el.done && (
				<svg
					width={22}
					height={22}
					viewBox="0 0 22 22"
					style={{ position: 'absolute', left: -8, top: -8 }}
					role="img"
					aria-label="Done"
					pointerEvents="none"
				>
					<circle cx={11} cy={11} r={10} fill="#16a34a" stroke="#fff" strokeWidth={2} />
					<path d="M6.5 11.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			)}
		</div>
	)
})

/** The smallest text notes and shapes shrink to. */
export const MIN_FONT = 7

/**
 * The font size at which a note's or shape's text fits its box, with whole words on each line: its own size
 * when it fits, smaller when it doesn't (down to MIN_FONT, where long words break). Text elements grow instead.
 */
function useFittedFontSize(el: TextBox, editing: boolean) {
	const boxRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const [fit, setFit] = useState<{ size: number; breakWords: boolean }>({ size: el.fontSize, breakWords: false })
	const shrinks = el.type !== 'text' && !editing
	const shape = el.type === 'shape' ? el.shape : ''
	useLayoutEffect(() => {
		const box = boxRef.current
		const text = textRef.current
		if (!shrinks || !box || !text) {
			setFit({ size: el.fontSize, breakWords: false })
			return
		}
		const saved = { size: text.style.fontSize, wrap: text.style.overflowWrap, max: text.style.maxHeight }
		text.style.overflowWrap = 'normal'
		text.style.maxHeight = 'none'
		const fits = (size: number) => {
			text.style.fontSize = `${size}px`
			return text.scrollHeight <= box.clientHeight + 1 && text.scrollWidth <= box.clientWidth + 1
		}
		let result = { size: el.fontSize, breakWords: false }
		if (!fits(el.fontSize)) {
			let lo = MIN_FONT
			let hi = el.fontSize
			if (!fits(lo)) result = { size: MIN_FONT, breakWords: true }
			else {
				// the largest half point that fits
				while (hi - lo > 0.5) {
					const mid = (lo + hi) / 2
					if (fits(mid)) lo = mid
					else hi = mid
				}
				result = { size: Math.floor(lo * 2) / 2, breakWords: false }
			}
		}
		text.style.fontSize = saved.size
		text.style.overflowWrap = saved.wrap
		text.style.maxHeight = saved.max
		setFit((f) => (f.size === result.size && f.breakWords === result.breakWords ? f : result))
	}, [shrinks, el.text, el.w, el.h, el.fontSize, el.bold, el.type, shape])
	return { size: shrinks ? fit.size : el.fontSize, breakWords: shrinks && fit.breakWords, boxRef, textRef }
}

/** A word being typed after @, right before the caret. */
const MENTION_TYPING = /(^|[^\w@.])@([a-zA-Z0-9._-]*)$/
/** @username in shown text. */
const MENTION = /(@[a-zA-Z0-9._-]{3,40})/g

/** Text with @mentions in bold. */
export function withMentions(text: string) {
	const parts = text.split(MENTION)
	if (parts.length === 1) return text
	return parts.map((part, i) =>
		i % 2 ? (
			<span key={i} style={{ fontWeight: 700, color: '#c01c37' }}>
				{part}
			</span>
		) : (
			part
		),
	)
}

function TextEditor({
	el,
	style,
	inset,
	onText,
	onEditEnd,
}: {
	el: TextBox
	style: React.CSSProperties
	inset: number
	onText: BoxProps['onText']
	onEditEnd: () => void
}) {
	const ref = useRef<HTMLTextAreaElement>(null)
	const { members } = useBoardEnv()
	const [mention, setMention] = useState<{ query: string; start: number; index: number; zoom: number } | null>(null)
	useEffect(() => {
		const t = ref.current
		if (!t) return
		t.style.height = `${t.scrollHeight}px`
		t.focus()
		t.setSelectionRange(t.value.length, t.value.length)
	}, [])

	const q = mention?.query.toLowerCase() ?? ''
	const candidates = mention
		? members.filter((m) => m.username.toLowerCase().startsWith(q) || m.displayName.toLowerCase().includes(q)).slice(0, 6)
		: []

	function update(t: HTMLTextAreaElement) {
		t.style.height = 'auto'
		t.style.height = `${t.scrollHeight}px`
		onText(el.id, t.value, el.type === 'text' ? t.scrollHeight + inset : undefined)
		const before = t.value.slice(0, t.selectionStart)
		const m = MENTION_TYPING.exec(before)
		// the board's zoom, to keep the list readable at any zoom
		const zoom = t.offsetWidth ? t.getBoundingClientRect().width / t.offsetWidth : 1
		setMention(m ? { query: m[2], start: t.selectionStart - m[2].length - 1, index: 0, zoom } : null)
	}

	function pick(username: string) {
		const t = ref.current
		if (!t || !mention) return
		const caret = t.selectionStart
		const value = `${t.value.slice(0, mention.start)}@${username} ${t.value.slice(caret)}`
		const at = mention.start + username.length + 2
		// put the caret after the name right away, so the next key lands there
		t.value = value
		t.setSelectionRange(at, at)
		onText(el.id, value)
		setMention(null)
	}

	// vertically centered text: grow the textarea with its content
	const centered = el.type !== 'text'
	return (
		// visible overflow, so the list of people isn't cut by the note
		<div style={{ ...style, display: 'flex', alignItems: centered ? 'center' : 'flex-start', overflow: 'visible' }}>
			<textarea
				ref={ref}
				value={el.text}
				rows={1}
				aria-label="Text"
				aria-autocomplete="list"
				aria-expanded={candidates.length > 0}
				onPointerDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (candidates.length && mention) {
						if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
							e.preventDefault()
							const step = e.key === 'ArrowDown' ? 1 : -1
							setMention({ ...mention, index: (mention.index + step + candidates.length) % candidates.length })
							return
						}
						if (e.key === 'Enter' || e.key === 'Tab') {
							e.preventDefault()
							pick(candidates[mention.index].username)
							return
						}
						if (e.key === 'Escape') {
							e.preventDefault()
							setMention(null)
							return
						}
					}
					if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
						e.preventDefault()
						onEditEnd()
					}
				}}
				onBlur={onEditEnd}
				onChange={(e) => update(e.currentTarget)}
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
			{candidates.length > 0 && mention && (
				<ul
					role="listbox"
					aria-label="People to mention"
					onPointerDown={(e) => {
						// keep the textarea focused while picking
						e.preventDefault()
						e.stopPropagation()
					}}
					className="absolute top-full left-0 z-30 mt-1 w-56 rounded-lg border border-gray-200 bg-white py-1 text-left text-sm font-normal text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
					style={{ fontSize: 14, lineHeight: 1.3, transform: `scale(${1 / mention.zoom})`, transformOrigin: 'top left' }}
				>
					{candidates.map((m, i) => (
						<li
							key={m.id}
							role="option"
							aria-selected={i === mention.index}
							onClick={() => pick(m.username)}
							className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 ${i === mention.index ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
						>
							<span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
							<span className="truncate font-medium">{m.displayName}</span>
							<span className="truncate text-xs text-gray-500">@{m.username}</span>
						</li>
					))}
				</ul>
			)}
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

/** Title height above a frame, in screen pixels. */
export const FRAME_TITLE = 24

/**
 * The frame's area lets clicks through to the board (to draw or select inside it);
 * the frame is picked by its title, which keeps the same size at any zoom.
 */
export const FrameView = memo(function FrameView({
	el,
	zoom,
	dark,
	editing,
	onTitle,
	onEditEnd,
}: {
	el: FrameElement
	zoom: number
	dark: boolean
	editing: boolean
	onTitle: (id: string, title: string) => void
	onEditEnd: () => void
}) {
	// constant on screen down to 60% zoom; further out it shrinks with the board so nested titles don't collide
	const scale = 1 / Math.max(zoom, 0.6)
	const border = 1 / zoom
	return (
		<>
			<div
				style={{
					position: 'absolute',
					left: el.x,
					top: el.y,
					width: el.w,
					height: el.h,
					background: resolveFrameFill(el.fill, dark),
					border: `${border}px solid ${frameBorder(dark)}`,
					borderRadius: 6,
					pointerEvents: 'none',
				}}
			/>
			<div
				data-el={el.id}
				style={{
					position: 'absolute',
					left: el.x,
					top: el.y - FRAME_TITLE * scale,
					height: FRAME_TITLE * scale,
					maxWidth: el.w,
					display: 'flex',
					alignItems: 'center',
					fontFamily: FONT,
					fontSize: 13 * scale,
					fontWeight: 600,
					color: dark ? '#d1d5db' : '#4b5563',
					whiteSpace: 'nowrap',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					cursor: 'move',
				}}
			>
				{editing ? (
					<input
						autoFocus
						value={el.title}
						aria-label="Frame title"
						onFocus={(e) => e.target.select()}
						size={Math.max(8, el.title.length + 1)}
						onPointerDown={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === 'Escape' || e.key === 'Enter') onEditEnd()
						}}
						onBlur={onEditEnd}
						onChange={(e) => onTitle(el.id, e.target.value)}
						style={{ font: 'inherit', color: 'inherit', background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
					/>
				) : (
					el.title || 'Frame'
				)}
			</div>
		</>
	)
})

/**
 * A pen or highlighter stroke. Only the line takes clicks (with some room around thin ones), so a long stroke
 * doesn't cover what's under its box.
 */
export const DrawView = memo(function DrawView({ el, dark }: { el: DrawElement; dark: boolean }) {
	const d = inkPath(el.points)
	const color = resolveStroke(el.stroke, dark)
	return (
		<svg
			width={el.w}
			height={el.h}
			viewBox={`0 0 ${el.vw} ${el.vh}`}
			preserveAspectRatio="none"
			style={{
				position: 'absolute',
				left: el.x,
				top: el.y,
				overflow: 'visible',
				pointerEvents: 'none',
				...(el.rotation ? { transform: `rotate(${el.rotation}deg)` } : {}),
			}}
		>
			<path
				d={d}
				fill="none"
				stroke={color}
				strokeOpacity={el.highlighter ? 0.4 : 1}
				strokeWidth={el.strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
				pointerEvents="none"
			/>
			<path
				data-el={el.id}
				d={d}
				fill="none"
				stroke="transparent"
				strokeWidth={Math.max(el.strokeWidth, 14)}
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{ pointerEvents: 'stroke', cursor: 'move' }}
			/>
		</svg>
	)
})

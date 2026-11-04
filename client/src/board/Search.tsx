import { ChevronDown, ChevronUp, MessageSquare, Search as SearchIcon, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Thread } from './Comments'
import type { ElementMap } from './geometry'
import { center, elementBounds } from './geometry'
import type { Point } from './types'

export interface Match {
	kind: 'element' | 'comment'
	/** The element id, or the thread id for comments. */
	id: string
	text: string
	at: Point
}

const fields = ['text', 'label', 'title', 'name'] as const

/** What on the board matches `q`: element texts, labels, frame titles, file names and comments; in reading order. */
export function findMatches(q: string, elements: ElementMap, threads: Thread[], pin: (t: Thread) => Point | null): Match[] {
	const needle = q.trim().toLowerCase()
	if (!needle) return []
	const out: Match[] = []
	for (const el of elements.values()) {
		const record = el as unknown as Record<string, unknown>
		const value = fields.map((f) => record[f]).find((v): v is string => typeof v === 'string' && v.toLowerCase().includes(needle))
		if (value) out.push({ kind: 'element', id: el.id, text: value.replace(/\s+/g, ' ').trim(), at: center(elementBounds(el, elements)) })
	}
	for (const t of threads) {
		const hit = t.comments.find((c) => c.text.toLowerCase().includes(needle))
		const at = pin(t)
		if (hit && at) out.push({ kind: 'comment', id: String(t.id), text: `${hit.author}: ${hit.text.replace(/\s+/g, ' ')}`, at })
	}
	return out.sort((a, b) => (Math.abs(a.at.y - b.at.y) > 40 ? a.at.y - b.at.y : a.at.x - b.at.x))
}

/** The search bar (Ctrl F): Enter goes to the next match, Shift + Enter to the previous one, Escape closes. */
export function SearchBar({
	elements,
	threads,
	pin,
	onGo,
	onClose,
}: {
	elements: ElementMap
	threads: Thread[]
	pin: (t: Thread) => Point | null
	onGo: (m: Match) => void
	onClose: () => void
}) {
	const [q, setQ] = useState('')
	const [index, setIndex] = useState(0)
	const [listOpen, setListOpen] = useState(false)
	const input = useRef<HTMLInputElement>(null)
	/** Whether a match was shown yet: the first Enter shows the first one, the next ones move on. */
	const shown = useRef(false)
	const matches = useMemo(() => findMatches(q, elements, threads, pin), [q, elements, threads, pin])
	const current = matches.length ? Math.min(index, matches.length - 1) : -1

	useEffect(() => {
		input.current?.focus()
		input.current?.select()
	}, [])

	const go = (i: number) => {
		if (!matches.length) return
		const next = (i + matches.length) % matches.length
		setIndex(next)
		onGo(matches[next])
	}

	return (
		<div
			data-ui
			role="search"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-3 left-1/2 z-30 w-[26rem] max-w-[calc(100%-24px)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
		>
			<div className="flex items-center gap-1.5 px-2.5 py-1.5">
				<SearchIcon size={16} className="shrink-0 text-gray-500" />
				<input
					ref={input}
					value={q}
					onChange={(e) => {
						setQ(e.target.value)
						setIndex(0)
						setListOpen(true)
						shown.current = false
					}}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Escape') onClose()
						if (e.key === 'Enter') {
							e.preventDefault()
							setListOpen(false)
							go(e.shiftKey ? current - 1 : current + (shown.current ? 1 : 0))
							shown.current = true
						}
					}}
					placeholder="Find on the board"
					aria-label="Find on the board"
					className="min-w-0 flex-1 bg-transparent py-1 focus:outline-none"
				/>
				<span className="shrink-0 text-xs text-gray-500 tabular-nums" aria-live="polite">
					{q.trim() ? (matches.length ? `${current + 1} of ${matches.length}` : 'No matches') : ''}
				</span>
				<button
					type="button"
					disabled={!matches.length}
					onClick={() => go(current - 1)}
					className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
					title="Previous (Shift Enter)"
				>
					<ChevronUp size={16} />
					<span className="sr-only">Previous match</span>
				</button>
				<button
					type="button"
					disabled={!matches.length}
					onClick={() => go(current + 1)}
					className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
					title="Next (Enter)"
				>
					<ChevronDown size={16} />
					<span className="sr-only">Next match</span>
				</button>
				<button
					type="button"
					onClick={onClose}
					className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
					title="Close (Esc)"
				>
					<X size={16} />
					<span className="sr-only">Close the search</span>
				</button>
			</div>
			{listOpen && matches.length > 0 && (
				<ul aria-label="Matches" className="max-h-64 overflow-auto border-t border-gray-200 p-1 dark:border-gray-700">
					{matches.slice(0, 50).map((m, i) => (
						<li key={`${m.kind}:${m.id}`}>
							<button
								type="button"
								onClick={() => {
									setListOpen(false)
									shown.current = true
									go(i)
								}}
								className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800 ${i === current ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
							>
								{m.kind === 'comment' && <MessageSquare size={14} className="shrink-0 text-gray-500" />}
								<span className="truncate">{m.text}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}

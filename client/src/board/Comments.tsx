import type { HocuspocusProvider } from '@hocuspocus/provider'
import { Check, MessageSquare, MessageSquarePlus, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Avatar } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { withMentions } from './ElementView'
import { center, type ElementMap, rotatePoint, rotationOf, toScreen } from './geometry'
import type { Camera, Point } from './types'
import { isBox } from './types'

export interface BoardComment {
	id: number
	userId: number | null
	author: string
	username: string | null
	color: string
	text: string
	createdAt: string
	editedAt: string | null
}

export interface Thread {
	id: number
	/** On an element: x, y from its top left corner; else a point of the board. */
	elementId: string | null
	x: number
	y: number
	createdAt: string
	resolvedAt: string | null
	resolvedBy: string | null
	comments: BoardComment[]
}

/** The board's comment threads, reloaded when someone changes them (the server tells the open boards). */
export function useComments(boardId: string, provider: HocuspocusProvider) {
	const [threads, setThreads] = useState<Thread[] | null>(null)
	const reload = useCallback(async () => {
		try {
			setThreads((await api<{ threads: Thread[] }>(`/api/boards/${boardId}/comments`)).threads)
		} catch {
			/* keep what we have */
		}
	}, [boardId])
	useEffect(() => {
		void reload()
		const onStateless = ({ payload }: { payload: string }) => payload === 'comments' && void reload()
		provider.on('stateless', onStateless)
		const id = setInterval(reload, 60_000)
		return () => {
			provider.off('stateless', onStateless)
			clearInterval(id)
		}
	}, [provider, reload])
	return { threads: threads ?? [], loaded: threads !== null, reload }
}

/** Where a thread's pin is on the board, or null when its element was deleted. */
export function pinPoint(t: Pick<Thread, 'elementId' | 'x' | 'y'>, elements: ElementMap): Point | null {
	if (!t.elementId) return { x: t.x, y: t.y }
	const el = elements.get(t.elementId)
	if (!isBox(el)) return null
	return rotatePoint({ x: el.x + t.x, y: el.y + t.y }, center(el), rotationOf(el))
}

/** Where a new comment at `world` goes: on the element under it (x, y from its corner), or at that point. */
export function anchorFor(world: Point, elementId: string | null, elements: ElementMap) {
	const el = elementId ? elements.get(elementId) : undefined
	if (!isBox(el)) return { elementId: null, x: Math.round(world.x), y: Math.round(world.y) }
	const local = rotatePoint(world, center(el), -rotationOf(el))
	return { elementId: el.id, x: Math.round(local.x - el.x), y: Math.round(local.y - el.y) }
}

export function CommentPins({
	threads,
	elements,
	camera,
	openId,
	showResolved,
	onOpen,
}: {
	threads: Thread[]
	elements: ElementMap
	camera: Camera
	openId: number | null
	showResolved: boolean
	onOpen: (id: number | null) => void
}) {
	return (
		<>
			{threads.map((t) => {
				if (t.resolvedAt && !showResolved && openId !== t.id) return null
				const p = pinPoint(t, elements)
				if (!p) return null
				const s = toScreen(camera, p)
				const first = t.comments[0]
				return (
					<button
						key={t.id}
						type="button"
						data-ui
						aria-expanded={openId === t.id}
						title={`${first?.author}: ${first?.text.slice(0, 80)}`}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => onOpen(openId === t.id ? null : t.id)}
						className={`pointer-events-auto absolute flex h-7 min-w-7 -translate-y-full items-center gap-0.5 rounded-full rounded-bl-none border-2 border-white px-1 text-[11px] font-semibold text-white shadow-md dark:border-gray-900 ${t.resolvedAt ? 'opacity-50' : ''} ${openId === t.id ? 'ring-2 ring-brand-500' : ''}`}
						style={{ left: s.x, top: s.y, background: first?.color ?? '#6b7280' }}
					>
						<MessageSquare size={13} />
						{t.comments.length > 1 && <span className="tabular-nums">{t.comments.length}</span>}
						<span className="sr-only">
							Comment by {first?.author}
							{t.resolvedAt ? ', resolved' : ''}
						</span>
					</button>
				)
			})}
		</>
	)
}

/** A box next to a point of the board, kept inside the viewport. */
function Floating({
	at,
	viewport,
	children,
	label,
}: {
	at: Point
	viewport: { w: number; h: number }
	children: React.ReactNode
	label: string
}) {
	const ref = useRef<HTMLDivElement>(null)
	const [pos, setPos] = useState({ left: at.x + 16, top: at.y - 8 })
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const w = el.offsetWidth
		const h = el.offsetHeight
		let left = at.x + 16
		if (left + w > viewport.w - 8) left = Math.max(8, at.x - w - 16)
		const top = Math.min(Math.max(8, at.y - 8), Math.max(8, viewport.h - h - 8))
		setPos({ left, top })
	}, [at.x, at.y, viewport.w, viewport.h, children])
	return (
		<div
			ref={ref}
			data-ui
			role="dialog"
			aria-label={label}
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute z-30 w-80 max-w-[calc(100%-16px)] rounded-xl border border-gray-200 bg-white text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900"
			style={pos}
		>
			{children}
		</div>
	)
}

/** Enter sends, Shift + Enter is a new line, Escape cancels. */
function CommentBox({
	placeholder,
	initial = '',
	busy,
	onSend,
	onCancel,
	autoFocus,
}: {
	placeholder: string
	initial?: string
	busy: boolean
	onSend: (text: string) => void
	onCancel?: () => void
	autoFocus?: boolean
}) {
	const [text, setText] = useState(initial)
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		e.stopPropagation()
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			if (text.trim() && !busy) onSend(text.trim())
		}
		if (e.key === 'Escape') onCancel?.()
	}
	return (
		<div className="flex items-end gap-1.5">
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				aria-label={placeholder}
				rows={Math.min(5, Math.max(1, text.split('\n').length))}
				maxLength={5000}
				autoFocus={autoFocus}
				className="min-h-9 flex-1 resize-none rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
			/>
			<button
				type="button"
				disabled={!text.trim() || busy}
				onClick={() => onSend(text.trim())}
				className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
				title="Send (Enter)"
			>
				<Send size={15} />
				<span className="sr-only">Send</span>
			</button>
		</div>
	)
}

/** Writing the first comment of a new thread. */
export function Composer({
	boardId,
	anchor,
	at,
	viewport,
	onDone,
	onCancel,
}: {
	boardId: string
	anchor: { elementId: string | null; x: number; y: number }
	at: Point
	viewport: { w: number; h: number }
	onDone: (threadId: number) => void
	onCancel: () => void
}) {
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	return (
		<>
			<div
				className="pointer-events-none absolute z-20 flex size-7 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-white bg-brand-600 text-white shadow-md"
				style={{ left: at.x, top: at.y }}
			>
				<MessageSquarePlus size={13} />
			</div>
			<Floating at={at} viewport={viewport} label="New comment">
				<div className="space-y-2 p-3">
					<CommentBox
						placeholder="Add a comment, @mention someone"
						busy={busy}
						autoFocus
						onCancel={onCancel}
						onSend={(text) => {
							setBusy(true)
							api<{ id: number }>(`/api/boards/${boardId}/comments`, { method: 'POST', body: { ...anchor, text } })
								.then((r) => onDone(r.id))
								.catch((e: Error) => {
									setError(e.message)
									setBusy(false)
								})
						}}
					/>
					{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
					<p className="text-xs text-gray-500">{anchor.elementId ? 'On this item: it moves with it.' : 'On this spot of the board.'}</p>
				</div>
			</Floating>
		</>
	)
}

/** A thread: its comments, a reply box, resolve or reopen. */
export function ThreadPopover({
	boardId,
	thread,
	at,
	viewport,
	userId,
	canModerate,
	onChanged,
	onClose,
}: {
	boardId: string
	thread: Thread
	at: Point
	viewport: { w: number; h: number }
	userId: number
	/** Editors delete anyone's comments. */
	canModerate: boolean
	onChanged: () => void
	onClose: () => void
}) {
	const [busy, setBusy] = useState(false)
	const [editing, setEditing] = useState<number | null>(null)
	const [error, setError] = useState('')
	const run = (call: Promise<unknown>) => {
		setBusy(true)
		setError('')
		return call
			.then(() => onChanged())
			.catch((e: Error) => setError(e.message))
			.finally(() => setBusy(false))
	}
	const resolved = !!thread.resolvedAt
	return (
		<Floating at={at} viewport={viewport} label="Comment thread">
			<div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
				<span className="text-xs text-gray-500">
					{resolved ? `Resolved${thread.resolvedBy ? ` by ${thread.resolvedBy}` : ''}` : 'Comments'}
				</span>
				<div className="flex items-center gap-1">
					<button
						type="button"
						disabled={busy}
						onClick={() => run(api(`/api/boards/${boardId}/comments/${thread.id}`, { method: 'PUT', body: { resolved: !resolved } }))}
						className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
					>
						{resolved ? <RotateCcw size={14} /> : <Check size={14} />}
						{resolved ? 'Reopen' : 'Resolve'}
					</button>
					<button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
						<X size={15} />
						<span className="sr-only">Close</span>
					</button>
				</div>
			</div>
			<ol className="max-h-80 space-y-3 overflow-auto p-3">
				{thread.comments.map((c, i) => (
					<li key={c.id} className="flex gap-2">
						<Avatar name={c.author} color={c.color} size={26} />
						<div className="min-w-0 flex-1">
							<div className="flex items-baseline gap-1.5">
								<span className="truncate font-medium">{c.author}</span>
								<span className="shrink-0 text-xs text-gray-500">
									{timeAgo(c.createdAt)}
									{c.editedAt ? ' · edited' : ''}
								</span>
								<span className="ml-auto flex shrink-0 gap-0.5">
									{c.userId === userId && editing !== c.id && (
										<button
											type="button"
											onClick={() => setEditing(c.id)}
											className="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
											title="Edit"
										>
											<Pencil size={12} />
											<span className="sr-only">Edit comment</span>
										</button>
									)}
									{(c.userId === userId || canModerate) && (
										<button
											type="button"
											onClick={() => {
												if (i === 0 && !window.confirm('Delete this comment and its replies?')) return
												void run(api(`/api/boards/${boardId}/comment-items/${c.id}`, { method: 'DELETE' })).then(() => i === 0 && onClose())
											}}
											className="rounded p-0.5 text-gray-400 hover:text-red-600"
											title={i === 0 ? 'Delete the thread' : 'Delete'}
										>
											<Trash2 size={12} />
											<span className="sr-only">Delete comment</span>
										</button>
									)}
								</span>
							</div>
							{editing === c.id ? (
								<div className="mt-1">
									<CommentBox
										placeholder="Edit the comment"
										initial={c.text}
										busy={busy}
										autoFocus
										onCancel={() => setEditing(null)}
										onSend={(text) =>
											void run(api(`/api/boards/${boardId}/comment-items/${c.id}`, { method: 'PUT', body: { text } })).then(() =>
												setEditing(null),
											)
										}
									/>
								</div>
							) : (
								<p className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">{withMentions(c.text)}</p>
							)}
						</div>
					</li>
				))}
			</ol>
			<div className="border-t border-gray-200 p-3 dark:border-gray-700">
				<CommentBox
					key={thread.comments.length}
					placeholder="Reply"
					busy={busy}
					onCancel={onClose}
					onSend={(text) => void run(api(`/api/boards/${boardId}/comments/${thread.id}/replies`, { method: 'POST', body: { text } }))}
				/>
				{error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
			</div>
		</Floating>
	)
}

/** Every thread of the board, open or resolved; click one to go to it. */
export function CommentsPanel({
	threads,
	elements,
	onShow,
	onNew,
	showResolved,
	onShowResolved,
	onClose,
}: {
	threads: Thread[]
	elements: ElementMap
	onShow: (t: Thread) => void
	onNew: () => void
	showResolved: boolean
	onShowResolved: (on: boolean) => void
	onClose: () => void
}) {
	const list = threads.filter((t) => !!t.resolvedAt === showResolved).sort((a, b) => b.id - a.id)
	const open = threads.filter((t) => !t.resolvedAt).length
	return (
		<aside
			data-ui
			aria-label="Comments"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-0 right-0 bottom-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
		>
			<div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<h2 className="flex items-center gap-2 font-semibold">
					<MessageSquare size={18} /> Comments
				</h2>
				<button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
					<X size={18} />
					<span className="sr-only">Close</span>
				</button>
			</div>
			<div role="tablist" className="flex gap-1 border-b border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
				{[false, true].map((resolved) => (
					<button
						key={String(resolved)}
						type="button"
						role="tab"
						aria-selected={showResolved === resolved}
						onClick={() => onShowResolved(resolved)}
						className={`rounded-md px-2.5 py-1 ${showResolved === resolved ? 'bg-gray-100 font-medium dark:bg-gray-800' : 'text-gray-600 dark:text-gray-400'}`}
					>
						{resolved ? `Resolved (${threads.length - open})` : `Open (${open})`}
					</button>
				))}
			</div>
			<div className="relative min-h-0 flex-1 overflow-auto p-2 text-sm">
				{list.length === 0 && (
					<p className="p-3 text-gray-500">
						{showResolved ? 'No resolved comments.' : 'No open comments. Add one with the button below, or press C.'}
					</p>
				)}
				<ul className="space-y-1">
					{list.map((t) => {
						const first = t.comments[0]
						const gone = !pinPoint(t, elements)
						return (
							<li key={t.id}>
								<button
									type="button"
									disabled={gone}
									onClick={() => onShow(t)}
									className="flex w-full gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-100 disabled:cursor-default disabled:opacity-60 dark:hover:bg-gray-800"
								>
									<Avatar name={first?.author ?? '?'} color={first?.color ?? '#9ca3af'} size={26} />
									<span className="min-w-0 flex-1">
										<span className="flex items-baseline gap-1.5">
											<span className="truncate font-medium">{first?.author}</span>
											<span className="shrink-0 text-xs text-gray-500">{timeAgo(t.createdAt)}</span>
										</span>
										<span className="line-clamp-2 text-gray-700 dark:text-gray-300">{first?.text}</span>
										<span className="text-xs text-gray-500">
											{t.comments.length > 1 ? `${t.comments.length - 1} ${t.comments.length === 2 ? 'reply' : 'replies'}` : 'No replies'}
											{gone ? ' · its item was deleted' : ''}
										</span>
									</span>
								</button>
							</li>
						)
					})}
				</ul>
			</div>
			<div className="border-t border-gray-200 p-3 dark:border-gray-700">
				<button
					type="button"
					onClick={onNew}
					className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
				>
					<MessageSquarePlus size={16} /> New comment
				</button>
			</div>
		</aside>
	)
}

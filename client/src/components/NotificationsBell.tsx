import { AtSign, Bell, Eye, MessageSquare, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { Avatar } from './ui'

export interface AppNotification {
	id: number
	kind: 'mention' | 'follow' | 'rule' | 'comment'
	boardId: string | null
	boardName: string | null
	projectName: string | null
	elementId: string | null
	actor: { name: string; color: string } | null
	text: string
	count: number
	updatedAt: string
	read: boolean
}

const POLL_MS = 30_000

function headline(n: AppNotification) {
	const who = n.actor?.name ?? 'Someone'
	if (n.kind === 'mention') return `${who} mentioned you`
	if (n.kind === 'rule') return 'A board rule ran'
	if (n.kind === 'comment') return `${who} commented`
	return n.count > 1
		? `${n.count} changes${n.elementId ? '' : ' on a board you follow'}, last by ${who}`
		: `${who} changed ${n.elementId ? 'an item you follow' : 'a board you follow'}`
}

/** The bell in the header: notifications about boards, checked every 30 seconds and when the tab is back. */
export function NotificationsBell() {
	const navigate = useNavigate()
	const [items, setItems] = useState<AppNotification[]>([])
	const [unread, setUnread] = useState(0)
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	const load = useCallback(() => {
		api<{ unread: number; notifications: AppNotification[] }>('/api/notifications')
			.then((r) => {
				setItems(r.notifications)
				setUnread(r.unread)
			})
			.catch(() => {})
	}, [])

	useEffect(() => {
		load()
		const id = setInterval(load, POLL_MS)
		window.addEventListener('focus', load)
		return () => {
			clearInterval(id)
			window.removeEventListener('focus', load)
		}
	}, [load])

	useEffect(() => {
		if (!open) return
		const close = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false)
		}
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [open])

	async function openOne(n: AppNotification) {
		setOpen(false)
		if (!n.read) await api('/api/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {})
		load()
		if (n.boardId) navigate(`/boards/${n.boardId}${n.elementId ? `?el=${encodeURIComponent(n.elementId)}` : ''}`)
	}

	async function act(path: string, method: string, body?: unknown) {
		await api(path, { method, body }).catch(() => {})
		load()
	}

	return (
		<div ref={ref} className="relative" data-ui>
			<button
				type="button"
				onClick={() => {
					setOpen(!open)
					if (!open) load()
				}}
				aria-expanded={open}
				title="Notifications"
				className="relative rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
			>
				<Bell size={18} />
				{unread > 0 && (
					<span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
						{unread > 99 ? '99+' : unread}
					</span>
				)}
				<span className="sr-only">Notifications{unread ? `, ${unread} unread` : ''}</span>
			</button>
			{open && (
				<div className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
					<div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
						<span className="text-sm font-semibold">Notifications</span>
						<span className="flex gap-1">
							<button
								type="button"
								disabled={!unread}
								onClick={() => act('/api/notifications/read', 'POST', { all: true })}
								className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
							>
								Mark all read
							</button>
							<button
								type="button"
								disabled={!items.some((n) => n.read)}
								onClick={() => act('/api/notifications/read', 'DELETE')}
								className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
							>
								Clear read
							</button>
						</span>
					</div>
					{items.length === 0 ? (
						<p className="px-3 py-6 text-center text-sm text-gray-500">No notifications.</p>
					) : (
						<ul className="relative max-h-96 overflow-auto py-1">
							{items.map((n) => {
								const Icon = n.kind === 'mention' ? AtSign : n.kind === 'rule' ? Zap : n.kind === 'comment' ? MessageSquare : Eye
								return (
									<li key={n.id}>
										<button
											type="button"
											onClick={() => openOne(n)}
											className={`flex w-full gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${n.read ? 'opacity-70' : ''}`}
										>
											<span className="relative mt-0.5 shrink-0">
												{n.actor ? (
													<Avatar name={n.actor.name} color={n.actor.color} size={28} />
												) : (
													<span className="inline-block size-7" />
												)}
												<Icon
													size={13}
													className="absolute -right-1 -bottom-1 rounded-full bg-white p-0.5 text-brand-600 dark:bg-gray-900"
												/>
											</span>
											<span className="min-w-0 flex-1">
												<span className={`block text-sm ${n.read ? '' : 'font-semibold'}`}>{headline(n)}</span>
												<span className="line-clamp-2 block text-xs text-gray-600 dark:text-gray-300">{n.text}</span>
												<span className="block text-xs text-gray-500">
													{n.boardName} · {timeAgo(n.updatedAt)}
												</span>
											</span>
											{!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
										</button>
									</li>
								)
							})}
						</ul>
					)}
				</div>
			)}
		</div>
	)
}

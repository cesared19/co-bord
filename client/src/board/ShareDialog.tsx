import { Check, Copy, Link2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, ErrorText, Modal } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'

interface ShareLink {
	id: number
	token: string
	createdAt: string
	createdBy: string | null
	expiresAt: string | null
	expired: boolean
}

/** Copies text, also without HTTPS (where the clipboard API isn't there). */
async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
	} catch {
		const t = document.createElement('textarea')
		t.value = text
		document.body.append(t)
		t.select()
		document.execCommand('copy')
		t.remove()
	}
}

const EXPIRY = [
	{ label: 'Never', days: null },
	{ label: '1 day', days: 1 },
	{ label: '7 days', days: 7 },
	{ label: '30 days', days: 30 },
]

/** Sharing a board: the link for members, and read-only guest links (owners). */
export function ShareDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
	const [links, setLinks] = useState<ShareLink[] | null>(null)
	const [days, setDays] = useState<number | null>(7)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [copied, setCopied] = useState<string | null>(null)
	const guestUrl = (token: string) => `${window.location.origin}/g/${token}`

	const load = useCallback(async () => {
		try {
			setLinks((await api<{ links: ShareLink[] }>(`/api/boards/${boardId}/share-links`)).links)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [boardId])
	useEffect(() => {
		void load()
	}, [load])

	const copy = async (key: string, text: string) => {
		await copyText(text)
		setCopied(key)
		setTimeout(() => setCopied(null), 1500)
	}
	const run = async (fn: () => Promise<unknown>) => {
		setBusy(true)
		setError('')
		try {
			await fn()
			await load()
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Modal title="Share the board" onClose={onClose}>
			<div className="space-y-5 text-sm">
				<section className="space-y-2">
					<h3 className="font-medium">People in the project</h3>
					<div className="flex gap-2">
						<input
							readOnly
							value={`${window.location.origin}/boards/${boardId}`}
							aria-label="Link for members"
							className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-800"
						/>
						<Button variant="secondary" onClick={() => void copy('members', `${window.location.origin}/boards/${boardId}`)}>
							{copied === 'members' ? <Check size={15} /> : <Copy size={15} />} Copy
						</Button>
					</div>
				</section>
				<section className="space-y-2">
					<h3 className="font-medium">Guests, without an account</h3>
					<p className="text-xs text-gray-600 dark:text-gray-400">
						Anyone with a guest link sees this board live, read-only, without comments or the project's integrations. Without HTTPS the link
						isn't encrypted on the way: share it inside your network. Revoke it to close it at once.
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<label className="flex items-center gap-2 text-xs">
							Expires
							<select
								value={days ?? ''}
								onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}
								className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
							>
								{EXPIRY.map((o) => (
									<option key={o.label} value={o.days ?? ''}>
										{o.label === 'Never' ? 'Never' : `In ${o.label}`}
									</option>
								))}
							</select>
						</label>
						<Button
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const link = await api<{ token: string }>(`/api/boards/${boardId}/share-links`, {
										method: 'POST',
										body: days ? { expiresInDays: days } : {},
									})
									await copy('new', guestUrl(link.token))
								})
							}
						>
							<Link2 size={15} /> Create a guest link
						</Button>
						{copied === 'new' && <span className="text-xs text-green-700 dark:text-green-400">Created and copied</span>}
					</div>
					<ErrorText>{error}</ErrorText>
					{links && links.length > 0 && (
						<ul
							className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700"
							aria-label="Guest links"
						>
							{links.map((l) => (
								<li key={l.id} className="flex items-center gap-2 px-3 py-2">
									<div className="min-w-0 flex-1">
										<p className="truncate font-mono text-xs">{guestUrl(l.token)}</p>
										<p className="text-xs text-gray-500">
											{l.createdBy ?? 'Someone'}, {timeAgo(l.createdAt)} ·{' '}
											{l.expired ? (
												<span className="text-red-600 dark:text-red-400">expired</span>
											) : l.expiresAt ? (
												`until ${new Date(l.expiresAt).toLocaleDateString()}`
											) : (
												"doesn't expire"
											)}
										</p>
									</div>
									{!l.expired && (
										<button
											type="button"
											onClick={() => void copy(`l${l.id}`, guestUrl(l.token))}
											className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
											title="Copy"
										>
											{copied === `l${l.id}` ? <Check size={15} /> : <Copy size={15} />}
											<span className="sr-only">Copy the guest link</span>
										</button>
									)}
									<button
										type="button"
										disabled={busy}
										onClick={() => void run(() => api(`/api/boards/${boardId}/share-links/${l.id}`, { method: 'DELETE' }))}
										className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
										title="Revoke"
									>
										<Trash2 size={15} />
										<span className="sr-only">Revoke the guest link</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</section>
			</div>
		</Modal>
	)
}

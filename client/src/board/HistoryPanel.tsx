import { History, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import { Button, ErrorText, Modal } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { renderPng } from './exportPng'
import type { ElementMap } from './geometry'
import type { BoardElement } from './types'

interface Version {
	id: number
	name: string | null
	auto: boolean
	createdAt: string
	createdBy: string | null
}

const label = (v: Version) => v.name ?? new Date(v.createdAt).toLocaleString()

/**
 * Saved versions of the board: automatic ones every 10 minutes of editing (kept 30 days) and named ones.
 * Anyone can look at one; editors save, name, restore and delete them.
 */
export function HistoryPanel({
	boardId,
	readOnly,
	dark,
	onClose,
}: {
	boardId: string
	readOnly: boolean
	dark: boolean
	onClose: () => void
}) {
	const [versions, setVersions] = useState<Version[] | null>(null)
	const [error, setError] = useState('')
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)
	const [preview, setPreview] = useState<Version | null>(null)

	const load = useCallback(async () => {
		try {
			setVersions((await api<{ versions: Version[] }>(`/api/boards/${boardId}/versions`)).versions)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [boardId])
	useEffect(() => {
		void load()
	}, [load])

	async function run(call: () => Promise<unknown>) {
		setBusy(true)
		setError('')
		try {
			await call()
			await load()
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<aside
			data-ui
			aria-label="Version history"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-0 right-0 bottom-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
		>
			<div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<h2 className="flex items-center gap-2 font-semibold">
					<History size={18} /> Version history
				</h2>
				<button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
					<X size={18} />
					<span className="sr-only">Close</span>
				</button>
			</div>
			{!readOnly && (
				<form
					className="flex gap-2 border-b border-gray-200 p-3 dark:border-gray-700"
					onSubmit={(e) => {
						e.preventDefault()
						if (name.trim())
							void run(async () => {
								await api(`/api/boards/${boardId}/versions`, { method: 'POST', body: { name: name.trim() } })
								setName('')
							})
					}}
				>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						maxLength={200}
						placeholder="Name this version"
						aria-label="Version name"
						className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
					/>
					<button
						type="submit"
						disabled={busy || !name.trim()}
						className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
					>
						<Save size={15} /> Save
					</button>
				</form>
			)}
			<div className="relative min-h-0 flex-1 overflow-auto p-2 text-sm">
				{error && <p className="p-2 text-red-600 dark:text-red-400">{error}</p>}
				{versions?.length === 0 && <p className="p-3 text-gray-500">No versions yet. One is saved every 10 minutes while people edit.</p>}
				<ul className="space-y-1">
					{versions?.map((v) => (
						<li key={v.id}>
							<button
								type="button"
								onClick={() => setPreview(v)}
								className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium">{label(v)}</span>
									<span className="text-xs text-gray-500">
										{v.auto ? 'Automatic · ' : ''}
										{timeAgo(v.createdAt)}
										{v.createdBy ? ` · ${v.createdBy}` : ''}
									</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			</div>
			<p className="border-t border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-700">
				Automatic versions are kept 30 days; named ones are kept.
			</p>
			{preview && (
				<VersionPreview
					boardId={boardId}
					version={preview}
					readOnly={readOnly}
					dark={dark}
					onClose={() => setPreview(null)}
					onChanged={() => void load()}
				/>
			)}
		</aside>
	)
}

function VersionPreview({
	boardId,
	version,
	readOnly,
	dark,
	onClose,
	onChanged,
}: {
	boardId: string
	version: Version
	readOnly: boolean
	dark: boolean
	onClose: () => void
	onChanged: () => void
}) {
	const [image, setImage] = useState<string | null>(null)
	const [empty, setEmpty] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [naming, setNaming] = useState(false)
	const [name, setName] = useState(version.name ?? '')
	const [restored, setRestored] = useState(false)

	useEffect(() => {
		let url: string | null = null
		let cancelled = false
		;(async () => {
			const res = await fetch(`/api/boards/${boardId}/versions/${version.id}`, { credentials: 'same-origin' })
			if (!res.ok) throw new Error(`The version can't be read (${res.status})`)
			const doc = new Y.Doc()
			Y.applyUpdate(doc, new Uint8Array(await res.arrayBuffer()))
			const elements: ElementMap = new Map()
			doc.getMap<BoardElement>('elements').forEach((el, id) => elements.set(id, el))
			if (!elements.size) return setEmpty(true)
			const blob = await renderPng(elements, dark)
			if (cancelled || !blob) return
			url = URL.createObjectURL(blob)
			setImage(url)
		})().catch((e: Error) => !cancelled && setError(e.message))
		return () => {
			cancelled = true
			if (url) URL.revokeObjectURL(url)
		}
	}, [boardId, version.id, dark])

	async function call(fn: () => Promise<unknown>) {
		setBusy(true)
		setError('')
		try {
			await fn()
			onChanged()
			return true
		} catch (e) {
			setError((e as Error).message)
			return false
		} finally {
			setBusy(false)
		}
	}

	return (
		<Modal title={label(version)} onClose={onClose}>
			<div className="space-y-3 text-sm">
				<p className="text-xs text-gray-500">
					{version.auto ? 'Saved automatically' : 'Saved'} {new Date(version.createdAt).toLocaleString()}
					{version.createdBy ? ` · ${version.createdBy}` : ''}
				</p>
				<div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
					{image ? (
						<img src={image} alt={`The board in the version ${label(version)}`} className="max-h-[50vh] w-full object-contain" />
					) : empty ? (
						<span className="text-gray-500">The board was empty.</span>
					) : (
						!error && <span className="text-gray-500">Drawing the version…</span>
					)}
				</div>
				{restored && (
					<p role="status" className="text-green-700 dark:text-green-400">
						Restored. The board as it was before is saved as a version too.
					</p>
				)}
				<ErrorText>{error}</ErrorText>
				{naming && (
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault()
							void call(() => api(`/api/boards/${boardId}/versions/${version.id}`, { method: 'PUT', body: { name: name.trim() } })).then(
								(ok) => ok && setNaming(false),
							)
						}}
					>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							maxLength={200}
							required
							aria-label="Version name"
							className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-600 dark:bg-gray-800"
						/>
						<Button type="submit" disabled={busy || !name.trim()}>
							Save name
						</Button>
					</form>
				)}
				<div className="flex flex-wrap justify-end gap-2">
					{!readOnly && (
						<>
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() => {
									if (window.confirm(`Delete the version ${label(version)}?`))
										void call(() => api(`/api/boards/${boardId}/versions/${version.id}`, { method: 'DELETE' })).then(
											(ok) => ok && onClose(),
										)
								}}
							>
								<Trash2 size={15} /> Delete
							</Button>
							{!naming && (
								<Button variant="secondary" disabled={busy} onClick={() => setNaming(true)}>
									<Pencil size={15} /> {version.name ? 'Rename' : 'Name it'}
								</Button>
							)}
							<Button
								disabled={busy || restored}
								onClick={() =>
									void call(() => api(`/api/boards/${boardId}/versions/${version.id}/restore`, { method: 'POST' })).then(
										(ok) => ok && setRestored(true),
									)
								}
							>
								<RotateCcw size={15} /> Restore this version
							</Button>
						</>
					)}
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
				</div>
			</div>
		</Modal>
	)
}

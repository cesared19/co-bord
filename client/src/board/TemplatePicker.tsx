import { FileUp, LayoutTemplate, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ErrorText, Field, Modal } from '../components/ui'
import { api } from '../lib/api'
import { renderPng } from './exportPng'
import type { ElementMap } from './geometry'
import { csvToElements, importCoBordFile, MAX_ROWS, parseCsv, templateElements } from './importExport'
import { TEMPLATES } from './templates'
import type { BoardElement } from './types'

interface ProjectTemplate {
	id: number
	name: string
	description: string
	elementCount: number
	createdBy: number | null
	createdByName: string | null
	thumbnail: string | null
}

type Tab = 'co-bord' | 'project' | 'import'

/**
 * Adding to the board: co-bord's templates, the project's own templates, or importing a CSV of notes (Miro's
 * too) or a co-bord file.
 */
export function TemplatePicker({
	projectId,
	boardId,
	userId,
	owner,
	onInsert,
	onSaveBoard,
	onClose,
}: {
	projectId: number
	boardId: string
	userId: number
	/** Owners delete anyone's templates. */
	owner: boolean
	onInsert: (elements: BoardElement[]) => Promise<void> | void
	onSaveBoard: () => void
	onClose: () => void
}) {
	const [tab, setTab] = useState<Tab>('co-bord')
	const [templates, setTemplates] = useState<ProjectTemplate[] | null>(null)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState('')
	const fileRef = useRef<HTMLInputElement>(null)

	const load = useCallback(async () => {
		try {
			setTemplates((await api<{ templates: ProjectTemplate[] }>(`/api/projects/${projectId}/templates`)).templates)
		} catch (e) {
			setError((e as Error).message)
		}
	}, [projectId])
	useEffect(() => {
		void load()
	}, [load])

	async function insert(load: () => Promise<BoardElement[]>) {
		setError('')
		try {
			const elements = await load()
			if (!elements.length) throw new Error('There was nothing to add')
			await onInsert(elements)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy('')
		}
	}

	async function importFile(file: File) {
		setBusy(`Reading ${file.name}…`)
		await insert(async () => {
			if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
				const { elements, skipped } = csvToElements(parseCsv(await file.text()))
				if (skipped) setError(`Only the first ${MAX_ROWS} rows were added.`)
				return elements
			}
			return importCoBordFile(file, boardId, setBusy)
		})
	}

	const tabButton = (id: Tab, label: string) => (
		<button
			type="button"
			role="tab"
			aria-selected={tab === id}
			onClick={() => setTab(id)}
			className={`rounded-md px-2.5 py-1 text-sm ${tab === id ? 'bg-gray-100 font-medium dark:bg-gray-800' : 'text-gray-600 dark:text-gray-400'}`}
		>
			{label}
		</button>
	)
	const card =
		'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-left hover:border-brand-500 hover:bg-brand-50 dark:border-gray-700 dark:hover:bg-brand-900/20'

	return (
		<Modal title="Add to the board" onClose={onClose}>
			<div role="tablist" className="mb-3 flex gap-1">
				{tabButton('co-bord', 'Templates')}
				{tabButton('project', `Project${templates?.length ? ` (${templates.length})` : ''}`)}
				{tabButton('import', 'Import')}
			</div>
			<p className="mb-3 text-sm text-gray-600 dark:text-gray-400">It's added next to what is on the board.</p>
			{tab === 'co-bord' && (
				<ul className="space-y-2">
					{TEMPLATES.map((t) => (
						<li key={t.id}>
							<button type="button" onClick={() => void insert(async () => t.build())} className={card}>
								<span className="block text-sm font-medium">{t.name}</span>
								<span className="block text-xs text-gray-600 dark:text-gray-400">{t.description}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{tab === 'project' && (
				<div className="space-y-3">
					{templates?.length === 0 && <p className="text-sm text-gray-500">No project templates yet. Save a board or a frame as one.</p>}
					<ul className="grid gap-2 sm:grid-cols-2">
						{templates?.map((t) => (
							<li key={t.id} className="relative">
								<button
									type="button"
									onClick={() => {
										setBusy(`Adding ${t.name}…`)
										void insert(
											async () => (await api<{ elements: BoardElement[] }>(`/api/projects/${projectId}/templates/${t.id}`)).elements,
										)
									}}
									className={`${card} h-full`}
								>
									<span className="mb-2 flex h-24 items-center justify-center overflow-hidden rounded bg-gray-50 dark:bg-gray-800">
										{t.thumbnail ? (
											<img src={t.thumbnail} alt="" className="max-h-full max-w-full object-contain" />
										) : (
											<LayoutTemplate size={28} className="text-gray-400" />
										)}
									</span>
									<span className="block truncate pr-6 text-sm font-medium">{t.name}</span>
									{t.description && <span className="line-clamp-2 block text-xs text-gray-600 dark:text-gray-400">{t.description}</span>}
									<span className="block text-xs text-gray-500">
										{t.elementCount} {t.elementCount === 1 ? 'item' : 'items'}
										{t.createdByName ? ` · ${t.createdByName}` : ''}
									</span>
								</button>
								{(t.createdBy === userId || owner) && (
									<button
										type="button"
										onClick={() => {
											if (!window.confirm(`Delete the template ${t.name}?`)) return
											void api(`/api/projects/${projectId}/templates/${t.id}`, { method: 'DELETE' })
												.then(load)
												.catch((e: Error) => setError(e.message))
										}}
										className="absolute right-2 bottom-2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
										title="Delete the template"
									>
										<Trash2 size={14} />
										<span className="sr-only">Delete the template {t.name}</span>
									</button>
								)}
							</li>
						))}
					</ul>
					<Button variant="secondary" onClick={onSaveBoard}>
						<Save size={15} /> Save this board as a template
					</Button>
					<p className="text-xs text-gray-500">To save just a frame, select it and use the template button in its toolbar.</p>
				</div>
			)}
			{tab === 'import' && (
				<div className="space-y-3 text-sm">
					<p className="text-gray-600 dark:text-gray-400">
						<strong>CSV</strong>: one sticky note per row, from a <code>text</code> column (and optional <code>color</code>,{' '}
						<code>frame</code> or <code>column</code>, and <code>tags</code>), or Miro's CSV export of sticky notes. Rows with a frame are
						grouped in frames.
					</p>
					<p className="text-gray-600 dark:text-gray-400">
						<strong>co-bord file</strong> (.zip): a board or frame downloaded from co-bord, with its files.
					</p>
					<input
						ref={fileRef}
						type="file"
						accept=".csv,text/csv,.zip,application/zip,.json,application/json"
						className="sr-only"
						aria-label="File to import"
						onChange={(e) => {
							const file = e.target.files?.[0]
							e.target.value = ''
							if (file) void importFile(file)
						}}
					/>
					<Button onClick={() => fileRef.current?.click()} disabled={!!busy}>
						<FileUp size={15} /> Choose a file
					</Button>
				</div>
			)}
			{busy && (
				<p role="status" className="mt-3 text-sm text-gray-600 dark:text-gray-400">
					{busy}
				</p>
			)}
			<div className="mt-3">
				<ErrorText>{error}</ErrorText>
			</div>
		</Modal>
	)
}

/** Saving the board, or a frame with what's inside, as a project template, with a small picture. */
export function SaveTemplateDialog({
	projectId,
	elements,
	frameId,
	boardName,
	onClose,
}: {
	projectId: number
	elements: ElementMap
	frameId: string | null
	boardName: string
	onClose: () => void
}) {
	const frame = frameId ? elements.get(frameId) : undefined
	const [name, setName] = useState(frame?.type === 'frame' ? frame.title || 'Frame' : boardName)
	const [description, setDescription] = useState('')
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [done, setDone] = useState(false)

	async function save() {
		setBusy(true)
		setError('')
		try {
			const list = templateElements(elements, frameId)
			const png = await renderPng(
				elements,
				false,
				list.map((e) => e.id),
			)
			let thumbnail: string | undefined
			if (png) {
				const bitmap = await createImageBitmap(png)
				const scale = Math.min(1, 480 / bitmap.width, 320 / bitmap.height)
				const canvas = document.createElement('canvas')
				canvas.width = Math.max(1, Math.round(bitmap.width * scale))
				canvas.height = Math.max(1, Math.round(bitmap.height * scale))
				canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
				thumbnail = canvas.toDataURL('image/png')
			}
			await api(`/api/projects/${projectId}/templates`, {
				method: 'POST',
				body: { name: name.trim(), description: description.trim(), elements: list, thumbnail },
			})
			setDone(true)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<Modal title={frame ? 'Save the frame as a template' : 'Save the board as a template'} onClose={onClose}>
			{done ? (
				<div className="space-y-3 text-sm">
					<p>Saved. Everyone in the project finds it in Templates, under Project.</p>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
				</div>
			) : (
				<form
					className="space-y-4"
					onSubmit={(e) => {
						e.preventDefault()
						void save()
					}}
				>
					<Field label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
					<Field label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
					<p className="text-xs text-gray-500">
						Images, videos and PDFs are kept with it. Jira issues and done marks aren't; links to SparkyTC tests are.
					</p>
					<ErrorText>{error}</ErrorText>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || !name.trim()}>
							{busy ? 'Saving…' : 'Save template'}
						</Button>
					</div>
				</form>
			)}
		</Modal>
	)
}

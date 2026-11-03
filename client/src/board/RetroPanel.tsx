import { ClipboardCopy, LayoutList, PanelRightClose, Sparkles, StickyNote } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { ElementMap } from './geometry'
import {
	aiInput,
	aiSections,
	type AiSummary,
	arrangeGroups,
	groupNotes,
	insertSummary,
	readRetro,
	retroScopes,
	ruleSummary,
	type SummarySection,
	summaryMarkdown,
} from './retro'
import type { BoardStore } from './store'

/** Copies text, also without HTTPS where the clipboard API isn't available. */
async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
		return
	} catch {
		// fall back below
	}
	const area = document.createElement('textarea')
	area.value = text
	document.body.append(area)
	area.select()
	document.execCommand('copy')
	area.remove()
}

/**
 * Guided retrospective: groups similar notes in each column, and summarizes the retro from the board's votes and
 * action items, or with Claude when the server has an API key. The summary can be copied, added to the board or
 * published to Confluence.
 */
export function RetroPanel({
	store,
	elements,
	boardId,
	votes,
	voters,
	readOnly,
	canPublish,
	onPublish,
	onShow,
	onClose,
}: {
	store: BoardStore
	elements: ElementMap
	boardId: string
	votes: Map<string, number>
	voters: number
	readOnly: boolean
	canPublish: boolean
	onPublish: (scopeId: string, sections: SummarySection[]) => void
	onShow: (id: string) => void
	onClose: () => void
}) {
	const scopes = useMemo(() => retroScopes(elements), [elements])
	const [scopeId, setScopeId] = useState(scopes[0]?.id ?? '')
	const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0]
	const retro = useMemo(() => (scope ? readRetro(scope, elements, votes) : null), [scope, elements, votes])
	const [aiEnabled, setAiEnabled] = useState(false)
	const [ai, setAi] = useState<AiSummary | null>(null)
	const [useAi, setUseAi] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		api<{ enabled: boolean }>('/api/ai')
			.then((r) => setAiEnabled(r.enabled))
			.catch(() => {})
	}, [])
	useEffect(() => {
		setAi(null)
		setUseAi(false)
	}, [scope?.id])

	const sections = retro ? (useAi && ai ? aiSections(ai, retro.scope.title) : ruleSummary(retro, voters)) : []

	async function writeWithClaude() {
		if (!retro) return
		setBusy(true)
		setError('')
		try {
			setAi(await api<AiSummary>(`/api/boards/${boardId}/retro/summary`, { method: 'POST', body: aiInput(retro) }))
			setUseAi(true)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	const btn =
		'inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800'
	return (
		<aside
			data-ui
			aria-label="Retrospective"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-0 right-0 bottom-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
		>
			<div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<h2 className="flex items-center gap-2 font-semibold">
					<StickyNote size={18} /> Retrospective
				</h2>
				<button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
					<PanelRightClose size={18} />
					<span className="sr-only">Close</span>
				</button>
			</div>
			{!retro ? (
				<p className="p-4 text-sm text-gray-600 dark:text-gray-400">
					No retrospective on this board. Add one from Templates: a retrospective is a frame with a frame per column inside.
				</p>
			) : (
				<>
					<div className="relative min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
						{scopes.length > 1 && (
							<label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
								Retrospective
								<select
									value={scope?.id}
									onChange={(e) => setScopeId(e.target.value)}
									className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
								>
									{scopes.map((s) => (
										<option key={s.id} value={s.id}>
											{s.title || 'Frame'}
										</option>
									))}
								</select>
							</label>
						)}
						<section className="space-y-2">
							<h3 className="font-medium">Columns</h3>
							<ul className="space-y-1">
								{retro.columns.map((c) => {
									const groups = groupNotes(c.notes).filter((g) => g.notes.length > 1 && g.label !== 'Other')
									return (
										<li key={c.frame.id}>
											<button
												type="button"
												onClick={() => onShow(c.frame.id)}
												className="w-full rounded-md px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
											>
												<span className="font-medium">{c.frame.title || 'Column'}</span>{' '}
												<span className="text-gray-500">
													{c.notes.length} {c.notes.length === 1 ? 'note' : 'notes'}
													{groups.length ? ` · ${groups.length} ${groups.length === 1 ? 'group' : 'groups'} of similar notes` : ''}
												</span>
											</button>
										</li>
									)
								})}
								{retro.actions && (
									<li className="px-2 text-gray-500">
										{retro.actions.frame.title}: {retro.actions.notes.length} {retro.actions.notes.length === 1 ? 'note' : 'notes'}
									</li>
								)}
							</ul>
							{!readOnly && (
								<button
									type="button"
									className={btn}
									onClick={() => arrangeGroups(store, retro, elements)}
									disabled={!retro.columns.some((c) => c.notes.length > 1)}
								>
									<LayoutList size={14} /> Group similar notes
								</button>
							)}
						</section>

						<section className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
							<div className="flex items-center justify-between gap-2">
								<h3 className="font-medium">Summary</h3>
								{ai && (
									<div
										role="radiogroup"
										aria-label="Summary source"
										className="flex rounded-md border border-gray-300 p-0.5 text-xs dark:border-gray-600"
									>
										{[
											{ value: false, label: 'From the board' },
											{ value: true, label: 'By Claude' },
										].map((o) => (
											<button
												key={o.label}
												type="button"
												role="radio"
												aria-checked={useAi === o.value}
												onClick={() => setUseAi(o.value)}
												className={`rounded px-1.5 py-0.5 ${useAi === o.value ? 'bg-gray-100 font-medium dark:bg-gray-800' : 'text-gray-500'}`}
											>
												{o.label}
											</button>
										))}
									</div>
								)}
							</div>
							<div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
								{sections.map((s, i) => (
									<div key={i}>
										<p className={i === 0 ? 'font-semibold' : 'font-medium'}>{s.heading}</p>
										{s.text && <p className="text-gray-600 dark:text-gray-300">{s.text}</p>}
										{s.items.length > 0 && (
											<ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700 dark:text-gray-200">
												{s.items.map((item, j) => (
													<li key={j}>{item}</li>
												))}
											</ul>
										)}
									</div>
								))}
							</div>
							{voters === 0 && !useAi && <p className="text-xs text-gray-500">Run a vote (timer button) to rank the notes.</p>}
							{aiEnabled && !readOnly && (
								<div className="space-y-1">
									<button
										type="button"
										className={btn}
										onClick={writeWithClaude}
										disabled={busy || !retro.columns.some((c) => c.notes.length)}
									>
										<Sparkles size={14} /> {busy ? 'Writing…' : ai ? 'Write again with Claude' : 'Write with Claude'}
									</button>
									<p className="text-xs text-gray-500">The notes and votes are sent to Anthropic's API to write it.</p>
								</div>
							)}
							{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
						</section>
					</div>
					<div className="flex flex-wrap gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
						<button
							type="button"
							className={btn}
							onClick={async () => {
								await copyText(summaryMarkdown(sections))
								setCopied(true)
								setTimeout(() => setCopied(false), 1500)
							}}
						>
							<ClipboardCopy size={14} /> {copied ? 'Copied' : 'Copy'}
						</button>
						{!readOnly && (
							<button
								type="button"
								className={btn}
								onClick={() => {
									const id = insertSummary(store, retro, sections)
									onShow(id)
								}}
							>
								<StickyNote size={14} /> Add to the board
							</button>
						)}
						{canPublish && (
							<button type="button" className={btn} onClick={() => onPublish(retro.scope.id, sections)}>
								Publish to Confluence
							</button>
						)}
					</div>
				</>
			)}
		</aside>
	)
}

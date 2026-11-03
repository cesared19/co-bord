import { CheckCircle2, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, ErrorText, Modal } from '../components/ui'
import { api } from '../lib/api'
import type { ConfluenceInfo, Publication } from './confluence'
import { renderPng } from './exportPng'
import { type ElementMap, withFrameContents } from './geometry'
import type { SummarySection } from './retro'
import { useCoverage } from './SparkyLinks'

/**
 * Publishes the board or one frame as a Confluence page, with its picture attached and, when the project is
 * connected to SparkyTC, its test coverage. The page published before can be updated instead of adding one.
 */
export function PublishDialog({
	boardId,
	boardName,
	projectId,
	elements,
	confluence,
	withCoverage,
	initialFrameId,
	summary,
	onClose,
}: {
	boardId: string
	boardName: string
	projectId: number
	elements: ElementMap
	confluence: ConfluenceInfo
	/** The project is connected to SparkyTC. */
	withCoverage: boolean
	initialFrameId: string | null
	/** A retrospective summary to add to the page. */
	summary?: SummarySection[] | null
	onClose: () => void
}) {
	const frames = useMemo(
		() => [...elements.values()].filter((el) => el.type === 'frame').sort((a, b) => a.y - b.y || a.x - b.x),
		[elements],
	)
	const [scope, setScope] = useState(initialFrameId ?? '')
	const frame = frames.find((f) => f.id === scope)
	const scopeName = frame?.type === 'frame' ? frame.title || 'Frame' : boardName
	const [title, setTitle] = useState(scopeName)
	const [includeCoverage, setIncludeCoverage] = useState(withCoverage && !summary)
	const [includeSummary, setIncludeSummary] = useState(!!summary)
	const [publications, setPublications] = useState<Publication[]>([])
	const [update, setUpdate] = useState(true)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [done, setDone] = useState<{ url: string; updated: boolean } | null>(null)
	const coverage = useCoverage(projectId, elements, frame?.id ?? null, '', withCoverage && includeCoverage)
	// results arrive a moment after opening; the report waits for them
	const coverageReady = !coverage.loading && (coverage.covered.length === 0 || coverage.results.size > 0 || !!coverage.error)

	useEffect(() => {
		api<{ publications: Publication[] }>(`/api/boards/${boardId}/confluence/publications`)
			.then((r) => setPublications(r.publications))
			.catch(() => {})
	}, [boardId])

	const previous = publications.find((p) => (p.frameId ?? '') === (frame?.id ?? ''))
	useEffect(() => setTitle(previous?.title ?? scopeName), [scopeName, previous?.title])

	async function publish() {
		setBusy(true)
		setError('')
		try {
			// documents read better in light colors
			const ids = frame ? withFrameContents([frame.id], elements) : undefined
			const image = elements.size ? await renderPng(elements, false, ids) : null
			const form = new FormData()
			form.append(
				'meta',
				JSON.stringify({
					title: title.trim(),
					frameId: frame?.id,
					scopeName,
					boardUrl: `${window.location.origin}/boards/${boardId}`,
					update: !!previous && update,
					coverage: withCoverage && includeCoverage ? coverage.report() : undefined,
					summary: summary && includeSummary ? { sections: summary } : undefined,
				}),
			)
			if (image) form.append('image', image, 'board.png')
			const res = await fetch(`/api/boards/${boardId}/confluence/publish`, { method: 'POST', body: form, credentials: 'same-origin' })
			const data = await res.json()
			if (!res.ok) throw new Error(data.error ?? `Publishing failed (${res.status})`)
			setDone(data)
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setBusy(false)
		}
	}

	const select = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900'
	return (
		<Modal title="Publish to Confluence" onClose={onClose}>
			{done ? (
				<div className="space-y-4 text-sm">
					<p className="flex items-center gap-2">
						<CheckCircle2 size={18} className="text-green-600" />
						{done.updated ? 'The page was updated.' : 'The page was created.'}
					</p>
					<div className="flex gap-2">
						<a
							href={done.url}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700"
						>
							<ExternalLink size={16} /> Open in Confluence
						</a>
						<Button variant="secondary" onClick={onClose}>
							Close
						</Button>
					</div>
				</div>
			) : (
				<form
					className="space-y-4 text-sm"
					onSubmit={(e) => {
						e.preventDefault()
						void publish()
					}}
				>
					<label className="block">
						<span className="mb-1 block font-medium">What</span>
						<select value={scope} onChange={(e) => setScope(e.target.value)} className={select}>
							<option value="">The whole board</option>
							{frames.map((f) => (
								<option key={f.id} value={f.id}>
									Frame: {f.type === 'frame' ? f.title || 'Frame' : ''}
								</option>
							))}
						</select>
					</label>
					<label className="block">
						<span className="mb-1 block font-medium">Page title</span>
						<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} className={select} />
					</label>
					{previous && (
						<label className="flex items-start gap-2">
							<input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} className="mt-0.5 accent-brand-600" />
							<span>
								Update the page published before{' '}
								<a
									href={previous.url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-brand-600 hover:underline dark:text-brand-300"
								>
									{previous.title}
								</a>
								<span className="block text-xs text-gray-500">
									{new Date(previous.publishedAt).toLocaleString()}
									{previous.publishedBy ? ` by ${previous.publishedBy}` : ''}. Otherwise a new page is created.
								</span>
							</span>
						</label>
					)}
					{summary && (
						<label className="flex items-start gap-2">
							<input
								type="checkbox"
								checked={includeSummary}
								onChange={(e) => setIncludeSummary(e.target.checked)}
								className="mt-0.5 accent-brand-600"
							/>
							<span>
								Include the retrospective summary
								<span className="block text-xs text-gray-500">{summary.length} sections</span>
							</span>
						</label>
					)}
					{withCoverage && (
						<label className="flex items-start gap-2">
							<input
								type="checkbox"
								checked={includeCoverage}
								onChange={(e) => setIncludeCoverage(e.target.checked)}
								className="mt-0.5 accent-brand-600"
							/>
							<span>
								Include the test coverage
								<span className="block text-xs text-gray-500">
									{!coverageReady
										? 'Reading results…'
										: `${coverage.percent}% of ${coverage.steps.length} steps${coverage.shownBuild ? `, build ${coverage.shownBuild.buildNumber}` : ''}`}
								</span>
							</span>
						</label>
					)}
					<p className="text-xs text-gray-500">
						In the space {confluence.spaceName ?? confluence.spaceKey}
						{!previous || !update ? (confluence.parentId ? ', under the parent page set in the project' : '') : ''}. The picture is attached
						to the page.
					</p>
					<ErrorText>{error}</ErrorText>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || !title.trim() || (includeCoverage && withCoverage && !coverageReady)}>
							{busy ? 'Publishing…' : 'Publish'}
						</Button>
					</div>
				</form>
			)}
		</Modal>
	)
}

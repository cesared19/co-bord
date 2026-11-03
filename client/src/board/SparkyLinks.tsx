import { CircleCheck, CircleDashed, CircleX, ExternalLink, FlaskConical, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { elementBounds, type ElementMap, frameContents, toScreen } from './geometry'
import {
	elementStatus,
	type LinkResult,
	linkKey,
	STATUS_STYLE,
	type SparkyInfo,
	type SparkyStatus,
	sparkyHref,
	useLinkResults,
	worstStatus,
} from './sparky'
import type { BoardElement, Camera, SparkyLink, TextBox } from './types'

const KINDS: { kind: SparkyLink['kind']; label: string }[] = [
	{ kind: 'case', label: 'Test cases' },
	{ kind: 'section', label: 'Suites and sections' },
	{ kind: 'plan', label: 'Test plans' },
]

interface SearchItem {
	link: SparkyLink
	detail?: string
}

function toItem(kind: SparkyLink['kind'], raw: Record<string, unknown>): SearchItem {
	if (kind === 'case')
		return {
			link: { kind, id: String(raw.testCaseNumber), label: `#${raw.testCaseNumber} ${raw.title}` },
			detail: raw.sectionPath as string | undefined,
		}
	if (kind === 'section')
		return { link: { kind, id: String(raw.sectionID), label: String(raw.path) }, detail: `${raw.testCaseCount} test cases` }
	return { link: { kind, id: String(raw.testPlanID), label: String(raw.name) }, detail: `${raw.testCaseCount} test cases` }
}

export function StatusDot({ status, size = 10 }: { status: SparkyStatus | null | undefined; size?: number }) {
	const color = status ? STATUS_STYLE[status].color : '#9ca3af'
	return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />
}

export function StatusLabel({ status }: { status: SparkyStatus | null | undefined }) {
	if (!status) return <span className="text-gray-500">No result</span>
	return <span style={{ color: STATUS_STYLE[status].color }}>{STATUS_STYLE[status].label}</span>
}

function resultDetail(result: LinkResult | undefined) {
	if (!result) return 'Loading…'
	if (result.missing) return 'Not found in SparkyTC anymore'
	if (result.counts) {
		const c = result.counts
		const parts = [
			c.passed && `${c.passed} passed`,
			c.failed && `${c.failed} failed`,
			c.blocked && `${c.blocked} blocked`,
			c.skipped && `${c.skipped} skipped`,
			c.notRun && `${c.notRun} not run`,
		].filter(Boolean)
		return `${c.total} test cases${parts.length ? `: ${parts.join(', ')}` : ''}`
	}
	if (result.executedAt)
		return `Run ${result.testRunNumber}${result.executedBy ? ` by ${result.executedBy}` : ''}, ${new Date(result.executedAt).toLocaleDateString()}`
	return 'Not run in this build'
}

/** Picks the SparkyTC items an element is tested by. */
export function LinkEditor({
	projectId,
	links,
	onChange,
}: {
	projectId: number
	links: SparkyLink[]
	onChange: (links: SparkyLink[]) => void
}) {
	const [kind, setKind] = useState<SparkyLink['kind']>('case')
	const [query, setQuery] = useState('')
	const [items, setItems] = useState<SearchItem[] | null>(null)
	const [error, setError] = useState('')

	useEffect(() => {
		let cancelled = false
		setItems(null)
		const id = setTimeout(() => {
			api<{ items: Record<string, unknown>[] }>(`/api/projects/${projectId}/sparkytc/search?${new URLSearchParams({ kind, q: query })}`)
				.then((r) => {
					if (cancelled) return
					setItems(r.items.map((raw) => toItem(kind, raw)))
					setError('')
				})
				.catch((e) => !cancelled && setError(e.message))
		}, 250)
		return () => {
			cancelled = true
			clearTimeout(id)
		}
	}, [projectId, kind, query])

	const linked = new Set(links.map(linkKey))
	return (
		<div className="w-80 max-w-[calc(100vw-32px)] space-y-2 text-sm">
			{links.length > 0 && (
				<ul className="space-y-1">
					{links.map((l) => (
						<li key={linkKey(l)} className="flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-800">
							<span className="min-w-0 flex-1 truncate">{l.label}</span>
							<button
								type="button"
								title="Remove the link"
								onClick={() => onChange(links.filter((x) => linkKey(x) !== linkKey(l)))}
								className="rounded p-0.5 text-gray-500 hover:text-red-600"
							>
								<X size={14} />
								<span className="sr-only">Remove the link to {l.label}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			<div role="tablist" className="flex gap-1">
				{KINDS.map((k) => (
					<button
						key={k.kind}
						type="button"
						role="tab"
						aria-selected={kind === k.kind}
						onClick={() => setKind(k.kind)}
						className={`rounded-md px-2 py-1 text-xs font-medium ${kind === k.kind ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
					>
						{k.label}
					</button>
				))}
			</div>
			<label className="flex items-center gap-2 rounded-md border border-gray-300 px-2 dark:border-gray-600">
				<Search size={14} className="text-gray-400" />
				<input
					autoFocus
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder={kind === 'case' ? 'Number or title' : 'Name'}
					aria-label="Search SparkyTC"
					className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
				/>
			</label>
			{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
			<ul className="max-h-60 space-y-0.5 overflow-auto">
				{items === null && !error && <li className="px-1 py-2 text-xs text-gray-500">Searching…</li>}
				{items?.length === 0 && <li className="px-1 py-2 text-xs text-gray-500">Nothing found.</li>}
				{items?.map((item) => {
					const on = linked.has(linkKey(item.link))
					return (
						<li key={linkKey(item.link)}>
							<button
								type="button"
								disabled={on}
								onClick={() => onChange([...links, item.link])}
								className="w-full rounded-md px-2 py-1.5 text-left hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
							>
								<span className="block truncate">{item.link.label}</span>
								{item.detail && <span className="block truncate text-xs text-gray-500">{item.detail}</span>}
								{on && <span className="text-xs text-gray-500">Linked</span>}
							</button>
						</li>
					)
				})}
			</ul>
		</div>
	)
}

/** A chip on each linked element with the combined status of its tests; it opens the details. */
export function LinkBadges({
	elements,
	results,
	camera,
	open,
	onOpen,
}: {
	elements: ElementMap
	results: Map<string, LinkResult>
	camera: Camera
	open: string | null
	onOpen: (id: string | null) => void
}) {
	return (
		<>
			{[...elements.values()].map((el) => {
				if (el.type === 'connector' || !el.links?.length) return null
				const status = elementStatus(el.links, results)
				const b = elementBounds(el, elements)
				const p = toScreen(camera, { x: b.x, y: b.y + b.h })
				const Icon =
					status === 'PASS' ? CircleCheck : status === 'FAIL' || status === 'BLOCKED' ? CircleX : status ? CircleDashed : FlaskConical
				const color = status ? STATUS_STYLE[status].color : '#6b7280'
				return (
					<button
						key={el.id}
						type="button"
						data-ui
						aria-expanded={open === el.id}
						title={status ? `Tests: ${STATUS_STYLE[status].label}` : 'Linked tests'}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => onOpen(open === el.id ? null : el.id)}
						className="pointer-events-auto absolute flex h-6 -translate-y-1/2 items-center gap-1 rounded-full border bg-white px-1.5 text-xs font-semibold shadow-sm dark:bg-gray-900"
						style={{ left: p.x + 6, top: p.y, borderColor: color, color }}
					>
						<Icon size={14} />
						{el.links.length}
						<span className="sr-only">linked tests, {status ? STATUS_STYLE[status].label : 'no result yet'}</span>
					</button>
				)
			})}
		</>
	)
}

/** The tests linked to one element, with their latest results and links to SparkyTC. */
export function LinksPopover({
	el,
	results,
	info,
	camera,
	elements,
	buildNumber,
	onClose,
}: {
	el: BoardElement
	results: Map<string, LinkResult>
	info: SparkyInfo
	camera: Camera
	elements: ElementMap
	buildNumber?: string
	onClose: () => void
}) {
	if (el.type === 'connector' || !el.links?.length) return null
	const b = elementBounds(el, elements)
	const p = toScreen(camera, { x: b.x, y: b.y + b.h })
	return (
		<div
			data-ui
			onPointerDown={(e) => e.stopPropagation()}
			className="pointer-events-auto absolute z-30 w-80 max-w-[calc(100vw-32px)] rounded-xl border border-gray-200 bg-white p-2 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
			style={{ left: Math.max(8, p.x), top: p.y + 18 }}
		>
			<div className="mb-1 flex items-center justify-between px-1">
				<span className="text-xs font-medium text-gray-500">Tests{buildNumber ? ` · build ${buildNumber}` : ''}</span>
				<button type="button" onClick={onClose} className="rounded p-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
					<X size={14} />
					<span className="sr-only">Close</span>
				</button>
			</div>
			<ul className="space-y-1">
				{el.links.map((l) => {
					const r = results.get(linkKey(l))
					const href = r && !r.missing ? sparkyHref(info, r.webPath) : undefined
					return (
						<li key={linkKey(l)} className="flex items-start gap-2 rounded-md px-1 py-1">
							<span className="mt-1">
								<StatusDot status={r?.status} />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{r?.name || l.label}</span>
								<span className="block text-xs text-gray-500">
									<StatusLabel status={r?.status} /> · {resultDetail(r)}
								</span>
							</span>
							{href && (
								<a
									href={href}
									target="_blank"
									rel="noopener noreferrer"
									title="Open in SparkyTC"
									className="rounded p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white"
								>
									<ExternalLink size={14} />
									<span className="sr-only">Open in SparkyTC</span>
								</a>
							)}
						</li>
					)
				})}
			</ul>
		</div>
	)
}

/** Steps that count for coverage: shapes and sticky notes with text. */
const isStep = (el: BoardElement): el is TextBox => (el.type === 'shape' || el.type === 'sticky') && el.text.trim().length > 0

/** Reading order: rows from top to bottom (by center), left to right in a row. */
const readingKey = (el: TextBox) => [Math.round((el.y + el.h / 2) / 60), el.x + el.w / 2] as const
const byReading = (a: TextBox, b: TextBox) => {
	const [ra, xa] = readingKey(a)
	const [rb, xb] = readingKey(b)
	return ra - rb || xa - xb
}

/**
 * Steps in the order of the flow: following the connectors between them from where the flow starts, and in
 * reading order where connectors don't decide (or loop back).
 */
function flowOrder(steps: TextBox[], elements: ElementMap): TextBox[] {
	const ids = new Set(steps.map((s) => s.id))
	const next = new Map<string, string[]>()
	const incoming = new Map<string, number>(steps.map((s) => [s.id, 0]))
	for (const el of elements.values()) {
		if (el.type !== 'connector' || !el.from.id || !el.to.id || !ids.has(el.from.id) || !ids.has(el.to.id)) continue
		next.set(el.from.id, [...(next.get(el.from.id) ?? []), el.to.id])
		incoming.set(el.to.id, (incoming.get(el.to.id) ?? 0) + 1)
	}
	const byId = new Map(steps.map((s) => [s.id, s]))
	const remaining = new Set(ids)
	const order: TextBox[] = []
	while (remaining.size) {
		const left = [...remaining].map((id) => byId.get(id)!)
		// in a loop nothing is ready: go on with the first step left in reading order
		const pick = left.filter((s) => (incoming.get(s.id) ?? 0) <= 0).sort(byReading)[0] ?? left.sort(byReading)[0]
		remaining.delete(pick.id)
		order.push(pick)
		for (const to of next.get(pick.id) ?? []) incoming.set(to, (incoming.get(to) ?? 0) - 1)
	}
	return order
}

interface Step {
	el: TextBox
	status: SparkyStatus | null
	covered: boolean
}

/**
 * Coverage of the steps in the board or a frame (`frameId`), with their tests' results in `build` (the current
 * one when empty). Shared by the coverage panel and publishing.
 */
export function useCoverage(projectId: number, elements: ElementMap, frameId: string | null, build: string, enabled: boolean) {
	const frame = frameId ? elements.get(frameId) : undefined
	const stepEls = useMemo(() => {
		const inside = frame?.type === 'frame' ? new Set(frameContents(frame, elements)) : null
		return flowOrder(
			[...elements.values()].filter((el): el is TextBox => isStep(el) && (!inside || inside.has(el.id))),
			elements,
		)
	}, [elements, frame])
	const links = useMemo(() => {
		const all = new Map<string, SparkyLink>()
		for (const el of stepEls) for (const l of el.links ?? []) all.set(linkKey(l), l)
		return [...all.values()]
	}, [stepEls])
	const { results, build: shownBuild, error, loading } = useLinkResults(projectId, links, enabled, build || undefined)
	const steps: Step[] = stepEls.map((el) => ({ el, covered: !!el.links?.length, status: elementStatus(el.links, results) }))
	const covered = steps.filter((s) => s.covered)
	const percent = steps.length ? Math.round((covered.length / steps.length) * 100) : 0
	const by = (status: SparkyStatus) => covered.filter((s) => s.status === status).length
	const overall = worstStatus(covered.map((s) => s.status))

	/** The report as sent to Confluence. */
	const report = () => ({
		percent,
		covered: covered.length,
		total: steps.length,
		build: shownBuild?.buildNumber ?? null,
		counts: {
			...Object.fromEntries(
				(['PASS', 'FAIL', 'BLOCKED', 'SKIP', 'NOT_RUN'] as SparkyStatus[]).map((st) => [STATUS_STYLE[st].label, by(st)]),
			),
			'Not covered': steps.length - covered.length,
		},
		steps: steps.map((st) => ({
			text: st.el.text.replace(/\s+/g, ' ').trim(),
			status: st.covered ? (st.status ? STATUS_STYLE[st.status].label : 'No result') : 'Not covered',
			links: (st.el.links ?? []).map((l) => {
				const r = results.get(linkKey(l))
				return { name: r?.name || l.label, status: r?.status ? STATUS_STYLE[r.status].label : r?.missing ? 'Not found' : 'No result' }
			}),
		})),
	})
	return { steps, covered, percent, by, overall, results, shownBuild, error, loading, report }
}

/**
 * Coverage of a flow: in the whole board or one frame, the steps (shapes and sticky notes with text) that have
 * linked tests, and how those tests did in a build.
 */
export function CoveragePanel({
	projectId,
	info,
	elements,
	boardName,
	onShow,
	onClose,
}: {
	projectId: number
	info: SparkyInfo
	elements: ElementMap
	boardName: string
	onShow: (id: string) => void
	onClose: () => void
}) {
	const frames = useMemo(
		() => [...elements.values()].filter((el) => el.type === 'frame').sort((a, b) => a.y - b.y || a.x - b.x),
		[elements],
	)
	const [scope, setScope] = useState('board')
	const [build, setBuild] = useState('')
	const scopeFrame = frames.find((f) => f.id === scope)

	const { steps, covered, percent, by, overall, results, shownBuild, error, loading } = useCoverage(
		projectId,
		elements,
		scopeFrame?.id ?? null,
		build,
		true,
	)
	const builds = info.project?.builds ?? []

	function downloadCsv() {
		const quote = (v: string) => `"${v.replace(/"/g, '""')}"`
		const rows = [
			['Step', 'Status', 'Linked tests', 'Build'],
			...steps.map((s) => [
				s.el.text.replace(/\s+/g, ' ').trim(),
				s.covered ? (s.status ? STATUS_STYLE[s.status].label : 'No result') : 'Not covered',
				(s.el.links ?? [])
					.map((l) => {
						const r = results.get(linkKey(l))
						return `${r?.name || l.label} (${r?.status ? STATUS_STYLE[r.status].label : r?.missing ? 'not found' : 'no result'})`
					})
					.join('; '),
				shownBuild?.buildNumber ?? '',
			]),
		]
		const csv = `\uFEFF${rows.map((r) => r.map(quote).join(',')).join('\r\n')}`
		const name = `${(scopeFrame?.type === 'frame' ? scopeFrame.title : boardName).replace(/[\\/:*?"<>|]+/g, '_')} coverage.csv`
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
		const a = document.createElement('a')
		a.href = url
		a.download = name
		a.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}

	const select = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800'
	return (
		<aside
			data-ui
			aria-label="Test coverage"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-0 right-0 bottom-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
		>
			<div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<h2 className="flex items-center gap-2 font-semibold">
					<FlaskConical size={18} /> Test coverage
				</h2>
				<button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
					<X size={18} />
					<span className="sr-only">Close</span>
				</button>
			</div>
			<div className="relative min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
				<div className="grid grid-cols-2 gap-2">
					<label className="text-xs font-medium text-gray-600 dark:text-gray-400">
						Steps in
						<select value={scope} onChange={(e) => setScope(e.target.value)} className={`${select} mt-1`}>
							<option value="board">The whole board</option>
							{frames.map((f) => (
								<option key={f.id} value={f.id}>
									{f.type === 'frame' ? f.title || 'Frame' : ''}
								</option>
							))}
						</select>
					</label>
					<label className="text-xs font-medium text-gray-600 dark:text-gray-400">
						Build
						<select value={build} onChange={(e) => setBuild(e.target.value)} className={`${select} mt-1`}>
							<option value="">Current{info.project?.currentBuild ? ` (${info.project.currentBuild.buildNumber})` : ''}</option>
							{builds.map((b) => (
								<option key={b.buildID} value={b.buildNumber}>
									{b.buildNumber}
								</option>
							))}
						</select>
					</label>
				</div>

				<div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
					<div className="flex items-baseline justify-between">
						<span className="text-3xl font-semibold tabular-nums">{percent}%</span>
						<span className="text-gray-600 dark:text-gray-400">
							{covered.length} of {steps.length} steps covered
						</span>
					</div>
					<div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" aria-hidden>
						{(['PASS', 'SKIP', 'NOT_RUN', 'BLOCKED', 'FAIL'] as SparkyStatus[]).map((s) => (
							<div key={s} style={{ width: `${steps.length ? (by(s) / steps.length) * 100 : 0}%`, background: STATUS_STYLE[s].color }} />
						))}
						<div
							style={{
								width: `${steps.length ? (covered.filter((s) => !s.status).length / steps.length) * 100 : 0}%`,
								background: '#9ca3af',
							}}
						/>
					</div>
					<ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
						{(['PASS', 'FAIL', 'BLOCKED', 'SKIP', 'NOT_RUN'] as SparkyStatus[]).map((s) => (
							<li key={s} className="flex items-center gap-1.5">
								<StatusDot status={s} size={8} /> {STATUS_STYLE[s].label}: {by(s)}
							</li>
						))}
						<li className="flex items-center gap-1.5">
							<span className="inline-block size-2 rounded-full border border-gray-400" /> Not covered: {steps.length - covered.length}
						</li>
					</ul>
					<p className="mt-2 text-xs text-gray-500">
						{loading ? 'Updating…' : shownBuild ? `Results of build ${shownBuild.buildNumber}` : 'Results of every test run'}
						{overall && (
							<>
								{' '}
								· overall <StatusLabel status={overall} />
							</>
						)}
					</p>
					{error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
				</div>

				{steps.length === 0 ? (
					<p className="text-gray-500">No steps here. Steps are shapes and sticky notes with text.</p>
				) : (
					<ol className="space-y-1">
						{steps.map((s) => (
							<li key={s.el.id}>
								<button
									type="button"
									onClick={() => onShow(s.el.id)}
									className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
								>
									<span className="mt-1">
										{s.covered ? (
											<StatusDot status={s.status} />
										) : (
											<span className="inline-block size-2.5 rounded-full border border-gray-400" />
										)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate">{s.el.text.replace(/\s+/g, ' ')}</span>
										<span className="block text-xs text-gray-500">
											{s.covered ? (
												<>
													<StatusLabel status={s.status} /> · {s.el.links!.length} {s.el.links!.length === 1 ? 'link' : 'links'}
												</>
											) : (
												'Not covered'
											)}
										</span>
									</span>
								</button>
							</li>
						))}
					</ol>
				)}
			</div>
			<div className="border-t border-gray-200 p-3 dark:border-gray-700">
				<button
					type="button"
					onClick={downloadCsv}
					disabled={!steps.length}
					className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"
				>
					Download CSV
				</button>
			</div>
		</aside>
	)
}

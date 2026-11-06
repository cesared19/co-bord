import { ChevronDown, ChevronRight, ExternalLink, FlaskConical, LoaderCircle, Paperclip, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { STATUS_STYLE, type SparkyInfo, type SparkyStatus, sparkyHref } from './sparky'
import { StatusDot, StatusLabel } from './SparkyLinks'

interface Step {
	action: string
	expected?: string | null
	sharedStepName?: string | null
}

interface HistoryEntry {
	status: SparkyStatus
	notes?: string | null
	recordedBy?: string | null
	recordedAt: string | number
	testRunNumber: number
	testRunTitle: string
	buildNumber?: string | null
	isLatestInRun: boolean
	steps: (Step & { status?: SparkyStatus | null; actual?: string | null })[]
	evidenceCount: number
	webPath: string
}

export interface TestCaseHistory {
	testCase: { testCaseNumber: number; title: string; sectionPath?: string | null; labels?: string[]; webPath: string }
	description?: string | null
	testInstructions?: string | null
	format: 'TEXT' | 'STEPS'
	steps: Step[]
	archived: boolean
	total: number
	results: HistoryEntry[]
}

const when = (value: string | number) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * A linked test case, read from SparkyTC: what it says to do and how it went in each test run, newest first.
 * Needs SparkyTC 2.4.0 or later.
 */
export function TestCasePanel({
	projectId,
	info,
	testCaseNumber,
	onClose,
}: {
	projectId: number
	info: SparkyInfo
	testCaseNumber: number
	onClose: () => void
}) {
	const [data, setData] = useState<TestCaseHistory | null>(null)
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(true)
	const [showSteps, setShowSteps] = useState(false)

	const load = useCallback(() => {
		setLoading(true)
		api<TestCaseHistory>(`/api/projects/${projectId}/sparkytc/test-cases/${testCaseNumber}/history`)
			.then((d) => {
				setData(d)
				setError('')
			})
			.catch((e: Error) => setError(e.message))
			.finally(() => setLoading(false))
	}, [projectId, testCaseNumber])

	useEffect(() => {
		setData(null)
		load()
	}, [load])

	const tc = data?.testCase
	const runs = data ? new Set(data.results.map((r) => r.testRunNumber)).size : 0
	const latest = data?.results[0]
	const counts = data
		? (['PASS', 'FAIL', 'BLOCKED', 'SKIP'] as SparkyStatus[])
				// each run counts once, with the result the test case ended with there
				.map((s) => [s, data.results.filter((r) => r.isLatestInRun && r.status === s).length] as const)
				.filter(([, n]) => n > 0)
		: []

	return (
		<aside
			data-ui
			aria-label="Test case history"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-0 right-0 bottom-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
		>
			<div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<h2 className="flex min-w-0 items-center gap-2 font-semibold">
					<FlaskConical size={18} className="shrink-0" />
					<span className="truncate">Test case #{testCaseNumber}</span>
				</h2>
				<span className="flex items-center gap-0.5">
					<button
						type="button"
						onClick={load}
						disabled={loading}
						title="Reload"
						className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
					>
						<RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
						<span className="sr-only">Reload</span>
					</button>
					<button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
						<X size={18} />
						<span className="sr-only">Close</span>
					</button>
				</span>
			</div>
			<div className="relative flex-1 space-y-4 overflow-auto p-4 text-sm">
				{error && (
					<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700 dark:bg-red-900/30 dark:text-red-300">
						{error}
					</p>
				)}
				{!data && loading && (
					<p className="flex items-center gap-2 text-gray-500">
						<LoaderCircle size={16} className="animate-spin" /> Loading from SparkyTC…
					</p>
				)}
				{data && tc && (
					<>
						<section className="space-y-1.5">
							<div className="flex items-start gap-2">
								<h3 className="min-w-0 flex-1 text-base font-semibold break-words">{tc.title}</h3>
								<a
									href={sparkyHref(info, tc.webPath)}
									target="_blank"
									rel="noopener noreferrer"
									title="Open in SparkyTC"
									className="shrink-0 rounded p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white"
								>
									<ExternalLink size={15} />
									<span className="sr-only">Open in SparkyTC</span>
								</a>
							</div>
							{tc.sectionPath && <p className="text-xs text-gray-500">{tc.sectionPath}</p>}
							{data.archived && <p className="text-xs text-amber-700 dark:text-amber-300">Deleted in SparkyTC; its results are kept.</p>}
							{!!tc.labels?.length && (
								<p className="flex flex-wrap gap-1">
									{tc.labels.map((l) => (
										<span key={l} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
											{l}
										</span>
									))}
								</p>
							)}
							{data.description && <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{data.description}</p>}
						</section>

						{(data.steps.length > 0 || data.testInstructions) && (
							<section>
								<button
									type="button"
									aria-expanded={showSteps}
									onClick={() => setShowSteps(!showSteps)}
									className="flex items-center gap-1 text-xs font-semibold tracking-wide text-gray-500 uppercase hover:text-gray-900 dark:hover:text-white"
								>
									{showSteps ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
									{data.format === 'STEPS' ? `Steps (${data.steps.length})` : 'Instructions'}
								</button>
								{showSteps &&
									(data.format === 'STEPS' ? (
										<ol className="mt-2 space-y-2">
											{data.steps.map((s, i) => (
												<li key={i} className="flex gap-2">
													<span className="w-5 shrink-0 text-right text-gray-400 tabular-nums">{i + 1}.</span>
													<span className="min-w-0">
														<span className="block whitespace-pre-wrap">{s.action}</span>
														{s.expected && <span className="block text-xs text-gray-500">Expected: {s.expected}</span>}
														{s.sharedStepName && <span className="block text-xs text-gray-400">From {s.sharedStepName}</span>}
													</span>
												</li>
											))}
										</ol>
									) : (
										<p className="mt-2 whitespace-pre-wrap text-gray-700 dark:text-gray-300">{data.testInstructions}</p>
									))}
							</section>
						)}

						<section className="space-y-2">
							<h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">History{data.total ? ` (${data.total})` : ''}</h3>
							{!data.results.length ? (
								<p className="text-gray-500">Not run in any test run yet.</p>
							) : (
								<>
									{latest && (
										<p className="text-xs text-gray-500">
											Last: <StatusLabel status={latest.status} /> in run #{latest.testRunNumber}
											{latest.buildNumber ? `, build ${latest.buildNumber}` : ''}.
											{counts.length > 0 &&
												` In ${runs} ${runs === 1 ? 'run' : 'runs'}: ${counts.map(([s, n]) => `${n} ${STATUS_STYLE[s].label.toLowerCase()}`).join(', ')}.`}
										</p>
									)}
									<ol className="space-y-2">
										{data.results.map((r, i) => (
											<HistoryItem key={i} entry={r} info={info} />
										))}
									</ol>
									{data.total > data.results.length && (
										<p className="text-xs text-gray-500">
											Showing the latest {data.results.length} of {data.total}.{' '}
											<a
												href={sparkyHref(info, tc.webPath)}
												target="_blank"
												rel="noopener noreferrer"
												className="text-brand-600 hover:underline dark:text-brand-300"
											>
												See all in SparkyTC
											</a>
										</p>
									)}
								</>
							)}
						</section>
					</>
				)}
			</div>
		</aside>
	)
}

function HistoryItem({ entry: r, info }: { entry: HistoryEntry; info: SparkyInfo }) {
	const [open, setOpen] = useState(false)
	const stepsDone = r.steps.filter((s) => s.status).length
	return (
		<li
			className={`rounded-lg border p-2.5 ${r.isLatestInRun ? 'border-gray-200 dark:border-gray-700' : 'border-dashed border-gray-200 opacity-75 dark:border-gray-700'}`}
		>
			<div className="flex items-start gap-2">
				<span className="mt-1">
					<StatusDot status={r.status} />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex flex-wrap items-baseline gap-x-1.5">
						<span className="font-medium">
							<StatusLabel status={r.status} />
						</span>
						<span className="truncate text-gray-700 dark:text-gray-300">
							Run #{r.testRunNumber} {r.testRunTitle}
						</span>
					</span>
					<span className="block text-xs text-gray-500">
						{when(r.recordedAt)}
						{r.recordedBy ? ` · ${r.recordedBy}` : ''}
						{r.buildNumber ? ` · build ${r.buildNumber}` : ''}
						{!r.isLatestInRun && ' · replaced by a later result in this run'}
					</span>
					{r.notes && <span className="mt-1 block whitespace-pre-wrap">{r.notes}</span>}
					<span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
						{r.steps.length > 0 && (
							<button
								type="button"
								aria-expanded={open}
								onClick={() => setOpen(!open)}
								className="flex items-center gap-0.5 text-gray-500 hover:text-gray-900 dark:hover:text-white"
							>
								{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
								Steps {stepsDone}/{r.steps.length}
							</button>
						)}
						{r.evidenceCount > 0 && (
							<span className="flex items-center gap-0.5 text-gray-500">
								<Paperclip size={12} /> {r.evidenceCount} {r.evidenceCount === 1 ? 'file' : 'files'}
							</span>
						)}
						<a
							href={sparkyHref(info, r.webPath)}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-0.5 text-brand-600 hover:underline dark:text-brand-300"
						>
							Open in the run <ExternalLink size={11} />
						</a>
					</span>
					{open && (
						<ol className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
							{r.steps.map((s, i) => (
								<li key={i} className="flex gap-2 text-xs">
									<span className="mt-1">
										<StatusDot status={s.status} size={8} />
									</span>
									<span className="min-w-0">
										<span className="block">
											{i + 1}. {s.action}
										</span>
										{s.actual && <span className="block text-gray-500">Actual: {s.actual}</span>}
									</span>
								</li>
							))}
						</ol>
					)}
				</span>
			</div>
		</li>
	)
}

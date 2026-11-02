import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { BoardElement, SparkyLink } from './types'

export type SparkyStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP' | 'NOT_RUN'

export interface SparkyBuild {
	buildID: string
	buildNumber: string
}

export interface SparkyInfo {
	connected: boolean
	publicUrl?: string
	url?: string
	error?: string
	project?: { projectShortCode: string; title: string; currentBuild: SparkyBuild | null; builds: SparkyBuild[]; webPath: string }
}

interface Counts {
	total: number
	passed: number
	failed: number
	blocked: number
	skipped: number
	notRun: number
}

export interface LinkResult {
	status: SparkyStatus | null
	name: string
	webPath: string
	counts?: Counts
	executedAt?: number
	executedBy?: string
	testRunNumber?: number
	missing?: boolean
}

interface ResultsResponse {
	build: SparkyBuild | null
	testCases: {
		testCaseNumber: number
		title: string
		status: SparkyStatus
		executedAt?: number
		executedBy?: string
		testRunNumber?: number
		webPath: string
	}[]
	sections: { id: string; name: string; counts: Counts; status?: SparkyStatus; webPath: string }[]
	testPlans: { id: string; name: string; counts: Counts; status?: SparkyStatus; webPath: string }[]
	missingTestCaseNumbers: number[]
	missingSectionIDs: string[]
	missingTestPlanIDs: string[]
}

export const linkKey = (link: Pick<SparkyLink, 'kind' | 'id'>) => `${link.kind}:${link.id}`

const SEVERITY: SparkyStatus[] = ['FAIL', 'BLOCKED', 'NOT_RUN', 'SKIP', 'PASS']

/** The status that sums up several: any failure first, then blocked, not run, skipped, passed. */
export function worstStatus(statuses: (SparkyStatus | null | undefined)[]): SparkyStatus | null {
	const present = statuses.filter((s): s is SparkyStatus => !!s)
	if (!present.length) return null
	return SEVERITY.find((s) => present.includes(s)) ?? null
}

export const STATUS_STYLE: Record<SparkyStatus, { label: string; color: string }> = {
	PASS: { label: 'Passed', color: '#16a34a' },
	FAIL: { label: 'Failed', color: '#dc2626' },
	BLOCKED: { label: 'Blocked', color: '#d97706' },
	SKIP: { label: 'Skipped', color: '#0891b2' },
	NOT_RUN: { label: 'Not run', color: '#6b7280' },
}

export function useSparkyInfo(projectId: number) {
	const [info, setInfo] = useState<SparkyInfo | null>(null)
	useEffect(() => {
		let cancelled = false
		api<SparkyInfo>(`/api/projects/${projectId}/sparkytc`)
			.then((r) => !cancelled && setInfo(r))
			.catch(() => !cancelled && setInfo({ connected: false }))
		return () => {
			cancelled = true
		}
	}, [projectId])
	return info
}

export function boardLinks(elements: Iterable<BoardElement>): SparkyLink[] {
	const all = new Map<string, SparkyLink>()
	for (const el of elements) if ('links' in el && el.links) for (const link of el.links) all.set(linkKey(link), link)
	return [...all.values()]
}

/**
 * Latest results of the given links in a build (the current one when empty), refreshed every minute and
 * whenever the set of links changes.
 */
export function useLinkResults(projectId: number, links: SparkyLink[], enabled: boolean, build?: string) {
	const [results, setResults] = useState<Map<string, LinkResult>>(new Map())
	const [resultBuild, setResultBuild] = useState<SparkyBuild | null>(null)
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(false)
	const key = useMemo(() => links.map(linkKey).sort().join(','), [links])
	const linksRef = useRef(links)
	linksRef.current = links

	const load = useCallback(async () => {
		const current = linksRef.current
		if (!enabled || !current.length) {
			setResults(new Map())
			return
		}
		setLoading(true)
		try {
			const r = await api<ResultsResponse>(`/api/projects/${projectId}/sparkytc/results`, {
				method: 'POST',
				body: {
					testCaseNumbers: current.filter((l) => l.kind === 'case').map((l) => Number(l.id)),
					sectionIDs: current.filter((l) => l.kind === 'section').map((l) => l.id),
					testPlanIDs: current.filter((l) => l.kind === 'plan').map((l) => l.id),
					...(build ? { build } : {}),
				},
			})
			const map = new Map<string, LinkResult>()
			for (const c of r.testCases)
				map.set(linkKey({ kind: 'case', id: String(c.testCaseNumber) }), {
					status: c.status,
					name: `#${c.testCaseNumber} ${c.title}`,
					webPath: c.webPath,
					executedAt: c.executedAt,
					executedBy: c.executedBy,
					testRunNumber: c.testRunNumber,
				})
			for (const s of r.sections)
				map.set(linkKey({ kind: 'section', id: s.id }), { status: s.status ?? null, name: s.name, webPath: s.webPath, counts: s.counts })
			for (const p of r.testPlans)
				map.set(linkKey({ kind: 'plan', id: p.id }), { status: p.status ?? null, name: p.name, webPath: p.webPath, counts: p.counts })
			const missing = { status: null, name: '', webPath: '', missing: true }
			for (const n of r.missingTestCaseNumbers) map.set(linkKey({ kind: 'case', id: String(n) }), missing)
			for (const id of r.missingSectionIDs) map.set(linkKey({ kind: 'section', id }), missing)
			for (const id of r.missingTestPlanIDs) map.set(linkKey({ kind: 'plan', id }), missing)
			setResults(map)
			setResultBuild(r.build)
			setError('')
		} catch (e) {
			setError((e as Error).message)
		} finally {
			setLoading(false)
		}
	}, [projectId, enabled, build])

	useEffect(() => {
		const id = setTimeout(load, 400)
		const every = setInterval(load, 60_000)
		return () => {
			clearTimeout(id)
			clearInterval(every)
		}
	}, [load, key])

	return { results, build: resultBuild, error, loading, reload: load }
}

/** The status of an element from its links' results. */
export function elementStatus(links: SparkyLink[] | undefined, results: Map<string, LinkResult>): SparkyStatus | null {
	if (!links?.length) return null
	return worstStatus(links.map((l) => results.get(linkKey(l))?.status))
}

export const sparkyHref = (info: SparkyInfo | null, webPath: string) =>
	info?.publicUrl && webPath ? `${info.publicUrl.replace(/\/+$/, '')}${webPath}` : undefined

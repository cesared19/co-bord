import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../lib/api'

export interface ConfluenceInfo {
	connected: boolean
	url?: string
	email?: string
	spaceKey?: string
	spaceName?: string
	parentId?: string | null
	error?: string
}

export interface ConfluencePageCard {
	id: string
	title: string
	spaceName: string
	updatedAt: string | null
	excerpt: string
	url: string
}

export interface Publication {
	frameId: string | null
	pageId: string
	url: string
	title: string
	publishedAt: string
	publishedBy: string | null
}

export function useConfluenceInfo(projectId: number) {
	const [info, setInfo] = useState<ConfluenceInfo | null>(null)
	useEffect(() => {
		let cancelled = false
		api<ConfluenceInfo>(`/api/projects/${projectId}/confluence`)
			.then((r) => !cancelled && setInfo(r))
			.catch(() => !cancelled && setInfo({ connected: false }))
		return () => {
			cancelled = true
		}
	}, [projectId])
	return info
}

/** What blocks need to know about the board's project. */
export interface BoardEnv {
	projectId: number
	confluence: ConfluenceInfo | null
}

export const BoardEnvContext = createContext<BoardEnv>({ projectId: 0, confluence: null })
export const useBoardEnv = () => useContext(BoardEnvContext)

/** The page id when `raw` is a page of the connected Confluence site. */
export function confluencePageId(raw: string, info: ConfluenceInfo | null): string | null {
	if (!info?.connected || !info.url) return null
	try {
		const url = new URL(raw.trim())
		if (url.host !== new URL(info.url).host) return null
		return /\/pages\/(\d+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('pageId')
	} catch {
		return null
	}
}

export const searchConfluence = (projectId: number, q: string) =>
	api<{ pages: { id: string; title: string; url: string; lastModified?: string }[] }>(
		`/api/projects/${projectId}/confluence/search?${new URLSearchParams({ q })}`,
	).then((r) => r.pages)

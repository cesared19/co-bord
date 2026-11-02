import type { MediaElement, MediaKind } from './types'

/** Height of the title bar of embedded blocks (not images), in board units. */
export const MEDIA_HEADER = 32

export interface NewMedia {
	kind: MediaKind
	src: string
	name: string
	start?: number
	assetId?: string
	w: number
	h: number
}

const YOUTUBE_ID = /^[\w-]{11}$/

/** Seconds from YouTube's `t` / `start` values: "90", "90s", "1m30s", "1h2m3s". */
function youtubeStart(value: string | null): number | undefined {
	if (!value) return undefined
	if (/^\d+$/.test(value)) return Number(value)
	const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
	if (!m || !value) return undefined
	const seconds = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
	return seconds || undefined
}

const videoSize = { w: 560, h: 315 + MEDIA_HEADER }

/** Recognizes YouTube, Google Drive and Vimeo links, and links to images, videos and PDFs; any other web link becomes a link card. */
export function parseMediaUrl(raw: string): NewMedia | null {
	let url: URL
	try {
		url = new URL(raw.trim())
	} catch {
		return null
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
	const host = url.hostname.replace(/^(www|m|music)\./, '')
	const path = url.pathname

	if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
		let id: string | null = null
		if (host === 'youtu.be') id = path.split('/')[1] ?? null
		else if (path === '/watch') id = url.searchParams.get('v')
		else {
			const m = /^\/(?:shorts|embed|live|v)\/([\w-]+)/.exec(path)
			id = m?.[1] ?? null
		}
		if (id && YOUTUBE_ID.test(id)) {
			const start = youtubeStart(url.searchParams.get('t') ?? url.searchParams.get('start'))
			const shorts = path.startsWith('/shorts/')
			return { kind: 'youtube', src: id, name: 'YouTube video', start, ...(shorts ? { w: 315, h: 560 + MEDIA_HEADER } : videoSize) }
		}
	}

	if (host === 'drive.google.com') {
		const m = /^\/file\/d\/([\w-]+)/.exec(path)
		const id = m?.[1] ?? (path === '/open' ? url.searchParams.get('id') : null)
		if (id && /^[\w-]+$/.test(id)) return { kind: 'drive', src: id, name: 'Google Drive file', ...videoSize }
	}

	if (host === 'vimeo.com' || host === 'player.vimeo.com') {
		const m = /^\/(?:video\/)?(\d+)/.exec(path)
		if (m) return { kind: 'vimeo', src: m[1], name: 'Vimeo video', ...videoSize }
	}

	const file = decodeURIComponent(path.split('/').pop() ?? '')
	const ext = file.split('.').pop()?.toLowerCase() ?? ''
	const href = url.toString()
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return { kind: 'image', src: href, name: file, w: 400, h: 300 }
	if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext)) return { kind: 'video', src: href, name: file, ...videoSize }
	if (ext === 'pdf') return { kind: 'pdf', src: href, name: file, w: 420, h: 560 + MEDIA_HEADER }
	return { kind: 'link', src: href, name: url.hostname + (path === '/' ? '' : path), w: 360, h: 96 }
}

/** The address of the content itself: the uploaded file or the external URL. */
export function mediaUrl(el: MediaElement): string {
	return el.assetId ? `/api/assets/${el.assetId}` : el.src
}

/** Player address for YouTube, Drive and Vimeo, built from the id only. */
export function embedUrl(el: MediaElement): string | null {
	const id = encodeURIComponent(el.src)
	switch (el.kind) {
		case 'youtube':
			return `https://www.youtube-nocookie.com/embed/${id}?rel=0${el.start ? `&start=${el.start}` : ''}`
		case 'drive':
			return `https://drive.google.com/file/d/${id}/preview`
		case 'vimeo':
			return `https://player.vimeo.com/video/${id}`
		default:
			return null
	}
}

/** Where "Open" goes: the original page or file. */
export function openUrl(el: MediaElement): string | null {
	const id = encodeURIComponent(el.src)
	switch (el.kind) {
		case 'youtube':
			return `https://www.youtube.com/watch?v=${id}${el.start ? `&t=${el.start}s` : ''}`
		case 'drive':
			return `https://drive.google.com/file/d/${id}/view`
		case 'vimeo':
			return `https://vimeo.com/${id}`
		case 'confluence':
			return null
		default:
			return safeUrl(mediaUrl(el))
	}
}

/** Only web addresses and our own files are used as links or sources. */
export function safeUrl(url: string): string | null {
	if (url.startsWith('/api/assets/')) return url
	try {
		const u = new URL(url)
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
	} catch {
		return null
	}
}

/** Fits a natural size inside a box of `max` units, keeping the proportions. */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
	if (!w || !h) return { w: max, h: Math.round(max * 0.75) }
	const scale = Math.min(1, max / Math.max(w, h))
	return { w: Math.max(40, Math.round(w * scale)), h: Math.max(40, Math.round(h * scale)) }
}

export const keepsRatio = (el: { type: string; kind?: MediaKind }) =>
	el.type === 'sticky' || (el.type === 'media' && el.kind !== 'link' && el.kind !== 'confluence')

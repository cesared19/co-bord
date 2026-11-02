import { ChevronLeft, ChevronRight, ExternalLink, FileText, Film, Globe, Image as ImageIcon, PlaySquare } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { embedUrl, MEDIA_HEADER, mediaUrl, openUrl, safeUrl } from './media'
import { loadPdf, renderPage } from './pdf'
import type { MediaElement, MediaKind } from './types'

const icons: Record<MediaKind, typeof Film> = {
	image: ImageIcon,
	video: Film,
	pdf: FileText,
	youtube: PlaySquare,
	drive: Film,
	vimeo: PlaySquare,
	link: Globe,
}

interface Props {
	el: MediaElement
	/** Selected and not being dragged: the player or PDF takes clicks. */
	active: boolean
	dark: boolean
}

/** An embedded block. Until it is selected, clicks go to the board so it can be selected and moved. */
export const MediaView = memo(function MediaView({ el, active, dark }: Props) {
	const frame: React.CSSProperties = {
		position: 'absolute',
		left: el.x,
		top: el.y,
		width: el.w,
		height: el.h,
		borderRadius: 8,
		overflow: 'hidden',
		background: dark ? '#1f2937' : '#ffffff',
		boxShadow: '0 1px 2px rgb(0 0 0 / .12), 0 4px 12px -4px rgb(0 0 0 / .2)',
	}

	if (el.kind === 'image') {
		const src = safeUrl(mediaUrl(el))
		return (
			<div data-el={el.id} style={{ ...frame, background: 'transparent', boxShadow: 'none', borderRadius: 0 }}>
				{src ? (
					<img
						src={src}
						alt={el.name}
						draggable={false}
						style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
					/>
				) : (
					<Unavailable text="This image can't be shown" />
				)}
			</div>
		)
	}

	const Icon = icons[el.kind]
	const open = openUrl(el)
	return (
		<div data-el={el.id} style={frame} className="text-gray-800 dark:text-gray-100">
			<div
				style={{ height: MEDIA_HEADER, fontSize: 13 }}
				className="flex cursor-move items-center gap-2 border-b border-gray-200 bg-gray-50 px-2.5 dark:border-gray-700 dark:bg-gray-800"
			>
				<Icon size={15} className="shrink-0 text-gray-500 dark:text-gray-400" />
				<span className="min-w-0 flex-1 truncate font-medium">{el.name}</span>
				{open && (
					<a
						href={open}
						target="_blank"
						rel="noopener noreferrer"
						title="Open in a new tab"
						onPointerDown={(e) => e.stopPropagation()}
						className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
					>
						<ExternalLink size={14} />
						<span className="sr-only">Open in a new tab</span>
					</a>
				)}
			</div>
			<div
				data-interactive={active ? '' : undefined}
				style={{ position: 'absolute', top: MEDIA_HEADER, left: 0, right: 0, bottom: 0, pointerEvents: active ? 'auto' : 'none' }}
			>
				<Content el={el} />
			</div>
		</div>
	)
})

function Content({ el }: { el: MediaElement }) {
	const embed = embedUrl(el)
	if (embed)
		return (
			<iframe
				src={embed}
				title={el.name}
				loading="lazy"
				allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
				allowFullScreen
				referrerPolicy="strict-origin-when-cross-origin"
				style={{ width: '100%', height: '100%', border: 0, background: '#000' }}
			/>
		)
	const src = safeUrl(mediaUrl(el))
	if (!src) return <Unavailable text="This address can't be shown" />
	if (el.kind === 'video')
		return (
			<video
				src={src}
				controls
				playsInline
				preload="metadata"
				style={{ width: '100%', height: '100%', background: '#000', objectFit: 'contain' }}
			/>
		)
	if (el.kind === 'pdf') return <PdfView url={src} width={el.w} />
	return (
		<div className="flex h-full flex-col justify-center gap-1 px-3 text-sm">
			<a href={src} target="_blank" rel="noopener noreferrer" className="truncate text-brand-600 hover:underline dark:text-brand-300">
				{src}
			</a>
		</div>
	)
}

function Unavailable({ text }: { text: string }) {
	return <div className="flex h-full items-center justify-center p-3 text-center text-xs text-gray-500">{text}</div>
}

/** One page at a time, with page buttons. The page is per person, not shared. */
function PdfView({ url, width }: { url: string; width: number }) {
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [pages, setPages] = useState(0)
	const [page, setPage] = useState(1)
	const [error, setError] = useState(false)

	useEffect(() => {
		let cancelled = false
		loadPdf(url)
			.then((doc) => !cancelled && setPages(doc.numPages))
			.catch(() => !cancelled && setError(true))
		return () => {
			cancelled = true
		}
	}, [url])

	// render sharp enough for zooming in; wait for resizing to settle
	const renderWidth = Math.min(2400, Math.round(width * 2))
	useEffect(() => {
		if (!pages) return
		let cancelled = false
		const id = setTimeout(() => {
			loadPdf(url)
				.then(async (doc) => {
					if (!cancelled && canvasRef.current) await renderPage(doc, page, canvasRef.current, renderWidth)
				})
				.catch(() => !cancelled && setError(true))
		}, 150)
		return () => {
			cancelled = true
			clearTimeout(id)
		}
	}, [url, page, pages, renderWidth])

	if (error) return <Unavailable text="This PDF can't be shown here. Open it in a new tab." />
	return (
		<div className="flex h-full flex-col bg-gray-100 dark:bg-gray-900">
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<canvas
					ref={canvasRef}
					aria-label={`Page ${page} of ${pages}`}
					style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
				/>
			</div>
			{pages > 1 && (
				<div className="flex h-8 shrink-0 items-center justify-center gap-2 border-t border-gray-200 bg-white text-xs tabular-nums dark:border-gray-700 dark:bg-gray-800">
					<button
						type="button"
						disabled={page <= 1}
						onClick={() => setPage(page - 1)}
						className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
						aria-label="Previous page"
					>
						<ChevronLeft size={16} />
					</button>
					<span>
						{page} / {pages}
					</span>
					<button
						type="button"
						disabled={page >= pages}
						onClick={() => setPage(page + 1)}
						className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
						aria-label="Next page"
					>
						<ChevronRight size={16} />
					</button>
				</div>
			)}
		</div>
	)
}

import { Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { download, renderPng } from './exportPng'
import type { ElementMap } from './geometry'
import { exportPdf, framesInOrder } from './pdfExport'

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_')

/** The board's download button: a PNG image, a PDF, a PDF with a page per frame, or (members) a co-bord file. */
export function ExportMenu({
	elements,
	name,
	dark,
	onCoBordFile,
}: {
	elements: ElementMap
	name: string
	dark: boolean
	/** Saves the board as a co-bord file (.zip) to import elsewhere. */
	onCoBordFile?: () => Promise<void>
}) {
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const frameCount = useMemo(() => framesInOrder(elements).length, [elements])

	useEffect(() => {
		if (!open) return
		const close = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) setOpen(false)
		}
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [open])

	const run = async (job: () => Promise<void>) => {
		setOpen(false)
		setBusy(true)
		try {
			await job()
		} finally {
			setBusy(false)
		}
	}
	const items = [
		{
			label: 'PNG image',
			hint: 'The whole board',
			run: () =>
				run(async () => {
					const blob = await renderPng(elements, dark)
					if (blob) download(blob, `${safeName(name)}.png`)
				}),
		},
		{
			label: 'PDF',
			hint: 'The whole board on one page',
			run: () =>
				run(async () => {
					const blob = await exportPdf(elements, name, false)
					if (blob) download(blob, `${safeName(name)}.pdf`)
				}),
		},
		{
			label: 'PDF, a page per frame',
			hint: frameCount ? `${frameCount} ${frameCount === 1 ? 'page' : 'pages'}, in reading order` : 'The board has no frames',
			disabled: !frameCount,
			run: () =>
				run(async () => {
					const blob = await exportPdf(elements, name, true)
					if (blob) download(blob, `${safeName(name)}.pdf`)
				}),
		},
		...(onCoBordFile
			? [{ label: 'co-bord file (.zip)', hint: 'Everything, with its files, to import in another board', run: () => run(onCoBordFile) }]
			: []),
	]

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				disabled={!elements.size || busy}
				aria-expanded={open}
				title="Download"
				className="rounded p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
			>
				<Download size={18} className={busy ? 'animate-pulse' : ''} />
				<span className="sr-only">Download</span>
			</button>
			{open && (
				<div
					role="menu"
					className="absolute top-9 right-0 z-40 w-64 rounded-xl border border-gray-200 bg-white p-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
				>
					{items.map((item) => (
						<button
							key={item.label}
							type="button"
							role="menuitem"
							disabled={item.disabled}
							onClick={() => void item.run()}
							className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
						>
							<span className="block font-medium">{item.label}</span>
							<span className="block text-xs text-gray-500">{item.hint}</span>
						</button>
					))}
				</div>
			)}
		</div>
	)
}

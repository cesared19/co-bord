import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const documents = new Map<string, Promise<PDFDocumentProxy>>()

/** Loads a PDF once per URL; pdf.js itself is only downloaded when a board has a PDF. */
export function loadPdf(url: string): Promise<PDFDocumentProxy> {
	let doc = documents.get(url)
	if (!doc) {
		doc = import('pdfjs-dist').then((pdfjs) => {
			pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
			return pdfjs.getDocument({ url, withCredentials: url.startsWith('/') }).promise
		})
		doc.catch(() => documents.delete(url))
		documents.set(url, doc)
	}
	return doc
}

/** Draws one page so it is `width` pixels wide. */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, width: number) {
	const page = await doc.getPage(pageNumber)
	const base = page.getViewport({ scale: 1 })
	const viewport = page.getViewport({ scale: width / base.width })
	canvas.width = Math.ceil(viewport.width)
	canvas.height = Math.ceil(viewport.height)
	await page.render({ canvas, viewport }).promise
	return { width: base.width, height: base.height }
}

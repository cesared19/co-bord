export interface UploadedAsset {
	id: string
	url: string
	name: string
	contentType: string
	kind: 'image' | 'video' | 'pdf'
	size: number
}

/** Uploads a file to the board; XMLHttpRequest because fetch has no upload progress. */
export function uploadAsset(boardId: string, file: File, onProgress: (fraction: number) => void): Promise<UploadedAsset> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open('POST', `/api/boards/${boardId}/assets`)
		xhr.responseType = 'json'
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response.asset)
			else reject(new Error(xhr.response?.error ?? `Upload failed (${xhr.status})`))
		}
		xhr.onerror = () => reject(new Error('Upload failed: no connection'))
		const form = new FormData()
		form.append('file', file)
		xhr.send(form)
	})
}

/** Natural size of an image or video file, read in the browser before uploading. */
export function readMediaSize(file: File): Promise<{ w: number; h: number } | null> {
	const url = URL.createObjectURL(file)
	const done = (size: { w: number; h: number } | null) => {
		URL.revokeObjectURL(url)
		return size
	}
	return new Promise((resolve) => {
		if (file.type.startsWith('image/')) {
			const img = new Image()
			img.onload = () => resolve(done({ w: img.naturalWidth, h: img.naturalHeight }))
			img.onerror = () => resolve(done(null))
			img.src = url
		} else if (file.type.startsWith('video/')) {
			const video = document.createElement('video')
			video.preload = 'metadata'
			video.onloadedmetadata = () => resolve(done({ w: video.videoWidth, h: video.videoHeight }))
			video.onerror = () => resolve(done(null))
			video.src = url
		} else resolve(done(null))
	})
}

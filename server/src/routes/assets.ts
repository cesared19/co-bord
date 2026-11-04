import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { atLeast, boardAccess, projectRole } from '../access.js'
import { type Ctx, currentUser, requireUser } from '../context.js'
import { shareLink } from '../shares.js'
import { badRequest, forbidden, HttpError, notFound, unauthorized } from '../errors.js'
import { isUuid } from '../validate.js'

/** Accepted uploads. The type is always served from this list, never from the upload. */
export const ALLOWED_TYPES: Record<string, 'image' | 'video' | 'pdf'> = {
	'image/png': 'image',
	'image/jpeg': 'image',
	'image/gif': 'image',
	'image/webp': 'image',
	'image/svg+xml': 'image',
	'video/mp4': 'video',
	'video/webm': 'video',
	'video/ogg': 'video',
	'video/quicktime': 'video',
	'application/pdf': 'pdf',
}

const assetUrl = (id: string) => `/api/assets/${id}`

export function assetRoutes(app: FastifyInstance, ctx: Ctx) {
	const { db, storage } = ctx

	app.post<{ Params: { id: string } }>('/api/boards/:id/assets', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		const access = await boardAccess(db, user, req.params.id)
		if (!atLeast(access.role, 'editor')) throw forbidden()

		const file = await req.file({ limits: { fileSize: ctx.config.maxUploadBytes, files: 1 } })
		if (!file) throw badRequest('Choose a file to upload')
		const contentType = file.mimetype.toLowerCase()
		if (!ALLOWED_TYPES[contentType]) {
			file.file.resume()
			throw badRequest('Only images (PNG, JPEG, GIF, WebP, SVG), videos (MP4, WebM, Ogg, MOV) and PDFs can be uploaded')
		}
		const id = randomUUID()
		const tooLarge = () => new HttpError(413, `Files can have up to ${Math.round(ctx.config.maxUploadBytes / 1024 / 1024)} MB`)
		let size: number
		try {
			size = await storage.save(id, file.file)
		} catch (e) {
			if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge()
			throw e
		}
		if (file.file.truncated) {
			await storage.remove([id])
			throw tooLarge()
		}
		const name = (file.filename || 'file').slice(0, 255)
		await db.query(
			'INSERT INTO assets (id, project_id, board_id, name, content_type, size, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
			[id, access.projectId, req.params.id, name, contentType, size, user.id],
		)
		return { asset: { id, url: assetUrl(id), name, contentType, kind: ALLOWED_TYPES[contentType], size } }
	})

	/**
	 * Files of elements pasted from another project's board are copied into this board's project, so everyone
	 * here can see them. Answers the id each file has in this project; files the user can't read are left out.
	 */
	app.post<{ Params: { id: string } }>('/api/boards/:id/assets/copy', async (req) => {
		const user = await requireUser(ctx, req)
		if (!isUuid(req.params.id)) throw notFound('Board not found')
		const access = await boardAccess(db, user, req.params.id)
		if (!atLeast(access.role, 'editor')) throw forbidden()
		const ids = (req.body as { ids?: unknown } | null)?.ids
		if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => typeof i === 'string' && isUuid(i)))
			throw badRequest('ids must be a list of file ids')
		const { rows } = await db.query<{ id: string; project_id: number; name: string; content_type: string; size: string }>(
			'SELECT id, project_id, name, content_type, size FROM assets WHERE id = ANY($1)',
			[[...new Set(ids)]],
		)
		const readable = new Map<number, boolean>()
		const result: Record<string, { id: string; url: string }> = {}
		for (const asset of rows) {
			if (asset.project_id === access.projectId) {
				result[asset.id] = { id: asset.id, url: assetUrl(asset.id) }
				continue
			}
			if (!readable.has(asset.project_id))
				readable.set(
					asset.project_id,
					await projectRole(db, user, asset.project_id).then(
						() => true,
						() => false,
					),
				)
			if (!readable.get(asset.project_id) || (await storage.size(asset.id)) === null) continue
			const id = randomUUID()
			await storage.copy(asset.id, id)
			await db.query(
				'INSERT INTO assets (id, project_id, board_id, name, content_type, size, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
				[id, access.projectId, req.params.id, asset.name, asset.content_type, asset.size, user.id],
			)
			result[asset.id] = { id, url: assetUrl(id) }
		}
		return { assets: result }
	})

	app.get<{ Params: { id: string }; Querystring: { guest?: string } }>('/api/assets/:id', async (req, reply) => {
		// guests read the files of the shared board's project with their link
		const link = req.query.guest ? await shareLink(db, req.query.guest) : null
		const user = link ? null : await currentUser(ctx, req)
		if (!user && !link) throw unauthorized()
		if (!isUuid(req.params.id)) throw notFound('File not found')
		const { rows } = await db.query<{ project_id: number; name: string; content_type: string }>(
			'SELECT project_id, name, content_type FROM assets WHERE id = $1',
			[req.params.id],
		)
		if (!rows[0]) throw notFound('File not found')
		if (link) {
			if (link.projectId !== rows[0].project_id) throw notFound('File not found')
		} else
			try {
				await projectRole(db, user!, rows[0].project_id)
			} catch {
				throw notFound('File not found')
			}
		const size = await storage.size(req.params.id)
		if (size === null) throw notFound('File not found')

		reply
			.header('Content-Type', rows[0].content_type)
			.header('X-Content-Type-Options', 'nosniff')
			// opened on its own, an SVG or PDF can't run scripts with our origin
			.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
			.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`)
			.header('Cache-Control', 'private, max-age=31536000, immutable')
			.header('Accept-Ranges', 'bytes')

		const range = parseRange(req.headers.range, size)
		if (range === 'invalid') return reply.status(416).header('Content-Range', `bytes */${size}`).send()
		if (range) {
			reply
				.status(206)
				.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
				.header('Content-Length', range.end - range.start + 1)
			return reply.send(storage.read(req.params.id, range))
		}
		reply.header('Content-Length', size)
		return reply.send(storage.read(req.params.id))
	})
}

/** A single `bytes=` range; several ranges are answered with the whole file. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
	if (!header) return null
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
	if (!m || (!m[1] && !m[2])) return null
	let start: number
	let end: number
	if (!m[1]) {
		start = Math.max(0, size - Number(m[2]))
		end = size - 1
	} else {
		start = Number(m[1])
		end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
	}
	if (start >= size || start > end) return 'invalid'
	return { start, end }
}

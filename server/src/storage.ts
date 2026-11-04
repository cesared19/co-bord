import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Uploaded files on disk, one file per asset id (a Docker volume in production). */
export class FileStorage {
	private readonly root: string

	constructor(dataDir: string) {
		this.root = resolve(dataDir)
	}

	private path(id: string) {
		return join(this.root, 'assets', id)
	}

	async init() {
		await mkdir(join(this.root, 'assets'), { recursive: true })
		await mkdir(join(this.root, 'tmp'), { recursive: true })
	}

	/** Writes the stream to a temporary file and moves it in place once complete. Returns the size. */
	async save(id: string, data: Readable): Promise<number> {
		const tmp = join(this.root, 'tmp', id)
		try {
			await pipeline(data, createWriteStream(tmp))
			await rename(tmp, this.path(id))
		} catch (e) {
			await rm(tmp, { force: true })
			throw e
		}
		return (await stat(this.path(id))).size
	}

	read(id: string, range?: { start: number; end: number }) {
		return createReadStream(this.path(id), range)
	}

	async size(id: string): Promise<number | null> {
		try {
			return (await stat(this.path(id))).size
		} catch {
			return null
		}
	}

	async copy(from: string, to: string) {
		const tmp = join(this.root, 'tmp', to)
		await copyFile(this.path(from), tmp)
		await rename(tmp, this.path(to))
	}

	async remove(ids: string[]) {
		await Promise.all(ids.map((id) => rm(this.path(id), { force: true })))
	}
}

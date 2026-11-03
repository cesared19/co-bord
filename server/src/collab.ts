import type { IncomingMessage } from 'node:http'
import { Hocuspocus } from '@hocuspocus/server'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import { atLeast, boardAccess, type Role } from './access.js'
import { cookieFromHeader, SESSION_COOKIE, type User, userForToken } from './auth.js'
import type { Ctx } from './context.js'
import { BoardWatcher } from './notify.js'
import { type BoardEditor, RuleEngine } from './rules.js'
import { isUuid } from './validate.js'

export interface CollabContext {
	user: User
	role: Role
}

/**
 * Real-time collaboration: each board is a Yjs document named after the board id,
 * stored whole in boards.document. Viewers connect read-only.
 */
export function createCollab(ctx: Ctx) {
	const { db } = ctx

	const watcher = new BoardWatcher(db, ctx.config.notifyDelayMs ?? 3000)
	let rules: RuleEngine | null = null

	const hocuspocus = new Hocuspocus<CollabContext>({
		quiet: true,
		debounce: 1500,
		maxDebounce: 10000,

		async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
			// browsers send the cookie on cross-site sockets too: only accept our own pages
			const origin = requestHeaders.get('origin')
			if (origin && new URL(origin).host !== requestHeaders.get('host')) throw new Error('Wrong origin')
			const user = await userForToken(db, cookieFromHeader(requestHeaders.get('cookie'), SESSION_COOKIE))
			if (!user) throw new Error('Not signed in')
			if (!isUuid(documentName)) throw new Error('Board not found')
			const access = await boardAccess(db, user, documentName)
			if (!atLeast(access.role, 'editor')) connectionConfig.readOnly = true
			return { user, role: access.role }
		},

		async onLoadDocument({ documentName, document }) {
			const { rows } = await db.query<{ document: Buffer | null }>('SELECT document FROM boards WHERE id = $1', [documentName])
			if (rows[0]?.document) Y.applyUpdate(document, new Uint8Array(rows[0].document))
			watcher.loaded(documentName, document)
			rules?.loaded(documentName, document)
			return document
		},

		async afterUnloadDocument({ documentName }) {
			await watcher.unloaded(documentName)
			await rules?.unloaded(documentName)
		},

		async onStoreDocument({ documentName, document, lastContext }) {
			await save(documentName, document, lastContext?.user?.id ?? null)
		},
	})

	async function save(boardId: string, document: Y.Doc, userId: number | null) {
		const state = Buffer.from(Y.encodeStateAsUpdate(document))
		await db.query('UPDATE boards SET document = $2, updated_at = now(), updated_by = COALESCE($3, updated_by) WHERE id = $1', [
			boardId,
			state,
			userId,
		])
	}

	/** Rules change boards through direct connections, so everyone sees the change and it's saved like any other. */
	const editor: BoardEditor = {
		async edit(boardId, depth, change) {
			const connection = await hocuspocus.openDirectConnection(boardId, { ruleDepth: depth } as unknown as CollabContext)
			try {
				await connection.transact((doc) => change(doc.getMap('elements')))
			} finally {
				await connection.disconnect()
			}
		},
		async snapshot(boardId) {
			const live = hocuspocus.documents.get(boardId)
			if (live) return live
			const { rows } = await db.query<{ document: Buffer | null }>('SELECT document FROM boards WHERE id = $1', [boardId])
			if (!rows[0]) return null
			const doc = new Y.Doc()
			if (rows[0].document) Y.applyUpdate(doc, new Uint8Array(rows[0].document))
			return doc
		},
	}
	rules = new RuleEngine(ctx, editor, ctx.config.notifyDelayMs ?? 3000)
	rules.start(ctx.config.rulePollMs ?? 120_000)
	ctx.rules = rules

	ctx.onBoardDeleted = (boardId) => hocuspocus.closeConnections(boardId)
	ctx.flushBoard = async (boardId) => {
		const document = hocuspocus.documents.get(boardId)
		if (document) await save(boardId, document, null)
	}

	/** Bridges a `ws` socket from @fastify/websocket to Hocuspocus. */
	function handle(socket: WebSocket, request: IncomingMessage) {
		const headers = new Headers()
		for (const [key, value] of Object.entries(request.headers)) {
			if (typeof value === 'string') headers.set(key, value)
			else if (Array.isArray(value)) headers.set(key, value.join(', '))
		}
		const webRequest = new Request(`http://localhost${request.url ?? '/'}`, { headers })
		const connection = hocuspocus.handleConnection(socket, webRequest)
		socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
			const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
			connection.handleMessage(new Uint8Array(bytes))
		})
		socket.on('pong', () => connection.touch())
		socket.on('close', (code, reason) => connection.handleClose({ code, reason: reason.toString() }))
	}

	async function close() {
		await watcher.flushAll()
		await rules?.stop()
		hocuspocus.flushPendingStores()
		await Promise.all([...hocuspocus.documents.values()].map((d) => save(d.name, d, null).catch(() => {})))
		hocuspocus.closeConnections()
	}

	return { hocuspocus, handle, close, watcher, rules }
}

import * as Y from 'yjs'
import type { Ctx } from './context.js'

const ASSET_PATH = /\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

/** The uploaded files a board's elements use: `assetId`, or an /api/assets/ address. */
export function assetsIn(doc: Y.Doc, into: Set<string>) {
	doc.getMap('elements').forEach((value) => {
		if (!value || typeof value !== 'object') return
		const el = value as { assetId?: unknown; src?: unknown }
		if (typeof el.assetId === 'string') into.add(el.assetId.toLowerCase())
		if (typeof el.src === 'string') for (const m of el.src.matchAll(ASSET_PATH)) into.add(m[1].toLowerCase())
	})
}

/**
 * Deletes uploaded files no board has used for `days` days. Files are kept a while after they stop being used,
 * because undo, and copies people paste later, can bring them back; if they're used again they're kept.
 */
export async function cleanupAssets(ctx: Ctx, live: (boardId: string) => Y.Doc | undefined, days: number): Promise<{ deleted: number }> {
	const { db, storage } = ctx
	const used = new Set<string>()
	let last = '00000000-0000-0000-0000-000000000000'
	// boards a few at a time, so big documents don't pile up in memory
	for (;;) {
		const { rows } = await db.query<{ id: string; document: Buffer | null }>(
			'SELECT id, document FROM boards WHERE id > $1 ORDER BY id LIMIT 50',
			[last],
		)
		if (!rows.length) break
		for (const row of rows) {
			const doc = live(row.id)
			if (doc) assetsIn(doc, used)
			else if (row.document) {
				const stored = new Y.Doc()
				Y.applyUpdate(stored, new Uint8Array(row.document))
				assetsIn(stored, used)
				stored.destroy()
			}
		}
		last = rows[rows.length - 1].id
	}
	const ids = [...used]
	await db.query('UPDATE assets SET unused_since = NULL WHERE unused_since IS NOT NULL AND id::text = ANY($1)', [ids])
	await db.query('UPDATE assets SET unused_since = now() WHERE unused_since IS NULL AND NOT (id::text = ANY($1))', [ids])
	const { rows: old } = await db.query<{ id: string }>(
		`DELETE FROM assets WHERE unused_since < now() - $1 * interval '1 day' AND NOT (id::text = ANY($2)) RETURNING id`,
		[days, ids],
	)
	await storage.remove(old.map((r) => r.id))
	return { deleted: old.length }
}

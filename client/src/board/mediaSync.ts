import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { serverNow } from './session'

/**
 * The shared playback of a video, or page of a PDF, while its Sync is on. `time` is the position at `at`
 * (server time, ms), so everyone works out where it is now. Kept in the board document, outside undo.
 */
export interface MediaState {
	sync: boolean
	playing: boolean
	time: number
	at: number
	page: number
	by: string
}

export class MediaSync {
	readonly map: Y.Map<MediaState>

	constructor(
		doc: Y.Doc,
		readonly canControl: boolean,
		readonly name: string,
	) {
		this.map = doc.getMap<MediaState>('media')
	}

	get(id: string): MediaState | null {
		return this.map.get(id) ?? null
	}

	set(id: string, patch: Partial<MediaState>) {
		if (!this.canControl) return
		const current = this.get(id) ?? { sync: false, playing: false, time: 0, at: serverNow(), page: 1, by: this.name }
		// not LOCAL: playback isn't something to undo
		this.map.doc?.transact(() => this.map.set(id, { ...current, ...patch, by: this.name }))
	}
}

export const MediaSyncContext = createContext<MediaSync | null>(null)

/** Where a synced video should be now. */
export const expectedTime = (s: MediaState) => s.time + (s.playing ? Math.max(0, serverNow() - s.at) / 1000 : 0)

/** The shared state of one element, and a setter (a no-op for viewers). */
export function useMediaState(id: string) {
	const sync = useContext(MediaSyncContext)
	const subscribe = useCallback(
		(onChange: () => void) => {
			if (!sync) return () => {}
			const handler = (e: Y.YMapEvent<MediaState>) => {
				if (e.keysChanged.has(id)) onChange()
			}
			sync.map.observe(handler)
			return () => sync.map.unobserve(handler)
		},
		[sync, id],
	)
	const state = useSyncExternalStore(subscribe, () => sync?.get(id) ?? null)
	const update = useCallback((patch: Partial<MediaState>) => sync?.set(id, patch), [sync, id])
	return useMemo(() => ({ state, update, canControl: !!sync?.canControl }), [state, update, sync])
}

import { HocuspocusProvider } from '@hocuspocus/provider'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { User } from '../lib/api'
import { BoardStore } from './store'
import type { BoardElement, Point } from './types'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'denied'

export interface PresenceState {
	user: { id: number; name: string; color: string }
	cursor: Point | null
	selection: string[]
	editing: string | null
	/** The part of the board on their screen, in board units, for following them. */
	view?: { x: number; y: number; w: number; h: number }
}

export interface Peer extends PresenceState {
	clientId: number
}

export interface BoardConnection {
	store: BoardStore
	provider: HocuspocusProvider
}

/** Opens the board's shared document; null until it is created. */
export function useBoardConnection(boardId: string): BoardConnection | null {
	const [connection, setConnection] = useState<BoardConnection | null>(null)
	useEffect(() => {
		const doc = new Y.Doc()
		const store = new BoardStore(doc)
		const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
		const provider = new HocuspocusProvider({ url: `${protocol}://${window.location.host}/collab`, name: boardId, document: doc })
		setConnection({ store, provider })
		return () => {
			setConnection(null)
			provider.destroy()
			doc.destroy()
		}
	}, [boardId])
	return connection
}

export function useBoardDoc({ store, provider }: BoardConnection, user: User, readOnly: boolean) {
	useEffect(() => {
		store.readOnly = readOnly
	}, [store, readOnly])

	const [status, setStatus] = useState<ConnectionStatus>('connecting')
	const [synced, setSynced] = useState(provider.isSynced)

	useEffect(() => {
		const onStatus = ({ status }: { status: string }) =>
			setStatus((current) =>
				current === 'denied' ? current : status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected',
			)
		const onSynced = () => setSynced(true)
		const onDenied = () => setStatus('denied')
		provider.on('status', onStatus)
		provider.on('synced', onSynced)
		provider.on('authenticationFailed', onDenied)
		// events may have fired before these listeners
		if (provider.isSynced) setSynced(true)
		if (provider.isAuthenticated) setStatus('connected')
		provider.setAwarenessField('user', { id: user.id, name: user.displayName, color: user.color })
		return () => {
			provider.off('status', onStatus)
			provider.off('synced', onSynced)
			provider.off('authenticationFailed', onDenied)
		}
	}, [provider, user])

	const elements = useElements(store)
	const peers = usePeers(provider, user.id)
	return { elements, peers, status, synced }
}

function useElements(store: BoardStore): Map<string, BoardElement> {
	const subscription = useMemo(() => {
		let snapshot = store.elements()
		return {
			subscribe(onChange: () => void) {
				const handler = () => {
					snapshot = store.elements()
					onChange()
				}
				store.map.observe(handler)
				return () => store.map.unobserve(handler)
			},
			get: () => snapshot,
		}
	}, [store])
	return useSyncExternalStore(subscription.subscribe, subscription.get)
}

/** Everyone else on the board; the user's own other tabs are left out. */
function usePeers(provider: HocuspocusProvider, userId: number): Peer[] {
	const [peers, setPeers] = useState<Peer[]>([])
	useEffect(() => {
		const awareness = provider.awareness
		if (!awareness) return
		const update = () => {
			const list: Peer[] = []
			awareness.getStates().forEach((state, clientId) => {
				if (clientId === awareness.clientID || !state.user || state.user.id === userId) return
				const presence = state as Partial<PresenceState> & Pick<PresenceState, 'user'>
				list.push({
					clientId,
					user: presence.user,
					cursor: presence.cursor ?? null,
					selection: presence.selection ?? [],
					editing: presence.editing ?? null,
					view: presence.view,
				})
			})
			setPeers(list)
		}
		awareness.on('change', update)
		update()
		return () => awareness.off('change', update)
	}, [provider, userId])
	return peers
}

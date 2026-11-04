import { Eye } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { Logo } from '../components/Logo'
import { Spinner } from '../components/ui'
import { api, type User } from '../lib/api'
import { useIsDark } from '../lib/theme'
import { Canvas } from './Canvas'
import { ExportMenu } from './ExportMenu'
import type { Follows } from './follows'
import { setGuestToken } from './media'
import { PresenceAvatars } from './Presence'
import { useBoardConnection, useBoardDoc } from './useBoardDoc'

const GUEST: User = { id: 0, username: 'guest', displayName: 'Guest', isAdmin: false, color: '#6b7280' }
const NO_FOLLOWS: Follows = { board: false, elements: new Set(), toggleBoard: () => {}, toggleElement: () => {} }

/** A board opened with a share link: live and read-only, for people without an account. */
export default function GuestBoard() {
	const { token = '' } = useParams()
	const [board, setBoard] = useState<{ id: string; name: string } | null>(null)
	const [error, setError] = useState('')
	/** Bumped when the link stops working while the board is open. */
	const [generation, setGeneration] = useState(0)

	const load = useCallback(() => {
		api<{ board: { id: string; name: string } }>(`/api/guest/${encodeURIComponent(token)}`)
			.then((r) => {
				setBoard(r.board)
				setGeneration((g) => g + 1)
			})
			.catch((e: Error) => setError(e.message))
	}, [token])

	useEffect(() => {
		setGuestToken(token)
		load()
		return () => setGuestToken(null)
	}, [token, load])

	if (error)
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
				<Logo />
				<p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
			</div>
		)
	if (!board)
		return (
			<div className="flex h-full">
				<Spinner />
			</div>
		)
	return <GuestSession key={`${board.id}:${generation}`} board={board} token={token} onClosed={load} />
}

function GuestSession({ board, token, onClosed }: { board: { id: string; name: string }; token: string; onClosed: () => void }) {
	const connection = useBoardConnection(board.id, token)
	if (!connection)
		return (
			<div className="flex h-full">
				<Spinner />
			</div>
		)
	return <GuestCanvas board={board} connection={connection} onClosed={onClosed} />
}

function GuestCanvas({
	board,
	connection,
	onClosed,
}: {
	board: { id: string; name: string }
	connection: NonNullable<ReturnType<typeof useBoardConnection>>
	onClosed: () => void
}) {
	const dark = useIsDark()
	const { store, provider } = connection
	const { elements, peers, status, synced } = useBoardDoc(connection, GUEST, true)
	const [following, setFollowing] = useState<number | null>(null)
	useEffect(() => {
		document.title = `${board.name} · co-bord`
	}, [board.name])
	// revoked while open: check the link again (it shows why it stopped working)
	useEffect(() => {
		const onClose = ({ event }: { event: { reason?: string } }) => {
			if (event.reason === 'Access changed') onClosed()
		}
		provider.on('close', onClose)
		return () => {
			provider.off('close', onClose)
		}
	}, [provider, onClosed])
	const user = useMemo(() => ({ id: 0, displayName: 'Guest' }), [])

	return (
		<div className="flex h-full flex-col">
			<header className="relative z-30 flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 sm:px-3 dark:border-gray-800 dark:bg-gray-950">
				<span className="hidden sm:block">
					<Logo className="text-sm" />
				</span>
				<span className="hidden text-gray-300 sm:inline dark:text-gray-700">/</span>
				<h1 className="min-w-0 truncate text-sm font-medium">{board.name}</h1>
				<span className="flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
					<Eye size={13} /> Guest · view only
				</span>
				<div className="ml-auto flex items-center gap-2">
					<PresenceAvatars
						peers={peers.filter((p) => p.user.id !== 0)}
						following={following}
						onPick={(peer) => setFollowing(following === peer.clientId ? null : peer.clientId)}
					/>
					<ExportMenu elements={elements} name={board.name} dark={dark} />
				</div>
			</header>
			<div className="relative min-h-0 flex-1">
				{status === 'denied' ? (
					<div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-600 dark:text-gray-400">
						This link doesn't work anymore. Ask for a new one.
					</div>
				) : !synced ? (
					<div className="flex h-full" style={{ background: 'var(--board-bg)' }}>
						<Spinner />
					</div>
				) : (
					<Canvas
						store={store}
						elements={elements}
						peers={peers}
						provider={provider}
						readOnly
						guest
						boardId={board.id}
						dark={dark}
						following={following}
						onFollow={setFollowing}
						user={user}
						boardName={board.name}
						projectId={0}
						sparky={null}
						confluence={null}
						follows={NO_FOLLOWS}
						focusId={null}
					/>
				)}
			</div>
		</div>
	)
}

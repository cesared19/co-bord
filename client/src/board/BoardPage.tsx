import { ArrowLeft, Check, Download, Eye, Link2, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Logo } from '../components/Logo'
import { Avatar, Spinner } from '../components/ui'
import { api, type BoardInfo, canEdit } from '../lib/api'
import { useUser } from '../lib/auth'
import { useIsDark } from '../lib/theme'
import { Canvas } from './Canvas'
import { download, renderPng } from './exportPng'
import { PresenceAvatars } from './Presence'
import { BoardEnvContext, useConfluenceInfo } from './confluence'
import { useSparkyInfo } from './sparky'
import { type BoardConnection, type Peer, useBoardConnection, useBoardDoc } from './useBoardDoc'

export default function BoardPage() {
	const { boardId = '' } = useParams()
	const [board, setBoard] = useState<BoardInfo | null>(null)
	const [error, setError] = useState('')

	useEffect(() => {
		setBoard(null)
		api<{ board: BoardInfo }>(`/api/boards/${boardId}`)
			.then((r) => setBoard(r.board))
			.catch((e) => setError(e.message))
	}, [boardId])

	if (error)
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
				<p className="text-sm text-gray-600 dark:text-gray-400">{error}</p>
				<Link to="/" className="text-sm font-medium text-brand-600 hover:underline">
					Back to projects
				</Link>
			</div>
		)
	if (!board)
		return (
			<div className="flex h-full">
				<Spinner />
			</div>
		)
	return <Board key={board.id} board={board} onRename={(name) => setBoard({ ...board, name })} />
}

function Board({ board, onRename }: { board: BoardInfo; onRename: (name: string) => void }) {
	const connection = useBoardConnection(board.id)
	if (!connection)
		return (
			<div className="flex h-full">
				<Spinner />
			</div>
		)
	return <BoardSession key={board.id} board={board} connection={connection} onRename={onRename} />
}

function BoardSession({
	board,
	connection,
	onRename,
}: {
	board: BoardInfo
	connection: BoardConnection
	onRename: (name: string) => void
}) {
	const user = useUser()
	const dark = useIsDark()
	const readOnly = !canEdit(board.role)
	const { store, provider } = connection
	const { elements, peers, status, synced } = useBoardDoc(connection, user, readOnly)
	const sparky = useSparkyInfo(board.projectId)
	const confluence = useConfluenceInfo(board.projectId)
	const env = useMemo(() => ({ projectId: board.projectId, confluence }), [board.projectId, confluence])
	const [copied, setCopied] = useState(false)
	const [jumpTo, setJumpTo] = useState<Peer | null>(null)

	useEffect(() => {
		document.title = `${board.name} · co-bord`
		return () => {
			document.title = 'co-bord'
		}
	}, [board.name])

	const exportPng = useCallback(async () => {
		const blob = await renderPng(elements, dark)
		if (blob) download(blob, `${board.name.replace(/[\\/:*?"<>|]+/g, '_')}.png`)
	}, [elements, dark, board.name])

	async function copyLink() {
		const url = window.location.href
		try {
			await navigator.clipboard.writeText(url)
		} catch {
			// no clipboard API without HTTPS: fall back to a hidden textarea
			const t = document.createElement('textarea')
			t.value = url
			document.body.append(t)
			t.select()
			document.execCommand('copy')
			t.remove()
		}
		setCopied(true)
		setTimeout(() => setCopied(false), 1500)
	}

	return (
		<div className="flex h-full flex-col">
			<header className="relative z-30 flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 sm:px-3 dark:border-gray-800 dark:bg-gray-950">
				<Link
					to={`/projects/${board.projectId}`}
					title="Back to project"
					className="rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
				>
					<ArrowLeft size={18} />
					<span className="sr-only">Back to project</span>
				</Link>
				<Link to="/" className="hidden sm:block" title="Projects">
					<Logo className="text-sm" />
				</Link>
				<span className="hidden text-gray-300 sm:inline dark:text-gray-700">/</span>
				<span className="hidden max-w-40 truncate text-sm text-gray-500 md:inline">{board.projectName}</span>
				<span className="hidden text-gray-300 md:inline dark:text-gray-700">/</span>
				<BoardName board={board} readOnly={readOnly} onRename={onRename} />
				{readOnly && (
					<span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
						<Eye size={13} /> View only
					</span>
				)}
				<div className="ml-auto flex items-center gap-2">
					{status !== 'connected' && status !== 'denied' && synced && (
						<span
							className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
							title="Your changes are kept and sent when the connection is back"
						>
							<WifiOff size={14} /> <span className="hidden sm:inline">Reconnecting…</span>
						</span>
					)}
					<PresenceAvatars peers={peers} onPick={(peer) => setJumpTo({ ...peer })} />
					<Avatar name={user.displayName} color={user.color} size={30} title={`${user.displayName} (you)`} />
					<button
						type="button"
						onClick={copyLink}
						title="Copy link"
						className="rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
					>
						{copied ? <Check size={18} /> : <Link2 size={18} />}
						<span className="sr-only">Copy link</span>
					</button>
					<button
						type="button"
						onClick={exportPng}
						disabled={!elements.size}
						title="Download as PNG"
						className="rounded p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
					>
						<Download size={18} />
						<span className="sr-only">Download as PNG</span>
					</button>
				</div>
			</header>
			<div className="relative min-h-0 flex-1">
				{status === 'denied' ? (
					<div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-600 dark:text-gray-400">
						You no longer have access to this board.
					</div>
				) : !synced ? (
					<div className="flex h-full" style={{ background: 'var(--board-bg)' }}>
						<Spinner />
					</div>
				) : (
					<BoardEnvContext.Provider value={env}>
						<Canvas
							store={store}
							elements={elements}
							peers={peers}
							provider={provider}
							readOnly={readOnly}
							boardId={board.id}
							dark={dark}
							jumpTo={jumpTo}
							user={user}
							boardName={board.name}
							projectId={board.projectId}
							sparky={sparky}
							confluence={confluence}
						/>
					</BoardEnvContext.Provider>
				)}
			</div>
		</div>
	)
}

function BoardName({ board, readOnly, onRename }: { board: BoardInfo; readOnly: boolean; onRename: (name: string) => void }) {
	const [editing, setEditing] = useState(false)
	const [value, setValue] = useState(board.name)
	const [error, setError] = useState('')

	async function save() {
		setEditing(false)
		const name = value.trim()
		if (!name || name === board.name) return setValue(board.name)
		try {
			await api(`/api/boards/${board.id}`, { method: 'PUT', body: { name } })
			onRename(name)
			setError('')
		} catch (e) {
			setValue(board.name)
			setError((e as Error).message)
		}
	}

	if (editing)
		return (
			<input
				autoFocus
				value={value}
				maxLength={120}
				aria-label="Board name"
				onChange={(e) => setValue(e.target.value)}
				onBlur={save}
				onKeyDown={(e) => {
					if (e.key === 'Enter') save()
					if (e.key === 'Escape') {
						setValue(board.name)
						setEditing(false)
					}
				}}
				className="min-w-0 rounded border border-brand-500 bg-transparent px-1.5 py-0.5 text-sm font-medium outline-none"
			/>
		)
	return (
		<button
			type="button"
			disabled={readOnly}
			title={error || (readOnly ? board.name : 'Rename')}
			onClick={() => setEditing(true)}
			className="min-w-0 truncate rounded px-1.5 py-0.5 text-sm font-medium hover:bg-gray-100 disabled:hover:bg-transparent dark:hover:bg-gray-800"
		>
			{board.name}
		</button>
	)
}

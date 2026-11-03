import { Bell, BellOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

export interface Follows {
	board: boolean
	elements: Set<string>
	toggleBoard: () => void
	toggleElement: (id: string) => void
}

/** What the signed-in user follows on a board: the board itself and some of its elements. */
export function useFollows(boardId: string): Follows {
	const [board, setBoard] = useState(false)
	const [elements, setElements] = useState<Set<string>>(new Set())

	useEffect(() => {
		api<{ board: boolean; elements: string[] }>(`/api/boards/${boardId}/follows`)
			.then((r) => {
				setBoard(r.board)
				setElements(new Set(r.elements))
			})
			.catch(() => {})
	}, [boardId])

	const save = useCallback(
		(elementId: string | undefined, follow: boolean) =>
			api(`/api/boards/${boardId}/follows`, { method: 'PUT', body: { elementId, follow } }).catch(() => {}),
		[boardId],
	)

	const toggleBoard = useCallback(() => {
		setBoard((now) => {
			void save(undefined, !now)
			return !now
		})
	}, [save])

	const toggleElement = useCallback(
		(id: string) => {
			setElements((now) => {
				const next = new Set(now)
				const follow = !next.has(id)
				if (follow) next.add(id)
				else next.delete(id)
				void save(id, follow)
				return next
			})
		},
		[save],
	)

	return { board, elements, toggleBoard, toggleElement }
}

export function FollowBoardButton({ follows }: { follows: Follows }) {
	return (
		<button
			type="button"
			onClick={follows.toggleBoard}
			aria-pressed={follows.board}
			title={
				follows.board ? 'Following this board: you are notified of changes. Click to stop.' : 'Follow this board to be notified of changes'
			}
			className={`hidden items-center gap-1 rounded-md px-2 py-1 text-xs font-medium sm:flex ${
				follows.board
					? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
					: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
			}`}
		>
			{follows.board ? <BellOff size={14} /> : <Bell size={14} />}
			{follows.board ? 'Following' : 'Follow'}
		</button>
	)
}

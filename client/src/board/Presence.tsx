import { Avatar } from '../components/ui'
import { elementBounds, type ElementMap, toScreen } from './geometry'
import type { Camera } from './types'
import type { Peer } from './useBoardDoc'

export function RemoteCursors({ peers, camera }: { peers: Peer[]; camera: Camera }) {
	return (
		<>
			{peers.map((peer) => {
				if (!peer.cursor) return null
				const p = toScreen(camera, peer.cursor)
				return (
					<div
						key={peer.clientId}
						className="absolute top-0 left-0 transition-transform duration-75 ease-linear"
						style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
					>
						<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden className="drop-shadow">
							<path d="M1 1l6 17 2.6-7.2L17 8z" fill={peer.user.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
						</svg>
						<span
							className="absolute top-4 left-3 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow"
							style={{ background: peer.user.color }}
						>
							{peer.user.name}
						</span>
					</div>
				)
			})}
		</>
	)
}

export function RemoteSelections({ peers, elements, camera }: { peers: Peer[]; elements: ElementMap; camera: Camera }) {
	return (
		<>
			{peers.flatMap((peer) =>
				peer.selection.map((id) => {
					const el = elements.get(id)
					if (!el) return null
					const b = elementBounds(el, elements)
					const p = toScreen(camera, b)
					return (
						<div
							key={`${peer.clientId}-${id}`}
							className="absolute rounded-sm border-2"
							style={{
								left: p.x - 4,
								top: p.y - 4,
								width: b.w * camera.zoom + 8,
								height: b.h * camera.zoom + 8,
								borderColor: peer.user.color,
							}}
						>
							{peer.editing === id && (
								<span
									className="absolute -top-5 left-0 rounded px-1 text-[10px] whitespace-nowrap text-white"
									style={{ background: peer.user.color }}
								>
									{peer.user.name} is typing…
								</span>
							)}
						</div>
					)
				}),
			)}
		</>
	)
}

/** Everyone on the board; each user once even with several tabs open. */
export function PresenceAvatars({ peers, onPick }: { peers: Peer[]; onPick: (peer: Peer) => void }) {
	const unique = [...new Map(peers.map((p) => [p.user.id, p])).values()]
	if (!unique.length) return null
	const shown = unique.slice(0, 5)
	return (
		<div className="flex items-center -space-x-1.5">
			{shown.map((peer) => (
				<button
					key={peer.user.id}
					type="button"
					onClick={() => onPick(peer)}
					className="rounded-full"
					title={`${peer.user.name}: go to cursor`}
				>
					<Avatar name={peer.user.name} color={peer.user.color} size={30} />
				</button>
			))}
			{unique.length > shown.length && (
				<span className="inline-flex size-[30px] items-center justify-center rounded-full bg-gray-200 text-xs font-medium ring-2 ring-white dark:bg-gray-700 dark:ring-gray-900">
					+{unique.length - shown.length}
				</span>
			)}
		</div>
	)
}

import { Minus, Pause, Play, Square, Timer, Vote } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { elementBounds, type ElementMap, toScreen } from './geometry'
import { chime, serverNow, type Session, type SessionSnapshot } from './session'
import type { Camera } from './types'

const panel = 'rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900'
const smallBtn =
	'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'

const formatTime = (ms: number) => {
	const total = Math.ceil(Math.max(0, ms) / 1000)
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function remainingOf(timer: SessionSnapshot['timer']) {
	if (!timer) return 0
	return timer.running && timer.endsAt ? timer.endsAt - serverNow() : timer.remaining
}

/** The toolbar popover where an editor starts the timer and the voting. */
export function FacilitationMenu({ session, state, userName }: { session: Session; state: SessionSnapshot; userName: string }) {
	const [minutes, setMinutes] = useState('5')
	const [votes, setVotes] = useState('5')
	const { timer, voting } = state

	return (
		<div className="w-72 space-y-4 p-3 text-sm">
			<section className="space-y-2">
				<h3 className="flex items-center gap-1.5 font-medium">
					<Timer size={16} /> Timer
				</h3>
				{timer ? (
					<TimerControls session={session} state={state} />
				) : (
					<>
						<div className="flex flex-wrap gap-1.5">
							{[1, 3, 5, 10].map((m) => (
								<button
									key={m}
									type="button"
									onClick={() => session.startTimer(m * 60_000, serverNow(), userName)}
									className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:border-brand-500 hover:text-brand-700 dark:border-gray-600 dark:hover:text-brand-300"
								>
									{m} min
								</button>
							))}
						</div>
						<form
							className="flex items-center gap-1.5"
							onSubmit={(e) => {
								e.preventDefault()
								const m = Number(minutes)
								if (m > 0 && m <= 180) session.startTimer(Math.round(m * 60_000), serverNow(), userName)
							}}
						>
							<input
								aria-label="Minutes"
								type="number"
								min={0.5}
								max={180}
								step={0.5}
								value={minutes}
								onChange={(e) => setMinutes(e.target.value)}
								className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
							/>
							<span className="text-xs text-gray-500">minutes</span>
							<button type="submit" className="ml-auto rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">
								Start
							</button>
						</form>
					</>
				)}
			</section>
			<section className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
				<h3 className="flex items-center gap-1.5 font-medium">
					<Vote size={16} /> Voting
				</h3>
				{voting?.active ? (
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-gray-600 dark:text-gray-400">
							{state.voters} {state.voters === 1 ? 'person has' : 'people have'} voted
						</span>
						<button
							type="button"
							onClick={() => session.endVoting()}
							className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
						>
							End voting
						</button>
					</div>
				) : (
					<form
						className="space-y-2"
						onSubmit={(e) => {
							e.preventDefault()
							const n = Math.round(Number(votes))
							if (n >= 1 && n <= 50) session.startVoting(n, userName)
						}}
					>
						<div className="flex items-center gap-1.5">
							<input
								aria-label="Votes per person"
								type="number"
								min={1}
								max={50}
								value={votes}
								onChange={(e) => setVotes(e.target.value)}
								className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
							/>
							<span className="text-xs text-gray-500">votes per person</span>
							<button type="submit" className="ml-auto rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700">
								{voting ? 'New vote' : 'Start'}
							</button>
						</div>
						<p className="text-xs text-gray-500">
							Everyone clicks items to vote, several times on one if they want. Totals show when the voting ends.
						</p>
						{voting && (
							<button type="button" onClick={() => session.clearVoting()} className={smallBtn}>
								Clear the results
							</button>
						)}
					</form>
				)}
			</section>
		</div>
	)
}

function TimerControls({ session, state }: { session: Session; state: SessionSnapshot }) {
	const t = state.timer
	if (!t) return null
	return (
		<div className="flex flex-wrap items-center gap-1">
			{t.running ? (
				<button type="button" className={smallBtn} onClick={() => session.pauseTimer(serverNow())}>
					<Pause size={13} /> Pause
				</button>
			) : (
				<button type="button" className={smallBtn} onClick={() => session.resumeTimer(serverNow())} disabled={remainingOf(t) <= 0}>
					<Play size={13} /> Resume
				</button>
			)}
			<button type="button" className={smallBtn} onClick={() => session.addTime(60_000, serverNow())}>
				+1 min
			</button>
			<button type="button" className={smallBtn} onClick={() => session.stopTimer()}>
				<Square size={12} /> Stop
			</button>
		</div>
	)
}

/** Countdown everyone sees at the top of the board; chimes once at zero. */
export function TimerPill({ session, state, canControl }: { session: Session; state: SessionSnapshot; canControl: boolean }) {
	const t = state.timer
	const [, tick] = useState(0)
	const chimedFor = useRef<number | null>(null)
	useEffect(() => {
		if (!t?.running) return
		const id = setInterval(() => tick((n) => n + 1), 250)
		return () => clearInterval(id)
	}, [t?.running, t?.endsAt])

	const remaining = remainingOf(t)
	useEffect(() => {
		if (t?.running && t.endsAt && remaining <= 0 && chimedFor.current !== t.endsAt) {
			chimedFor.current = t.endsAt
			// only chime for timers that ended while we watched
			if (serverNow() - t.endsAt < 3000) chime()
		}
	}, [t, remaining])

	if (!t) return null
	const done = remaining <= 0
	const urgent = !done && remaining < 10_000
	const progress = t.duration ? Math.min(1, Math.max(0, 1 - remaining / t.duration)) : 1
	return (
		<div role="timer" aria-live="off" className={`${panel} overflow-hidden`}>
			<div className="flex items-center gap-2 px-3 py-1.5">
				<Timer size={16} className={done ? 'text-brand-600' : 'text-gray-500'} />
				<span className={`text-lg font-semibold tabular-nums ${done || urgent ? 'text-brand-600 dark:text-brand-400' : ''}`}>
					{done ? "Time's up" : formatTime(remaining)}
				</span>
				{!t.running && !done && <span className="text-xs text-gray-500">Paused</span>}
				{canControl && (
					<div className="ml-1 flex items-center">
						{!done &&
							(t.running ? (
								<button type="button" title="Pause" className={smallBtn} onClick={() => session.pauseTimer(serverNow())}>
									<Pause size={14} />
									<span className="sr-only">Pause</span>
								</button>
							) : (
								<button type="button" title="Resume" className={smallBtn} onClick={() => session.resumeTimer(serverNow())}>
									<Play size={14} />
									<span className="sr-only">Resume</span>
								</button>
							))}
						<button type="button" title="Add a minute" className={smallBtn} onClick={() => session.addTime(60_000, serverNow())}>
							+1
						</button>
						<button type="button" title="Stop the timer" className={smallBtn} onClick={() => session.stopTimer()}>
							<Square size={13} />
							<span className="sr-only">Stop the timer</span>
						</button>
					</div>
				)}
			</div>
			<div className="h-1 bg-gray-100 dark:bg-gray-800">
				<div className="h-full bg-brand-600 transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
			</div>
		</div>
	)
}

export function VotingBanner({
	session,
	state,
	canControl,
	onResults,
}: {
	session: Session
	state: SessionSnapshot
	canControl: boolean
	onResults: () => void
}) {
	const v = state.voting
	if (!v) return null
	if (v.active) {
		const left = v.perPerson - state.myVotes.length
		return (
			<div className={`${panel} flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm`}>
				<Vote size={16} className="text-brand-600" />
				<span className="font-medium">Voting</span>
				<span className="text-gray-600 dark:text-gray-300">
					{canControl ? `${left} of ${v.perPerson} votes left · click items to vote` : 'Editors are voting'}
				</span>
				{canControl && (
					<button
						type="button"
						onClick={() => session.endVoting()}
						className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
					>
						End voting
					</button>
				)}
			</div>
		)
	}
	return (
		<div className={`${panel} flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm`}>
			<Vote size={16} className="text-brand-600" />
			<span className="font-medium">Voting results</span>
			<span className="text-gray-600 dark:text-gray-300">
				{state.voters} {state.voters === 1 ? 'person' : 'people'} voted
			</span>
			<button type="button" onClick={onResults} className={smallBtn}>
				Ranking
			</button>
			{canControl && (
				<button type="button" onClick={() => session.clearVoting()} className={smallBtn}>
					Clear
				</button>
			)}
		</div>
	)
}

/** Vote counts on the elements: your own while voting (click to take one back), everyone's after. */
export function VoteBadges({
	session,
	state,
	elements,
	camera,
	userId,
}: {
	session: Session
	state: SessionSnapshot
	elements: ElementMap
	camera: Camera
	userId: number
}) {
	const v = state.voting
	if (!v) return null
	const counts = new Map<string, number>()
	if (v.active) for (const id of state.myVotes) counts.set(id, (counts.get(id) ?? 0) + 1)
	else for (const [id, n] of state.counts) counts.set(id, n)
	return (
		<>
			{[...counts].map(([id, n]) => {
				const el = elements.get(id)
				if (!el) return null
				const b = elementBounds(el, elements)
				const p = toScreen(camera, { x: b.x + b.w, y: b.y })
				const style = { left: p.x, top: p.y }
				return v.active ? (
					<button
						key={id}
						type="button"
						data-ui
						title="Take a vote back"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => session.unvote(userId, id)}
						className="group pointer-events-auto absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-0.5 rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white shadow ring-2 ring-white dark:ring-gray-900"
						style={style}
					>
						<span className="group-hover:hidden">{n}</span>
						<Minus size={13} className="hidden group-hover:block" />
						<span className="sr-only">Take a vote back</span>
					</button>
				) : (
					<span
						key={id}
						className="absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white shadow ring-2 ring-white dark:ring-gray-900"
						style={style}
						title={`${n} ${n === 1 ? 'vote' : 'votes'}`}
					>
						{n}
					</span>
				)
			})}
		</>
	)
}

/** Most voted first; picking one shows it on the board. */
export function VoteRanking({
	state,
	elements,
	onPick,
	onClose,
}: {
	state: SessionSnapshot
	elements: ElementMap
	onPick: (id: string) => void
	onClose: () => void
}) {
	const rows = [...state.counts]
		.filter(([id]) => elements.has(id))
		.sort((a, b) => b[1] - a[1])
		.slice(0, 20)
	const label = (id: string) => {
		const el = elements.get(id)
		if (!el) return ''
		if ('text' in el && el.text) return el.text
		if (el.type === 'media') return el.name
		if (el.type === 'frame') return el.title
		return el.type === 'shape' ? 'Shape' : 'Item'
	}
	return (
		<div data-ui className={`${panel} w-80 max-w-[calc(100vw-32px)] p-2`}>
			<div className="mb-1 flex items-center justify-between px-1">
				<h3 className="text-sm font-medium">Ranking</h3>
				<button type="button" onClick={onClose} className={smallBtn}>
					Close
				</button>
			</div>
			{rows.length === 0 ? (
				<p className="px-1 py-2 text-xs text-gray-500">No votes.</p>
			) : (
				<ol className="max-h-72 space-y-0.5 overflow-auto">
					{rows.map(([id, n], i) => (
						<li key={id}>
							<button
								type="button"
								onClick={() => onPick(id)}
								className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
							>
								<span className="w-5 text-xs text-gray-500 tabular-nums">{i + 1}.</span>
								<span className="min-w-0 flex-1 truncate">{label(id)}</span>
								<span className="rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white">{n}</span>
							</button>
						</li>
					))}
				</ol>
			)}
		</div>
	)
}

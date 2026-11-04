import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { newId } from '../lib/id'
import type { BoardStore } from './store'

/** Shared timer. Times are in server milliseconds, so everyone sees the same countdown. */
export interface TimerState {
	running: boolean
	/** When it ends, while running. */
	endsAt: number | null
	/** What is left, while paused. */
	remaining: number
	duration: number
	by: string
}

/** A voting round. Votes live in the `votes` map under `${round}:${userId}`, so each person only writes their own key. */
export interface VotingState {
	round: string
	active: boolean
	perPerson: number
	by: string
}

/** Someone presenting: everyone else follows their view (they can step out). */
export interface Presenting {
	id: string
	clientId: number
	name: string
	color: string
}

/** Facilitation state of a board: kept in the board document, outside undo. */
export class Session {
	readonly map: Y.Map<unknown>
	readonly votes: Y.Map<string[]>

	constructor(private readonly store: BoardStore) {
		this.map = store.doc.getMap('session')
		this.votes = store.doc.getMap<string[]>('votes')
	}

	private set(key: string, value: unknown) {
		if (this.store.readOnly) return
		this.store.doc.transact(() => this.map.set(key, value))
	}

	get timer() {
		return (this.map.get('timer') as TimerState | undefined) ?? null
	}

	get voting() {
		return (this.map.get('voting') as VotingState | undefined) ?? null
	}

	get presenting() {
		return (this.map.get('presenting') as Presenting | undefined) ?? null
	}

	startPresenting(clientId: number, name: string, color: string) {
		this.set('presenting', { id: newId(), clientId, name, color } satisfies Presenting)
	}

	stopPresenting() {
		if (!this.store.readOnly) this.store.doc.transact(() => this.map.delete('presenting'))
	}

	startTimer(ms: number, now: number, by: string) {
		this.set('timer', { running: true, endsAt: now + ms, remaining: ms, duration: ms, by } satisfies TimerState)
	}

	pauseTimer(now: number) {
		const t = this.timer
		if (t?.running && t.endsAt) this.set('timer', { ...t, running: false, endsAt: null, remaining: Math.max(0, t.endsAt - now) })
	}

	resumeTimer(now: number) {
		const t = this.timer
		if (t && !t.running) this.set('timer', { ...t, running: true, endsAt: now + t.remaining })
	}

	addTime(ms: number, now: number) {
		const t = this.timer
		if (!t) return
		if (t.running && t.endsAt) this.set('timer', { ...t, endsAt: Math.max(t.endsAt, now) + ms, duration: t.duration + ms })
		else this.set('timer', { ...t, remaining: t.remaining + ms, duration: t.duration + ms })
	}

	stopTimer() {
		if (!this.store.readOnly) this.store.doc.transact(() => this.map.delete('timer'))
	}

	startVoting(perPerson: number, by: string) {
		this.set('voting', { round: newId(), active: true, perPerson, by } satisfies VotingState)
	}

	endVoting() {
		const v = this.voting
		if (v) this.set('voting', { ...v, active: false })
	}

	/** Removes the round and its votes. */
	clearVoting() {
		if (this.store.readOnly) return
		this.store.doc.transact(() => {
			this.map.delete('voting')
			for (const key of [...this.votes.keys()]) this.votes.delete(key)
		})
	}

	myVotes(userId: number): string[] {
		const v = this.voting
		return v ? (this.votes.get(`${v.round}:${userId}`) ?? []) : []
	}

	vote(userId: number, elementId: string) {
		const v = this.voting
		if (!v?.active || this.store.readOnly) return false
		const mine = this.myVotes(userId)
		if (mine.length >= v.perPerson) return false
		this.store.doc.transact(() => this.votes.set(`${v.round}:${userId}`, [...mine, elementId]))
		return true
	}

	unvote(userId: number, elementId: string) {
		const v = this.voting
		if (!v?.active || this.store.readOnly) return
		const mine = [...this.myVotes(userId)]
		const index = mine.lastIndexOf(elementId)
		if (index < 0) return
		mine.splice(index, 1)
		this.store.doc.transact(() => this.votes.set(`${v.round}:${userId}`, mine))
	}

	/** Votes per element in the current round, and how many people voted. */
	totals(): { counts: Map<string, number>; voters: number } {
		const v = this.voting
		const counts = new Map<string, number>()
		let voters = 0
		if (!v) return { counts, voters }
		for (const [key, ids] of this.votes.entries()) {
			if (!key.startsWith(`${v.round}:`)) continue
			if (ids.length) voters++
			for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
		}
		return { counts, voters }
	}
}

export interface SessionSnapshot {
	timer: TimerState | null
	voting: VotingState | null
	presenting: Presenting | null
	myVotes: string[]
	counts: Map<string, number>
	voters: number
}

export function useSession(store: BoardStore, userId: number) {
	const session = useMemo(() => new Session(store), [store])
	const subscription = useMemo(() => {
		const read = (): SessionSnapshot => ({
			timer: session.timer,
			voting: session.voting,
			presenting: session.presenting,
			myVotes: session.myVotes(userId),
			...session.totals(),
		})
		let snapshot = read()
		return {
			subscribe(onChange: () => void) {
				const handler = () => {
					snapshot = read()
					onChange()
				}
				session.map.observe(handler)
				session.votes.observe(handler)
				return () => {
					session.map.unobserve(handler)
					session.votes.unobserve(handler)
				}
			},
			get: () => snapshot,
		}
	}, [session, userId])
	const state = useSyncExternalStore(subscription.subscribe, subscription.get)
	return { session, ...state }
}

let clockOffset = 0
let clockPromise: Promise<void> | null = null

/** Server time, estimated from /api/health. */
export const serverNow = () => Date.now() + clockOffset

export function useServerClock() {
	const [, setReady] = useState(false)
	useEffect(() => {
		clockPromise ??= (async () => {
			const before = Date.now()
			const res = await fetch('/api/health')
			const after = Date.now()
			const { now } = (await res.json()) as { now: number }
			clockOffset = now - (before + after) / 2
		})().catch(() => {})
		void clockPromise.then(() => setReady(true))
	}, [])
}

/** A short chime when the timer ends; silent if the browser blocks sound. */
export function chime() {
	try {
		const audio = new AudioContext()
		for (const [i, freq] of [880, 1320].entries()) {
			const osc = audio.createOscillator()
			const gain = audio.createGain()
			osc.frequency.value = freq
			gain.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.18)
			gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + i * 0.18 + 0.02)
			gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.18 + 0.5)
			osc.connect(gain).connect(audio.destination)
			osc.start(audio.currentTime + i * 0.18)
			osc.stop(audio.currentTime + i * 0.18 + 0.55)
		}
		setTimeout(() => audio.close(), 1500)
	} catch {
		/* no sound */
	}
}

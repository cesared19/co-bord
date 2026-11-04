import { Play } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { expectedTime, type MediaState } from './mediaSync'
import { serverNow } from './session'

interface Playback {
	playing: boolean
	time: number
}

/** What a player lets the sync do: control it and read where it is. */
interface Controls {
	play: () => Promise<void> | void
	pause: () => void
	seek: (time: number) => void
	current: () => Playback
}

/** Lets the media block read the playback when Sync is turned on, to start everyone from there. */
export interface PlaybackHandle {
	current: () => Playback | null
}

interface SyncProps {
	state: MediaState | null
	update: (patch: Partial<MediaState>) => void
	handle?: Ref<PlaybackHandle>
}

/**
 * Keeps a player in step with the shared state while Sync is on: applies what others do, and shares what this
 * person does. Events that already match the shared state (like the ones applying it causes) aren't shared again.
 */
function useSyncedPlayback(controls: Controls | null, { state, update, handle }: SyncProps) {
	const [blocked, setBlocked] = useState(false)
	const synced = !!state?.sync

	useImperativeHandle(handle, () => ({ current: () => controls?.current() ?? null }), [controls])

	const apply = useCallback(async () => {
		if (!controls || !state?.sync) return
		const now = controls.current()
		const expected = expectedTime(state)
		if (Math.abs(now.time - expected) > 1) controls.seek(expected)
		if (state.playing && !now.playing) {
			try {
				await controls.play()
				setBlocked(false)
			} catch {
				// the browser wants a click before playing with sound
				setBlocked(true)
			}
		} else if (!state.playing && now.playing) controls.pause()
		if (!state.playing) setBlocked(false)
	}, [controls, state])

	useEffect(() => {
		void apply()
	}, [apply])

	// drift: check now and then while playing together
	useEffect(() => {
		if (!synced || !state?.playing) return
		const id = setInterval(() => void apply(), 5000)
		return () => clearInterval(id)
	}, [synced, state?.playing, apply])

	const report = useCallback(
		(p: Playback) => {
			if (!state?.sync) return
			if (p.playing === state.playing && Math.abs(p.time - expectedTime(state)) < 1) return
			update({ playing: p.playing, time: Math.max(0, p.time), at: serverNow() })
		},
		[state?.sync, update],
	)

	const join = () => {
		setBlocked(false)
		void apply()
	}
	return { report, blocked, join, synced }
}

function JoinOverlay({ by, onJoin }: { by: string; onJoin: () => void }) {
	return (
		<button
			type="button"
			onClick={onJoin}
			className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-sm font-medium text-white"
		>
			<Play size={28} />
			{by} is playing this. Click to watch along.
		</button>
	)
}

/** An uploaded video. */
export function SyncedVideo({ src, ...sync }: SyncProps & { src: string }) {
	const ref = useRef<HTMLVideoElement>(null)
	const [controls, setControls] = useState<Controls | null>(null)
	useEffect(() => {
		const v = ref.current
		if (!v) return
		setControls({
			play: () => v.play(),
			pause: () => v.pause(),
			seek: (t) => {
				v.currentTime = t
			},
			current: () => ({ playing: !v.paused && !v.ended, time: v.currentTime }),
		})
	}, [src])
	const { report, blocked, join } = useSyncedPlayback(controls, sync)
	const now = () => ({ playing: !!ref.current && !ref.current.paused, time: ref.current?.currentTime ?? 0 })
	return (
		<div className="relative h-full w-full">
			<video
				ref={ref}
				src={src}
				controls
				playsInline
				preload="metadata"
				onPlay={() => report(now())}
				onPause={() => report(now())}
				onSeeked={() => report(now())}
				style={{ width: '100%', height: '100%', background: '#000', objectFit: 'contain' }}
			/>
			{blocked && <JoinOverlay by={sync.state?.by ?? 'Someone'} onJoin={join} />}
		</div>
	)
}

const ORIGINS = { youtube: 'https://www.youtube-nocookie.com', vimeo: 'https://player.vimeo.com' }

/**
 * A YouTube or Vimeo player, controlled through the providers' message APIs (YouTube's widget API with
 * enablejsapi, Vimeo's player API), so no third-party script is loaded.
 */
export function SyncedEmbed({ kind, src, title, ...sync }: SyncProps & { kind: 'youtube' | 'vimeo'; src: string; title: string }) {
	const ref = useRef<HTMLIFrameElement>(null)
	const last = useRef<{ playing: boolean; time: number; at: number }>({ playing: false, time: 0, at: Date.now() })
	const [controls, setControls] = useState<Controls | null>(null)
	const reportRef = useRef<(p: Playback) => void>(() => {})

	const url =
		kind === 'youtube'
			? `${src}${src.includes('?') ? '&' : '?'}enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`
			: `${src}${src.includes('?') ? '&' : '?'}api=1`

	useEffect(() => {
		const frame = ref.current
		if (!frame) return
		const origin = ORIGINS[kind]
		const post = (message: unknown) => frame.contentWindow?.postMessage(JSON.stringify(message), origin)
		const now = (): Playback => {
			const l = last.current
			return { playing: l.playing, time: l.time + (l.playing ? (Date.now() - l.at) / 1000 : 0) }
		}
		const set = (playing: boolean, time: number) => {
			last.current = { playing, time, at: Date.now() }
		}
		const ytCommand = (func: string, args: unknown[] = []) => post({ event: 'command', func, args, id: 1, channel: 'widget' })

		const onMessage = (e: MessageEvent) => {
			if (e.source !== frame.contentWindow || e.origin !== origin) return
			let data: Record<string, unknown>
			try {
				data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
			} catch {
				return
			}
			if (kind === 'youtube') {
				const info = data.info as { currentTime?: number; playerState?: number } | number | undefined
				if (data.event === 'onReady' || data.event === 'initialDelivery') setControls(ytControls)
				if (data.event === 'infoDelivery' && info && typeof info === 'object') {
					const before = now()
					if (typeof info.currentTime === 'number') {
						const playing = info.playerState === undefined ? last.current.playing : info.playerState === 1
						set(playing, info.currentTime)
						// a jump while not changing state is a seek
						if (Math.abs(info.currentTime - before.time) > 2 && info.playerState === undefined) reportRef.current(now())
					}
				}
				if (data.event === 'onStateChange' && typeof info === 'number' && (info === 1 || info === 2)) {
					set(info === 1, now().time)
					reportRef.current(now())
				}
			} else {
				const seconds = (data.data as { seconds?: number } | undefined)?.seconds
				if (data.event === 'ready') {
					for (const value of ['play', 'pause', 'seeked', 'timeupdate']) post({ method: 'addEventListener', value })
					setControls(vimeoControls)
				}
				if (typeof seconds !== 'number') return
				if (data.event === 'timeupdate') set(last.current.playing, seconds)
				if (data.event === 'play' || data.event === 'pause' || data.event === 'seeked') {
					set(data.event === 'play' ? true : data.event === 'pause' ? false : last.current.playing, seconds)
					reportRef.current(now())
				}
			}
		}
		const ytControls: Controls = {
			play: () => ytCommand('playVideo'),
			pause: () => ytCommand('pauseVideo'),
			seek: (t) => {
				ytCommand('seekTo', [t, true])
				set(last.current.playing, t)
			},
			current: now,
		}
		const vimeoControls: Controls = {
			play: () => post({ method: 'play' }),
			pause: () => post({ method: 'pause' }),
			seek: (t) => {
				post({ method: 'setCurrentTime', value: t })
				set(last.current.playing, t)
			},
			current: now,
		}
		window.addEventListener('message', onMessage)
		// YouTube starts sending events once it's told someone listens
		const onLoad = () => kind === 'youtube' && post({ event: 'listening', id: 1, channel: 'widget' })
		frame.addEventListener('load', onLoad)
		return () => {
			window.removeEventListener('message', onMessage)
			frame.removeEventListener('load', onLoad)
		}
	}, [kind, url])

	const { report, blocked, join } = useSyncedPlayback(controls, sync)
	reportRef.current = report
	return (
		<div className="relative h-full w-full">
			<iframe
				ref={ref}
				src={url}
				title={title}
				loading="lazy"
				allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
				allowFullScreen
				referrerPolicy="strict-origin-when-cross-origin"
				style={{ width: '100%', height: '100%', border: 0, background: '#000' }}
			/>
			{blocked && <JoinOverlay by={sync.state?.by ?? 'Someone'} onJoin={join} />}
		</div>
	)
}

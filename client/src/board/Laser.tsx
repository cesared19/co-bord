import { useEffect, useState } from 'react'
import { toScreen } from './geometry'
import type { LaserTrail } from './ink'
import type { Camera } from './types'
import type { Peer } from './useBoardDoc'

const LASER = '#ef4444'

/** Laser strokes, this person's and everyone else's, in screen space. */
export function LaserOverlay({
	trail,
	peers,
	camera,
	publish,
}: {
	trail: LaserTrail
	peers: Peer[]
	camera: Camera
	publish: (strokes: number[][] | null) => void
}) {
	const [, setTick] = useState(0)

	// while there's something to show: redraw every frame, share a few times a second, and say when it's gone
	useEffect(() => {
		let raf: number | null = null
		let lastSent = 0
		const frame = () => {
			raf = null
			const now = performance.now()
			const alive = trail.prune(now)
			if (!alive || now - lastSent > 60) {
				publish(alive ? trail.shared() : null)
				lastSent = now
			}
			setTick((t) => t + 1)
			if (alive) raf = requestAnimationFrame(frame)
		}
		const off = trail.onChange(() => {
			if (raf === null) raf = requestAnimationFrame(frame)
		})
		return () => {
			off()
			if (raf !== null) cancelAnimationFrame(raf)
		}
	}, [trail, publish])

	const line = (points: number[]) => {
		let d = ''
		for (let i = 0; i < points.length; i += 2) {
			const s = toScreen(camera, { x: points[i], y: points[i + 1] })
			d += `${i ? 'L' : 'M'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`
		}
		return points.length === 2 ? `${d}l0.01 0` : d
	}
	const mine = trail.shared()
	const theirs = peers.flatMap((p) => p.laser ?? [])
	if (!mine.length && !theirs.length) return null
	return (
		<svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
			{[...theirs, ...mine].map((points, i) => (
				<g key={i}>
					<path
						d={line(points)}
						fill="none"
						stroke={LASER}
						strokeOpacity={0.25}
						strokeWidth={10}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<path d={line(points)} fill="none" stroke={LASER} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
				</g>
			))}
		</svg>
	)
}

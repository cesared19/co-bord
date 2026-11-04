import * as Y from 'yjs'
import { newId } from '../lib/id'
import { connectorGeometry, type ElementMap } from './geometry'
import { copiedGroups } from './groups'
import type { BoardElement, DistributiveOmit, Point } from './types'
import { isBox } from './types'

/** Marks local edits so undo only reverts what this user did. */
export const LOCAL = Symbol('local')

type Patch = Partial<BoardElement> & Record<string, unknown>

/**
 * The board lives in a Yjs map `elements` (id -> plain element object). Each edit replaces the
 * whole element, so concurrent edits on one element keep the last one.
 */
export class BoardStore {
	readonly map: Y.Map<BoardElement>
	readonly undo: Y.UndoManager
	readOnly = false

	constructor(readonly doc: Y.Doc) {
		this.map = doc.getMap<BoardElement>('elements')
		this.undo = new Y.UndoManager(this.map, { trackedOrigins: new Set([LOCAL]), captureTimeout: 400 })
	}

	elements(): ElementMap {
		return new Map(this.map.entries())
	}

	get(id: string) {
		return this.map.get(id)
	}

	private transact(fn: () => void) {
		if (this.readOnly) return
		this.doc.transact(fn, LOCAL)
	}

	maxZ() {
		let z = 0
		for (const el of this.map.values()) z = Math.max(z, el.z)
		return z
	}

	add(elements: (DistributiveOmit<BoardElement, 'id' | 'z'> & { id?: string })[]): string[] {
		const ids: string[] = []
		this.transact(() => {
			let z = this.maxZ()
			for (const el of elements) {
				const id = el.id ?? newId()
				ids.push(id)
				this.map.set(id, { ...el, id, z: ++z } as BoardElement)
			}
		})
		return ids
	}

	update(patches: Map<string, Patch> | [string, Patch][]) {
		this.transact(() => {
			for (const [id, patch] of patches) {
				const current = this.map.get(id)
				if (current) this.map.set(id, { ...current, ...patch } as BoardElement)
			}
		})
	}

	/** Deletes elements; connectors attached to them stay, detached where they were. */
	remove(ids: Iterable<string>) {
		const gone = new Set(ids)
		this.transact(() => {
			const all = this.elements()
			for (const el of all.values()) {
				if (el.type !== 'connector' || gone.has(el.id)) continue
				const fromGone = el.from.id && gone.has(el.from.id)
				const toGone = el.to.id && gone.has(el.to.id)
				if (!fromGone && !toGone) continue
				const g = connectorGeometry(el, all)
				this.map.set(el.id, {
					...el,
					from: fromGone ? { x: g.start.x, y: g.start.y } : el.from,
					to: toGone ? { x: g.end.x, y: g.end.y } : el.to,
				})
			}
			for (const id of gone) this.map.delete(id)
		})
	}

	bringToFront(ids: string[]) {
		const sorted = ids
			.map((id) => this.map.get(id))
			.filter((e): e is BoardElement => !!e)
			.sort((a, b) => a.z - b.z)
		let z = this.maxZ()
		this.update(sorted.map((el) => [el.id, { z: ++z }]))
	}

	sendToBack(ids: string[]) {
		const sorted = ids
			.map((id) => this.map.get(id))
			.filter((e): e is BoardElement => !!e)
			.sort((a, b) => b.z - a.z)
		let z = Math.min(0, ...[...this.map.values()].map((e) => e.z))
		this.update(sorted.map((el) => [el.id, { z: --z }]))
	}

	/**
	 * Copies elements with new ids, moved by `offset`. Connectors between copied elements
	 * attach to the copies; ends attached to elements left out become free.
	 */
	clone(elements: BoardElement[], offset: Point, source: ElementMap = this.elements()): string[] {
		const ids = new Map(elements.map((el) => [el.id, newId()]))
		const groups = copiedGroups(elements, this.elements())
		const regroup = (el: BoardElement) => {
			if (!el.groups?.length) return el
			const path = el.groups.map((g) => groups.get(g)).filter((g): g is string => !!g)
			return { ...el, groups: path }
		}
		const copies = elements.map(regroup).map((el): BoardElement => {
			if (isBox(el)) return { ...el, id: ids.get(el.id)!, x: el.x + offset.x, y: el.y + offset.y }
			const g = connectorGeometry(el, source)
			const end = (e: typeof el.from, p: Point) =>
				e.id && ids.has(e.id) ? { id: ids.get(e.id), x: p.x + offset.x, y: p.y + offset.y } : { x: p.x + offset.x, y: p.y + offset.y }
			return { ...el, id: ids.get(el.id)!, from: end(el.from, g.start), to: end(el.to, g.end) }
		})
		copies.sort((a, b) => a.z - b.z)
		return this.add(copies)
	}

	/** Groups the next changes into their own undo step. */
	checkpoint() {
		this.undo.stopCapturing()
	}
}

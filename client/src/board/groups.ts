import { newId } from '../lib/id'
import type { ElementMap } from './geometry'
import type { BoardElement } from './types'

/**
 * Groups: each element keeps the ids of the groups it's in, outermost first (`groups`). "Entered" is the path of
 * groups the person double-clicked into: clicks pick units one level below it.
 */
const groupsOf = (el: BoardElement | undefined): string[] => el?.groups ?? []

const startsWith = (path: string[], prefix: string[]) => prefix.every((g, i) => path[i] === g)

/** Whether an element is inside the entered groups (always, when none are entered). */
export const insideEntered = (el: BoardElement | undefined, entered: string[]) => !!el && startsWith(groupsOf(el), entered)

/** The group a click on `el` picks, one level below `entered`; null when it's picked on its own. */
export function unitGroup(el: BoardElement | undefined, entered: string[]): string | null {
	const path = groupsOf(el)
	// outside the entered groups, clicks pick whole outermost groups again
	if (!insideEntered(el, entered)) return path[0] ?? null
	return path.length > entered.length ? path[entered.length] : null
}

/** Every element in a group. */
export const groupMembers = (group: string, all: ElementMap) =>
	[...all.values()].filter((el) => groupsOf(el).includes(group)).map((el) => el.id)

/** What a click on `id` selects: its group one level below `entered`, or the element itself. */
export function unitOf(id: string, entered: string[], all: ElementMap): string[] {
	const group = unitGroup(all.get(id), entered)
	return group ? groupMembers(group, all) : [id]
}

/** `ids`, with whole groups for any element in one (one level below `entered`). */
export function expandToUnits(ids: string[], entered: string[], all: ElementMap): string[] {
	const result = new Set<string>()
	for (const id of ids) for (const x of unitOf(id, entered, all)) result.add(x)
	return [...result]
}

/** The groups selected as a whole, one level below `entered`. */
export function selectedGroups(ids: string[], entered: string[], all: ElementMap): string[] {
	const picked = new Set(ids)
	const found = new Set<string>()
	for (const id of ids) {
		const g = unitGroup(all.get(id), entered)
		if (g && groupMembers(g, all).every((m) => picked.has(m))) found.add(g)
	}
	return [...found]
}

/** How many separate things are selected: groups count once. */
export function unitCount(ids: string[], entered: string[], all: ElementMap): number {
	const units = new Set(ids.map((id) => unitGroup(all.get(id), entered) ?? `el:${id}`))
	return units.size
}

/** The shared start of the elements' group paths. */
function commonPath(els: BoardElement[]): string[] {
	const paths = els.map(groupsOf)
	const first = paths[0] ?? []
	let n = 0
	while (n < first.length && paths.every((p) => p[n] === first[n])) n++
	return first.slice(0, n)
}

/**
 * Patches that put the elements in a new group, inside the groups they share (up to the entered ones), so groups
 * nest: grouping two groups makes a group of groups.
 */
export function groupPatches(els: BoardElement[], entered: string[]): [string, Partial<BoardElement>][] {
	const shared = commonPath(els)
	const level = startsWith(shared, entered) ? entered.length : Math.min(shared.length, entered.length)
	const id = newId()
	return els.map((el) => {
		const path = groupsOf(el)
		return [el.id, { groups: [...path.slice(0, level), id, ...path.slice(level)] }]
	})
}

/** Patches that take the selected groups (one level below `entered`) apart; what was inside stays grouped inside. */
export function ungroupPatches(els: BoardElement[], entered: string[], groups: string[]): [string, Partial<BoardElement>][] {
	const gone = new Set(groups)
	return els
		.filter((el) => gone.has(groupsOf(el)[entered.length]))
		.map((el) => {
			const path = groupsOf(el).filter((g) => !gone.has(g))
			return [el.id, { groups: path }]
		})
}

/**
 * Group ids for copies of `copied` (ids in the board `all`): a group copied whole gets a new id, so the copy is
 * its own group; one copied in part is left out, so a copy of one element of a group isn't grouped with nothing.
 * Groups not on the board at all (pasted from elsewhere) count as whole.
 */
export function copiedGroups(copied: BoardElement[], all: ElementMap): Map<string, string | null> {
	const ids = new Set(copied.map((el) => el.id))
	const result = new Map<string, string | null>()
	for (const el of copied)
		for (const g of groupsOf(el)) {
			if (result.has(g)) continue
			const whole = [...all.values()].every((other) => !groupsOf(other).includes(g) || ids.has(other.id))
			result.set(g, whole ? newId() : null)
		}
	return result
}

import { CircleAlert, CircleCheck, History, Pencil, Plus, Trash2, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useBoardEnv } from './confluence'
import type { ElementMap } from './geometry'
import { STICKY_COLORS } from './types'

export type RuleTrigger = { type: 'frame'; frameId: string } | { type: 'votes'; count: number } | { type: 'test-fails' }

export type RuleAction =
	| { type: 'jira' }
	| { type: 'note'; color?: string; done?: boolean; frameId?: string }
	| { type: 'notify'; userIds: number[] }
	| { type: 'test-case'; sectionPath?: string }

interface RuleRun {
	id: number
	elementId: string | null
	text: string
	ok: boolean
	details: { action: string; ok: boolean; message: string }[]
	at: string
}

interface Rule {
	id: number
	name: string
	enabled: boolean
	trigger: RuleTrigger
	actions: RuleAction[]
	createdBy: string | null
	createdAt: string
	runs: RuleRun[]
}

type Draft = { id: number | null; name: string; trigger: RuleTrigger; actions: RuleAction[] }

const ACTIONS: { type: RuleAction['type']; label: string }[] = [
	{ type: 'jira', label: 'Create a Jira issue' },
	{ type: 'note', label: 'Change the card' },
	{ type: 'notify', label: 'Notify people' },
	{ type: 'test-case', label: 'Create a test case' },
]

const newAction = (type: RuleAction['type']): RuleAction =>
	type === 'note' ? { type, done: true } : type === 'notify' ? { type, userIds: [] } : type === 'test-case' ? { type } : { type: 'jira' }

function ago(iso: string) {
	const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
	if (s < 60) return 'just now'
	if (s < 3600) return `${Math.floor(s / 60)} min ago`
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`
	return new Date(iso).toLocaleDateString()
}

/**
 * The card rules of a board: when a card enters a frame, gets votes or its linked test starts failing, run
 * actions on it. Everyone sees the rules and what they did; editors create, pause and change them.
 */
export function RulesPanel({
	boardId,
	elements,
	readOnly,
	sparky,
	onShow,
	onClose,
}: {
	boardId: string
	elements: ElementMap
	readOnly: boolean
	/** SparkyTC is connected, and whether its token can write. */
	sparky: { connected: boolean; canWrite: boolean }
	onShow: (id: string) => void
	onClose: () => void
}) {
	const { jira, members } = useBoardEnv()
	const [rules, setRules] = useState<Rule[] | null>(null)
	const [error, setError] = useState('')
	const [draft, setDraft] = useState<Draft | null>(null)
	const [open, setOpen] = useState<number | null>(null)

	const frames = useMemo(
		() =>
			[...elements.values()]
				.filter((el) => el.type === 'frame')
				.sort((a, b) => a.y - b.y || a.x - b.x)
				.map((f) => ({ id: f.id, title: (f.type === 'frame' && f.title) || 'Untitled frame' })),
		[elements],
	)
	const frameName = (id: string | undefined) => (id ? (frames.find((f) => f.id === id)?.title ?? 'a deleted frame') : '')

	const load = useCallback(async () => {
		try {
			setRules((await api<{ rules: Rule[] }>(`/api/boards/${boardId}/rules`)).rules)
			setError('')
		} catch (e) {
			setError((e as Error).message)
		}
	}, [boardId])

	useEffect(() => {
		void load()
		// what the rules did shows up as they run
		const id = setInterval(load, 10_000)
		return () => clearInterval(id)
	}, [load])

	const describeTrigger = (t: RuleTrigger) =>
		t.type === 'frame'
			? `A card enters ${frameName(t.frameId)}`
			: t.type === 'votes'
				? `A card gets ${t.count} ${t.count === 1 ? 'vote' : 'votes'}`
				: 'A linked test starts failing'

	const describeAction = (a: RuleAction) => {
		switch (a.type) {
			case 'jira':
				return `Create a Jira issue${jira?.projectKey ? ` in ${jira.projectKey}` : ''}`
			case 'note': {
				const parts = [a.color && 'change its color', a.frameId && `move it to ${frameName(a.frameId)}`, a.done && 'mark it done']
				const text = parts.filter(Boolean).join(', ')
				return text.charAt(0).toUpperCase() + text.slice(1)
			}
			case 'notify': {
				const names = a.userIds.map((id) => members.find((m) => m.id === id)?.displayName ?? 'someone')
				return `Notify ${names.join(', ')}`
			}
			case 'test-case':
				return `Create a test case${a.sectionPath ? ` in ${a.sectionPath}` : ''}`
		}
	}

	async function save(d: Draft) {
		const body = { name: d.name, trigger: d.trigger, actions: d.actions }
		if (d.id) await api(`/api/boards/${boardId}/rules/${d.id}`, { method: 'PUT', body })
		else await api(`/api/boards/${boardId}/rules`, { method: 'POST', body })
		setDraft(null)
		await load()
	}

	async function toggle(rule: Rule) {
		setRules((list) => list?.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)) ?? null)
		try {
			await api(`/api/boards/${boardId}/rules/${rule.id}`, { method: 'PUT', body: { enabled: !rule.enabled } })
		} catch (e) {
			setError((e as Error).message)
		}
		await load()
	}

	async function remove(rule: Rule) {
		if (!window.confirm(`Delete the rule “${rule.name}” and its history?`)) return
		try {
			await api(`/api/boards/${boardId}/rules/${rule.id}`, { method: 'DELETE' })
		} catch (e) {
			setError((e as Error).message)
		}
		await load()
	}

	return (
		<aside
			data-ui
			aria-label="Rules"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-0 right-0 bottom-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
		>
			<div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<h2 className="flex items-center gap-2 font-semibold">
					<Zap size={18} /> {draft ? (draft.id ? 'Edit rule' : 'New rule') : 'Rules'}
				</h2>
				<button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
					<X size={18} />
					<span className="sr-only">Close</span>
				</button>
			</div>
			{draft ? (
				<RuleForm draft={draft} frames={frames} sparky={sparky} onCancel={() => setDraft(null)} onSave={save} />
			) : (
				<>
					<div className="relative min-h-0 flex-1 space-y-3 overflow-auto p-4 text-sm">
						<p className="text-gray-600 dark:text-gray-400">
							Rules act on cards (sticky notes and shapes with text) when something happens to them.
						</p>
						{error && <p className="text-red-600 dark:text-red-400">{error}</p>}
						{rules?.length === 0 && <p className="text-gray-500">No rules on this board yet.</p>}
						{rules?.map((rule) => (
							<section
								key={rule.id}
								aria-label={rule.name}
								className={`rounded-lg border border-gray-200 p-3 dark:border-gray-700 ${rule.enabled ? '' : 'opacity-70'}`}
							>
								<div className="flex items-start justify-between gap-2">
									<h3 className="min-w-0 font-medium break-words">{rule.name}</h3>
									{readOnly ? (
										<span className="shrink-0 text-xs text-gray-500">{rule.enabled ? 'Active' : 'Paused'}</span>
									) : (
										<button
											type="button"
											role="switch"
											aria-checked={rule.enabled}
											aria-label={`${rule.name}: ${rule.enabled ? 'active' : 'paused'}`}
											onClick={() => void toggle(rule)}
											className="flex shrink-0 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"
										>
											{rule.enabled ? 'Active' : 'Paused'}
											<span
												className={`relative h-5 w-9 rounded-full transition-colors ${rule.enabled ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}
											>
												<span
													className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] ${rule.enabled ? 'left-[18px]' : 'left-0.5'}`}
												/>
											</span>
										</button>
									)}
								</div>
								<p className="mt-1.5 text-gray-700 dark:text-gray-300">
									<span className="font-medium text-gray-500">When</span> {describeTrigger(rule.trigger)}
								</p>
								<ul className="mt-0.5 text-gray-700 dark:text-gray-300">
									{rule.actions.map((a, i) => (
										<li key={i}>
											<span className="font-medium text-gray-500">{i === 0 ? 'Then' : 'And'}</span> {describeAction(a)}
										</li>
									))}
								</ul>
								<div className="mt-2 flex items-center gap-1">
									<button
										type="button"
										aria-expanded={open === rule.id}
										onClick={() => setOpen(open === rule.id ? null : rule.id)}
										className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
									>
										<History size={14} /> History ({rule.runs.length})
									</button>
									{!readOnly && (
										<>
											<button
												type="button"
												onClick={() => setDraft({ id: rule.id, name: rule.name, trigger: rule.trigger, actions: rule.actions })}
												className="ml-auto rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
												title="Edit"
											>
												<Pencil size={14} />
												<span className="sr-only">Edit {rule.name}</span>
											</button>
											<button
												type="button"
												onClick={() => void remove(rule)}
												className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
												title="Delete"
											>
												<Trash2 size={14} />
												<span className="sr-only">Delete {rule.name}</span>
											</button>
										</>
									)}
								</div>
								{open === rule.id && (
									<ol className="mt-2 space-y-2 border-t border-gray-200 pt-2 dark:border-gray-700">
										{rule.runs.length === 0 && <li className="text-xs text-gray-500">It hasn't run yet.</li>}
										{rule.runs.map((run) => (
											<li key={run.id} className="text-xs">
												<div className="flex items-start gap-1.5">
													{run.ok ? (
														<CircleCheck size={14} className="mt-px shrink-0 text-green-600" aria-label="Done" />
													) : (
														<CircleAlert size={14} className="mt-px shrink-0 text-red-600" aria-label="With errors" />
													)}
													<div className="min-w-0 flex-1">
														{run.elementId && elements.has(run.elementId) ? (
															<button type="button" onClick={() => onShow(run.elementId!)} className="text-left hover:underline">
																{run.text}
															</button>
														) : (
															<span>{run.text}</span>
														)}
														<span className="block text-gray-500">{ago(run.at)}</span>
														<ul>
															{run.details.map((d, i) => (
																<li key={i} className={d.ok ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}>
																	{d.message}
																</li>
															))}
														</ul>
													</div>
												</div>
											</li>
										))}
									</ol>
								)}
							</section>
						))}
					</div>
					{!readOnly && (
						<div className="border-t border-gray-200 p-3 dark:border-gray-700">
							<button
								type="button"
								onClick={() =>
									setDraft({
										id: null,
										name: '',
										trigger: frames[0] ? { type: 'frame', frameId: frames[0].id } : { type: 'votes', count: 3 },
										actions: [],
									})
								}
								className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
							>
								<Plus size={16} /> New rule
							</button>
						</div>
					)}
				</>
			)}
		</aside>
	)
}

function RuleForm({
	draft,
	frames,
	sparky,
	onCancel,
	onSave,
}: {
	draft: Draft
	frames: { id: string; title: string }[]
	sparky: { connected: boolean; canWrite: boolean }
	onCancel: () => void
	onSave: (d: Draft) => Promise<void>
}) {
	const { jira, members } = useBoardEnv()
	const [d, setD] = useState(draft)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const input = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800'
	const label = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'
	const setAction = (i: number, a: RuleAction) => setD({ ...d, actions: d.actions.map((x, j) => (j === i ? a : x)) })
	const unused = ACTIONS.filter((a) => !d.actions.some((x) => x.type === a.type))
	const warn = 'mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'

	return (
		<form
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(e) => {
				e.preventDefault()
				setBusy(true)
				setError('')
				onSave(d)
					.catch((err: Error) => setError(err.message))
					.finally(() => setBusy(false))
			}}
		>
			<div className="relative min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
				<label className="block">
					<span className={label}>Name</span>
					<input
						value={d.name}
						onChange={(e) => setD({ ...d, name: e.target.value })}
						required
						maxLength={200}
						placeholder="Bug for what's done"
						className={input}
					/>
				</label>
				<fieldset className="space-y-2">
					<legend className={label}>When</legend>
					<select
						aria-label="Trigger"
						value={d.trigger.type}
						onChange={(e) => {
							const type = e.target.value as RuleTrigger['type']
							setD({
								...d,
								trigger: type === 'frame' ? { type, frameId: frames[0]?.id ?? '' } : type === 'votes' ? { type, count: 3 } : { type },
							})
						}}
						className={input}
					>
						<option value="frame">A card enters a frame</option>
						<option value="votes">A card gets votes</option>
						<option value="test-fails">A linked test starts failing</option>
					</select>
					{d.trigger.type === 'frame' &&
						(frames.length ? (
							<select
								aria-label="Frame"
								value={d.trigger.frameId}
								onChange={(e) => setD({ ...d, trigger: { type: 'frame', frameId: e.target.value } })}
								className={input}
							>
								{!frames.some((f) => d.trigger.type === 'frame' && f.id === d.trigger.frameId) && <option value="">Choose a frame</option>}
								{frames.map((f) => (
									<option key={f.id} value={f.id}>
										{f.title}
									</option>
								))}
							</select>
						) : (
							<p className={warn}>Add a frame to the board first.</p>
						))}
					{d.trigger.type === 'votes' && (
						<label className="flex items-center gap-2">
							<input
								type="number"
								min={1}
								max={99}
								value={d.trigger.count}
								onChange={(e) => setD({ ...d, trigger: { type: 'votes', count: Number(e.target.value) } })}
								className={`${input} w-20`}
							/>
							<span>votes in the current round</span>
						</label>
					)}
					{d.trigger.type === 'test-fails' && (
						<p className="text-xs text-gray-500">
							{sparky.connected
								? 'SparkyTC is checked every few minutes; cards whose tests were already failing when the rule started are left alone.'
								: 'Connect the project to SparkyTC to use this.'}
						</p>
					)}
				</fieldset>

				<fieldset className="space-y-2">
					<legend className={label}>Then</legend>
					{d.actions.map((a, i) => (
						<div key={a.type} className="rounded-md border border-gray-200 p-2.5 dark:border-gray-700">
							<div className="mb-1.5 flex items-center justify-between">
								<span className="font-medium">{ACTIONS.find((x) => x.type === a.type)?.label}</span>
								<button
									type="button"
									onClick={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })}
									className="rounded p-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
								>
									<X size={14} />
									<span className="sr-only">Remove the action</span>
								</button>
							</div>
							{a.type === 'jira' &&
								(jira?.connected ? (
									<p className="text-xs text-gray-500">
										A {jira.issueType} in {jira.projectKey}, linked to the card. When it's done in Jira, the card is marked done.
									</p>
								) : (
									<p className={warn}>An admin needs to connect the project to Jira in its settings.</p>
								))}
							{a.type === 'note' && (
								<div className="space-y-2">
									<div role="radiogroup" aria-label="Color" className="flex flex-wrap items-center gap-1">
										<button
											type="button"
											role="radio"
											aria-checked={!a.color}
											onClick={() => setAction(i, { ...a, color: undefined })}
											className={`rounded px-1.5 text-xs ${!a.color ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
										>
											Same color
										</button>
										{STICKY_COLORS.map((c) => (
											<button
												key={c}
												type="button"
												role="radio"
												aria-checked={a.color === c}
												aria-label={c}
												onClick={() => setAction(i, { ...a, color: c })}
												className={`size-5 rounded-full border ${a.color === c ? 'ring-2 ring-brand-600 ring-offset-1 dark:ring-offset-gray-900' : 'border-gray-300 dark:border-gray-600'}`}
												style={{ background: c }}
											/>
										))}
									</div>
									<select
										aria-label="Move to"
										value={a.frameId ?? ''}
										onChange={(e) => setAction(i, { ...a, frameId: e.target.value || undefined })}
										className={input}
									>
										<option value="">Don't move it</option>
										{frames.map((f) => (
											<option key={f.id} value={f.id}>
												Move it to {f.title}
											</option>
										))}
									</select>
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											checked={!!a.done}
											onChange={(e) => setAction(i, { ...a, done: e.target.checked || undefined })}
											className="accent-brand-600"
										/>
										Mark it done
									</label>
								</div>
							)}
							{a.type === 'notify' && (
								<div className="max-h-36 space-y-1 overflow-auto">
									{members.map((m) => (
										<label key={m.id} className="flex items-center gap-2">
											<input
												type="checkbox"
												checked={a.userIds.includes(m.id)}
												onChange={(e) =>
													setAction(i, {
														...a,
														userIds: e.target.checked ? [...a.userIds, m.id] : a.userIds.filter((x) => x !== m.id),
													})
												}
												className="accent-brand-600"
											/>
											{m.displayName} <span className="text-xs text-gray-500">@{m.username}</span>
										</label>
									))}
								</div>
							)}
							{a.type === 'test-case' && (
								<>
									<input
										aria-label="Section in SparkyTC"
										value={a.sectionPath ?? ''}
										onChange={(e) => setAction(i, { ...a, sectionPath: e.target.value || undefined })}
										maxLength={500}
										placeholder="Section, like Checkout / Payments"
										className={input}
									/>
									<p className="mt-1 text-xs text-gray-500">The card's text is the title; the card is linked to it. Once per card.</p>
									{!sparky.canWrite && (
										<p className={warn}>
											{sparky.connected
												? 'The SparkyTC token can only read: an admin can connect a Read and write token.'
												: 'Connect the project to SparkyTC to use this.'}
										</p>
									)}
								</>
							)}
						</div>
					))}
					{unused.length > 0 && (
						<select
							aria-label="Add an action"
							value=""
							onChange={(e) => e.target.value && setD({ ...d, actions: [...d.actions, newAction(e.target.value as RuleAction['type'])] })}
							className={input}
						>
							<option value="">Add an action…</option>
							{unused.map((a) => (
								<option key={a.type} value={a.type}>
									{a.label}
								</option>
							))}
						</select>
					)}
				</fieldset>
				{error && (
					<p role="alert" className="text-red-600 dark:text-red-400">
						{error}
					</p>
				)}
			</div>
			<div className="flex justify-end gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
				<button
					type="button"
					onClick={onCancel}
					className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={busy || !d.name.trim() || !d.actions.length}
					className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
				>
					{busy ? 'Saving…' : 'Save rule'}
				</button>
			</div>
		</form>
	)
}

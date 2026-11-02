import { Copy, LayoutDashboard, Pencil, Plus, Trash2, UserMinus } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { SparkyConnection } from '../components/SparkyConnection'
import { Avatar, Button, ErrorText, Field, Modal, PageHeader, RoleBadge, Select, Spinner } from '../components/ui'
import { api, type BoardInfo, canEdit, type Member, type Project as ProjectInfo, type Role } from '../lib/api'
import { useUser } from '../lib/auth'
import { timeAgo } from '../lib/format'

type Tab = 'boards' | 'members' | 'settings'

export function Project() {
	const { projectId } = useParams()
	const [params, setParams] = useSearchParams()
	const [project, setProject] = useState<ProjectInfo | null>(null)
	const [error, setError] = useState('')
	const tab = (params.get('tab') as Tab) ?? 'boards'

	const load = useCallback(() => {
		api<{ project: ProjectInfo }>(`/api/projects/${projectId}`)
			.then((r) => setProject(r.project))
			.catch((e) => setError(e.message))
	}, [projectId])
	useEffect(load, [load])

	if (error) return <ErrorText>{error}</ErrorText>
	if (!project) return <Spinner />

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'boards', label: 'Boards' },
		{ id: 'members', label: 'Members' },
		...(project.role === 'owner' ? [{ id: 'settings' as Tab, label: 'Settings' }] : []),
	]

	return (
		<>
			<p className="mb-1 text-sm text-gray-500">
				<Link to="/" className="hover:underline">
					Projects
				</Link>
			</p>
			<PageHeader title={project.name}>
				<RoleBadge role={project.role} />
			</PageHeader>
			{project.description && <p className="-mt-4 mb-6 text-sm text-gray-600 dark:text-gray-400">{project.description}</p>}
			<div role="tablist" className="mb-6 flex gap-1 border-b border-gray-200 dark:border-gray-800">
				{tabs.map((t) => (
					<button
						key={t.id}
						role="tab"
						type="button"
						aria-selected={tab === t.id}
						onClick={() => setParams(t.id === 'boards' ? {} : { tab: t.id }, { replace: true })}
						className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
							tab === t.id
								? 'border-brand-600 text-brand-700 dark:text-brand-300'
								: 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
						}`}
					>
						{t.label}
					</button>
				))}
			</div>
			{tab === 'boards' && <Boards project={project} />}
			{tab === 'members' && <Members project={project} />}
			{tab === 'settings' && project.role === 'owner' && <Settings project={project} onSaved={load} />}
		</>
	)
}

function Boards({ project }: { project: ProjectInfo }) {
	const navigate = useNavigate()
	const [boards, setBoards] = useState<BoardInfo[] | null>(null)
	const [error, setError] = useState('')
	const [creating, setCreating] = useState(false)
	const [renaming, setRenaming] = useState<BoardInfo | null>(null)
	const [deleting, setDeleting] = useState<BoardInfo | null>(null)
	const editable = canEdit(project.role)

	const load = useCallback(() => {
		api<{ boards: BoardInfo[] }>(`/api/projects/${project.id}/boards`)
			.then((r) => setBoards(r.boards))
			.catch((e) => setError(e.message))
	}, [project.id])
	useEffect(load, [load])

	async function run(action: () => Promise<unknown>) {
		setError('')
		try {
			await action()
			load()
		} catch (e) {
			setError((e as Error).message)
		}
	}

	async function create(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const name = new FormData(e.currentTarget).get('name')
		try {
			const r = await api<{ board: BoardInfo }>(`/api/projects/${project.id}/boards`, { method: 'POST', body: { name } })
			navigate(`/boards/${r.board.id}`)
		} catch (err) {
			setError((err as Error).message)
		}
	}

	return (
		<>
			{editable && (
				<div className="mb-4 flex justify-end">
					<Button onClick={() => setCreating(true)}>
						<Plus size={16} /> New board
					</Button>
				</div>
			)}
			<ErrorText>{error}</ErrorText>
			{!boards ? (
				<Spinner />
			) : boards.length === 0 ? (
				<div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
					<LayoutDashboard className="mx-auto mb-3 text-gray-400" />
					No boards yet.
				</div>
			) : (
				<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{boards.map((b) => (
						<li
							key={b.id}
							className="group relative rounded-xl border border-gray-200 bg-white transition hover:border-brand-400 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-500"
						>
							<Link to={`/boards/${b.id}`} className="block p-5">
								<div
									className="mb-4 h-20 rounded-lg bg-[radial-gradient(var(--board-dot)_1px,transparent_1px)] [background-size:12px_12px]"
									style={{ backgroundColor: 'var(--board-bg)' }}
								/>
								<h3 className="truncate pr-16 font-medium">{b.name}</h3>
								<p className="mt-1 text-xs text-gray-500">
									Edited {timeAgo(b.updatedAt)}
									{b.updatedByName ? ` by ${b.updatedByName}` : ''}
								</p>
							</Link>
							{editable && (
								<div className="absolute right-3 bottom-4 flex gap-0.5 opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
									<IconButton label="Rename" onClick={() => setRenaming(b)}>
										<Pencil size={15} />
									</IconButton>
									<IconButton label="Duplicate" onClick={() => run(() => api(`/api/boards/${b.id}/duplicate`, { method: 'POST' }))}>
										<Copy size={15} />
									</IconButton>
									{project.role === 'owner' && (
										<IconButton label="Delete" onClick={() => setDeleting(b)}>
											<Trash2 size={15} />
										</IconButton>
									)}
								</div>
							)}
						</li>
					))}
				</ul>
			)}
			{creating && (
				<Modal title="New board" onClose={() => setCreating(false)}>
					<form onSubmit={create} className="space-y-4">
						<Field label="Name" name="name" required maxLength={120} autoFocus />
						<div className="flex justify-end gap-2">
							<Button variant="secondary" onClick={() => setCreating(false)}>
								Cancel
							</Button>
							<Button type="submit">Create</Button>
						</div>
					</form>
				</Modal>
			)}
			{renaming && (
				<Modal title="Rename board" onClose={() => setRenaming(null)}>
					<form
						onSubmit={(e) => {
							e.preventDefault()
							const name = new FormData(e.currentTarget).get('name')
							const id = renaming.id
							setRenaming(null)
							void run(() => api(`/api/boards/${id}`, { method: 'PUT', body: { name } }))
						}}
						className="space-y-4"
					>
						<Field label="Name" name="name" required maxLength={120} defaultValue={renaming.name} autoFocus />
						<div className="flex justify-end gap-2">
							<Button variant="secondary" onClick={() => setRenaming(null)}>
								Cancel
							</Button>
							<Button type="submit">Save</Button>
						</div>
					</form>
				</Modal>
			)}
			{deleting && (
				<Modal title="Delete board" onClose={() => setDeleting(null)}>
					<p className="mb-5 text-sm">
						Delete <strong>{deleting.name}</strong>? Everyone loses it, and it cannot be undone.
					</p>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={() => setDeleting(null)}>
							Cancel
						</Button>
						<Button
							variant="danger"
							onClick={() => {
								const id = deleting.id
								setDeleting(null)
								void run(() => api(`/api/boards/${id}`, { method: 'DELETE' }))
							}}
						>
							Delete
						</Button>
					</div>
				</Modal>
			)}
		</>
	)
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			title={label}
			onClick={onClick}
			className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
		>
			{children}
			<span className="sr-only">{label}</span>
		</button>
	)
}

interface DirectoryUser {
	id: number
	username: string
	displayName: string
	color: string
}

function Members({ project }: { project: ProjectInfo }) {
	const me = useUser()
	const [members, setMembers] = useState<Member[] | null>(null)
	const [directory, setDirectory] = useState<DirectoryUser[]>([])
	const [error, setError] = useState('')
	const owner = project.role === 'owner'

	const load = useCallback(() => {
		api<{ members: Member[] }>(`/api/projects/${project.id}/members`)
			.then((r) => setMembers(r.members))
			.catch((e) => setError(e.message))
	}, [project.id])
	useEffect(load, [load])
	useEffect(() => {
		if (owner) api<{ users: DirectoryUser[] }>('/api/users/directory').then((r) => setDirectory(r.users))
	}, [owner])

	async function setRole(userId: number, role: Role) {
		setError('')
		try {
			await api(`/api/projects/${project.id}/members/${userId}`, { method: 'PUT', body: { role } })
			load()
		} catch (e) {
			setError((e as Error).message)
		}
	}

	async function remove(userId: number) {
		setError('')
		try {
			await api(`/api/projects/${project.id}/members/${userId}`, { method: 'DELETE' })
			load()
		} catch (e) {
			setError((e as Error).message)
		}
	}

	if (!members) return <Spinner />
	const candidates = directory.filter((u) => !members.some((m) => m.id === u.id))

	return (
		<div className="space-y-4">
			<ErrorText>{error}</ErrorText>
			{owner && candidates.length > 0 && (
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(e) => {
						e.preventDefault()
						const form = new FormData(e.currentTarget)
						void setRole(Number(form.get('user')), form.get('role') as Role)
						e.currentTarget.reset()
					}}
				>
					<label className="text-sm">
						<span className="mb-1 block font-medium">Add member</span>
						<Select name="user" required>
							{candidates.map((u) => (
								<option key={u.id} value={u.id}>
									{u.displayName} ({u.username})
								</option>
							))}
						</Select>
					</label>
					<Select name="role" defaultValue="editor" aria-label="Role">
						<option value="editor">Editor</option>
						<option value="viewer">Viewer</option>
						<option value="owner">Owner</option>
					</Select>
					<Button type="submit">Add</Button>
				</form>
			)}
			<ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
				{members.map((m) => (
					<li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
						<Avatar name={m.displayName} color={m.color} />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium">{m.displayName}</p>
							<p className="truncate text-xs text-gray-500">{m.username}</p>
						</div>
						{owner ? (
							<>
								<Select value={m.role} onChange={(e) => setRole(m.id, e.target.value as Role)} aria-label={`Role of ${m.displayName}`}>
									<option value="owner">Owner</option>
									<option value="editor">Editor</option>
									<option value="viewer">Viewer</option>
								</Select>
								<button
									type="button"
									title="Remove"
									onClick={() => remove(m.id)}
									className="rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
								>
									<UserMinus size={16} />
									<span className="sr-only">Remove {m.displayName}</span>
								</button>
							</>
						) : (
							<>
								<RoleBadge role={m.role} />
								{m.id === me.id && (
									<Button variant="ghost" onClick={() => remove(m.id)}>
										Leave
									</Button>
								)}
							</>
						)}
					</li>
				))}
			</ul>
			<p className="text-xs text-gray-500">Owners manage members and delete boards. Editors create and edit boards. Viewers only look.</p>
		</div>
	)
}

function Settings({ project, onSaved }: { project: ProjectInfo; onSaved: () => void }) {
	const me = useUser()
	const navigate = useNavigate()
	const [error, setError] = useState('')
	const [saved, setSaved] = useState(false)
	const [deleting, setDeleting] = useState(false)

	async function save(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		setError('')
		setSaved(false)
		try {
			await api(`/api/projects/${project.id}`, { method: 'PUT', body: { name: form.get('name'), description: form.get('description') } })
			setSaved(true)
			onSaved()
		} catch (err) {
			setError((err as Error).message)
		}
	}

	return (
		<div className="max-w-lg space-y-8">
			<form onSubmit={save} className="space-y-4">
				<Field label="Name" name="name" required maxLength={100} defaultValue={project.name} />
				<Field label="Description" name="description" maxLength={1000} defaultValue={project.description} />
				<ErrorText>{error}</ErrorText>
				<div className="flex items-center gap-3">
					<Button type="submit">Save</Button>
					{saved && <span className="text-sm text-green-700 dark:text-green-400">Saved</span>}
				</div>
			</form>
			<SparkyConnection projectId={project.id} />
			{me.isAdmin && (
				<section className="rounded-xl border border-red-200 p-4 dark:border-red-900">
					<h2 className="font-medium">Delete project</h2>
					<p className="mt-1 mb-3 text-sm text-gray-600 dark:text-gray-400">Deletes the project and all of its boards.</p>
					<Button variant="danger" onClick={() => setDeleting(true)}>
						Delete project
					</Button>
				</section>
			)}
			{deleting && (
				<Modal title="Delete project" onClose={() => setDeleting(false)}>
					<p className="mb-5 text-sm">
						Delete <strong>{project.name}</strong> and all its boards? This cannot be undone.
					</p>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={() => setDeleting(false)}>
							Cancel
						</Button>
						<Button
							variant="danger"
							onClick={async () => {
								await api(`/api/projects/${project.id}`, { method: 'DELETE' })
								navigate('/')
							}}
						>
							Delete
						</Button>
					</div>
				</Modal>
			)}
		</div>
	)
}

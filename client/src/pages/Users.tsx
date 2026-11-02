import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Avatar, Button, ErrorText, Field, Modal, PageHeader, Spinner } from '../components/ui'
import { api, type User } from '../lib/api'
import { useUser } from '../lib/auth'

export function Users() {
	const me = useUser()
	const [users, setUsers] = useState<User[] | null>(null)
	const [error, setError] = useState('')
	const [creating, setCreating] = useState(false)
	const [resetting, setResetting] = useState<User | null>(null)
	const [deleting, setDeleting] = useState<User | null>(null)
	const [modalError, setModalError] = useState('')

	const load = useCallback(() => {
		api<{ users: User[] }>('/api/users')
			.then((r) => setUsers(r.users))
			.catch((e) => setError(e.message))
	}, [])
	useEffect(load, [load])

	function closeModals() {
		setCreating(false)
		setResetting(null)
		setDeleting(null)
		setModalError('')
	}

	async function submit(action: () => Promise<unknown>) {
		setModalError('')
		try {
			await action()
			closeModals()
			load()
		} catch (e) {
			setModalError((e as Error).message)
		}
	}

	async function toggleAdmin(user: User) {
		setError('')
		try {
			await api(`/api/users/${user.id}`, { method: 'PUT', body: { isAdmin: !user.isAdmin } })
			load()
		} catch (e) {
			setError((e as Error).message)
		}
	}

	function create(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		void submit(() =>
			api('/api/users', {
				method: 'POST',
				body: {
					username: form.get('username'),
					displayName: form.get('displayName'),
					password: form.get('password'),
					isAdmin: form.get('isAdmin') === 'on',
				},
			}),
		)
	}

	return (
		<>
			<PageHeader title="Users">
				<Button onClick={() => setCreating(true)}>
					<Plus size={16} /> New user
				</Button>
			</PageHeader>
			<ErrorText>{error}</ErrorText>
			{!users ? (
				<Spinner />
			) : (
				<ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
					{users.map((u) => (
						<li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
							<Avatar name={u.displayName} color={u.color} />
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">
									{u.displayName}
									{u.id === me.id && <span className="ml-2 text-xs text-gray-500">(you)</span>}
								</p>
								<p className="truncate text-xs text-gray-500">{u.username}</p>
							</div>
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={u.isAdmin}
									disabled={u.id === me.id}
									onChange={() => toggleAdmin(u)}
									className="accent-brand-600"
								/>
								Admin
							</label>
							<button
								type="button"
								title="Reset password"
								onClick={() => setResetting(u)}
								className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
							>
								<KeyRound size={16} />
								<span className="sr-only">Reset password of {u.displayName}</span>
							</button>
							<button
								type="button"
								title="Delete"
								disabled={u.id === me.id}
								onClick={() => setDeleting(u)}
								className="rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:opacity-30 dark:hover:bg-gray-800"
							>
								<Trash2 size={16} />
								<span className="sr-only">Delete {u.displayName}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{creating && (
				<Modal title="New user" onClose={closeModals}>
					<form onSubmit={create} className="space-y-4">
						<Field label="Username" name="username" required autoComplete="off" autoFocus />
						<Field label="Display name" name="displayName" required maxLength={80} />
						<Field
							label="Password"
							name="password"
							type="password"
							required
							minLength={8}
							autoComplete="new-password"
							hint="At least 8 characters. Share it with the person; they can change it in Account."
						/>
						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" name="isAdmin" className="accent-brand-600" /> Admin (manages users and all projects)
						</label>
						<ErrorText>{modalError}</ErrorText>
						<div className="flex justify-end gap-2">
							<Button variant="secondary" onClick={closeModals}>
								Cancel
							</Button>
							<Button type="submit">Create</Button>
						</div>
					</form>
				</Modal>
			)}
			{resetting && (
				<Modal title={`Reset password of ${resetting.displayName}`} onClose={closeModals}>
					<form
						onSubmit={(e) => {
							e.preventDefault()
							const password = new FormData(e.currentTarget).get('password')
							void submit(() => api(`/api/users/${resetting.id}/password`, { method: 'PUT', body: { password } }))
						}}
						className="space-y-4"
					>
						<Field
							label="New password"
							name="password"
							type="password"
							required
							minLength={8}
							autoComplete="new-password"
							autoFocus
							hint="Signs the user out everywhere."
						/>
						<ErrorText>{modalError}</ErrorText>
						<div className="flex justify-end gap-2">
							<Button variant="secondary" onClick={closeModals}>
								Cancel
							</Button>
							<Button type="submit">Reset</Button>
						</div>
					</form>
				</Modal>
			)}
			{deleting && (
				<Modal title="Delete user" onClose={closeModals}>
					<p className="mb-5 text-sm">
						Delete <strong>{deleting.displayName}</strong>? Their boards stay in the projects.
					</p>
					<ErrorText>{modalError}</ErrorText>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={closeModals}>
							Cancel
						</Button>
						<Button variant="danger" onClick={() => submit(() => api(`/api/users/${deleting.id}`, { method: 'DELETE' }))}>
							Delete
						</Button>
					</div>
				</Modal>
			)}
		</>
	)
}

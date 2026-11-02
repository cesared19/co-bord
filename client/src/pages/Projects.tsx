import { FolderKanban, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, ErrorText, Field, Modal, PageHeader, RoleBadge, Spinner } from '../components/ui'
import { api, type Project } from '../lib/api'
import { useUser } from '../lib/auth'

export function Projects() {
	const user = useUser()
	const navigate = useNavigate()
	const [projects, setProjects] = useState<Project[] | null>(null)
	const [error, setError] = useState('')
	const [creating, setCreating] = useState(false)

	useEffect(() => {
		api<{ projects: Project[] }>('/api/projects')
			.then((r) => setProjects(r.projects))
			.catch((e) => setError(e.message))
	}, [])

	async function create(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		try {
			const r = await api<{ project: Project }>('/api/projects', {
				method: 'POST',
				body: { name: form.get('name'), description: form.get('description') },
			})
			navigate(`/projects/${r.project.id}`)
		} catch (err) {
			setError((err as Error).message)
		}
	}

	return (
		<>
			<PageHeader title="Projects">
				{user.isAdmin && (
					<Button onClick={() => setCreating(true)}>
						<Plus size={16} /> New project
					</Button>
				)}
			</PageHeader>
			<ErrorText>{error}</ErrorText>
			{!projects ? (
				<Spinner />
			) : projects.length === 0 ? (
				<div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
					<FolderKanban className="mx-auto mb-3 text-gray-400" />
					{user.isAdmin
						? 'Create the first project to start making boards.'
						: 'You are not a member of any project yet. Ask an admin to add you.'}
				</div>
			) : (
				<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{projects.map((p) => (
						<li key={p.id}>
							<Link
								to={`/projects/${p.id}`}
								className="block h-full rounded-xl border border-gray-200 bg-white p-5 transition hover:border-brand-400 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-500"
							>
								<div className="flex items-start justify-between gap-2">
									<h2 className="font-semibold">{p.name}</h2>
									<RoleBadge role={p.role} />
								</div>
								{p.description && <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{p.description}</p>}
								<p className="mt-3 text-xs text-gray-500">
									{p.boardCount} {p.boardCount === 1 ? 'board' : 'boards'}
								</p>
							</Link>
						</li>
					))}
				</ul>
			)}
			{creating && (
				<Modal title="New project" onClose={() => setCreating(false)}>
					<form onSubmit={create} className="space-y-4">
						<Field label="Name" name="name" required maxLength={100} autoFocus />
						<Field label="Description" name="description" maxLength={1000} />
						<div className="flex justify-end gap-2">
							<Button variant="secondary" onClick={() => setCreating(false)}>
								Cancel
							</Button>
							<Button type="submit">Create</Button>
						</div>
					</form>
				</Modal>
			)}
		</>
	)
}

import { CheckCircle2, Unplug } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import type { ConfluenceInfo } from '../board/confluence'
import { api } from '../lib/api'
import { useUser } from '../lib/auth'
import { Button, ErrorText, Field, Spinner } from './ui'

/** Project settings: the Confluence Cloud site and space this project shows and publishes pages in. */
export function ConfluenceConnection({ projectId }: { projectId: number }) {
	const user = useUser()
	const [info, setInfo] = useState<ConfluenceInfo | null>(null)
	const [editing, setEditing] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		api<ConfluenceInfo>(`/api/projects/${projectId}/confluence`)
			.then(setInfo)
			.catch((e) => setError(e.message))
	}, [projectId])

	async function save(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		setBusy(true)
		setError('')
		try {
			const r = await api<ConfluenceInfo>(`/api/projects/${projectId}/confluence`, {
				method: 'PUT',
				body: {
					url: form.get('url'),
					email: form.get('email'),
					token: form.get('token') || undefined,
					spaceKey: form.get('spaceKey'),
					parentId: form.get('parentId') || undefined,
				},
			})
			setInfo({ ...r, connected: true })
			setEditing(false)
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setBusy(false)
		}
	}

	async function disconnect() {
		setBusy(true)
		try {
			await api(`/api/projects/${projectId}/confluence`, { method: 'DELETE' })
			setInfo({ connected: false })
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setBusy(false)
		}
	}

	if (!info) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

	return (
		<section className="space-y-3">
			<div>
				<h2 className="font-medium">Confluence</h2>
				<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
					Show Confluence pages on boards, and publish boards, frames and their test coverage as Confluence pages.
				</p>
			</div>
			{info.connected && !editing && (
				<div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
					{info.error ? (
						<ErrorText>{info.error}</ErrorText>
					) : (
						<p className="flex items-center gap-2">
							<CheckCircle2 size={16} className="text-green-600" />
							Space <strong>{info.spaceName}</strong> ({info.spaceKey})
						</p>
					)}
					<p className="mt-1 text-xs text-gray-500">
						{info.url}
						{info.email ? ` · ${info.email}` : ''}
						{info.parentId ? ` · new pages go under page ${info.parentId}` : ''}
					</p>
					{user.isAdmin && (
						<div className="mt-3 flex gap-2">
							<Button variant="secondary" onClick={() => setEditing(true)}>
								Change
							</Button>
							<Button variant="ghost" onClick={disconnect} disabled={busy}>
								<Unplug size={15} /> Disconnect
							</Button>
						</div>
					)}
				</div>
			)}
			{!info.connected && !editing && (
				<div className="text-sm text-gray-600 dark:text-gray-400">
					{user.isAdmin ? (
						<Button variant="secondary" onClick={() => setEditing(true)}>
							Connect to Confluence
						</Button>
					) : (
						'Not connected. An admin can connect it.'
					)}
				</div>
			)}
			{editing && (
				<form onSubmit={save} className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
					<Field label="Confluence site" name="url" required defaultValue={info.url ?? ''} placeholder="https://your-team.atlassian.net" />
					<Field
						label="Account email"
						name="email"
						type="email"
						required
						defaultValue={info.email ?? ''}
						hint="The Atlassian account co-bord reads and publishes pages with. Pages are published in its name."
					/>
					<Field
						label="API token"
						name="token"
						type="password"
						autoComplete="off"
						required={!info.connected}
						placeholder={info.connected ? 'Leave empty to keep the current token' : ''}
						hint="Created at id.atlassian.com, Security, API tokens. It's stored encrypted."
					/>
					<Field label="Space key" name="spaceKey" required defaultValue={info.spaceKey ?? ''} placeholder="QA" />
					<Field
						label="Parent page (optional)"
						name="parentId"
						defaultValue={info.parentId ?? ''}
						placeholder="Page address or id"
						hint="New pages are created under it, in the same space."
					/>
					<ErrorText>{error}</ErrorText>
					<div className="flex gap-2">
						<Button type="submit" disabled={busy}>
							{busy ? 'Checking…' : 'Save connection'}
						</Button>
						<Button variant="secondary" onClick={() => setEditing(false)}>
							Cancel
						</Button>
					</div>
				</form>
			)}
		</section>
	)
}

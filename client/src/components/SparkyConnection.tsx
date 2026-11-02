import { CheckCircle2, Unplug } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useUser } from '../lib/auth'
import type { SparkyInfo } from '../board/sparky'
import { Button, ErrorText, Field, Spinner } from './ui'

/** Project settings: the SparkyTC project this co-bord project reads test results from. */
export function SparkyConnection({ projectId }: { projectId: number }) {
	const user = useUser()
	const [info, setInfo] = useState<SparkyInfo | null>(null)
	const [editing, setEditing] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		api<SparkyInfo>(`/api/projects/${projectId}/sparkytc`)
			.then(setInfo)
			.catch((e) => setError(e.message))
	}, [projectId])

	async function save(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		setBusy(true)
		setError('')
		try {
			const r = await api<SparkyInfo>(`/api/projects/${projectId}/sparkytc`, {
				method: 'PUT',
				body: { url: form.get('url'), publicUrl: form.get('publicUrl') || undefined, token: form.get('token') || undefined },
			})
			setInfo(r)
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
			await api(`/api/projects/${projectId}/sparkytc`, { method: 'DELETE' })
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
				<h2 className="font-medium">SparkyTC</h2>
				<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
					Link board steps to SparkyTC test cases, suites and plans to see their latest results and the test coverage of a flow.
				</p>
			</div>
			{info.connected && !editing && (
				<div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
					{info.error ? (
						<ErrorText>{info.error}</ErrorText>
					) : (
						<p className="flex items-center gap-2">
							<CheckCircle2 size={16} className="text-green-600" />
							Connected to <strong>{info.project?.title}</strong> ({info.project?.projectShortCode})
							{info.project?.currentBuild && <span className="text-gray-500">· current build {info.project.currentBuild.buildNumber}</span>}
						</p>
					)}
					<p className="mt-1 text-xs text-gray-500">Links open at {info.publicUrl}</p>
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
							Connect to SparkyTC
						</Button>
					) : (
						'Not connected. An admin can connect it.'
					)}
				</div>
			)}
			{editing && (
				<form onSubmit={save} className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
					<Field
						label="SparkyTC API address"
						name="url"
						required
						defaultValue={info.url ?? 'http://backend-service:8080'}
						hint="Where co-bord's server reaches the SparkyTC backend. On the same server with Docker: http://backend-service:8080 (see the README)."
					/>
					<Field
						label="Address people open"
						name="publicUrl"
						defaultValue={info.publicUrl ?? ''}
						placeholder="http://192.168.1.20:3000"
						hint="SparkyTC's web address, for the links to test cases."
					/>
					<Field
						label="Project API token"
						name="token"
						type="password"
						autoComplete="off"
						required={!info.connected}
						placeholder={info.connected ? 'Leave empty to keep the current token' : 'stc_...'}
						hint="Created by a SparkyTC admin in the project's Settings, under API tokens. It's stored encrypted and only reads."
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

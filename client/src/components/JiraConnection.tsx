import { CheckCircle2, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ConfluenceInfo, JiraInfo } from '../board/confluence'
import { api } from '../lib/api'
import { useUser } from '../lib/auth'
import { Button, ErrorText, Field, Spinner } from './ui'

interface JiraProject {
	key: string
	name: string
	issueTypes: string[]
}

/**
 * Project settings: the Jira Cloud site, account and project where card rules (and people, from a card) create
 * issues. The Confluence account can be reused when it's the same Atlassian site.
 */
export function JiraConnection({ projectId }: { projectId: number }) {
	const user = useUser()
	const [info, setInfo] = useState<JiraInfo | null>(null)
	const [confluence, setConfluence] = useState<ConfluenceInfo | null>(null)
	const [editing, setEditing] = useState(false)
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const [url, setUrl] = useState('')
	const [email, setEmail] = useState('')
	const [token, setToken] = useState('')
	const [useConfluence, setUseConfluence] = useState(false)
	const [projects, setProjects] = useState<JiraProject[] | null>(null)
	const [projectKey, setProjectKey] = useState('')
	const [issueType, setIssueType] = useState('')

	useEffect(() => {
		api<JiraInfo>(`/api/projects/${projectId}/jira`)
			.then(setInfo)
			.catch((e) => setError(e.message))
		api<ConfluenceInfo>(`/api/projects/${projectId}/confluence`)
			.then(setConfluence)
			.catch(() => setConfluence(null))
	}, [projectId])

	function startEditing() {
		setUrl(info?.url ?? '')
		setEmail(info?.email ?? '')
		setToken('')
		setUseConfluence(false)
		setProjects(null)
		setProjectKey(info?.projectKey ?? '')
		setIssueType(info?.issueType ?? '')
		setError('')
		setEditing(true)
	}

	const credentials = () => (useConfluence ? { useConfluence: true } : { url, email, token: token || undefined })

	async function loadProjects(withConfluence = useConfluence) {
		setBusy(true)
		setError('')
		try {
			const r = await api<{ url: string; email: string; projects: JiraProject[] }>(`/api/projects/${projectId}/jira/projects`, {
				method: 'POST',
				body: withConfluence ? { useConfluence: true } : { url, email, token: token || undefined },
			})
			setUrl(r.url)
			setEmail(r.email)
			setProjects(r.projects)
			const project = r.projects.find((p) => p.key === projectKey) ?? r.projects[0]
			if (project) {
				setProjectKey(project.key)
				setIssueType(
					project.issueTypes.find((t) => t === issueType) ?? project.issueTypes.find((t) => t === 'Bug') ?? project.issueTypes[0] ?? '',
				)
			}
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setBusy(false)
		}
	}

	async function save() {
		setBusy(true)
		setError('')
		try {
			const r = await api<JiraInfo>(`/api/projects/${projectId}/jira`, {
				method: 'PUT',
				body: { ...credentials(), projectKey, issueType },
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
			await api(`/api/projects/${projectId}/jira`, { method: 'DELETE' })
			setInfo({ connected: false })
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setBusy(false)
		}
	}

	if (!info) return error ? <ErrorText>{error}</ErrorText> : <Spinner />
	const project = projects?.find((p) => p.key === projectKey)
	const select = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900'

	return (
		<section className="space-y-3">
			<div>
				<h2 className="font-medium">Jira</h2>
				<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
					Create Jira issues from cards, by hand or with board rules. Cards show the issue's status and are marked done when it's closed.
				</p>
			</div>
			{info.connected && !editing && (
				<div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
					<p className="flex items-center gap-2">
						<CheckCircle2 size={16} className="text-green-600" />
						New issues: <strong>{info.issueType}</strong> in <strong>{info.projectKey}</strong>
					</p>
					<p className="mt-1 text-xs text-gray-500">
						{info.url}
						{info.email ? ` · ${info.email}` : ''}
					</p>
					{user.isAdmin && (
						<div className="mt-3 flex gap-2">
							<Button variant="secondary" onClick={startEditing}>
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
						<Button variant="secondary" onClick={startEditing}>
							Connect to Jira
						</Button>
					) : (
						'Not connected. An admin can connect it.'
					)}
				</div>
			)}
			{editing && (
				<form
					onSubmit={(e) => {
						e.preventDefault()
						void (projects ? save() : loadProjects())
					}}
					className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
				>
					{confluence?.connected && !useConfluence && !projects && (
						<div className="rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-800/60">
							<p>Is Jira on the same Atlassian site as Confluence ({confluence.url})?</p>
							<Button
								variant="secondary"
								className="mt-2"
								disabled={busy}
								onClick={() => {
									setUseConfluence(true)
									void loadProjects(true)
								}}
							>
								Use the Confluence account
							</Button>
						</div>
					)}
					{useConfluence ? (
						<p className="text-sm">
							With the Confluence account: {email || confluence?.email || '…'} on {url || confluence?.url}.{' '}
							<button
								type="button"
								className="text-brand-600 hover:underline dark:text-brand-300"
								onClick={() => {
									setUseConfluence(false)
									setProjects(null)
									setUrl(info.url ?? '')
									setEmail(info.email ?? '')
								}}
							>
								Use another account
							</button>
						</p>
					) : (
						<>
							<Field
								label="Jira site"
								name="url"
								required
								value={url}
								onChange={(e) => {
									setUrl(e.target.value)
									setProjects(null)
								}}
								placeholder="https://your-team.atlassian.net"
							/>
							<Field
								label="Account email"
								name="email"
								type="email"
								required
								value={email}
								onChange={(e) => {
									setEmail(e.target.value)
									setProjects(null)
								}}
								hint="The Atlassian account co-bord creates issues with. It needs permission to create issues in the project."
							/>
							<Field
								label="API token"
								name="token"
								type="password"
								autoComplete="off"
								required={!info.connected}
								value={token}
								onChange={(e) => {
									setToken(e.target.value)
									setProjects(null)
								}}
								placeholder={info.connected ? 'Leave empty to keep the current token' : ''}
								hint="Created at id.atlassian.com, Security, API tokens. It's stored encrypted."
							/>
						</>
					)}
					{projects && (
						<div className="grid gap-3 sm:grid-cols-2">
							<label className="block text-sm">
								<span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">Jira project</span>
								<select
									value={projectKey}
									onChange={(e) => {
										setProjectKey(e.target.value)
										const types = projects.find((p) => p.key === e.target.value)?.issueTypes ?? []
										setIssueType(types.find((t) => t === 'Bug') ?? types[0] ?? '')
									}}
									className={select}
								>
									{projects.map((p) => (
										<option key={p.key} value={p.key}>
											{p.name} ({p.key})
										</option>
									))}
								</select>
							</label>
							<label className="block text-sm">
								<span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">Issue type</span>
								<select value={issueType} onChange={(e) => setIssueType(e.target.value)} className={select}>
									{project?.issueTypes.map((t) => (
										<option key={t} value={t}>
											{t}
										</option>
									))}
								</select>
							</label>
							{!projects.length && <p className="text-sm text-gray-500 sm:col-span-2">The account can't see any Jira project.</p>}
						</div>
					)}
					<ErrorText>{error}</ErrorText>
					<div className="flex gap-2">
						<Button type="submit" disabled={busy || (!!projects && (!projectKey || !issueType))}>
							{busy ? 'Checking…' : projects ? 'Save connection' : 'Next: choose the project'}
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

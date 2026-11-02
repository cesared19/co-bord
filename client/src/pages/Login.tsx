import { type FormEvent, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Logo } from '../components/Logo'
import { Button, ErrorText, Field } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex min-h-full items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-950">
			<div className="w-full max-w-sm space-y-6">
				<div className="flex justify-center">
					<Logo className="text-xl" />
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
					<h1 className="mb-4 text-lg font-semibold">{title}</h1>
					{children}
				</div>
			</div>
		</div>
	)
}

export function Login() {
	const { user, needsSetup, refresh } = useAuth()
	const location = useLocation()
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)
	const from = (location.state as { from?: string } | null)?.from ?? '/'

	if (needsSetup) return <Navigate to="/setup" replace />
	if (user) return <Navigate to={from} replace />

	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		setBusy(true)
		setError('')
		try {
			await api('/api/auth/login', { method: 'POST', body: { username: form.get('username'), password: form.get('password') } })
			// once signed in, the redirect above takes the user back where they were going
			await refresh()
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<AuthCard title="Sign in">
			<form onSubmit={submit} className="space-y-4">
				<Field label="Username" name="username" autoComplete="username" required autoFocus />
				<Field label="Password" name="password" type="password" autoComplete="current-password" required />
				<ErrorText>{error}</ErrorText>
				<Button type="submit" className="w-full" disabled={busy}>
					{busy ? 'Signing in…' : 'Sign in'}
				</Button>
			</form>
		</AuthCard>
	)
}

export function Setup() {
	const { user, needsSetup, refresh } = useAuth()
	const navigate = useNavigate()
	const [error, setError] = useState('')
	const [busy, setBusy] = useState(false)

	if (user || !needsSetup) return <Navigate to="/" replace />

	async function submit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		if (form.get('password') !== form.get('confirm')) return setError('The passwords do not match')
		setBusy(true)
		setError('')
		try {
			await api('/api/setup', {
				method: 'POST',
				body: { username: form.get('username'), displayName: form.get('displayName'), password: form.get('password') },
			})
			await refresh()
			navigate('/', { replace: true })
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setBusy(false)
		}
	}

	return (
		<AuthCard title="Create the admin account">
			<p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
				This is the first start. The admin creates the other accounts and the projects.
			</p>
			<form onSubmit={submit} className="space-y-4">
				<Field label="Username" name="username" autoComplete="username" required autoFocus />
				<Field label="Display name" name="displayName" autoComplete="name" required />
				<Field
					label="Password"
					name="password"
					type="password"
					autoComplete="new-password"
					minLength={8}
					required
					hint="At least 8 characters."
				/>
				<Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
				<ErrorText>{error}</ErrorText>
				<Button type="submit" className="w-full" disabled={busy}>
					Create account
				</Button>
			</form>
		</AuthCard>
	)
}

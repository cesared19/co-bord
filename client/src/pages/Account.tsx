import { type FormEvent, useEffect, useState } from 'react'
import { Avatar, Button, ErrorText, Field, PageHeader } from '../components/ui'
import { api, type User } from '../lib/api'
import { useAuth, useUser } from '../lib/auth'

export function Account() {
	const user = useUser()
	const { setUser } = useAuth()
	const [profileMsg, setProfileMsg] = useState('')
	const [profileError, setProfileError] = useState('')
	const [passwordMsg, setPasswordMsg] = useState('')
	const [passwordError, setPasswordError] = useState('')

	async function saveProfile(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		setProfileMsg('')
		setProfileError('')
		try {
			const r = await api<{ user: User }>('/api/account', {
				method: 'PUT',
				body: { displayName: new FormData(e.currentTarget).get('displayName') },
			})
			setUser(r.user)
			setProfileMsg('Saved')
		} catch (err) {
			setProfileError((err as Error).message)
		}
	}

	async function savePassword(e: FormEvent<HTMLFormElement>) {
		e.preventDefault()
		const formEl = e.currentTarget
		const form = new FormData(formEl)
		setPasswordMsg('')
		setPasswordError('')
		if (form.get('newPassword') !== form.get('confirm')) return setPasswordError('The new passwords do not match')
		try {
			await api('/api/account/password', {
				method: 'PUT',
				body: { currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') },
			})
			formEl.reset()
			setPasswordMsg('Password changed. Your other sessions were signed out.')
		} catch (err) {
			setPasswordError((err as Error).message)
		}
	}

	return (
		<div className="max-w-lg">
			<PageHeader title="Account" />
			<div className="mb-6 flex items-center gap-3">
				<Avatar name={user.displayName} color={user.color} size={44} />
				<div>
					<p className="font-medium">{user.displayName}</p>
					<p className="text-sm text-gray-500">
						{user.username}
						{user.isAdmin ? ' · Admin' : ''}
					</p>
				</div>
			</div>
			<form onSubmit={saveProfile} className="mb-10 space-y-4">
				<Field
					label="Display name"
					name="displayName"
					required
					maxLength={80}
					defaultValue={user.displayName}
					hint="Shown next to your cursor on boards."
				/>
				<ErrorText>{profileError}</ErrorText>
				<div className="flex items-center gap-3">
					<Button type="submit">Save</Button>
					{profileMsg && <span className="text-sm text-green-700 dark:text-green-400">{profileMsg}</span>}
				</div>
			</form>
			<NotificationPreferences />
			<h2 className="mb-4 text-lg font-semibold">Change password</h2>
			<form onSubmit={savePassword} className="space-y-4">
				<Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
				<Field
					label="New password"
					name="newPassword"
					type="password"
					autoComplete="new-password"
					minLength={8}
					required
					hint="At least 8 characters."
				/>
				<Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
				<ErrorText>{passwordError}</ErrorText>
				<div className="flex items-center gap-3">
					<Button type="submit">Change password</Button>
					{passwordMsg && <span className="text-sm text-green-700 dark:text-green-400">{passwordMsg}</span>}
				</div>
			</form>
		</div>
	)
}

interface Preferences {
	mentions: boolean
	follows: boolean
	rules: boolean
}

const PREFERENCES: { key: keyof Preferences; label: string; hint: string }[] = [
	{ key: 'mentions', label: 'Mentions', hint: 'Someone writes @' + 'your username on a board.' },
	{ key: 'follows', label: 'Things I follow', hint: 'Changes to boards and items you follow, grouped while unread.' },
	{ key: 'rules', label: 'Board rules', hint: 'A rule of a board notifies you.' },
]

/** Which notifications reach the bell. */
function NotificationPreferences() {
	const [prefs, setPrefs] = useState<Preferences | null>(null)
	const [error, setError] = useState('')
	useEffect(() => {
		api<Preferences>('/api/account/notifications')
			.then(setPrefs)
			.catch((e) => setError(e.message))
	}, [])

	async function toggle(key: keyof Preferences, value: boolean) {
		setError('')
		setPrefs((p) => (p ? { ...p, [key]: value } : p))
		try {
			setPrefs(await api<Preferences>('/api/account/notifications', { method: 'PUT', body: { [key]: value } }))
		} catch (e) {
			setError((e as Error).message)
		}
	}

	return (
		<section className="mb-10">
			<h2 className="mb-4 text-lg font-semibold">Notifications</h2>
			<ErrorText>{error}</ErrorText>
			{prefs && (
				<ul className="space-y-3">
					{PREFERENCES.map((p) => (
						<li key={p.key}>
							<label className="flex items-start gap-3 text-sm">
								<input
									type="checkbox"
									checked={prefs[p.key]}
									onChange={(e) => toggle(p.key, e.target.checked)}
									className="mt-0.5 accent-brand-600"
								/>
								<span>
									<span className="block font-medium">{p.label}</span>
									<span className="block text-gray-600 dark:text-gray-400">{p.hint}</span>
								</span>
							</label>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}

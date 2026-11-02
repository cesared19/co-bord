import { type FormEvent, useState } from 'react'
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

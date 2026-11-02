import { LogOut, Menu, UserRound, Users, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useAuth, useUser } from '../lib/auth'
import { Logo } from './Logo'
import { ThemeSwitch } from './ThemeMenu'
import { Avatar } from './ui'

const navClass = ({ isActive }: { isActive: boolean }) =>
	`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
		isActive
			? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
			: 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
	}`

export function Layout() {
	const user = useUser()
	const { setUser } = useAuth()
	const navigate = useNavigate()
	const [open, setOpen] = useState(false)

	async function logout() {
		await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
		setUser(null)
		navigate('/login')
	}

	const links = (
		<>
			<NavLink to="/" end className={navClass} onClick={() => setOpen(false)}>
				Projects
			</NavLink>
			{user.isAdmin && (
				<NavLink to="/users" className={navClass} onClick={() => setOpen(false)}>
					<Users size={16} /> Users
				</NavLink>
			)}
			<NavLink to="/account" className={navClass} onClick={() => setOpen(false)}>
				<UserRound size={16} /> Account
			</NavLink>
		</>
	)

	return (
		<div className="flex h-full flex-col">
			<header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
				<div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
					<Link to="/">
						<Logo />
					</Link>
					<nav className="hidden flex-1 items-center gap-1 md:flex">{links}</nav>
					<div className="ml-auto hidden items-center gap-3 md:flex">
						<ThemeSwitch />
						<Avatar name={user.displayName} color={user.color} />
						<button
							type="button"
							onClick={logout}
							title="Sign out"
							className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
						>
							<LogOut size={17} />
							<span className="sr-only">Sign out</span>
						</button>
					</div>
					<button
						type="button"
						className="ml-auto rounded p-2 md:hidden"
						onClick={() => setOpen(!open)}
						aria-expanded={open}
						aria-label="Menu"
					>
						{open ? <X size={20} /> : <Menu size={20} />}
					</button>
				</div>
				{open && (
					<div className="space-y-1 border-t border-gray-200 px-4 py-3 md:hidden dark:border-gray-800">
						{links}
						<div className="flex items-center justify-between pt-2">
							<ThemeSwitch />
							<button type="button" onClick={logout} className={navClass({ isActive: false })}>
								<LogOut size={16} /> Sign out
							</button>
						</div>
					</div>
				)}
			</header>
			<main className="relative flex-1 overflow-auto">
				<div className="mx-auto max-w-6xl px-4 py-8">
					<Outlet />
				</div>
			</main>
		</div>
	)
}

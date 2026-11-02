import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { api, ApiError, type User } from './api'

interface AuthState {
	user: User | null
	loading: boolean
	needsSetup: boolean
	refresh: () => Promise<void>
	setUser: (user: User | null) => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null)
	const [loading, setLoading] = useState(true)
	const [needsSetup, setNeedsSetup] = useState(false)

	const refresh = useCallback(async () => {
		try {
			const me = await api<{ user: User }>('/api/auth/me')
			setUser(me.user)
			setNeedsSetup(false)
		} catch (e) {
			setUser(null)
			if (e instanceof ApiError && e.status === 401) {
				const setup = await api<{ needsSetup: boolean }>('/api/setup').catch(() => ({ needsSetup: false }))
				setNeedsSetup(setup.needsSetup)
			}
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void refresh()
	}, [refresh])

	return <AuthContext.Provider value={{ user, loading, needsSetup, refresh, setUser }}>{children}</AuthContext.Provider>
}

export function useAuth() {
	const ctx = useContext(AuthContext)
	if (!ctx) throw new Error('useAuth outside AuthProvider')
	return ctx
}

/** For pages behind the login: the user is always there. */
export function useUser(): User {
	const { user } = useAuth()
	if (!user) throw new Error('Not signed in')
	return user
}

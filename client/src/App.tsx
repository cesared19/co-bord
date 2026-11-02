import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { AuthProvider, useAuth } from './lib/auth'
import { Account } from './pages/Account'
import { Login, Setup } from './pages/Login'
import { Project } from './pages/Project'
import { Projects } from './pages/Projects'
import { Users } from './pages/Users'

const BoardPage = lazy(() => import('./board/BoardPage'))

function RequireUser({ admin = false }: { admin?: boolean }) {
	const { user, loading, needsSetup } = useAuth()
	const location = useLocation()
	if (loading)
		return (
			<div className="flex h-full">
				<Spinner />
			</div>
		)
	if (needsSetup) return <Navigate to="/setup" replace />
	if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
	if (admin && !user.isAdmin) return <Navigate to="/" replace />
	return <Outlet />
}

function NotFound() {
	return <p className="text-sm text-gray-600 dark:text-gray-400">This page does not exist.</p>
}

export function App() {
	return (
		<AuthProvider>
			<BrowserRouter>
				<Routes>
					<Route path="/login" element={<Login />} />
					<Route path="/setup" element={<Setup />} />
					<Route element={<RequireUser />}>
						<Route
							path="/boards/:boardId"
							element={
								<Suspense
									fallback={
										<div className="flex h-full">
											<Spinner />
										</div>
									}
								>
									<BoardPage />
								</Suspense>
							}
						/>
						<Route element={<Layout />}>
							<Route index element={<Projects />} />
							<Route path="/projects/:projectId" element={<Project />} />
							<Route path="/account" element={<Account />} />
							<Route element={<RequireUser admin />}>
								<Route path="/users" element={<Users />} />
							</Route>
							<Route path="*" element={<NotFound />} />
						</Route>
					</Route>
				</Routes>
			</BrowserRouter>
		</AuthProvider>
	)
}

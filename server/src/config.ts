export interface Config {
	port: number
	databaseUrl: string
	cookieSecure: boolean
	sessionDays: number
	clientDir: string | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const databaseUrl = env.DATABASE_URL
	if (!databaseUrl) throw new Error('DATABASE_URL is required')
	return {
		port: Number(env.PORT ?? 8080),
		databaseUrl,
		cookieSecure: env.COOKIE_SECURE === 'true',
		sessionDays: Number(env.SESSION_DAYS ?? 7),
		clientDir: env.CLIENT_DIR ?? null,
	}
}

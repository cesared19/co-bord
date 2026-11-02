export interface Config {
	port: number
	databaseUrl: string
	cookieSecure: boolean
	sessionDays: number
	clientDir: string | null
	/** Where uploaded files are kept. */
	dataDir: string
	maxUploadBytes: number
	/** Key for the credentials of integrations; generated in DATA_DIR when missing. */
	encryptionKey?: string
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
		dataDir: env.DATA_DIR ?? './data',
		maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024,
		encryptionKey: env.ENCRYPTION_KEY || undefined,
	}
}

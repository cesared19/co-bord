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
	/** How long edits settle before notifications go out (shorter in tests). */
	notifyDelayMs?: number
	/** Optional: lets Claude write retrospective summaries. */
	anthropicApiKey?: string
	/** The address people open co-bord at, for links in Jira issues and test cases; learned from requests when empty. */
	publicUrl?: string
	/** How often rules check SparkyTC results and Jira issues (0 turns it off, as in tests). */
	rulePollMs?: number
	/** Days an uploaded file no board uses is kept before it's deleted. */
	assetRetentionDays?: number
	/** How often unused files are looked for (0 turns it off, as in tests). */
	cleanupEveryMs?: number
	/** How often an automatic version of a board being edited is saved (10 minutes; shorter in tests). */
	versionEveryMs?: number
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
		anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
		publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : undefined,
		rulePollMs: Number(env.RULE_CHECK_SECONDS ?? 120) * 1000,
		assetRetentionDays: Number(env.UNUSED_FILES_DAYS ?? 30),
		cleanupEveryMs: 24 * 60 * 60 * 1000,
	}
}

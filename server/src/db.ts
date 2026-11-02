import pg from 'pg'

export type Db = pg.Pool

export function createDb(databaseUrl: string): Db {
	return new pg.Pool({ connectionString: databaseUrl, max: 10 })
}

/**
 * Schema migrations, applied in order. Never edit a migration that was released:
 * add a new one at the end.
 */
const migrations: { version: string; sql: string }[] = [
	{
		version: '0.0.1',
		sql: `
			CREATE TABLE users (
				id SERIAL PRIMARY KEY,
				username TEXT NOT NULL,
				display_name TEXT NOT NULL,
				password_hash TEXT NOT NULL,
				is_admin BOOLEAN NOT NULL DEFAULT FALSE,
				color TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE UNIQUE INDEX users_username_key ON users (lower(username));

			CREATE TABLE sessions (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
				expires_at TIMESTAMPTZ NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX sessions_user_id_idx ON sessions (user_id);

			CREATE TABLE projects (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);

			CREATE TABLE project_members (
				project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
				user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
				role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
				PRIMARY KEY (project_id, user_id)
			);
			CREATE INDEX project_members_user_id_idx ON project_members (user_id);

			CREATE TABLE boards (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				document BYTEA,
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX boards_project_id_idx ON boards (project_id);
		`,
	},
]

export async function migrate(db: Db): Promise<void> {
	const client = await db.connect()
	try {
		await client.query('SELECT pg_advisory_lock(424242)')
		await client.query(
			'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
		)
		const applied = new Set(
			(await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
				(r) => r.version,
			),
		)
		for (const m of migrations) {
			if (applied.has(m.version)) continue
			await client.query('BEGIN')
			try {
				await client.query(m.sql)
				await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version])
				await client.query('COMMIT')
			} catch (e) {
				await client.query('ROLLBACK')
				throw e
			}
		}
	} finally {
		await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {})
		client.release()
	}
}

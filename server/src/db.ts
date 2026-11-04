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
	{
		version: '0.0.2',
		sql: `
			CREATE TABLE assets (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
				board_id UUID REFERENCES boards (id) ON DELETE SET NULL,
				name TEXT NOT NULL,
				content_type TEXT NOT NULL,
				size BIGINT NOT NULL,
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX assets_project_id_idx ON assets (project_id);
		`,
	},
	{
		version: '0.0.3',
		sql: `
			-- SparkyTC connection: API address, address people open, and the project API token (encrypted)
			ALTER TABLE projects ADD COLUMN sparkytc_url TEXT;
			ALTER TABLE projects ADD COLUMN sparkytc_public_url TEXT;
			ALTER TABLE projects ADD COLUMN sparkytc_token TEXT;
		`,
	},
	{
		version: '0.0.4',
		sql: `
			-- Confluence Cloud connection per project: site, account email, API token (encrypted), space and parent page
			ALTER TABLE projects ADD COLUMN confluence_url TEXT;
			ALTER TABLE projects ADD COLUMN confluence_email TEXT;
			ALTER TABLE projects ADD COLUMN confluence_token TEXT;
			ALTER TABLE projects ADD COLUMN confluence_space_key TEXT;
			ALTER TABLE projects ADD COLUMN confluence_space_id TEXT;
			ALTER TABLE projects ADD COLUMN confluence_parent_id TEXT;

			-- the Confluence page a board (or one of its frames) was last published to, to update it next time
			CREATE TABLE confluence_publications (
				id SERIAL PRIMARY KEY,
				board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
				frame_id TEXT NOT NULL DEFAULT '',
				page_id TEXT NOT NULL,
				page_url TEXT NOT NULL,
				title TEXT NOT NULL,
				published_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				UNIQUE (board_id, frame_id)
			);
		`,
	},
	{
		version: '0.0.5',
		sql: `
			-- in-app notifications: mentions, changes to what people follow, and (later) rules
			CREATE TABLE notifications (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
				kind TEXT NOT NULL CHECK (kind IN ('mention', 'follow', 'rule')),
				board_id UUID REFERENCES boards (id) ON DELETE CASCADE,
				element_id TEXT,
				actor_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
				text TEXT NOT NULL,
				count INTEGER NOT NULL DEFAULT 1,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				read_at TIMESTAMPTZ
			);
			CREATE INDEX notifications_user_idx ON notifications (user_id, updated_at DESC);

			-- boards ('' element) and blocks people follow
			CREATE TABLE follows (
				user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
				board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
				element_id TEXT NOT NULL DEFAULT '',
				PRIMARY KEY (user_id, board_id, element_id)
			);
			CREATE INDEX follows_board_idx ON follows (board_id);

			ALTER TABLE users ADD COLUMN notify_mentions BOOLEAN NOT NULL DEFAULT TRUE;
			ALTER TABLE users ADD COLUMN notify_follows BOOLEAN NOT NULL DEFAULT TRUE;
			ALTER TABLE users ADD COLUMN notify_rules BOOLEAN NOT NULL DEFAULT TRUE;
		`,
	},
	{
		version: '0.0.6',
		sql: `
			-- Jira Cloud for a project: site, account, API token (encrypted), and where issues go
			ALTER TABLE projects ADD COLUMN jira_url TEXT;
			ALTER TABLE projects ADD COLUMN jira_email TEXT;
			ALTER TABLE projects ADD COLUMN jira_token TEXT;
			ALTER TABLE projects ADD COLUMN jira_project_key TEXT;
			ALTER TABLE projects ADD COLUMN jira_issue_type TEXT;

			-- card rules of a board: a trigger and the actions it runs
			CREATE TABLE board_rules (
				id SERIAL PRIMARY KEY,
				board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				enabled BOOLEAN NOT NULL DEFAULT TRUE,
				trigger JSONB NOT NULL,
				actions JSONB NOT NULL,
				-- what the rule last saw, like the test results of linked elements
				state JSONB NOT NULL DEFAULT '{}',
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX board_rules_board_idx ON board_rules (board_id);

			CREATE TABLE rule_runs (
				id SERIAL PRIMARY KEY,
				rule_id INTEGER NOT NULL REFERENCES board_rules (id) ON DELETE CASCADE,
				element_id TEXT,
				element_text TEXT NOT NULL DEFAULT '',
				ok BOOLEAN NOT NULL,
				details JSONB NOT NULL DEFAULT '[]',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX rule_runs_rule_idx ON rule_runs (rule_id, created_at DESC);

			-- Jira issues created for board elements, checked now and then to mark the element done
			CREATE TABLE jira_links (
				board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
				element_id TEXT NOT NULL,
				issue_key TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT '',
				category TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				checked_at TIMESTAMPTZ,
				PRIMARY KEY (board_id, element_id)
			);
		`,
	},
	{
		version: '0.0.7',
		sql: `
			-- failed sign-ins per username and per address; 5 within 15 minutes lock that key for 15 minutes
			CREATE TABLE login_locks (
				key TEXT PRIMARY KEY,
				failures INTEGER NOT NULL DEFAULT 0,
				first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				locked_until TIMESTAMPTZ,
				-- for a username: the address of its last failure, so unlocking the user unlocks it too
				last_ip TEXT
			);

			-- since when no board uses an uploaded file; it's deleted after a while
			ALTER TABLE assets ADD COLUMN unused_since TIMESTAMPTZ;
		`,
	},
	{
		version: '0.0.8',
		sql: `
			-- comment threads: on an element (x, y from its top left corner) or at a point of the board
			CREATE TABLE comment_threads (
				id SERIAL PRIMARY KEY,
				board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
				element_id TEXT,
				x DOUBLE PRECISION NOT NULL,
				y DOUBLE PRECISION NOT NULL,
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				resolved_at TIMESTAMPTZ,
				resolved_by INTEGER REFERENCES users (id) ON DELETE SET NULL
			);
			CREATE INDEX comment_threads_board_idx ON comment_threads (board_id);

			CREATE TABLE comments (
				id SERIAL PRIMARY KEY,
				thread_id INTEGER NOT NULL REFERENCES comment_threads (id) ON DELETE CASCADE,
				user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
				text TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				edited_at TIMESTAMPTZ
			);
			CREATE INDEX comments_thread_idx ON comments (thread_id, id);

			-- saved states of a board: automatic every 10 minutes of editing, or named by someone
			CREATE TABLE board_versions (
				id SERIAL PRIMARY KEY,
				board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
				name TEXT,
				auto BOOLEAN NOT NULL,
				document BYTEA NOT NULL,
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX board_versions_board_idx ON board_versions (board_id, created_at DESC);

			ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
			ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('mention', 'follow', 'rule', 'comment'));
		`,
	},
	{
		version: '0.0.9',
		sql: `
			-- boards and frames saved as templates of a project
			CREATE TABLE project_templates (
				id SERIAL PRIMARY KEY,
				project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				elements JSONB NOT NULL,
				element_count INTEGER NOT NULL,
				thumbnail BYTEA,
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX project_templates_project_idx ON project_templates (project_id);

			-- read-only links for people without an account; the token is kept encrypted (to show it again) and hashed (to find it)
			CREATE TABLE board_share_links (
				id SERIAL PRIMARY KEY,
				board_id UUID NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
				token_hash TEXT NOT NULL UNIQUE,
				token TEXT NOT NULL,
				created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				expires_at TIMESTAMPTZ,
				revoked_at TIMESTAMPTZ
			);
			CREATE INDEX board_share_links_board_idx ON board_share_links (board_id);
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
		const applied = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version))
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

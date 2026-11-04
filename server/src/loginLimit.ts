import type { Db } from './db.js'
import { HttpError } from './errors.js'

/** Failed sign-ins allowed within the window before a lock. */
export const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000

export const userKey = (username: string) => `user:${username.toLowerCase()}`
export const ipKey = (ip: string) => `ip:${ip}`

/** Refuses a sign-in while the username or the address is locked, saying how long is left. */
export async function checkLock(db: Db, keys: string[]) {
	const { rows } = await db.query<{ until: Date }>(
		'SELECT max(locked_until) AS until FROM login_locks WHERE key = ANY($1) AND locked_until > now()',
		[keys],
	)
	const until = rows[0]?.until
	if (!until) return
	const minutes = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000))
	throw new HttpError(429, `Too many failed sign-ins. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`)
}

/** Counts a failed sign-in for each key; the fifth within 15 minutes locks the key for 15 minutes. */
export async function recordFailure(db: Db, keys: string[], ip: string) {
	for (const key of keys)
		await db.query(
			`INSERT INTO login_locks AS l (key, failures, first_at, last_ip) VALUES ($1, 1, now(), $3)
			ON CONFLICT (key) DO UPDATE SET last_ip = $3,
				failures = CASE WHEN l.first_at < now() - $2 * interval '1 millisecond' THEN 1 ELSE l.failures + 1 END,
				first_at = CASE WHEN l.first_at < now() - $2 * interval '1 millisecond' THEN now() ELSE l.first_at END`,
			[key, WINDOW_MS, ip],
		)
	await db.query(
		`UPDATE login_locks SET locked_until = now() + $2 * interval '1 millisecond', failures = 0, first_at = now()
		WHERE key = ANY($1) AND failures >= $3`,
		[keys, LOCK_MS, MAX_FAILURES],
	)
}

/** Unlocks a username, and the address its last failure came from (likely the person's own). */
export async function unlockUser(db: Db, username: string) {
	const { rows } = await db.query<{ last_ip: string | null }>('DELETE FROM login_locks WHERE key = $1 RETURNING last_ip', [
		userKey(username),
	])
	if (rows[0]?.last_ip) await db.query('DELETE FROM login_locks WHERE key = $1', [ipKey(rows[0].last_ip)])
}

/** A successful sign-in clears the counts of its username and address. */
export async function clearFailures(db: Db, keys: string[]) {
	await db.query('DELETE FROM login_locks WHERE key = ANY($1)', [keys])
}

/** Old entries, so the table doesn't grow. */
export async function pruneLocks(db: Db) {
	await db.query(
		`DELETE FROM login_locks WHERE (locked_until IS NULL OR locked_until < now()) AND first_at < now() - $1 * interval '1 millisecond'`,
		[WINDOW_MS],
	)
}

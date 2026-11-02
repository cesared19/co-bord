import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Encrypts the credentials of integrations (SparkyTC tokens, Confluence API tokens) before they go in the
 * database, with AES-256-GCM. The key comes from ENCRYPTION_KEY, or is created once in DATA_DIR/encryption.key.
 */
export class SecretBox {
	private constructor(private readonly key: Buffer) {}

	static load(dataDir: string, envKey?: string): SecretBox {
		if (envKey) return new SecretBox(createHash('sha256').update(envKey).digest())
		const dir = resolve(dataDir)
		const file = join(dir, 'encryption.key')
		if (!existsSync(file)) {
			mkdirSync(dir, { recursive: true })
			writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 })
		}
		return new SecretBox(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'))
	}

	encrypt(plain: string): string {
		const iv = randomBytes(12)
		const cipher = createCipheriv('aes-256-gcm', this.key, iv)
		const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
		return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
	}

	decrypt(sealed: string): string {
		const [version, iv, tag, data] = sealed.split(':')
		if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown secret format')
		const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'))
		decipher.setAuthTag(Buffer.from(tag, 'base64'))
		return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
	}
}

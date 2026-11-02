/** Random ids that also work without HTTPS (crypto.randomUUID needs a secure context). */
export function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12))
	return Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
		.join('')
		.slice(0, 20)
}

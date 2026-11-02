export function Logo({ className = '' }: { className?: string }) {
	return (
		<span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
			<svg viewBox="0 0 32 32" className="size-7" aria-hidden>
				<rect width="32" height="32" rx="7" fill="#C01C37" />
				<rect x="7" y="8" width="11" height="9" rx="2" fill="#fff" />
				<rect x="14" y="16" width="11" height="9" rx="2" fill="#fde68a" />
			</svg>
			co-bord
		</span>
	)
}

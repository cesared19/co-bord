import { X } from 'lucide-react'
import {
	type ButtonHTMLAttributes,
	type InputHTMLAttributes,
	type ReactNode,
	type SelectHTMLAttributes,
	useEffect,
	useId,
	useRef,
} from 'react'
import { initials } from '../lib/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
	primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
	secondary:
		'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800',
	ghost: 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
	danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
	return (
		<button
			type="button"
			{...props}
			className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
		/>
	)
}

export const inputClass =
	'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:ring-1 focus:ring-brand-600 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'

export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
	const id = useId()
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
				{label}
			</label>
			<input id={id} {...props} className={inputClass} />
			{hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
		</div>
	)
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
	return <select {...props} className={`${inputClass} w-auto pr-8 ${className}`} />
}

export function ErrorText({ children }: { children: ReactNode }) {
	if (!children) return null
	return (
		<p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
			{children}
		</p>
	)
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
	const ref = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	useEffect(() => {
		const dialog = ref.current
		dialog?.showModal()
		return () => dialog?.close()
	}, [])
	return (
		<dialog
			ref={ref}
			aria-labelledby={titleId}
			onCancel={(e) => {
				e.preventDefault()
				onClose()
			}}
			className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/40 dark:bg-gray-900 dark:text-gray-100"
		>
			<div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-800">
				<h2 id={titleId} className="text-base font-semibold">
					{title}
				</h2>
				<button
					type="button"
					onClick={onClose}
					className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
					aria-label="Close"
				>
					<X size={18} />
				</button>
			</div>
			<div className="p-5">{children}</div>
		</dialog>
	)
}

export function Avatar({ name, color, size = 28, title }: { name: string; color: string; size?: number; title?: string }) {
	return (
		<span
			title={title ?? name}
			className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-gray-900"
			style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}
		>
			{initials(name)}
		</span>
	)
}

export function RoleBadge({ role }: { role: string }) {
	const styles: Record<string, string> = {
		owner: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
		editor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
		viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
	}
	return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[role] ?? styles.viewer}`}>{role}</span>
}

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
	return (
		<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
			<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			<div className="flex flex-wrap items-center gap-2">{children}</div>
		</div>
	)
}

export function Spinner() {
	return <div className="m-auto size-6 animate-spin rounded-full border-2 border-gray-300 border-t-brand-600" aria-label="Loading" />
}

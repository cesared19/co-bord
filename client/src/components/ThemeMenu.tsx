import { Monitor, Moon, Sun } from 'lucide-react'
import { type ThemeChoice, useTheme } from '../lib/theme'

const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
	{ value: 'light', label: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', icon: Monitor },
]

export function ThemeSwitch() {
	const [choice, setChoice] = useTheme()
	return (
		<div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
			{options.map(({ value, label, icon: Icon }) => (
				<button
					key={value}
					type="button"
					role="radio"
					aria-checked={choice === value}
					title={label}
					onClick={() => setChoice(value)}
					className={`rounded p-1.5 ${choice === value ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
				>
					<Icon size={15} />
					<span className="sr-only">{label}</span>
				</button>
			))}
		</div>
	)
}

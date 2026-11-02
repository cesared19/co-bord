import { useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

function read(): ThemeChoice {
	try {
		const value = localStorage.getItem('theme')
		return value === 'light' || value === 'dark' ? value : 'system'
	} catch {
		return 'system'
	}
}

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function apply(choice: ThemeChoice) {
	const dark = choice === 'dark' || (choice === 'system' && media().matches)
	document.documentElement.classList.toggle('dark', dark)
	window.dispatchEvent(new Event('themechange'))
}

export function useTheme() {
	const [choice, setChoice] = useState<ThemeChoice>(read)
	useEffect(() => {
		apply(choice)
		try {
			if (choice === 'system') localStorage.removeItem('theme')
			else localStorage.setItem('theme', choice)
		} catch {
			/* storage unavailable */
		}
		if (choice !== 'system') return
		const m = media()
		const onChange = () => apply('system')
		m.addEventListener('change', onChange)
		return () => m.removeEventListener('change', onChange)
	}, [choice])
	return [choice, setChoice] as const
}

/** Whether the page is currently dark, updated when the theme changes. */
export function useIsDark() {
	const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
	useEffect(() => {
		const update = () => setDark(document.documentElement.classList.contains('dark'))
		window.addEventListener('themechange', update)
		return () => window.removeEventListener('themechange', update)
	}, [])
	return dark
}

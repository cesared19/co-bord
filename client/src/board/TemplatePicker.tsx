import { Modal } from '../components/ui'
import { TEMPLATES, type Template } from './templates'

export function TemplatePicker({ onPick, onClose }: { onPick: (template: Template) => void; onClose: () => void }) {
	return (
		<Modal title="Templates" onClose={onClose}>
			<p className="mb-3 text-sm text-gray-600 dark:text-gray-400">The template is added next to what is on the board.</p>
			<ul className="space-y-2">
				{TEMPLATES.map((t) => (
					<li key={t.id}>
						<button
							type="button"
							onClick={() => onPick(t)}
							className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-left hover:border-brand-500 hover:bg-brand-50 dark:border-gray-700 dark:hover:bg-brand-900/20"
						>
							<span className="block text-sm font-medium">{t.name}</span>
							<span className="block text-xs text-gray-600 dark:text-gray-400">{t.description}</span>
						</button>
					</li>
				))}
			</ul>
		</Modal>
	)
}

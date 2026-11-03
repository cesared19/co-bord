import { elementBounds, type ElementMap, toScreen } from './geometry'
import type { Camera, JiraIssue } from './types'

/** Colors of Jira's status categories: to do, in progress, done. */
export const CATEGORY_STYLE: Record<string, { color: string; label: string }> = {
	new: { color: '#6b7280', label: 'To do' },
	indeterminate: { color: '#2563eb', label: 'In progress' },
	done: { color: '#16a34a', label: 'Done' },
}

export const issueColor = (issue: JiraIssue) => (CATEGORY_STYLE[issue.category] ?? CATEGORY_STYLE.new).color

/** The Jira issue of each card, with its status, under the card (below its tests badge, if any); it opens the issue. */
export function IssueBadges({ elements, camera }: { elements: ElementMap; camera: Camera }) {
	return (
		<>
			{[...elements.values()].map((el) => {
				if (el.type === 'connector' || !el.issue?.key) return null
				const b = elementBounds(el, elements)
				const p = toScreen(camera, { x: b.x, y: b.y + b.h })
				const color = issueColor(el.issue)
				return (
					<a
						key={el.id}
						href={el.issue.url}
						target="_blank"
						rel="noopener noreferrer"
						data-ui
						title={`${el.issue.key}: ${el.issue.status || 'Jira issue'}`}
						aria-label={`Jira ${el.issue.key}${el.issue.status ? `: ${el.issue.status}` : ''}`}
						onPointerDown={(e) => e.stopPropagation()}
						className="pointer-events-auto absolute flex h-6 max-w-56 -translate-y-1/2 items-center gap-1.5 rounded-full border bg-white px-2 text-xs font-semibold whitespace-nowrap text-gray-800 shadow-sm hover:underline dark:bg-gray-900 dark:text-gray-100"
						style={{ left: p.x + 6, top: p.y + (el.links?.length ? 28 : 0), borderColor: color }}
					>
						<span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
						<span>{el.issue.key}</span>
						{el.issue.status && <span className="truncate font-normal text-gray-600 dark:text-gray-300">{el.issue.status}</span>}
					</a>
				)
			})}
		</>
	)
}

import { newId } from '../lib/id'
import type { BoardElement, ConnectorElement, FrameElement, ShapeElement, ShapeKind, StickyElement, TextElement } from './types'

export interface Template {
	id: string
	name: string
	description: string
	build: () => BoardElement[]
}

let z = 0
const base = () => ({ id: newId(), z: ++z })

function frame(x: number, y: number, w: number, h: number, title: string, fill = 'auto'): FrameElement {
	return { ...base(), type: 'frame', x, y, w, h, title, fill }
}

function text(
	x: number,
	y: number,
	w: number,
	value: string,
	opts: Partial<Pick<TextElement, 'fontSize' | 'bold' | 'textColor' | 'h'>> = {},
): TextElement {
	const fontSize = opts.fontSize ?? 18
	const lines = value.split('\n').length
	return {
		...base(),
		type: 'text',
		x,
		y,
		w,
		h: opts.h ?? Math.ceil(lines * fontSize * 1.3 + 8),
		text: value,
		fontSize,
		bold: opts.bold ?? false,
		align: 'left',
		textColor: opts.textColor ?? 'auto',
	}
}

function shape(kind: ShapeKind, x: number, y: number, w: number, h: number, value: string, fill = '#ffffff'): ShapeElement {
	return {
		...base(),
		type: 'shape',
		shape: kind,
		x,
		y,
		w,
		h,
		text: value,
		fill,
		stroke: 'auto',
		strokeWidth: 2,
		fontSize: 16,
		bold: false,
		align: 'center',
		textColor: 'auto',
	}
}

function sticky(x: number, y: number, value: string, fill: string): StickyElement {
	return {
		...base(),
		type: 'sticky',
		x,
		y,
		w: 180,
		h: 180,
		text: value,
		fill,
		fontSize: 16,
		bold: false,
		align: 'center',
		textColor: 'auto',
	}
}

function connect(from: { id: string; x: number; y: number }, to: { id: string; x: number; y: number }, label = ''): ConnectorElement {
	return {
		...base(),
		type: 'connector',
		from: { id: from.id, x: from.x, y: from.y },
		to: { id: to.id, x: to.x, y: to.y },
		route: 'elbow',
		stroke: 'auto',
		strokeWidth: 2,
		dash: false,
		startArrow: false,
		endArrow: true,
		label,
	}
}

const MUTED = '#6b7280'

interface Column {
	title: string
	prompt: string
	tint: string
	note: string
}

function retrospective(name: string, columns: Column[]): BoardElement[] {
	const colW = 440
	const colH = 640
	const gap = 40
	const pad = 48
	const width = pad * 2 + columns.length * colW + (columns.length - 1) * gap
	const top = 200
	const actionsY = top + colH + 80
	const height = actionsY + 300 + pad
	const out: BoardElement[] = [
		frame(0, 0, width, height, `Retrospective: ${name}`),
		text(pad, 36, width - pad * 2, `Retrospective: ${name}`, { fontSize: 40, bold: true }),
		text(pad, 96, width - pad * 2, 'Write one idea per sticky note in each column. Then vote, and agree on the action items below.', {
			textColor: MUTED,
		}),
	]
	columns.forEach((c, i) => {
		const x = pad + i * (colW + gap)
		// the frame's own title names the column
		out.push(frame(x, top, colW, colH, c.title, c.tint))
		out.push(text(x + 24, top + 20, colW - 48, c.prompt, { fontSize: 20, textColor: MUTED }))
		out.push(sticky(x + 24, top + 72, '', c.note))
	})
	out.push(frame(pad, actionsY, width - pad * 2, 300, 'Action items'))
	out.push(text(pad + 24, actionsY + 20, width - pad * 2 - 48, 'Who does what, and by when.', { fontSize: 20, textColor: MUTED }))
	return out
}

function workflow(): BoardElement[] {
	const f = frame(0, 0, 1520, 640, 'Workflow')
	const title = text(48, 36, 900, 'Workflow', { fontSize: 40, bold: true })
	const hint = text(48, 96, 1100, 'Rename the steps, add or remove shapes, and drag the + handles of a shape to connect it.', {
		textColor: MUTED,
	})
	const start = shape('terminator', 48, 260, 180, 70, 'Start', '#dcfce7')
	const input = shape('parallelogram', 288, 250, 200, 90, 'Request')
	const step = shape('rect', 548, 250, 200, 90, 'Review')
	const decision = shape('diamond', 808, 235, 200, 120, 'Approved?', '#fef3c7')
	const next = shape('rect', 1068, 250, 200, 90, 'Do the work')
	const end = shape('terminator', 1318, 260, 160, 70, 'End', '#fee2e2')
	const rework = shape('rect', 808, 450, 200, 90, 'Ask for changes')
	return [
		f,
		title,
		hint,
		start,
		input,
		step,
		decision,
		next,
		end,
		rework,
		connect(start, input),
		connect(input, step),
		connect(step, decision),
		connect(decision, next, 'Yes'),
		connect(next, end),
		connect(decision, rework, 'No'),
		connect(rework, step),
	]
}

function designDocument(): BoardElement[] {
	const docW = 1100
	const out: BoardElement[] = []
	const sections: [string, string][] = [
		['Context and problem', 'What is happening today, who it affects and why it matters now.'],
		['Goals', 'What this design must achieve. Measurable when possible.'],
		['Non-goals', 'What is deliberately left out.'],
		['Proposed design', 'How it works: components, data, flows. Add diagrams, screenshots, videos or PDFs below.'],
		['Alternatives considered', 'Other options and why they were not chosen.'],
		['Risks and open questions', 'What could go wrong, and what still needs an answer.'],
		['Decision log', 'Date, decision, who decided.'],
	]
	let y = 160
	const blocks: BoardElement[] = []
	for (const [heading, body] of sections) {
		blocks.push(text(56, y, docW - 112, heading, { fontSize: 28, bold: true }))
		blocks.push(text(56, y + 48, docW - 112, body, { textColor: MUTED }))
		y += 140
		if (heading === 'Proposed design') {
			blocks.push(shape('rounded', 56, y - 30, docW - 112, 320, 'Diagram area', '#f8fafc'))
			y += 330
		}
	}
	const docH = y + 40
	out.push(frame(0, 0, docW, docH, 'Design document'))
	out.push(text(56, 40, docW - 112, 'Design: Title', { fontSize: 44, bold: true }))
	out.push(text(56, 104, docW - 112, 'Author · Reviewers · Status: Draft · Date', { textColor: MUTED }))
	out.push(...blocks)
	const side = docW + 60
	out.push(frame(side, 0, 460, docH, 'Review comments', '#fefce8'))
	out.push(text(side + 32, 40, 400, 'Leave a sticky note next to what it is about.', { textColor: MUTED }))
	out.push(sticky(side + 32, 100, '', '#fef08a'))
	return out
}

export const TEMPLATES: Template[] = [
	{
		id: 'retro-ssc',
		name: 'Retrospective: Start, Stop, Continue',
		description: 'What to start doing, stop doing and keep doing, plus action items.',
		build: () =>
			retrospective('Start, Stop, Continue', [
				{ title: 'Start', prompt: 'What should we start doing?', tint: '#f0fdf4', note: '#bbf7d0' },
				{ title: 'Stop', prompt: 'What should we stop doing?', tint: '#fef2f2', note: '#fecdd3' },
				{ title: 'Continue', prompt: 'What is working and should continue?', tint: '#eff6ff', note: '#bae6fd' },
			]),
	},
	{
		id: 'retro-msg',
		name: 'Retrospective: Mad, Sad, Glad',
		description: 'How the sprint felt, to talk about what frustrated, disappointed or pleased the team.',
		build: () =>
			retrospective('Mad, Sad, Glad', [
				{ title: 'Mad', prompt: 'What frustrated you?', tint: '#fef2f2', note: '#fecdd3' },
				{ title: 'Sad', prompt: 'What disappointed you?', tint: '#eff6ff', note: '#c7d2fe' },
				{ title: 'Glad', prompt: 'What made you happy?', tint: '#f0fdf4', note: '#bbf7d0' },
			]),
	},
	{
		id: 'retro-4l',
		name: 'Retrospective: 4Ls',
		description: 'Liked, Learned, Lacked and Longed for.',
		build: () =>
			retrospective('4Ls', [
				{ title: 'Liked', prompt: 'What did you like?', tint: '#f0fdf4', note: '#bbf7d0' },
				{ title: 'Learned', prompt: 'What did you learn?', tint: '#eff6ff', note: '#bae6fd' },
				{ title: 'Lacked', prompt: 'What was missing?', tint: '#fff7ed', note: '#fed7aa' },
				{ title: 'Longed for', prompt: 'What do you wish we had?', tint: '#f5f3ff', note: '#f5d0fe' },
			]),
	},
	{
		id: 'workflow',
		name: 'Workflow',
		description: 'A flowchart with a start, steps, a decision and an end, already connected.',
		build: workflow,
	},
	{
		id: 'design-doc',
		name: 'Design document',
		description: 'Context, goals, proposal, alternatives, risks and a decision log, with room for diagrams and review comments.',
		build: designDocument,
	},
]

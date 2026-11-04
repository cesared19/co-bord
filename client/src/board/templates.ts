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

function sticky(x: number, y: number, value: string, fill: string, w = 180, h = 180): StickyElement {
	return {
		...base(),
		type: 'sticky',
		x,
		y,
		w,
		h,
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

/** A line between two free points: a lifeline or a message in a sequence diagram. */
function line(x1: number, y1: number, x2: number, y2: number, opts: Partial<ConnectorElement> = {}): ConnectorElement {
	return {
		...base(),
		type: 'connector',
		from: { x: x1, y: y1 },
		to: { x: x2, y: y2 },
		route: 'straight',
		stroke: 'auto',
		strokeWidth: 2,
		dash: false,
		startArrow: false,
		endArrow: true,
		label: '',
		...opts,
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

function storyMap(): BoardElement[] {
	const pad = 48
	const labelW = 220
	const noteW = 180
	const gap = 20
	const activities: [string, string[]][] = [
		['Find a product', ['Search', 'Browse categories']],
		['Buy it', ['Add to cart', 'Pay']],
		['Get it', ['Track the order', 'Return it']],
	]
	const colW = 2 * noteW + gap
	const width = pad * 2 + labelW + activities.length * colW + (activities.length - 1) * 40 + 40
	const releaseH = 300
	const top = 180
	const releasesY = top + 290
	const height = releasesY + 2 * (releaseH + 40) + pad
	const out: BoardElement[] = [
		frame(0, 0, width, height, 'User story map'),
		text(pad, 36, width - pad * 2, 'User story map', { fontSize: 40, bold: true }),
		text(
			pad,
			96,
			width - pad * 2,
			'Left to right, what people do (activities and their steps). Top to bottom, the stories for each step, by release.',
			{ textColor: MUTED },
		),
		text(pad, top + 40, labelW - 24, 'Activities', { fontSize: 20, bold: true }),
		text(pad, top + 170, labelW - 24, 'Steps', { fontSize: 20, bold: true }),
	]
	activities.forEach(([activity, steps], i) => {
		const x = pad + labelW + i * (colW + 40)
		out.push(sticky(x, top, activity, '#fed7aa', colW, 110))
		steps.forEach((step, j) => {
			const sx = x + j * (noteW + gap)
			out.push(sticky(sx, top + 140, step, '#bae6fd', noteW, 110))
			out.push(sticky(sx, releasesY + 60, '', '#fef08a', noteW, 110))
		})
	})
	;['Release 1 (MVP)', 'Release 2'].forEach((name, i) => {
		const y = releasesY + i * (releaseH + 40)
		out.push(frame(pad, y, width - pad * 2, releaseH, name, i ? '#f8fafc' : '#f0fdf4'))
		out.push(text(pad + 20, y + 20, labelW - 40, i ? 'Next' : 'The smallest useful version', { textColor: MUTED }))
	})
	return out
}

function priorityMatrix(): BoardElement[] {
	const pad = 48
	const axis = 80
	const cell = 520
	const gap = 16
	const left = pad + axis
	const top = 180
	const width = left + cell * 2 + gap + pad + 260
	const height = top + cell * 2 + gap + axis + pad
	const quadrants: [string, string, string, number, number][] = [
		['Quick wins', 'High impact, little effort: do these first.', '#f0fdf4', 0, 0],
		['Big bets', 'High impact, a lot of effort: plan them.', '#eff6ff', 1, 0],
		['Fill-ins', 'Little impact, little effort: when there is time.', '#fefce8', 0, 1],
		['Money pits', 'Little impact, a lot of effort: avoid them.', '#fef2f2', 1, 1],
	]
	const out: BoardElement[] = [
		frame(0, 0, width, height, 'Priority matrix'),
		text(pad, 36, width - pad * 2, 'Priority matrix: impact and effort', { fontSize: 40, bold: true }),
		text(pad, 96, width - pad * 2, 'Write the ideas on sticky notes and drag each one to where it belongs.', { textColor: MUTED }),
	]
	for (const [title, hint, tint, col, row] of quadrants) {
		const x = left + col * (cell + gap)
		const y = top + row * (cell + gap)
		out.push(frame(x, y, cell, cell, title, tint))
		out.push(text(x + 20, y + 20, cell - 40, hint, { textColor: MUTED }))
	}
	// axis labels: impact up the left side (turned), effort along the bottom
	const impact = text(left - axis / 2 - 140, top + cell + gap / 2 - 18, 280, 'Impact →', { fontSize: 22, bold: true })
	out.push({ ...impact, align: 'center', rotation: 270 })
	out.push({
		...text(left, top + cell * 2 + gap + 24, cell * 2 + gap, 'Effort →', { fontSize: 22, bold: true }),
		align: 'center',
	})
	const side = left + cell * 2 + gap + 40
	out.push(text(side, top, 220, 'Ideas to sort', { fontSize: 20, bold: true }))
	out.push(sticky(side, top + 50, '', '#fef08a'))
	out.push(sticky(side, top + 250, '', '#fef08a'))
	return out
}

function sequenceDiagram(): BoardElement[] {
	const pad = 48
	const top = 180
	const colW = 280
	const boxW = 200
	const participants: [string, 'rect' | 'cylinder'][] = [
		['User', 'rect'],
		['Web app', 'rect'],
		['API', 'rect'],
		['Database', 'cylinder'],
	]
	const messages: [number, number, string, boolean][] = [
		[0, 1, 'Sign in', false],
		[1, 2, 'POST /login', false],
		[2, 3, 'Find the user', false],
		[3, 2, 'User', true],
		[2, 1, 'Session', true],
		[1, 0, 'Home page', true],
	]
	const firstMessage = top + 150
	const step = 80
	const bottom = firstMessage + messages.length * step + 20
	const width = pad * 2 + participants.length * colW - (colW - boxW)
	const height = bottom + pad + 40
	const out: BoardElement[] = [
		frame(0, 0, width, height, 'Sequence diagram'),
		text(pad, 36, width - pad * 2, 'Sequence diagram: Sign in', { fontSize: 40, bold: true }),
		text(pad, 96, width - pad * 2, 'Rename the participants, then edit the messages: arrows are calls, dashed ones are replies.', {
			textColor: MUTED,
		}),
	]
	const lifeline = (i: number) => pad + i * colW + boxW / 2
	participants.forEach(([name, kind], i) => {
		// each participant and its lifeline move together
		const group = newId()
		const box = shape(kind, pad + i * colW, top, boxW, kind === 'cylinder' ? 100 : 70, name, kind === 'cylinder' ? '#f5f3ff' : '#eff6ff')
		const life = line(lifeline(i), top + (kind === 'cylinder' ? 100 : 70), lifeline(i), bottom, {
			dash: true,
			endArrow: false,
			stroke: '#9ca3af',
		})
		out.push({ ...box, groups: [group] }, { ...life, groups: [group] })
	})
	messages.forEach(([from, to, label, reply], i) => {
		const y = firstMessage + i * step
		out.push(line(lifeline(from), y, lifeline(to), y, { label, dash: reply }))
	})
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
	{
		id: 'story-map',
		name: 'User story map',
		description: 'Activities and their steps from left to right, and the stories for each step by release.',
		build: storyMap,
	},
	{
		id: 'priority-matrix',
		name: 'Priority matrix',
		description: 'Impact and effort in four quadrants: quick wins, big bets, fill-ins and money pits.',
		build: priorityMatrix,
	},
	{
		id: 'sequence-diagram',
		name: 'Sequence diagram',
		description: 'Participants with their lifelines, and the calls and replies between them in order.',
		build: sequenceDiagram,
	},
]

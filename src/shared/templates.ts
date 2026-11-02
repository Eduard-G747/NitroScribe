import type { Template } from './types'

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Picks the best structure for whatever was discussed',
    instructions:
      'Organize the notes into 3-6 sections with short, descriptive `###` headings that reflect the actual topics discussed, in the order they came up. ' +
      'Under each heading use concise bullets, with nested sub-bullets for supporting details (numbers, names, dates, reasons). ' +
      'Finish with a `### Next steps` section listing action items as "Owner: task (due date if mentioned)".'
  },
  {
    id: 'summary',
    name: 'Summary',
    description: 'A short recap: what happened, what was decided, what happens next',
    instructions:
      'Start with a `### Summary` section: 2-4 sentences of plain prose covering what the meeting was about, what was concluded and what is still open. ' +
      'Then `### Key points` (the most important facts, numbers and arguments as concise bullets), `### Decisions` (skip if none were made) and ' +
      '`### Next steps` listing action items as "Owner: task (due date if mentioned)".'
  },
  {
    id: 'one-on-one',
    name: '1:1',
    description: 'Manager / report or peer one-on-ones',
    instructions:
      'Use these sections (skip any that were not discussed): `### Updates`, `### Wins`, `### Challenges & blockers`, `### Feedback`, `### Career & growth`, `### Action items`. ' +
      'Action items should be "Owner: task (due date if mentioned)".'
  },
  {
    id: 'standup',
    name: 'Stand-up',
    description: 'Daily or weekly team stand-up',
    instructions:
      'Create one `### <Person name>` section per person who gave an update (use "Me" for the user if no name is known). ' +
      'Under each, use bullets prefixed with **Done:**, **Next:** and **Blockers:**. Finish with `### Blockers & follow-ups` collecting anything that needs action.'
  },
  {
    id: 'customer-call',
    name: 'Customer / sales call',
    description: 'Discovery, demo or sales conversations',
    instructions:
      'Use these sections (skip any that were not discussed): `### Company & context`, `### Pain points`, `### Current solution`, `### Requirements`, ' +
      '`### Objections & concerns`, `### Budget, timeline & decision process`, `### Next steps`. Capture concrete numbers, tools and names exactly.'
  },
  {
    id: 'user-interview',
    name: 'User interview',
    description: 'Research and customer discovery interviews',
    instructions:
      'Use these sections: `### About the participant`, `### Key insights`, `### Pain points`, `### Workflows & tools`, `### Notable quotes`, `### Opportunities`, `### Follow-ups`. ' +
      'Notable quotes must be verbatim from the transcript, in quotation marks.'
  },
  {
    id: 'hiring-interview',
    name: 'Hiring interview',
    description: 'Evaluate a candidate',
    instructions:
      'Use these sections: `### Background`, `### Strengths`, `### Concerns`, `### Notable answers`, `### Questions they asked`, `### Overall impression`. ' +
      'Stick to observations from the conversation; do not make a hire / no-hire recommendation unless the user wrote one in their notes.'
  },
  {
    id: 'team-meeting',
    name: 'Team meeting',
    description: 'Planning, syncs and recurring team meetings',
    instructions:
      'Start with `### Decisions` (what was agreed). Then `### Discussion` with a `####` sub-heading per topic. Then `### Open questions` and `### Action items` ("Owner: task (due date if mentioned)").'
  },
  {
    id: 'lecture',
    name: 'Lecture / learning',
    description: 'Classes, talks, webinars and trainings',
    instructions:
      'Use these sections: `### Key concepts`, `### Details & examples`, `### Questions & answers`, `### Takeaways`. Explain concepts clearly enough to study from later.'
  },
  {
    id: 'pitch',
    name: 'Investor / pitch',
    description: 'Fundraising and pitch meetings',
    instructions:
      'Use these sections (skip any that were not discussed): `### Company overview`, `### Traction & metrics`, `### Team`, `### Market & competition`, `### The ask / terms`, `### Questions & concerns`, `### Next steps`.'
  }
]

export function allTemplates(custom: Template[]): Template[] {
  return [...BUILT_IN_TEMPLATES.map((t) => ({ ...t, builtIn: true })), ...custom]
}

export function findTemplate(id: string | undefined, custom: Template[]): Template {
  const all = allTemplates(custom)
  return all.find((t) => t.id === id) ?? all[0]
}

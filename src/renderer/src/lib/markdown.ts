import { marked } from 'marked'
import TurndownService from 'turndown'

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Model output is untrusted: never pass raw HTML through and only allow safe link targets.
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      if (!/^(https?:|mailto:)/i.test(href)) return text
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>`
    }
  }
})

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' })
turndown.addRule('taskItem', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute('data-checked') === 'true'
    return `- [${checked ? 'x' : ' '}] ${content.trim().replace(/\n+/g, ' ')}\n`
  }
})
turndown.addRule('aiSpan', {
  filter: (node) => node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute('data-ai'),
  replacement: (content) => content
})

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return ''
  return turndown.turndown(html).trim()
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/** Text of an element excluding nested lists. */
function ownText(el: Element): string {
  let text = ''
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) text += n.textContent
    else if (n instanceof Element && !['UL', 'OL'].includes(n.tagName)) text += ownText(n)
  })
  return text
}

function wrapOwnText(el: Element, doc: Document) {
  const walk = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        const span = doc.createElement('span')
        span.setAttribute('data-ai', 'true')
        child.replaceWith(span)
        span.appendChild(child)
      } else if (child instanceof Element && !['UL', 'OL', 'P', 'LI'].includes(child.tagName)) {
        walk(child)
      }
    }
  }
  walk(el)
}

/** Converts GitHub task-list markup from marked into TipTap's task list structure. */
function convertTaskLists(doc: Document) {
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = [...ul.children].filter((c) => c.tagName === 'LI')
    const isTask = (li: Element) => !!li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]')
    if (!items.length || !items.every(isTask)) return
    ul.setAttribute('data-type', 'taskList')
    for (const li of items) {
      const box = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', box?.hasAttribute('checked') ? 'true' : 'false')
      box?.remove()
      if (!li.querySelector(':scope > p')) {
        const p = doc.createElement('p')
        while (li.firstChild && !(li.firstChild instanceof Element && ['UL', 'OL'].includes(li.firstChild.tagName))) p.appendChild(li.firstChild)
        li.prepend(p)
      }
      const p = li.querySelector(':scope > p')
      if (p?.firstChild?.nodeType === Node.TEXT_NODE) p.firstChild.textContent = p.firstChild.textContent!.replace(/^\s+/, '')
    }
  })
}

/**
 * Builds editor HTML for AI notes: text that does not come from the user's own notes is wrapped in
 * `<span data-ai>` so it renders in gray while the user's own points stay black.
 */
export function enhancedToEditorHtml(markdown: string, userNotesMarkdown: string): string {
  const doc = new DOMParser().parseFromString(`<body>${markdownToHtml(markdown)}</body>`, 'text/html')
  convertTaskLists(doc)
  const userLines = userNotesMarkdown
    .split('\n')
    .map((l) => words(l.replace(/^\s*(?:[-*+]|\d+\.|#+|- \[[ x]\])\s*/i, '')))
    .filter((w) => w.length > 0)
  const fromUser = (text: string) => {
    const block = new Set(words(text))
    if (!block.size) return false
    return userLines.some((line) => {
      const hit = line.filter((w) => block.has(w)).length
      if (line.length === 1) return hit === 1 && block.size <= 4
      return hit / line.length >= 0.7 && block.size <= Math.max(line.length * 2.5, line.length + 8)
    })
  }
  doc.body.querySelectorAll('p, li').forEach((el) => {
    if (el.tagName === 'LI' && el.querySelector(':scope > p')) return
    const text = ownText(el)
    if (text.trim() && !fromUser(text)) wrapOwnText(el, doc)
  })
  return doc.body.innerHTML
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('p, li, h1, h2, h3, h4, br').forEach((el) => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

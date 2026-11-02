import { EditorContent, Mark, mergeAttributes, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { useEffect, useRef } from 'react'

/**
 * Marks AI-written text (rendered gray). Anything the user types or pastes is stripped of the mark,
 * so their own edits show up in black.
 */
const AiText = Mark.create({
  name: 'aiText',
  inclusive: false,
  parseHTML: () => [{ tag: 'span[data-ai]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-ai': 'true', class: 'ai-text' }), 0],
  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        key: new PluginKey('aiTextUserEdits'),
        appendTransaction(transactions, _old, state) {
          const ranges: [number, number][] = []
          transactions.forEach((tr, ti) => {
            if (!tr.docChanged || tr.getMeta('aiContent')) return
            tr.steps.forEach((step, si) => {
              step.getMap().forEach((_os, _oe, ns, ne) => {
                if (ne <= ns) return
                const rest = tr.mapping.slice(si + 1)
                let from = rest.map(ns, -1)
                let to = rest.map(ne, 1)
                for (let k = ti + 1; k < transactions.length; k++) {
                  from = transactions[k].mapping.map(from, -1)
                  to = transactions[k].mapping.map(to, 1)
                }
                if (to > from) ranges.push([from, Math.min(to, state.doc.content.size)])
              })
            })
          })
          if (!ranges.length) return null
          const tr = state.tr
          for (const [from, to] of ranges) tr.removeMark(from, to, type)
          return tr.steps.length ? tr : null
        }
      })
    ]
  }
})

export function NotesEditor({
  initialHtml,
  onChange,
  placeholder,
  ai = false,
  autofocus = false
}: {
  initialHtml: string
  onChange: (html: string) => void
  placeholder: string
  ai?: boolean
  autofocus?: boolean
}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      AiText
    ],
    content: initialHtml,
    autofocus: autofocus ? 'end' : false,
    editorProps: { attributes: { class: 'notes min-h-[320px] pb-40', spellcheck: 'true' } },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getHTML())
  })

  // Ctrl+click opens links in the browser.
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      if (a && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void window.api.app.openExternal(a.href)
      }
    }
    dom.addEventListener('click', onClick)
    return () => dom.removeEventListener('click', onClick)
  }, [editor])

  return <EditorContent editor={editor} className={ai ? 'ai-notes' : undefined} />
}

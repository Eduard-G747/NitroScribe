import { Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ActionsView } from './components/ActionsView'
import { ChatPanel } from './components/ChatPanel'
import { DigestView } from './components/DigestView'
import { FollowUpDialog } from './components/FollowUpDialog'
import { PeopleView, PersonView } from './components/PeopleView'
import { HomeView } from './components/HomeView'
import { ImportDialog } from './components/ImportDialog'
import { MeetingView } from './components/MeetingView'
import { NotesView } from './components/NotesView'
import { Onboarding } from './components/Onboarding'
import { SearchPalette } from './components/SearchPalette'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { useApp } from './lib/store'

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

export function App() {
  const booted = useApp((s) => s.booted)
  const route = useApp((s) => s.route)
  const globalChatOpen = useApp((s) => s.globalChatOpen)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    void useApp.getState().boot()
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState()
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      if (mod && key === 'n') {
        e.preventDefault()
        void s.newMeeting({ record: true })
      } else if (mod && key === 'k') {
        e.preventDefault()
        s.setSearchOpen(!s.searchOpen)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        s.openSettings()
      } else if (mod && e.key === '\\') {
        e.preventDefault()
        s.toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (globalChatOpen) useApp.getState().setPanel(null)
  }, [globalChatOpen])

  if (!booted) return <div className="drag h-full" />

  return (
    <div
      className="flex h-full bg-app text-ink"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (hasFiles(e) && --dragDepth.current <= 0) setDragging(false)
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) void useApp.getState().importDroppedFile(file)
      }}
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-[60] flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-app/85 backdrop-blur-sm">
          <div className="text-center">
            <Upload className="mx-auto size-7 text-accent" />
            <div className="serif mt-3 text-[26px]">Drop to import a transcript</div>
            <div className="mt-1 text-[13px] text-muted">.vtt · .srt · .docx · .txt · .md · .json</div>
          </div>
        </div>
      )}
      <Sidebar />
      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          {route.name === 'meeting' ? (
            <MeetingView />
          ) : route.name === 'notes' ? (
            <NotesView />
          ) : route.name === 'actions' ? (
            <ActionsView />
          ) : route.name === 'people' ? (
            <PeopleView />
          ) : route.name === 'person' ? (
            <PersonView key={route.key} personKey={route.key} />
          ) : route.name === 'digest' ? (
            <DigestView key={route.week} week={route.week} />
          ) : (
            <HomeView />
          )}
        </div>
        {globalChatOpen && (
          <aside className="flex w-[420px] flex-none flex-col border-l border-edge bg-app">
            <div className="drag h-11 flex-none" />
            <div className="min-h-0 flex-1">
              <ChatPanel scope="global" onClose={() => useApp.getState().setGlobalChat(false)} />
            </div>
          </aside>
        )}
      </div>
      <SearchPalette />
      <FollowUpDialog />
      <ImportDialog />
      <SettingsModal />
      <Onboarding />
      <Toasts />
    </div>
  )
}

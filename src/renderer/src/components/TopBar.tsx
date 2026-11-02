import { PanelLeft, Plus, Search, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../lib/store'
import { Button, IconButton } from './ui'

/** The draggable title bar of the main area; leaves room for the Windows caption buttons. */
export function TopBar({ left, children }: { left?: ReactNode; children?: ReactNode }) {
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const { toggleSidebar, setSearchOpen, newMeeting, openImport } = useApp.getState()
  return (
    <div className="drag flex h-11 flex-none items-center gap-1.5 pl-3 pr-[150px]">
      {collapsed && (
        <>
          <IconButton label="Show sidebar" onClick={toggleSidebar}>
            <PanelLeft className="size-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Search (Ctrl+K)" onClick={() => setSearchOpen(true)}>
            <Search className="size-4" strokeWidth={1.75} />
          </IconButton>
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{left}</div>
      {children}
      <Button variant="ghost" size="sm" onClick={() => openImport()} title="Import a transcript from another app or date (or drop a file anywhere)">
        <Upload className="size-3.5" /> Import
      </Button>
      <Button variant="pill" size="sm" onClick={() => void newMeeting({ record: true })} title="New note and start transcribing (Ctrl+N)">
        <Plus className="size-3.5" /> New note
      </Button>
    </div>
  )
}

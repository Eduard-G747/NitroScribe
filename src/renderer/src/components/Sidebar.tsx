import clsx from 'clsx'
import { CalendarDays, ChevronsUpDown, Home, Lock, MessageCircle, Moon, PanelLeft, Search, Settings2, Sun, type LucideIcon } from 'lucide-react'
import logo from '../assets/logo.png'
import { useApp } from '../lib/store'
import { Bars, IconButton } from './ui'

function NavItem({ icon: Icon, label, active, onClick, trailing }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx('no-drag flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors', active ? 'bg-active text-ink' : 'text-muted hover:bg-hover hover:text-ink')}
    >
      <Icon className="size-4 flex-none" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  )
}

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function EngineCard() {
  const whisper = useApp((s) => s.whisper)
  const model = useApp((s) => s.view?.settings.transcription.model)
  const openSettings = useApp((s) => s.openSettings)
  const ready = !!whisper?.binary && !!model && whisper.installedModels.includes(model)
  const label = whisper?.installing ? 'Downloading…' : ready ? (whisper?.gpu ? 'GPU ready' : 'CPU ready') : 'Set up'
  return (
    <div className="mx-2.5 mb-2 flex items-center justify-between rounded-xl border border-edge px-3 py-2">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium">Local Whisper</div>
        <div className="truncate text-[11px] text-faint">Private, on this PC</div>
      </div>
      <button
        onClick={() => openSettings('transcription')}
        className={clsx('no-drag rounded-full px-2.5 py-1 text-[11.5px] font-medium', ready ? 'bg-hover text-muted hover:text-ink' : 'bg-ink text-app')}
      >
        {label}
      </button>
    </div>
  )
}

export function Sidebar() {
  const route = useApp((s) => s.route)
  const recording = useApp((s) => s.recording)
  const meetings = useApp((s) => s.meetings)
  const globalChatOpen = useApp((s) => s.globalChatOpen)
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const userName = useApp((s) => s.view?.settings.userName ?? '')
  const theme = useApp((s) => s.view?.settings.general.theme ?? 'system')
  const { goHome, goNotes, openMeeting, openSettings, setGlobalChat, setSearchOpen, toggleSidebar, setTheme } = useApp.getState()
  if (collapsed) return null
  const recordingMeeting = recording.status !== 'idle' ? meetings.find((m) => m.id === recording.meetingId) : undefined
  const dark = theme === 'dark' || (theme === 'system' && isDark())

  return (
    <aside className="flex w-[232px] flex-none flex-col bg-side">
      <div className="drag traffic-gap flex h-11 flex-none items-center gap-0.5 px-2.5">
        <IconButton label="Hide sidebar" onClick={toggleSidebar}>
          <PanelLeft className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Search (Ctrl+K)" onClick={() => setSearchOpen(true)}>
          <Search className="size-4" strokeWidth={1.75} />
        </IconButton>
      </div>

      <nav className="space-y-px px-2 pt-1">
        <NavItem icon={Home} label="Home" active={route.name === 'home' && !globalChatOpen} onClick={() => void goHome()} />
        <NavItem icon={MessageCircle} label="Chat" active={globalChatOpen} onClick={() => setGlobalChat(!globalChatOpen)} />
      </nav>

      {recordingMeeting && (
        <button
          onClick={() => void openMeeting(recordingMeeting.id)}
          className="no-drag mx-2 mt-3 flex items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-2 text-left text-[12.5px] text-accent"
        >
          <Bars level={0.05} active={recording.status === 'recording'} />
          <span className="min-w-0 flex-1 truncate font-medium">{recordingMeeting.title || 'Untitled meeting'}</span>
        </button>
      )}

      <div className="px-4 pb-1 pt-5 text-[11.5px] font-medium text-faint">Spaces</div>
      <nav className="px-2">
        <NavItem
          icon={Lock}
          label="My notes"
          active={route.name === 'notes'}
          onClick={() => void goNotes()}
          trailing={meetings.length > 0 && <span className="text-[11px] text-faint">{meetings.length}</span>}
        />
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5 px-2.5 pb-2">
        <IconButton label="Settings (Ctrl+,)" onClick={() => openSettings()}>
          <Settings2 className="size-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton label={dark ? 'Light mode' : 'Dark mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
          {dark ? <Sun className="size-4" strokeWidth={1.75} /> : <Moon className="size-4" strokeWidth={1.75} />}
        </IconButton>
        <IconButton label="Calendars" onClick={() => openSettings('calendar')}>
          <CalendarDays className="size-4" strokeWidth={1.75} />
        </IconButton>
      </div>
      <EngineCard />
      <button onClick={() => openSettings('general')} className="no-drag flex items-center gap-2.5 border-t border-edge/60 px-3.5 py-3 text-left hover:bg-hover">
        <img src={logo} alt="" className="size-6" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{userName ? `${userName.split(/\s+/)[0]}'s NitroScribe` : 'NitroScribe'}</span>
        <ChevronsUpDown className="size-3.5 text-faint" />
      </button>
    </aside>
  )
}

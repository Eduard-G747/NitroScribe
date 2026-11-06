import { Copy, Mail, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { splitEmail } from '@shared/insights'
import { useApp } from '../lib/store'
import { useAiStream } from '../lib/useAiStream'
import { Button, CloseButton, Modal, Spinner } from './ui'

/** One click after a call: a recap email with decisions and who owes what, ready to paste. */
export function FollowUpDialog() {
  const meetingId = useApp((s) => s.followUpFor)
  const { setFollowUp, toast } = useApp.getState()
  const { text, setText, status, error, start, cancel } = useAiStream()
  const { subject, body } = splitEmail(text)

  useEffect(() => {
    if (meetingId) void start(() => window.api.ai.followUp(meetingId))
    else cancel()
  }, [meetingId, start, cancel])

  const copy = async (what: string, label: string) => {
    await window.api.files.copy(what)
    toast('success', `${label} copied`)
  }
  // Mail apps cap mailto: links at around 2,000 characters.
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <Modal open={!!meetingId} onClose={() => setFollowUp(null)} className="flex max-h-[86vh] w-[min(640px,94vw)] flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-5 py-3.5">
        <Mail className="size-4 text-accent" />
        <div className="flex-1 text-[14px] font-semibold">Follow-up email</div>
        {status === 'writing' && <Spinner className="size-3.5 text-muted" />}
        <CloseButton onClick={() => setFollowUp(null)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {status === 'error' ? (
          <div className="text-[13px] text-danger">{error}</div>
        ) : (
          <>
            {subject && (
              <div className="mb-3 flex items-baseline gap-2 border-b border-edge pb-3 text-[13.5px]">
                <span className="text-faint">Subject</span>
                <span className="font-medium">{subject}</span>
              </div>
            )}
            <textarea
              value={status === 'done' ? body : body || 'Writing…'}
              readOnly={status !== 'done'}
              onChange={(e) => setText(subject ? `Subject: ${subject}\n\n${e.target.value}` : e.target.value)}
              className="min-h-[300px] w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none"
              style={{ height: `${Math.max(300, body.split('\n').length * 22 + 20)}px` }}
              spellCheck
            />
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-5 py-3">
        <Button size="sm" variant="ghost" disabled={status === 'writing' || !meetingId} onClick={() => meetingId && void start(() => window.api.ai.followUp(meetingId))}>
          <RefreshCw className="size-3.5" /> Rewrite
        </Button>
        <div className="flex-1" />
        {subject && (
          <Button size="sm" disabled={status !== 'done'} onClick={() => void copy(subject, 'Subject')}>
            Copy subject
          </Button>
        )}
        <Button size="sm" disabled={status !== 'done'} onClick={() => void window.api.app.openExternal(mailto)} title={mailto.length > 2000 ? 'Long emails may get cut off; copying is safer' : 'Opens your email app with this draft'}>
          <Mail className="size-3.5" /> Open in email app
        </Button>
        <Button size="sm" variant="solid" disabled={status !== 'done'} onClick={() => void copy(body, 'Email')}>
          <Copy className="size-3.5" /> Copy email
        </Button>
      </div>
    </Modal>
  )
}

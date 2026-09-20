import { useEffect, useRef, useState } from 'react'
import { getInboxAttachment, getInboxEmail, getInboxEmails, type EmailRecord } from '../lib/api'

type Attachment = { path: string; url: string; size: number; text?: string }

export function InboxSource({ debug, disabled, onLoad, onBusy }: { debug: boolean; disabled: boolean; onLoad: (email: EmailRecord) => void; onBusy: (busy: boolean) => void }) {
  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [selected, setSelected] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Request the Docker inbox to choose an email.')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const urls = useRef<string[]>([])
  useEffect(() => () => { controller.current?.abort(); urls.current.forEach(URL.revokeObjectURL) }, [])

  async function request(load: boolean) {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true); onBusy(true); setError('')
    const timeout = window.setTimeout(() => abort.abort(), 120000)
    const pending: Attachment[] = []
    try {
      if (!load) {
        const records = await getInboxEmails(abort.signal)
        if (abort.signal.aborted) return
        setEmails(records); setSelected(records[0]?.email_id ?? '')
        setStatus(records.length ? `${records.length} emails available. Choose one to request its contents.` : 'Docker inbox is empty. Check the Docker data mount.')
      } else {
        const email = await getInboxEmail(selected, abort.signal)
        if (!debug || includeAttachments) {
          let total = 0
          for (const path of email.attachments ?? []) {
            const blob = await getInboxAttachment(email.email_id, path, abort.signal)
            total += blob.size
            if (total > 20_000_000) throw new Error('Attachments for this email exceed the 20 MB session limit.')
            const text = blob.type.startsWith('text/plain') ? (await blob.text()).slice(0, 100000) : undefined
            pending.push({ path, url: URL.createObjectURL(blob), size: blob.size, text })
          }
        }
        if (abort.signal.aborted) return
        urls.current.forEach(URL.revokeObjectURL)
        urls.current = pending.map(item => item.url)
        setAttachments(pending)
        onLoad(email)
        setStatus(`${email.email_id} loaded. ${pending.length} attachments retrieved${debug && !includeAttachments ? ' (filenames only requested)' : ''}. Ready to classify.`)
      }
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not request Docker inbox.')
      else setError('Inbox request stopped or timed out. Retry the request.')
    } finally {
      pending.filter(item => !urls.current.includes(item.url)).forEach(item => URL.revokeObjectURL(item.url))
      window.clearTimeout(timeout)
      if (controller.current === abort) { controller.current = null; setBusy(false); onBusy(false) }
    }
  }

  return <div className="inbox-source">
    <div className="run-toolbar"><button className="secondary" disabled={disabled || busy} onClick={() => void request(false)}>Request emails from Docker</button></div>
    <label>Email<select value={selected} disabled={disabled || busy || !emails.length} onChange={event => setSelected(event.target.value)}><option value="" disabled>Select an email</option>{emails.map(email => <option key={email.email_id} value={email.email_id}>{email.email_id} — {email.subject || '(No subject)'}</option>)}</select></label>
    {debug && <label className="filter"><input type="checkbox" checked={includeAttachments} disabled={disabled || busy} onChange={event => setIncludeAttachments(event.target.checked)}/> Also request this email’s attachments</label>}
    <div className="run-toolbar"><button className="secondary" disabled={disabled || busy || !selected} onClick={() => void request(true)}>{busy ? 'Requesting…' : !debug || includeAttachments ? 'Load email and attachments' : 'Load email'}</button></div>
    <p role="status">{status}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {attachments.length > 0 && <details><summary>Retrieved attachments ({attachments.length})</summary>{attachments.map(item => <div key={item.path}><a href={item.url} download={item.path.split('/').pop()}>{item.path}</a> <span>({item.size.toLocaleString()} bytes)</span>{item.text !== undefined && <pre>{item.text}</pre>}</div>)}</details>}
  </div>
}

import { useEffect, useState } from 'react'
import { Bell, Check, Circle } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type NoticeRow = { id: string; kind: string; message: string; read_at: string | null; created_at: string; match_id: string | null }
export function NotificationsPanel({ session, onOpenMatch }: { session: Session | null; onOpenMatch: (id: string) => void }) {
  const [rows, setRows] = useState<NoticeRow[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supabase || !session) { setRows([]); return }
    const load = async () => { const { data } = await supabase!.from('notifications').select('id,kind,message,read_at,created_at,match_id').order('created_at', { ascending: false }).limit(20); setRows((data ?? []) as NoticeRow[]) }
    void load()
    const channel = supabase.channel(`notifications-${session.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, () => void load()).subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [session])
  const markRead = async () => {
    if (!supabase || !session) return
    setBusy(true)
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', session.user.id).is('read_at', null)
    if (!error) setRows(current => current.map(row => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })))
    setBusy(false)
  }
  const unread = rows.filter(row => !row.read_at).length
  return <section className="notification-popover" aria-label="Notifications"><div className="notification-popover-head"><div><b>Notifications</b><span>{unread ? `${unread} new` : 'You are all caught up'}</span></div>{unread > 0 && <button onClick={() => void markRead()} disabled={busy}>Mark all read</button>}</div>{!session ? <div className="notification-empty"><Bell size={18}/><span>Sign in to see match notifications.</span></div> : rows.length ? <div className="notification-items">{rows.map(row => {
    const content = <><span className="notification-bullet">{row.read_at ? <Check size={12}/> : <Circle size={8} fill="currentColor"/>}</span><span><b>{row.message}</b><small>{new Date(row.created_at).toLocaleString()}</small></span></>
    return row.match_id
      ? <button className={`notification-item ${row.read_at ? '' : 'notification-unread'}`} key={row.id} onClick={() => onOpenMatch(row.match_id!)}>{content}</button>
      : <div className={`notification-item notification-static ${row.read_at ? '' : 'notification-unread'}`} key={row.id}>{content}</div>
  })}</div> : <div className="notification-empty"><Bell size={18}/><span>No match updates yet.</span></div>}</section>
}

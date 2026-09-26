import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, LockKeyhole, MessageCircle, Send, ShieldCheck, Swords } from 'lucide-react'
import { getMatch, getMessages, getProfile, sendMessage, shareRoomCode, submitResult } from '../lib/matches'
import { supabase } from '../lib/supabase'
import type { ChatMessage, Match } from '../lib/types'
import { Avatar, PlayerLink } from './PlayerBits'

type Notice = { kind: 'success' | 'error' | 'info'; text: string }
export function MatchRoom({ matchId, userId, notify, onBack, onOpenProfile }: { matchId: string; userId: string; notify: (notice: Notice) => void; onBack: () => void; onOpenProfile: (id: string) => void }) {
  const [match, setMatch] = useState<Match | null>(null)
  const [playerProfiles, setPlayerProfiles] = useState<Record<string, Awaited<ReturnType<typeof getProfile>>>>({})
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [scores, setScores] = useState({ own: '', opponent: '' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const canShare = Boolean(match && match.requester_id === userId && !match.room_code)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try { const [m, chat] = await Promise.all([getMatch(matchId), getMessages(matchId)]); if (alive) { setMatch(m); setMessages(chat); const [one, two] = await Promise.all([getProfile(m.player_one_id), getProfile(m.player_two_id)]); if (alive) setPlayerProfiles({ [m.player_one_id]: one, [m.player_two_id]: two }) } }
      catch { if (alive) notify({ kind: 'error', text: 'This private room is unavailable or you do not have access.' }) }
      finally { if (alive) setLoading(false) }
    }
    void load()
    if (!supabase) return () => { alive = false }
    const channel = supabase.channel(`match-room-${matchId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, payload => setMatch(payload.new as Match)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_messages', filter: `match_id=eq.${matchId}` }, payload => setMessages(current => current.some(m => m.id === (payload.new as ChatMessage).id) ? current : [...current, payload.new as ChatMessage])).subscribe()
    return () => { alive = false; void supabase?.removeChannel(channel) }
  }, [matchId, userId, notify])

  const share = async () => {
    if (!/^[A-Za-z0-9-]{4,24}$/.test(code)) return notify({ kind: 'error', text: 'Enter a valid room code between 4 and 24 characters.' })
    setBusy(true)
    try { await shareRoomCode(matchId, code); setCode(''); notify({ kind: 'success', text: 'Room code shared with your opponent.' }) }
    catch { notify({ kind: 'error', text: 'We could not share that room code. Please try again.' }) }
    finally { setBusy(false) }
  }
  const copy = async () => { if (!match?.room_code) return; try { await navigator.clipboard.writeText(match.room_code); notify({ kind: 'success', text: 'Room code copied.' }) } catch { notify({ kind: 'error', text: 'Clipboard access is unavailable. Copy the code manually.' }) } }
  const chat = async (event: FormEvent) => {
    event.preventDefault(); const body = message.trim(); if (!body || body.length > 1000) return
    setBusy(true); try { await sendMessage(matchId, body); setMessage('') } catch { notify({ kind: 'error', text: 'Your message could not be sent. Please try again.' }) } finally { setBusy(false) }
  }
  const result = async (event: FormEvent) => {
    event.preventDefault(); const own = Number(scores.own), opponent = Number(scores.opponent)
    if (!Number.isInteger(own) || !Number.isInteger(opponent) || own < 0 || opponent < 0 || own > 99 || opponent > 99) return notify({ kind: 'error', text: 'Enter whole number scores from 0 to 99.' })
    setBusy(true); try { const status = await submitResult(matchId, own, opponent); notify({ kind: status === 'completed' ? 'success' : status === 'disputed' ? 'error' : 'info', text: status === 'completed' ? 'Both results agree. Match completed.' : status === 'disputed' ? 'The submitted results differ. This match needs review.' : 'Result submitted. Waiting for your opponent.' }); setScores({ own: '', opponent: '' }) } catch { notify({ kind: 'error', text: 'Your result could not be submitted. Please try again.' }) } finally { setBusy(false) }
  }
  if (loading) return <div className="room-loading"><span className="spinner"/> Opening your private room…</div>
  if (!match) return <div className="room-loading"><LockKeyhole size={24}/><b>Private room unavailable</b><button className="button button-outline" onClick={onBack}>Return to the field</button></div>
  const statusLabel = match.status.replaceAll('_', ' ')
  const statusText = match.status === 'completed' ? 'MATCH COMPLETE' : match.status === 'disputed' ? 'RESULT DISPUTED' : match.status === 'awaiting_results' ? 'AWAITING RESULTS' : match.room_code ? 'ROOM READY' : 'LOBBY OPEN'
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to 1v1 Anyone</button>
    <div className="room-title"><div><div className="eyebrow"><LockKeyhole size={12}/> PRIVATE MATCH ROOM</div><h1>Match lobby<span className="lime-dot">.</span></h1><p>Coordinate your match and submit your scores here.</p></div><span className={`room-status status-${match.status}`}><i/>{statusText}</span></div>
    <section className="room-scoreboard"><div className="room-contender"><PlayerLink id={match.player_one_id} onOpen={onOpenProfile}><Avatar name={playerProfiles[match.player_one_id]?.display_name || playerProfiles[match.player_one_id]?.username || 'Player one'} image={playerProfiles[match.player_one_id]?.avatar_url} size="room"/></PlayerLink><PlayerLink id={match.player_one_id} onOpen={onOpenProfile} className="room-player-name">{playerProfiles[match.player_one_id]?.display_name || playerProfiles[match.player_one_id]?.username || (match.player_one_id === userId ? 'You' : 'Player one')}</PlayerLink><small>REQUESTER</small></div><div className="versus"> <span>VS</span><b>{match.player_one_score ?? '—'} <i>:</i> {match.player_two_score ?? '—'}</b><small>{statusLabel}</small></div><div className="room-contender"><PlayerLink id={match.player_two_id} onOpen={onOpenProfile}><Avatar name={playerProfiles[match.player_two_id]?.display_name || playerProfiles[match.player_two_id]?.username || 'Opponent'} image={playerProfiles[match.player_two_id]?.avatar_url} size="room" tone="blue"/></PlayerLink><PlayerLink id={match.player_two_id} onOpen={onOpenProfile} className="room-player-name">{playerProfiles[match.player_two_id]?.display_name || playerProfiles[match.player_two_id]?.username || (match.player_two_id === userId ? 'You' : 'Opponent')}</PlayerLink><small>{match.player_two_id === userId ? 'CHALLENGER' : 'OPPONENT'}</small></div></section>
    <div className="room-grid"><div className="room-main"><section className="panel code-panel"><div className="panel-head"><div><div className="room-section-icon"><Swords size={16}/></div><h3>eFootball room code</h3><p>Shared only with players in this private match.</p></div><span className="secure-label"><LockKeyhole size={13}/> PRIVATE</span></div>{match.room_code ? <div className="shared-code"><div><small>YOUR OPPONENT SHARED A CODE</small><b>{match.room_code}</b></div><button className="button button-lime" onClick={() => void copy()}><Copy size={14}/> Copy code</button></div> : canShare ? <form className="share-code-form" onSubmit={e => { e.preventDefault(); void share() }}><label htmlFor="room-code">Enter the room code you created</label><div><input id="room-code" autoComplete="off" maxLength={24} value={code} onChange={e => setCode(e.target.value)} placeholder="For example, 123456789"/><button className="button button-lime" disabled={busy || !code.trim()}>Share code <ArrowRight size={14}/></button></div><small>Your opponent receives this as soon as you share it.</small></form> : <div className="waiting-code"><span className="spinner"/><div><b>Waiting for the room code</b><small>The requester will share the eFootball room code here.</small></div></div>}</section>
      <section className="panel result-panel"><div className="panel-head"><div><div className="room-section-icon"><Check size={16}/></div><h3>Submit match result</h3><p>Report the score you saw in the match.</p></div><ShieldCheck size={17} className="quiet-icon"/></div>{match.status === 'completed' ? <div className="result-confirmed"><span><Check size={17}/></span><div><b>Result confirmed</b><small>Both players agreed. Player records have been updated.</small></div></div> : match.status === 'disputed' ? <div className="disputed-message"><b>These results do not match.</b><span>This match is flagged for review. Competitive statistics have not been updated.</span></div> : <form className="result-form" onSubmit={e => void result(e)}><label>Your score<input inputMode="numeric" type="number" min="0" max="99" required value={scores.own} onChange={e => setScores({...scores, own: e.target.value})} placeholder="0"/></label><span className="score-separator">—</span><label>Opponent score<input inputMode="numeric" type="number" min="0" max="99" required value={scores.opponent} onChange={e => setScores({...scores, opponent: e.target.value})} placeholder="0"/></label><button type="submit" className="button button-lime" disabled={busy || !match.room_code}>Submit result <ArrowRight size={14}/></button><small>Results are compared only after both players submit.</small></form>}</section></div>
      <section className="panel chat-panel"><div className="panel-head"><div><div className="room-section-icon"><MessageCircle size={16}/></div><h3>Private chat</h3><p>Only players in this room can read or send messages.</p></div><span className="chat-live"><i/> LIVE</span></div><div className="chat-messages" aria-live="polite">{messages.length ? messages.map(m => <div className={`chat-message ${m.sender_id === userId ? 'chat-mine' : ''}`} key={m.id}><small>{m.sender_id === userId ? 'YOU' : 'OPPONENT'} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><p>{m.body}</p></div>) : <div className="chat-empty"><MessageCircle size={18}/><span>Say hello to your opponent.</span></div>}</div><form className="chat-form" onSubmit={e => void chat(e)}><input aria-label="Message" maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a message…"/><button aria-label="Send message" type="submit" disabled={busy || !message.trim()}><Send size={16}/></button></form><div className="chat-private"><LockKeyhole size={12}/> End to end private to your match room</div></section></div>
    <section className="room-notice"><ShieldCheck size={16}/><span><b>Results you can trust.</b> Both players submit independently. If reports differ, the match is flagged and ratings stay unchanged.</span></section>
  </>
}

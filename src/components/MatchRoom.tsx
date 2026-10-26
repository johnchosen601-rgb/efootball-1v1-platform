import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, Copy, ExternalLink, LockKeyhole, MessageCircle, Send, ShieldCheck, Swords } from 'lucide-react'
import { getMatch, getMessages, getProfile, sendMessage, shareRoomCode, submitResult } from '../lib/matches'
import { supabase } from '../lib/supabase'
import type { ChatMessage, Match } from '../lib/types'
import { Avatar, PlayerLink } from './PlayerBits'

type Notice = { kind: 'success' | 'error' | 'info'; text: string }
export function MatchRoom({ matchId, userId, notify, onBack, onOpenProfile }: { matchId: string; userId: string; notify: (notice: Notice) => void; onBack: () => void; onOpenProfile: (id: string) => void }) {
  const [match, setMatch] = useState<Match | null>(null)
  const [playerProfiles, setPlayerProfiles] = useState<Record<string, Awaited<ReturnType<typeof getProfile>>>>({})
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatError, setChatError] = useState('')
  const [chatLoading, setChatLoading] = useState(true)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [scores, setScores] = useState({ own: '', opponent: '' })
  const [evidence, setEvidence] = useState<File | null>(null)
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const canShare = Boolean(match && match.requester_id === userId && !match.room_code)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const m = await getMatch(matchId)
        if (!alive) return
        setMatch(m)
        const [one, two] = await Promise.all([getProfile(m.player_one_id), getProfile(m.player_two_id)])
        if (alive) setPlayerProfiles({ [m.player_one_id]: one, [m.player_two_id]: two })
        try { const chat = await getMessages(matchId); if (alive) { setMessages(chat); setChatError('') } }
        catch { if (alive) setChatError('Chat could not load. Your private match room is still available; try refreshing the messages.') }
      }
      catch { if (alive) notify({ kind: 'error', text: 'This private room is unavailable or you do not have access.' }) }
      finally { if (alive) { setLoading(false); setChatLoading(false) } }
    }
    void load()
    if (!supabase) return () => { alive = false }
    const channel = supabase.channel(`match-room-${matchId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, payload => setMatch(payload.new as Match)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `match_id=eq.${matchId}` }, payload => setMessages(current => current.some(m => m.id === (payload.new as ChatMessage).id) ? current : [...current, payload.new as ChatMessage])).subscribe()
    return () => { alive = false; void supabase?.removeChannel(channel) }
  }, [matchId, userId, notify])

  useEffect(() => {
    if (!match || !supabase) return
    let active = true
    const paths = [match.player_one_evidence_path, match.player_two_evidence_path].filter((path): path is string => Boolean(path))
    void Promise.all(paths.map(async path => {
      const { data, error } = await supabase!.storage.from('match-evidence').createSignedUrl(path, 1800)
      if (error) throw error
      return [path, data.signedUrl] as const
    })).then(entries => { if (active) setEvidenceUrls(Object.fromEntries(entries)) }).catch(() => { if (active) notify({ kind: 'error', text: 'Match evidence is not available right now.' }) })
    return () => { active = false }
  }, [match?.player_one_evidence_path, match?.player_two_evidence_path])

  const share = async () => {
    if (!/^[A-Za-z0-9-]{4,24}$/.test(code)) return notify({ kind: 'error', text: 'Enter a valid room code between 4 and 24 characters.' })
    setBusy(true)
    try { await shareRoomCode(matchId, code); setCode(''); notify({ kind: 'success', text: 'Room code shared with your opponent.' }) }
    catch { notify({ kind: 'error', text: 'We could not share that room code. Please try again.' }) }
    finally { setBusy(false) }
  }
  const retryChat = async () => {
    setChatLoading(true); setChatError('')
    try { setMessages(await getMessages(matchId)) }
    catch { setChatError('Chat could not load. Your private match room is still available; try refreshing the messages.') }
    finally { setChatLoading(false) }
  }
  const copy = async () => { if (!match?.room_code) return; try { await navigator.clipboard.writeText(match.room_code); notify({ kind: 'success', text: 'Room code copied.' }) } catch { notify({ kind: 'error', text: 'Clipboard access is unavailable. Copy the code manually.' }) } }
  const chat = async (event: FormEvent) => {
    event.preventDefault(); const body = message.trim(); if (!body || body.length > 1000) return
    setBusy(true); try { await sendMessage(matchId, body); setMessage('') } catch { notify({ kind: 'error', text: 'Your message could not be sent. Please try again.' }) } finally { setBusy(false) }
  }
  const result = async (event: FormEvent) => {
    event.preventDefault(); const own = Number(scores.own), opponent = Number(scores.opponent)
    if (!Number.isInteger(own) || !Number.isInteger(opponent) || own < 0 || opponent < 0 || own > 99 || opponent > 99) return notify({ kind: 'error', text: 'Enter whole number scores from 0 to 99.' })
    setBusy(true)
    try {
      let evidencePath: string | null = null
      if (evidence) {
        const allowed = ['image/jpeg', 'image/png', 'image/webp']
        if (!allowed.includes(evidence.type)) throw new Error('Choose a JPEG, PNG or WebP screenshot.')
        if (evidence.size > 8 * 1024 * 1024) throw new Error('Screenshots must be 8 MB or smaller.')
        const extension = evidence.type === 'image/jpeg' ? 'jpg' : evidence.type.split('/')[1]
        evidencePath = `${matchId}/${userId}/${crypto.randomUUID()}.${extension}`
        const { error } = await supabase!.storage.from('match-evidence').upload(evidencePath, evidence, { contentType: evidence.type, cacheControl: '3600', upsert: false })
        if (error) throw error
      }
      const status = await submitResult(matchId, own, opponent, evidencePath)
      notify({ kind: status === 'completed' ? 'success' : status === 'disputed' ? 'error' : 'info', text: status === 'completed' ? 'Both results agree. Match completed and ratings updated.' : status === 'disputed' ? 'The submitted results differ. Review and resubmit the correct score.' : 'Result submitted. Waiting for your opponent.' })
      setScores({ own: '', opponent: '' }); setEvidence(null)
    } catch (error) { notify({ kind: 'error', text: error instanceof Error ? error.message : 'Your result could not be submitted. Please try again.' }) }
    finally { setBusy(false) }
  }
  if (loading) return <div className="room-loading"><span className="spinner"/> Opening your private room…</div>
  if (!match) return <div className="room-loading"><LockKeyhole size={24}/><b>Private room unavailable</b><button className="button button-outline" onClick={onBack}>Return to the field</button></div>
  const statusLabel = match.status.replaceAll('_', ' ')
  const statusText = match.status === 'completed' ? 'MATCH COMPLETE' : match.status === 'voided' ? 'MATCH VOIDED' : match.status === 'disputed' ? 'RESULT DISPUTED' : match.status === 'awaiting_results' ? 'AWAITING RESULTS' : match.room_code ? 'ROOM READY' : 'LOBBY OPEN'
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to 1v1 Anyone</button>
    <div className="room-title"><div><div className="eyebrow"><LockKeyhole size={12}/> PRIVATE MATCH ROOM</div><h1>Match lobby<span className="lime-dot">.</span></h1><p>Coordinate your match and submit your scores here.</p>{match.status === 'active' && match.result_deadline_at && <small className="result-deadline-note">Submit your result by {new Date(match.result_deadline_at).toLocaleString()}.</small>}{match.status === 'awaiting_results' && match.opponent_deadline_at && <small className="result-deadline-note">Opponent response deadline: {new Date(match.opponent_deadline_at).toLocaleString()}.</small>}</div><span className={`room-status status-${match.status}`}><i/>{statusText}</span></div>
    <section className="room-scoreboard"><div className="room-contender"><PlayerLink id={match.player_one_id} onOpen={onOpenProfile}><Avatar name={playerProfiles[match.player_one_id]?.display_name || playerProfiles[match.player_one_id]?.username || 'Player one'} image={playerProfiles[match.player_one_id]?.avatar_url} size="room"/></PlayerLink><PlayerLink id={match.player_one_id} onOpen={onOpenProfile} className="room-player-name">{playerProfiles[match.player_one_id]?.display_name || playerProfiles[match.player_one_id]?.username || (match.player_one_id === userId ? 'You' : 'Player one')}</PlayerLink><small>REQUESTER</small></div><div className="versus"> <span>VS</span><b>{match.player_one_score ?? '—'} <i>:</i> {match.player_two_score ?? '—'}</b><small>{statusLabel}</small></div><div className="room-contender"><PlayerLink id={match.player_two_id} onOpen={onOpenProfile}><Avatar name={playerProfiles[match.player_two_id]?.display_name || playerProfiles[match.player_two_id]?.username || 'Opponent'} image={playerProfiles[match.player_two_id]?.avatar_url} size="room" tone="blue"/></PlayerLink><PlayerLink id={match.player_two_id} onOpen={onOpenProfile} className="room-player-name">{playerProfiles[match.player_two_id]?.display_name || playerProfiles[match.player_two_id]?.username || (match.player_two_id === userId ? 'You' : 'Opponent')}</PlayerLink><small>{match.player_two_id === userId ? 'CHALLENGER' : 'OPPONENT'}</small></div></section>
    <div className="room-grid"><div className="room-main"><section className="panel code-panel"><div className="panel-head"><div><div className="room-section-icon"><Swords size={16}/></div><h3>eFootball room code</h3><p>Shared only with players in this private match.</p></div><span className="secure-label"><LockKeyhole size={13}/> PRIVATE</span></div>{match.room_code ? <div className="shared-code"><div><small>YOUR OPPONENT SHARED A CODE</small><b>{match.room_code}</b></div><button className="button button-lime" onClick={() => void copy()}><Copy size={14}/> Copy code</button></div> : canShare ? <form className="share-code-form" onSubmit={e => { e.preventDefault(); void share() }}><label htmlFor="room-code">Enter the room code you created</label><div><input id="room-code" autoComplete="off" maxLength={24} value={code} onChange={e => setCode(e.target.value)} placeholder="For example, 123456789"/><button className="button button-lime" disabled={busy || !code.trim()}>Share code <ArrowRight size={14}/></button></div><small>Your opponent receives this as soon as you share it.</small></form> : <div className="waiting-code"><span className="spinner"/><div><b>Waiting for the room code</b><small>The requester will share the eFootball room code here.</small></div></div>}</section>
      <section className="panel result-panel"><div className="panel-head"><div><div className="room-section-icon"><Check size={16}/></div><h3>Submit match result</h3><p>Report the score you saw in the match.</p></div><ShieldCheck size={17} className="quiet-icon"/></div>{match.status === 'completed' ? <div className="result-confirmed"><span><Check size={17}/></span><div><b>Result confirmed</b><small>Player records and ratings have been updated once.</small></div></div> : match.status === 'voided' ? <div className="result-voided" role="status"><AlertTriangle size={18}/><div><b>Match voided</b><small>{match.void_reason || 'The result window expired. Ratings and player records were not changed.'}</small></div></div> : <>{match.status === 'disputed' && <div className="disputed-message"><b>These results do not match.</b><span>Submit the agreed score to resolve the dispute. Ratings update only after both reports match.</span></div>}<form className="result-form" onSubmit={e => void result(e)}><label>Your score<input inputMode="numeric" type="number" min="0" max="99" required value={scores.own} onChange={e => setScores({...scores, own: e.target.value})} placeholder="0"/></label><span className="score-separator">—</span><label>Opponent score<input inputMode="numeric" type="number" min="0" max="99" required value={scores.opponent} onChange={e => setScores({...scores, opponent: e.target.value})} placeholder="0"/></label><label className="match-evidence-upload"><Camera size={14}/> Add screenshot (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setEvidence(event.target.files?.[0] ?? null)}/><small>{evidence?.name || "JPEG, PNG or WebP · up to 8 MB"}</small></label><button type="submit" className="button button-lime" disabled={busy || !match.room_code}>Submit result <ArrowRight size={14}/></button><small>A one-sided result needs screenshot evidence to finalize automatically after the opponent’s five-minute response window.</small></form>{(match.player_one_evidence_path || match.player_two_evidence_path) && <div className="match-evidence-links">{match.player_one_evidence_path && evidenceUrls[match.player_one_evidence_path] && <a href={evidenceUrls[match.player_one_evidence_path]} target="_blank" rel="noreferrer">Player one screenshot <ExternalLink size={12}/></a>}{match.player_two_evidence_path && evidenceUrls[match.player_two_evidence_path] && <a href={evidenceUrls[match.player_two_evidence_path]} target="_blank" rel="noreferrer">Player two screenshot <ExternalLink size={12}/></a>}</div>}</>}</section></div>
      <section className="panel chat-panel"><div className="panel-head"><div><div className="room-section-icon"><MessageCircle size={16}/></div><h3>Private chat</h3><p>Only players in this room can read or send messages.</p></div><span className="chat-live"><i/> LIVE</span></div><div className="chat-messages" aria-live="polite">{chatLoading ? <div className="chat-empty"><span className="spinner"/> Loading messages…</div> : chatError ? <div className="chat-empty" role="alert">{chatError} <button type="button" className="chat-retry" onClick={() => void retryChat()}>Try again</button></div> : messages.length ? messages.map(m => <div className={`chat-message ${m.sender_id === userId ? 'chat-mine' : ''}`} key={m.id}><small>{m.sender_id === userId ? 'YOU' : 'OPPONENT'} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><p>{m.message}</p></div>) : <div className="chat-empty"><MessageCircle size={18}/><span>Say hello to your opponent.</span></div>}</div><form className="chat-form" onSubmit={e => void chat(e)}><input aria-label="Message" maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a message…"/><button aria-label="Send message" type="submit" disabled={busy || !message.trim() || Boolean(chatError)}><Send size={16}/></button></form><div className="chat-private"><LockKeyhole size={12}/> Chat access is limited to the two match participants.</div></section></div>
    <section className="room-notice"><ShieldCheck size={16}/><span><b>Results you can trust.</b> Both players submit independently. If reports differ, the match is flagged and ratings stay unchanged.</span></section>
  </>
}

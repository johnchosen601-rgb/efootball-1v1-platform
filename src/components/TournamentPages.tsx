import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, CircleHelp, Crown, Plus, Search, Settings2, ShieldCheck, Swords, Trophy, UserPlus, UserRoundMinus, Users, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { Avatar, PlayerLink } from './PlayerBits'
import { addTournamentPlayer, createTournament, getTournamentDetails, getTournaments, joinTournament, removeTournamentPlayer, resolveTournamentResult, searchTournamentPlayers, startTournament, submitTournamentResult, updateTournamentSettings, type TournamentInput, type TournamentSettings } from '../lib/tournaments'
import type { Profile, Tournament, TournamentDetails, TournamentMatch } from '../lib/types'
import { supabase } from '../lib/supabase'
import { TOURNAMENT_MATCH_RULES, TOURNAMENT_RESULT_POLICY } from '../lib/tournamentRules'
import '../tournament.css'

type Notice = { kind: 'success' | 'error' | 'info'; text: string }
type TournamentSummary = Awaited<ReturnType<typeof getTournaments>>[number]
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Please try again.'
const prettyDate = (date: string | null) => date ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date to be announced'
function roundLabel(capacity: number, round: number) {
  const players = capacity / (2 ** (round - 1))
  if (players === 2) return 'Final'
  if (players === 4) return 'Semi-final'
  if (players === 8) return 'Quarter-final'
  return `Round of ${players}`
}

export function TournamentPage({ session, tournamentId, onOpenTournament, onOpenProfile, notify, onAuth }: {
  session: Session | null; tournamentId: string | null; onOpenTournament: (id: string) => void; onOpenProfile: (id: string) => void;
  notify: (notice: Notice) => void; onAuth: () => void
}) {
  const [items, setItems] = useState<TournamentSummary[]>([])
  const [details, setDetails] = useState<TournamentDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pendingJoinId, setPendingJoinId] = useState<string | null>(null)
  const refresh = async () => {
    if (!session) { setItems([]); setDetails(null); setLoading(false); return }
    setError('')
    try {
      if (tournamentId) {
        const value = await getTournamentDetails(tournamentId)
        setDetails(value)
        if (!value) setError('Tournament not found or not available to this account.')
      } else {
        setDetails(null)
        setItems(await getTournaments())
      }
    } catch (e) { setError(errorText(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { setLoading(true); void refresh() }, [session?.user.id, tournamentId])
  useEffect(() => {
    if (!supabase || !session || !tournamentId) return
    const channel = supabase.channel(`tournament-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants', filter: `tournament_id=eq.${tournamentId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, () => void refresh())
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [session?.user.id, tournamentId])
  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try { await fn(); notify({ kind: 'success', text: success }); await refresh() }
    catch (e) { notify({ kind: 'error', text: errorText(e) }) }
    finally { setBusy(false) }
  }
  const confirmJoin = () => {
    if (!pendingJoinId) return
    const id = pendingJoinId
    setPendingJoinId(null)
    void act(() => joinTournament(id), 'You joined the tournament.')
  }
  const pendingJoinTitle = details?.tournament.id === pendingJoinId
    ? details.tournament.title
    : items.find(item => item.tournament.id === pendingJoinId)?.tournament.title ?? 'this tournament'
  if (!session) return <><div className="page-intro"><div className="eyebrow"><span className="eyebrow-dot"/> COMPETE TOGETHER</div><h1>Tournaments.</h1><p>Enter a free knockout competition and play your way to the final.</p></div><section className="panel tournament-auth-card"><Trophy size={25}/><h2>Sign in to find a tournament.</h2><p>Browse brackets, register for events and track tournament titles on your player profile.</p><button className="button button-lime" onClick={onAuth}>Sign in to compete <ArrowRight size={15}/></button></section></>
  if (tournamentId) return <><TournamentDetailsView details={details} loading={loading} error={error} userId={session.user.id} busy={busy} onBack={() => onOpenTournament('')} onJoin={() => setPendingJoinId(tournamentId)} onStart={() => void act(() => startTournament(tournamentId), 'Bracket generated. The tournament has started.')} onOpenProfile={onOpenProfile} onSettings={settings => void act(() => updateTournamentSettings(tournamentId, settings), 'Tournament settings saved.')} onAddPlayer={playerId => void act(() => addTournamentPlayer(tournamentId, playerId), 'Player added to the tournament.')} onRemovePlayer={playerId => void act(() => removeTournamentPlayer(tournamentId, playerId), 'Player removed from the tournament.')} onSubmit={(matchId, own, opponent) => void act(() => submitTournamentResult(matchId, own, opponent), 'Result submitted. Waiting for your opponent to confirm.')} onResolve={(matchId, one, two) => void act(() => resolveTournamentResult(matchId, one, two), 'Organizer decision saved and bracket advanced.')}/>{pendingJoinId === tournamentId && <TournamentRulesAcknowledgement title={pendingJoinTitle} busy={busy} onCancel={() => setPendingJoinId(null)} onConfirm={confirmJoin}/>}</>
  return <>
    <div className="page-intro tournament-list-intro"><div><div className="eyebrow"><span className="eyebrow-dot"/> COMPETE TOGETHER</div><h1>Tournaments.</h1><p>Join a free knockout competition and build your record on the pitch.</p></div><button className="button button-lime" onClick={() => setCreateOpen(true)}><Plus size={15}/> Create tournament</button></div>
    <div className="tournament-information"><span><ShieldCheck size={15}/> Free community competitions</span><span><CircleHelp size={15}/> No entry fees or wagering</span></div>
    {error && <div className="tournament-error">{error}</div>}
    {loading ? <div className="room-loading"><span className="spinner"/> Loading tournaments…</div> : items.length ? <section className="tournament-list-grid">{items.map(item => <TournamentCard key={item.tournament.id} item={item} currentUserId={session.user.id} busy={busy} onOpen={() => onOpenTournament(item.tournament.id)} onJoin={() => setPendingJoinId(item.tournament.id)} onOpenProfile={onOpenProfile}/>)}</section> : <section className="panel tournament-empty"><span className="tournament-emblem"><Trophy size={24}/></span><div className="eyebrow"><span className="eyebrow-dot"/> OPEN THE COMPETITION</div><h2>No tournaments yet.</h2><p>Create the first free eFootball knockout event for the community.</p><button className="button button-lime" onClick={() => setCreateOpen(true)}><Plus size={15}/> Create tournament</button></section>}
    {pendingJoinId && <TournamentRulesAcknowledgement title={pendingJoinTitle} busy={busy} onCancel={() => setPendingJoinId(null)} onConfirm={confirmJoin}/>}
    {createOpen && <CreateTournamentForm busy={busy} onClose={() => setCreateOpen(false)} onCreate={async input => {
      setBusy(true)
      try { const id = await createTournament(input); setCreateOpen(false); notify({ kind: 'success', text: 'Tournament created. You are registered as organizer and player.' }); onOpenTournament(id) }
      catch (e) { notify({ kind: 'error', text: errorText(e) }) }
      finally { setBusy(false) }
    }}/ >}
  </>
}

function TournamentCard({ item, currentUserId, busy, onOpen, onJoin, onOpenProfile }: { item: TournamentSummary; currentUserId: string; busy: boolean; onOpen: () => void; onJoin: () => void; onOpenProfile: (id: string) => void }) {
  const { tournament: t, participant_count: count } = item
  const isJoined = item.player_ids.includes(currentUserId)
  const full = count >= t.max_players
  const label = t.status === 'registration' ? !t.registration_open ? 'REGISTRATION PAUSED' : full ? 'FIELD FULL' : 'REGISTRATION OPEN' : t.status.replace('_', ' ').toUpperCase()
  return <article className="panel tournament-card">
    <div className="tournament-card-top"><span className={`tournament-status tournament-${t.status}`}>{label}</span><span className="tournament-capacity"><Users size={13}/>{count}/{t.max_players}</span></div>
    <button className="tournament-card-title" onClick={onOpen}><h2>{t.title}</h2><ChevronRight size={17}/></button>
    <p>{t.description || 'A community knockout competition. Register and play through the bracket to become champion.'}</p>
    <div className="tournament-card-meta"><span><CalendarDays size={14}/>{prettyDate(t.starts_at)}</span><span><Swords size={14}/>{Math.log2(t.max_players)} rounds</span></div>
    <div className="tournament-organizer"><span>ORGANIZED BY</span>{item.organizer && <PlayerLink id={item.organizer.id} onOpen={onOpenProfile}><b>{item.organizer.display_name || item.organizer.username}</b></PlayerLink>}</div>
    <div className="tournament-card-actions"><button className="button button-outline" onClick={onOpen}>Tournament details <ArrowRight size={14}/></button>{t.status === 'registration' && t.registration_open && !full && !isJoined && t.organizer_id !== currentUserId && <button className="button button-lime" disabled={busy} onClick={onJoin}>Join <ArrowRight size={14}/></button>}</div>
    {t.status === 'completed' && item.winner && <div className="tournament-winner-strip"><Crown size={15}/><span>Winner</span><b>{item.winner.display_name || item.winner.username}</b></div>}
  </article>
}

function CreateTournamentForm({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (input: TournamentInput) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [capacity, setCapacity] = useState(8)
  const [startsAt, setStartsAt] = useState('')
  return <div className="tournament-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}><form className="panel tournament-form-modal" onSubmit={event => { event.preventDefault(); void onCreate({ title: title.trim(), description: description.trim(), max_players: capacity, starts_at: startsAt ? new Date(startsAt).toISOString() : null }) }}>
    <div className="tournament-modal-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> NEW COMPETITION</div><h2>Create tournament.</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
    <label>Tournament name<input required minLength={3} maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Weekend Champions Cup"/></label>
    <label>Details<textarea maxLength={500} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Share the event details and match expectations."/></label>
    <div className="tournament-form-split"><label>Player capacity<select value={capacity} onChange={e => setCapacity(Number(e.target.value))}><option value={4}>4 players · 2 rounds</option><option value={8}>8 players · 3 rounds</option><option value={16}>16 players · 4 rounds</option><option value={32}>32 players · 5 rounds</option></select></label><label>Start time<input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)}/></label></div>
    <TournamentRulesCard compact/>
    <p className="tournament-form-note"><ShieldCheck size={14}/> Creating the tournament also registers you as the organizer and first player. No payment or wagering features are enabled.</p>
    <div className="tournament-form-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button type="submit" className="button button-lime" disabled={busy}>{busy ? 'Creating…' : 'Create tournament'} <ArrowRight size={14}/></button></div>
  </form></div>
}

function TournamentDetailsView({ details, loading, error, userId, busy, onBack, onJoin, onStart, onOpenProfile, onSettings, onAddPlayer, onRemovePlayer, onSubmit, onResolve }: {
  details: TournamentDetails | null; loading: boolean; error: string; userId: string; busy: boolean; onBack: () => void;
  onJoin: () => void; onStart: () => void; onOpenProfile: (id: string) => void;
  onSettings: (settings: TournamentSettings) => void; onAddPlayer: (playerId: string) => void; onRemovePlayer: (playerId: string) => void;
  onSubmit: (matchId: string, own: number, opponent: number) => void; onResolve: (matchId: string, one: number, two: number) => void;
}) {
  if (loading) return <div className="room-loading"><span className="spinner"/> Loading tournament…</div>
  if (!details) return <div className="tournament-empty"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Tournaments</button><p>{error || 'Tournament unavailable.'}</p></div>
  const { tournament: t, participants, matches } = details
  const isOrganizer = t.organizer_id === userId
  const isJoined = participants.some(player => player.player_id === userId)
  const joinedCount = participants.length
  const rounds = matches.length ? Array.from({ length: Math.log2(t.max_players) }, (_, index) => index + 1) : []
  const winner = participants.find(player => player.player_id === t.winner_id)?.profile
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> All tournaments</button>
    {error && <div className="tournament-error">{error}</div>}
    <section className="panel tournament-detail-hero"><div className="tournament-detail-emblem"><Trophy size={25}/></div><div className="tournament-detail-copy"><span className={`tournament-status tournament-${t.status}`}>{t.status === 'registration' ? t.registration_open ? 'REGISTRATION OPEN' : 'REGISTRATION PAUSED' : t.status.replace('_', ' ').toUpperCase()}</span><h1>{t.title}</h1><p>{t.description || 'Community knockout competition.'}</p><div className="tournament-card-meta"><span><CalendarDays size={14}/>{prettyDate(t.starts_at)}</span><span><Users size={14}/>{joinedCount} / {t.max_players} players</span><span><Swords size={14}/>{Math.log2(t.max_players)} rounds</span></div></div>
      <div className="tournament-detail-actions">{t.status === 'registration' && t.registration_open && !isJoined && joinedCount < t.max_players && <button className="button button-lime" disabled={busy} onClick={onJoin}>Join tournament <ArrowRight size={15}/></button>}{t.status === 'registration' && isOrganizer && <button className="button button-outline" disabled={busy || joinedCount !== t.max_players} onClick={onStart}>{busy ? 'Starting…' : 'Start tournament'} <Swords size={14}/></button>}</div>
    </section>
    <TournamentRulesCard/>
    {t.status === 'completed' && winner && <div className="tournament-champion"><span><Crown size={21}/></span><div><small>TOURNAMENT CHAMPION</small><PlayerLink id={winner.id} onOpen={onOpenProfile}><b>{winner.display_name || winner.username}</b></PlayerLink></div></div>}
    <div className="tournament-detail-grid"><section className="panel tournament-roster"><div className="panel-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> REGISTERED PLAYERS</div><h3>Competitors</h3></div><span className="muted-caption">{joinedCount} / {t.max_players} players</span></div>{participants.length ? <div className="tournament-roster-list">{participants.map(player => <div className="tournament-roster-row" key={player.player_id}><span className="tournament-seed">{player.seed.toString().padStart(2, '0')}</span><PlayerLink id={player.player_id} onOpen={onOpenProfile} className="tournament-roster-player"><Avatar name={player.profile?.display_name || player.profile?.username || 'Player'} image={player.profile?.avatar_url} size="sm"/><span><b>{player.profile?.display_name || player.profile?.username || 'Player'}</b><small>@{player.profile?.username || 'player'}</small></span></PlayerLink>{player.player_id === t.organizer_id && <span className="tournament-organizer-tag">ORGANIZER</span>}{isOrganizer && t.status === 'registration' && player.player_id !== t.organizer_id && <button className="tournament-player-remove" type="button" disabled={busy} onClick={() => onRemovePlayer(player.player_id)}><UserRoundMinus size={14}/> Remove</button>}</div>)}</div> : <div className="profile-empty-note"><Users size={17}/> No players have registered.</div>}
    {isOrganizer && t.status === 'registration' && <><div className="tournament-divider"/><TournamentPlayerManager tournament={t} participants={participants} busy={busy} onAdd={onAddPlayer} onRemove={onRemovePlayer} onOpenProfile={onOpenProfile}/><div className="tournament-divider"/><TournamentSettingsForm tournament={t} busy={busy} onSave={onSettings}/><button className="button button-outline tournament-start-full" disabled={busy || joinedCount !== t.max_players} onClick={onStart}>{busy ? 'Starting…' : joinedCount !== t.max_players ? `Start when full · ${joinedCount}/${t.max_players}` : 'Generate bracket & start'} <ArrowRight size={14}/></button></>}
    </section><section className="panel tournament-bracket-panel"><div className="panel-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> KNOCKOUT BRACKET</div><h3>{t.status === 'registration' ? 'Bracket preview' : t.status === 'completed' ? 'Completed bracket' : 'Tournament bracket'}</h3></div><span className="muted-caption">{matches.length ? `${matches.filter(match => match.status === 'completed').length}/${matches.length} results` : 'Generated when the organizer starts'}</span></div>
      {matches.length ? <div className="tournament-bracket-scroll"><div className="tournament-bracket">{rounds.map(round => <div className="tournament-round" key={round}><h4>{roundLabel(t.max_players, round)}</h4><div className={`tournament-round-matches tournament-round-${round}`}>{matches.filter(match => match.round_number === round).map(match => <TournamentMatchCard key={match.id} match={match} currentUserId={userId} isOrganizer={isOrganizer} busy={busy} onOpenProfile={onOpenProfile} onSubmit={onSubmit} onResolve={onResolve}/>)}</div></div>)}</div></div> : <div className="tournament-bracket-empty"><Trophy size={25}/><b>The bracket is waiting for a full field.</b><span>Once all {t.max_players} player slots are filled, the organizer can generate every round.</span><div className="tournament-capacity-track"><i style={{ width: `${Math.min(100, joinedCount / t.max_players * 100)}%` }}/></div></div>}
    </section></div>
    <p className="tournament-fair-play"><ShieldCheck size={14}/> Knockout scores require both players to agree. Organizers can resolve disputed results. A draw must be settled with extra time or penalties.</p>
  </>
}

function TournamentRulesCard({ compact = false }: { compact?: boolean }) {
  return <section className={`panel tournament-rules-card ${compact ? 'tournament-rules-compact' : ''}`} aria-labelledby={compact ? 'create-tournament-rules' : 'tournament-rules-title'}>
    <div className="tournament-rules-heading"><span><ShieldCheck size={16}/></span><div><h3 id={compact ? 'create-tournament-rules' : 'tournament-rules-title'}>Tournament Rules</h3><p>Apply the same match conditions for both players.</p></div></div>
    <ul className="tournament-rules-list">{TOURNAMENT_MATCH_RULES.map(rule => <li key={rule.label}><span>{rule.label}</span><b>{rule.value}</b></li>)}</ul>
    <div className="tournament-winner-policy"><Check size={14}/><span><b>Decisive winner required.</b> {TOURNAMENT_RESULT_POLICY.submissionGuidance}</span></div>
  </section>
}

function TournamentRulesAcknowledgement({ title, busy, onCancel, onConfirm }: { title: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="tournament-modal-backdrop rules-ack-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section className="panel tournament-form-modal tournament-rules-ack" role="dialog" aria-modal="true" aria-labelledby="tournament-rules-ack-title">
      <div className="tournament-modal-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> BEFORE YOU JOIN</div><h2 id="tournament-rules-ack-title">Review the match rules.</h2></div><button className="icon-button" type="button" aria-label="Close rules confirmation" onClick={onCancel} disabled={busy}><X size={18}/></button></div>
      <p className="tournament-rules-ack-copy">You’re joining <b>{title}</b>. Please confirm you understand the required match conditions.</p>
      <TournamentRulesCard compact/>
      <div className="tournament-form-actions"><button type="button" className="button button-outline" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="button button-lime" onClick={onConfirm} disabled={busy}>{busy ? 'Joining…' : 'I understand the tournament rules'} <ArrowRight size={14}/></button></div>
    </section>
  </div>
}

function TournamentPlayerManager({ tournament, participants, busy, onAdd, onRemove, onOpenProfile }: {
  tournament: Tournament; participants: TournamentDetails['participants']; busy: boolean;
  onAdd: (id: string) => void; onRemove: (id: string) => void; onOpenProfile: (id: string) => void;
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  useEffect(() => {
    const term = query.trim()
    setSearchError('')
    if (term.length < 2) { setResults([]); setSearching(false); return }
    let active = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      void searchTournamentPlayers(term).then(rows => { if (active) setResults(rows) })
        .catch(error => { if (active) setSearchError(errorText(error)) })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])
  const registered = new Set(participants.map(player => player.player_id))
  const full = participants.length >= tournament.max_players
  return <section className="tournament-player-manager" aria-label="Add players to tournament">
    <div className="tournament-player-manager-head"><div><div className="tournament-settings-heading"><UserPlus size={15}/><b>Add players</b></div><p>Search registered players and manage this tournament’s roster.</p></div><strong>{participants.length} / {tournament.max_players} players</strong></div>
    <label className="tournament-player-search"><Search size={16}/><input aria-label="Search registered players" placeholder="Search username or display name…" value={query} onChange={event => setQuery(event.target.value)}/></label>
    {searchError && <p className="tournament-search-error" role="alert">Could not search players: {searchError}</p>}
    {searching && <p className="tournament-search-hint">Searching players…</p>}
    {!searching && query.trim().length >= 2 && !searchError && results.length === 0 && <p className="tournament-search-hint">No matching players found.</p>}
    {full && <p className="tournament-search-hint">Tournament capacity is full. Remove a player before adding another.</p>}
    {results.length > 0 && <div className="tournament-player-results">{results.map(player => {
      const added = registered.has(player.id)
      return <div className="tournament-player-result" key={player.id}>
        <PlayerLink id={player.id} onOpen={onOpenProfile} className="tournament-roster-player"><Avatar name={player.display_name || player.username} image={player.avatar_url} size="sm"/><span><b>{player.display_name || player.username}</b><small>@{player.username}{player.country ? ` · ${player.country}` : ''}</small></span></PlayerLink>
        <span className="tournament-player-rating">{player.rating} <small>RATING</small></span>
        {added ? player.id === tournament.organizer_id ? <span className="tournament-organizer-tag">ORGANIZER</span> : <button className="tournament-player-remove" type="button" disabled={busy} onClick={() => onRemove(player.id)}><UserRoundMinus size={14}/> Remove</button> : <button className="button button-outline tournament-player-add" type="button" disabled={busy || full} onClick={() => onAdd(player.id)}>{busy ? 'Adding…' : <><UserPlus size={14}/> Add</>}</button>}
      </div>
    })}</div>}
  </section>
}

function TournamentSettingsForm({ tournament, busy, onSave }: { tournament: Tournament; busy: boolean; onSave: (settings: TournamentSettings) => void }) {
  const [title, setTitle] = useState(tournament.title)
  const [description, setDescription] = useState(tournament.description)
  const [capacity, setCapacity] = useState(tournament.max_players)
  const [startsAt, setStartsAt] = useState(tournament.starts_at ? new Date(tournament.starts_at).toISOString().slice(0, 16) : '')
  const [registrationOpen, setRegistrationOpen] = useState(tournament.registration_open)
  useEffect(() => { setTitle(tournament.title); setDescription(tournament.description); setCapacity(tournament.max_players); setRegistrationOpen(tournament.registration_open); setStartsAt(tournament.starts_at ? new Date(tournament.starts_at).toISOString().slice(0, 16) : '') }, [tournament.id, tournament.title, tournament.description, tournament.max_players, tournament.registration_open, tournament.starts_at])
  return <form className="tournament-settings" onSubmit={event => { event.preventDefault(); onSave({ title: title.trim(), description: description.trim(), max_players: capacity, starts_at: startsAt ? new Date(startsAt).toISOString() : null, registration_open: registrationOpen }) }}>
    <div className="tournament-settings-heading"><Settings2 size={15}/><b>Organizer settings</b></div>
    <label>Tournament title<input required minLength={3} maxLength={80} value={title} onChange={e => setTitle(e.target.value)}/></label>
    <label>Details<textarea maxLength={500} rows={3} value={description} onChange={e => setDescription(e.target.value)}/></label>
    <div className="tournament-settings-split"><label>Capacity<select value={capacity} onChange={e => setCapacity(Number(e.target.value))}><option value={4}>4 players</option><option value={8}>8 players</option><option value={16}>16 players</option><option value={32}>32 players</option></select></label><label>Start time<input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)}/></label></div>
    <label className="tournament-toggle"><input type="checkbox" checked={registrationOpen} onChange={e => setRegistrationOpen(e.target.checked)}/><span>{registrationOpen ? 'Registration open' : 'Registration paused'}</span></label>
    <button className="button button-outline" disabled={busy} type="submit">Save settings <Check size={14}/></button>
  </form>
}

function TournamentMatchCard({ match, currentUserId, isOrganizer, busy, onOpenProfile, onSubmit, onResolve }: {
  match: TournamentMatch; currentUserId: string; isOrganizer: boolean; busy: boolean; onOpenProfile: (id: string) => void;
  onSubmit: (matchId: string, own: number, opponent: number) => void; onResolve: (matchId: string, one: number, two: number) => void;
}) {
  const [ownScore, setOwnScore] = useState('')
  const [opponentScore, setOpponentScore] = useState('')
  const [score1, setScore1] = useState('')
  const [score2, setScore2] = useState('')
  const mine = currentUserId === match.player1_id ? 1 : currentUserId === match.player2_id ? 2 : 0
  const submitted = mine === 1 ? match.player1_submitted_for !== null : mine === 2 ? match.player2_submitted_for !== null : false
  const canSubmit = mine > 0 && match.status !== 'completed' && match.status !== 'disputed' && !submitted && match.player1_id && match.player2_id
  return <article className={`tournament-match-card ${match.status === 'completed' ? 'match-done' : ''}`}>
    <span className={`tournament-match-state match-state-${match.status}`}>{match.status.replace('_', ' ')}</span>
    <TournamentMatchPlayer id={match.player1_id} profile={match.player1} score={match.player1_score} winner={match.winner_id === match.player1_id} onOpenProfile={onOpenProfile}/>
    <div className="tournament-vs">VS</div>
    <TournamentMatchPlayer id={match.player2_id} profile={match.player2} score={match.player2_score} winner={match.winner_id === match.player2_id} onOpenProfile={onOpenProfile}/>
    {canSubmit && <form className="tournament-score-form" onSubmit={event => { event.preventDefault(); if (ownScore !== '' && opponentScore !== '') onSubmit(match.id, Number(ownScore), Number(opponentScore)) }}><span>Your score</span><input required type="number" min="0" max="99" value={ownScore} onChange={e => setOwnScore(e.target.value)} aria-label="Your score"/><b>:</b><input required type="number" min="0" max="99" value={opponentScore} onChange={e => setOpponentScore(e.target.value)} aria-label="Opponent score"/><button className="button button-lime" disabled={busy}>Submit</button></form>}
    {submitted && match.status === 'awaiting_confirmation' && <div className="tournament-match-hint">Your report is in. Waiting for opponent confirmation.</div>}
    {match.status === 'disputed' && <div className="tournament-match-hint disputed">Score reports differ. The organizer can resolve this result.</div>}
    {isOrganizer && ['disputed', 'awaiting_confirmation'].includes(match.status) && <form className="tournament-resolve-form" onSubmit={event => { event.preventDefault(); if (score1 !== '' && score2 !== '') onResolve(match.id, Number(score1), Number(score2)) }}><span>Organizer result</span><input required type="number" min="0" max="99" value={score1} onChange={e => setScore1(e.target.value)} aria-label="Player one final score"/><b>:</b><input required type="number" min="0" max="99" value={score2} onChange={e => setScore2(e.target.value)} aria-label="Player two final score"/><button type="submit" className="button button-outline" disabled={busy}>Resolve</button></form>}
  </article>
}

function TournamentMatchPlayer({ id, profile, score, winner, onOpenProfile }: { id: string | null; profile: Profile | null; score: number | null; winner: boolean; onOpenProfile: (id: string) => void }) {
  if (!id) return <div className="tournament-match-player placeholder"><span className="avatar avatar-sm">?</span><span><b>Waiting for qualifier</b><small>Player advances from previous round</small></span><span className="tournament-match-score">–</span></div>
  return <div className={`tournament-match-player ${winner ? 'match-player-winner' : ''}`}><PlayerLink id={id} onOpen={onOpenProfile} className="tournament-match-profile"><Avatar name={profile?.display_name || profile?.username || 'Player'} image={profile?.avatar_url} size="sm"/><span><b>{profile?.display_name || profile?.username || 'Player'}</b><small>{winner ? 'ADVANCES' : `@${profile?.username || 'player'}`}</small></span></PlayerLink><span className="tournament-match-score">{score ?? '–'}</span></div>
}

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BadgeCheck, Camera, Gamepad2, Globe2, Medal, Save, Shield, Swords, Trophy, UserRound } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { getProfile, getProfileMatches, getProfileRank, updateProfile } from '../lib/matches'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { Avatar } from './PlayerBits'
import { getPlayerTournamentHistory, getPlayerTournamentWinCount } from '../lib/tournaments'
import type { TournamentHistoryItem } from '../lib/types'
import '../profile.css'

type Notice = { kind: 'success' | 'error' | 'info'; text: string }
const online = (lastSeen: string | null) => Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() < 180_000)
const readableError = (error: unknown) => {
  const e = error as { message?: string; code?: string }
  return import.meta.env.DEV ? [e.code, e.message].filter(Boolean).join(': ') || 'Unknown error' : e.message || 'Please try again.'
}
function ownAvatarPath(url: string | null, userId: string) {
  if (!url || !supabase) return null
  const base = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/player-avatars/`
  if (!url.startsWith(base)) return null
  const path = decodeURIComponent(url.slice(base.length).split('?')[0])
  return path.startsWith(`${userId}/`) ? path : null
}

export function PlayerProfilePage({ profileId, ownId, onBack, onEdit, onOpenPlayer, notify }: {
  profileId: string; ownId: string | null; onBack: () => void; onEdit: () => void;
  onOpenPlayer: (id: string) => void; notify: (notice: Notice) => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof getProfileMatches>>>([])
  const [tournamentHistory, setTournamentHistory] = useState<TournamentHistoryItem[]>([])
  const [tournamentWins, setTournamentWins] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([getProfile(profileId), getProfileMatches(profileId), getPlayerTournamentHistory(profileId), getPlayerTournamentWinCount(profileId)]).then(async ([p, history, tournaments, tournamentWinCount]) => {
      if (!active) return
      setProfile(p); setMatches(history); setTournamentHistory(tournaments); setTournamentWins(tournamentWinCount)
      if (p) setRank(await getProfileRank(p.rating))
    }).catch(error => { if (active) notify({ kind: 'error', text: `Could not load player profile. ${readableError(error)}` }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [profileId])
  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel(`profile-presence-${profileId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profileId}` }, payload => {
      const updated = payload.new as Profile
      setProfile(current => current ? { ...current, last_seen_at: updated.last_seen_at } : current)
    }).subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [profileId])
  if (loading) return <div className="room-loading"><span className="spinner"/> Loading player profile…</div>
  if (!profile) return <div className="history-empty"><UserRound size={25}/><h3>Player profile unavailable.</h3><p>This profile may have been removed or you may need to sign in.</p><button className="button button-outline" onClick={onBack}><ArrowLeft size={15}/> Back</button></div>
  const winRate = profile.matches_played ? Math.round(profile.wins / profile.matches_played * 100) : 0
  const badges = [
    ...(profile.matches_played >= 1 ? [{ title: 'First whistle', detail: 'Played a verified match' }] : []),
    ...(profile.wins >= 5 ? [{ title: 'Five wins', detail: 'Won five verified matches' }] : []),
    ...(profile.wins >= 10 ? [{ title: 'Double digits', detail: 'Won ten verified matches' }] : []),
    ...(profile.matches_played >= 20 ? [{ title: 'Veteran', detail: 'Played twenty verified matches' }] : []),
    ...(tournamentWins >= 1 ? [{ title: 'Tournament Champion', detail: 'Won a completed community tournament' }] : []),
    ...(tournamentWins >= 3 ? [{ title: 'Three-time Champion', detail: 'Won three community tournaments' }] : []),
    ...(tournamentWins >= 5 ? [{ title: 'Five-time Champion', detail: 'Won five community tournaments' }] : []),
  ]
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back</button>
    <section className="player-profile-hero panel">
      <div className="profile-card-accent"/>
      <Avatar name={profile.display_name || profile.username} image={profile.avatar_url} size="profile"/>
      <div className="profile-identity"><div className="profile-status"><i className={online(profile.last_seen_at) ? 'is-online' : ''}/>{online(profile.last_seen_at) ? 'ONLINE' : 'OFFLINE'} <span>·</span> PLAYER CARD</div>
        <h1>{profile.display_name || profile.username}</h1><p>@{profile.username}{profile.country ? ` · ${profile.country}` : ''}</p>
        {profile.bio && <div className="profile-bio">{profile.bio}</div>}
        <div className="profile-tags">{profile.platform && <span><Gamepad2 size={13}/>{profile.platform}</span>}{profile.favourite_club && <span><Shield size={13}/>{profile.favourite_club}</span>}{profile.playing_style && <span><Swords size={13}/>{profile.playing_style}</span>}</div>
      </div>
      <div className="profile-hero-actions">{ownId === profile.id && <button className="button button-lime" onClick={onEdit}>Edit profile <ArrowRight size={15}/></button>}</div>
      <div className="profile-rating"><small>COMPETITIVE RATING</small><b>{profile.rating}</b><span><Trophy size={13}/> {rank ? `GLOBAL #${rank}` : 'UNRANKED'}</span></div>
    </section>
    <section className="profile-facts-grid">
      <div className="profile-fact"><span><Medal size={15}/></span><small>RECORD</small><b>{profile.wins}–{profile.losses}–{profile.draws}</b><em>WINS · LOSSES · DRAWS</em></div>
      <div className="profile-fact"><span><Swords size={15}/></span><small>MATCHES PLAYED</small><b>{profile.matches_played}</b><em>COMPLETED MATCHES</em></div>
      <div className="profile-fact"><span><BadgeCheck size={15}/></span><small>WIN RATE</small><b>{winRate}%</b><em>OF VERIFIED MATCHES</em></div>
      <div className="profile-fact"><span><Globe2 size={15}/></span><small>PLAYER SINCE</small><b>{new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</b><em>{profile.country || 'COMMUNITY PLAYER'}</em></div>
    </section>
    <div className="profile-detail-grid">
      <section className="panel profile-info-panel"><div className="panel-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> PLAYER DETAILS</div><h3>On the pitch</h3></div></div>
        <div className="profile-detail-list"><div><small>eFOOTBALL ID</small><b>{profile.efootball_id || 'Not added'}</b></div><div><small>PLATFORM / DEVICE</small><b>{profile.platform || 'Not added'}</b></div><div><small>FAVOURITE CLUB</small><b>{profile.favourite_club || 'Not added'}</b></div><div><small>PLAYING STYLE</small><b>{profile.playing_style || 'Not added'}</b></div><div><small>COUNTRY</small><b>{profile.country || 'Not added'}</b></div><div><small>JOINED</small><b>{new Date(profile.created_at).toLocaleDateString()}</b></div></div>
      </section>
      <section className="panel profile-badges-panel"><div className="panel-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> ACHIEVEMENTS</div><h3>Earned on the pitch</h3></div></div>{badges.length ? <div className="profile-badges">{badges.map(badge => <div className="achievement-badge" key={badge.title}><span><Trophy size={17}/></span><div><b>{badge.title}</b><small>{badge.detail}</small></div></div>)}</div> : <div className="profile-empty-note"><Medal size={19}/><span>Verified matches unlock your first badge.</span></div>}</section>
    </div>
    <section className="panel profile-history-panel"><div className="panel-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> VERIFIED RESULTS</div><h3>Recent match history</h3></div><span className="muted-caption">Most recent first</span></div>
      {matches.length ? <div className="profile-match-list">{matches.map(match => <ProfileMatchRow key={match.id} match={match} onOpenPlayer={onOpenPlayer}/>)}</div> : <div className="profile-empty-note"><Swords size={19}/><span>Completed, agreed results will appear here.</span></div>}
    </section>
    <section className="panel profile-history-panel tournament-profile-history"><div className="panel-head"><div><div className="eyebrow"><span className="eyebrow-dot"/> TOURNAMENT RECORD</div><h3>Competition history</h3></div><span className="muted-caption">{tournamentWins} tournament wins</span></div>
      {tournamentHistory.length ? <div className="tournament-profile-list">{tournamentHistory.map(item => <div className="tournament-profile-row" key={item.tournament.id}><span className={`tournament-mini-status tournament-${item.tournament.status}`}>{item.is_winner ? 'WINNER' : item.tournament.status.replace('_', ' ').toUpperCase()}</span><span className="tournament-profile-name">{item.tournament.title}</span><small>{item.tournament.max_players} player bracket</small>{item.is_winner && <Trophy size={15}/>}</div>)}</div> : <div className="profile-empty-note"><Trophy size={19}/><span>Joined and completed tournaments will appear here.</span></div>}
    </section>
  </>
}

function ProfileMatchRow({ match, onOpenPlayer }: { match: Awaited<ReturnType<typeof getProfileMatches>>[number]; onOpenPlayer: (id: string) => void }) {
  return <div className="profile-match-row"><span className={`match-outcome outcome-${match.outcome}`}>{match.outcome.toUpperCase()}</span>
    <button className="profile-match-player" onClick={() => match.opponent && onOpenPlayer(match.opponent.id)}><Avatar name={match.opponent?.display_name || match.opponent?.username || 'Player'} image={match.opponent?.avatar_url} size="sm"/><span><b>{match.opponent?.display_name || match.opponent?.username || 'Player'}</b><small>{match.opponent ? `@${match.opponent.username}` : 'Opponent profile unavailable'}</small></span></button>
    <b className="profile-match-score">{match.ownScore} : {match.opponentScore}</b><time>{new Date(match.created_at).toLocaleDateString()}</time>
  </div>
}

export function EditProfilePage({ session, initialProfile, onBack, onSaved, notify }: { session: Session | null; initialProfile: Profile | null; onBack: () => void; onSaved: () => void; notify: (notice: Notice) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState({ username: '', display_name: '', country: '', efootball_id: '', platform: '', favourite_club: '', playing_style: '', bio: '', avatar_url: '' })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (!session) { setLoading(false); return }
    setLoading(true)
    getProfile(session.user.id).then(loaded => {
      if (!active) return
      const p = loaded?.username ? loaded : initialProfile ?? loaded
      setProfile(p)
      if (p) setForm({ username: p.username, display_name: p.display_name || '', country: p.country || '', efootball_id: p.efootball_id || '', platform: p.platform || '', favourite_club: p.favourite_club || '', playing_style: p.playing_style || '', bio: p.bio || '', avatar_url: p.avatar_url || '' })
    }).catch(error => notify({ kind: 'error', text: `Could not load your profile. ${readableError(error)}` })).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session?.user.id, initialProfile?.id])
  const field = (key: keyof typeof form, value: string) => setForm(prev => ({ ...prev, [key]: value }))
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!session || !profile || !supabase) return
    setBusy(true)
    try {
      let avatarUrl = form.avatar_url || null
      if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.')
        if (file.size > 5 * 1024 * 1024) throw new Error('Avatar images must be 5 MB or smaller.')
        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
        const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('player-avatars').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false })
        if (uploadError) throw uploadError
        avatarUrl = supabase.storage.from('player-avatars').getPublicUrl(path).data.publicUrl
      }
      await updateProfile(session.user.id, { username: form.username.trim() || profile.username, display_name: form.display_name.trim() || null, country: form.country.trim() || null, efootball_id: form.efootball_id.trim() || null, platform: form.platform.trim() || null, favourite_club: form.favourite_club.trim() || null, playing_style: form.playing_style.trim() || null, bio: form.bio.trim() || null, avatar_url: avatarUrl })
      if (profile.avatar_url !== avatarUrl) {
        const oldPath = ownAvatarPath(profile.avatar_url, session.user.id)
        if (oldPath) {
          const { error: removeError } = await supabase.storage.from('player-avatars').remove([oldPath])
          if (removeError) console.error('Could not remove replaced player avatar:', removeError)
        }
      }
      notify({ kind: 'success', text: 'Your player profile has been updated.' }); onSaved()
    } catch (error) { notify({ kind: 'error', text: `Profile could not be saved. ${readableError(error)}` }) }
    finally { setBusy(false) }
  }
  if (loading) return <div className="room-loading"><span className="spinner"/> Loading your profile…</div>
  if (!session || !profile) return <div className="history-empty"><UserRound size={25}/><h3>Sign in to edit your profile.</h3><button className="button button-outline" onClick={onBack}>Back</button></div>
  return <>
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to player card</button>
    <div className="page-intro"><div className="eyebrow"><span className="eyebrow-dot"/> YOUR PLAYER CARD</div><h1>Edit profile.</h1><p>Set up your public competitive profile. Your account email stays private.</p></div>
    <form className="panel edit-profile-form" onSubmit={e => void save(e)}>
      <div className="edit-avatar-row"><Avatar name={form.display_name || form.username || 'Player'} image={preview || form.avatar_url} size="profile"/><label className="button button-outline avatar-upload"><Camera size={15}/> {file ? 'Choose another' : 'Upload avatar'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} hidden/></label>{(file || form.avatar_url) && <button type="button" className="button button-outline avatar-remove" onClick={() => { setFile(null); field('avatar_url', '') }}>Remove photo</button>}<span>JPEG, PNG or WebP · up to 5 MB</span></div>
      <div className="edit-profile-grid">
        <label>Username<input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" defaultValue={initialProfile?.username || form.username || profile.username} onChange={e => field('username', e.target.value)} autoComplete="off"/><small>Letters, numbers and underscores.</small></label>
        <label>Display name<input maxLength={48} value={form.display_name} onChange={e => field('display_name', e.target.value)}/></label>
        <label>Country<input maxLength={64} value={form.country} onChange={e => field('country', e.target.value)} placeholder="e.g. Nigeria"/></label>
        <label>eFootball ID<input maxLength={64} value={form.efootball_id} onChange={e => field('efootball_id', e.target.value)}/></label>
        <label>Platform / device<select value={form.platform} onChange={e => field('platform', e.target.value)}><option value="">Select platform</option><option>PlayStation</option><option>Xbox</option><option>PC</option><option>iOS</option><option>Android</option></select></label>
        <label>Favourite club<input maxLength={64} value={form.favourite_club} onChange={e => field('favourite_club', e.target.value)} placeholder="e.g. Arsenal"/></label>
        <label>Playing style<input maxLength={64} value={form.playing_style} onChange={e => field('playing_style', e.target.value)} placeholder="e.g. Quick counter"/></label>
        <label className="edit-bio-field">Short bio<textarea maxLength={240} rows={4} value={form.bio} onChange={e => field('bio', e.target.value)} placeholder="Tell other players how you like to play."/><small>{form.bio.length}/240</small></label>
      </div>
      <div className="edit-profile-actions"><button type="button" className="button button-outline" onClick={onBack}>Cancel</button><button type="submit" className="button button-lime" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}{busy ? <span className="spinner"/> : <Save size={15}/>}</button></div>
    </form>
  </>
}

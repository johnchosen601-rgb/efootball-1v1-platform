import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, LoaderCircle, Search, Shield, Trash2, UserRound } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Avatar } from './PlayerBits'
import '../profile.css'

type AdminPlayer = {
  id: string
  email: string
  created_at: string
  profile: { username: string; display_name: string | null; avatar_url: string | null; country: string | null; rating: number; wins: number; losses: number } | null
}

export function AdminPlayersPage({ session }: { session: Session | null }) {
  const [players, setPlayers] = useState<AdminPlayer[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const isAdmin = session?.user.app_metadata?.role === 'admin'

  const loadPlayers = async () => {
    if (!supabase || !isAdmin) return
    setBusy(true)
    setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('admin-player-accounts', { body: { action: 'list' } })
    if (invokeError) setError(invokeError.message || 'Player accounts could not be loaded.')
    else setPlayers((data?.players ?? []) as AdminPlayer[])
    setBusy(false)
  }

  useEffect(() => { void loadPlayers() }, [isAdmin])

  const visiblePlayers = useMemo(() => players.filter(player =>
    `${player.email} ${player.profile?.username ?? ''} ${player.profile?.display_name ?? ''}`.toLowerCase().includes(search.toLowerCase().trim())
  ), [players, search])

  const deletePlayer = async (player: AdminPlayer) => {
    if (!supabase || !isAdmin || player.id === session?.user.id) return
    const name = player.profile?.display_name || player.profile?.username || player.email
    if (!window.confirm(`Delete ${name}'s account? Their sign-in and personal profile details will be removed. Match scores and tournament history will remain with the player anonymized as “Deleted player”. This cannot be undone.`)) return
    setDeletingId(player.id)
    setError('')
    const { error: invokeError } = await supabase.functions.invoke('admin-player-accounts', { body: { action: 'delete', userId: player.id } })
    if (invokeError) setError(invokeError.message || 'The account could not be deleted.')
    else setPlayers(current => current.filter(item => item.id !== player.id))
    setDeletingId(null)
  }

  if (!session) return <div className="history-empty"><Shield size={24}/><h3>Sign in to continue.</h3></div>
  if (!isAdmin) return <div className="history-empty"><Shield size={24}/><h3>Administrator access is required.</h3><p>This page is available only to authorized ConnectGamers1v1 administrators.</p></div>

  return <section className="admin-player-page">
    <div className="page-intro"><div className="eyebrow"><Shield size={13}/> ACCOUNT ADMINISTRATION</div><h1>Player accounts.</h1><p>Remove sign-in access while preserving verified match and tournament history.</p></div>
    <div className="panel admin-player-panel">
      <div className="admin-player-toolbar"><label><Search size={15}/><input aria-label="Search player accounts" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search username or email"/></label><button className="button button-outline" onClick={() => void loadPlayers()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={14}/> : 'Refresh'}</button></div>
      {error && <p className="admin-player-error" role="alert"><AlertTriangle size={15}/>{error}</p>}
      {busy && !players.length ? <div className="room-loading"><span className="spinner"/> Loading player accounts…</div> : visiblePlayers.length ? <div className="admin-player-list">{visiblePlayers.map(player => {
        const label = player.profile?.display_name || player.profile?.username || player.email || 'Player'
        return <article className="admin-player-row" key={player.id}>
          <Avatar name={label} image={player.profile?.avatar_url ?? null} size="sm"/>
          <div className="admin-player-identity"><b>{label}</b><small>{player.profile?.username ? `@${player.profile.username} · ` : ''}{player.email}</small></div>
          <div className="admin-player-rating"><b>{player.profile?.rating ?? '—'}</b><small>{player.profile?.country || 'PLAYER RATING'}</small></div>
          <button className="button admin-delete-button" onClick={() => void deletePlayer(player)} disabled={player.id === session.user.id || deletingId !== null} title={player.id === session.user.id ? 'You cannot delete your own admin account' : `Delete ${label}`}>
            {deletingId === player.id ? <LoaderCircle className="spin" size={14}/> : <Trash2 size={14}/>}<span>{deletingId === player.id ? 'Deleting…' : player.id === session.user.id ? 'Current admin' : 'Delete account'}</span>
          </button>
        </article>
      })}</div> : !error ? <div className="profile-empty-note"><UserRound size={18}/><span>No matching player accounts.</span></div> : null}
      <p className="admin-player-note">Account deletion clears the user’s avatar and match evidence, removes private messages and notifications, and anonymizes the profile. Completed match scores, tournament participants, brackets, champions, and ratings remain.</p>
    </div>
  </section>
}

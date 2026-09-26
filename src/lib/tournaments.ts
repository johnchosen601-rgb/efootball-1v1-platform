import { supabase } from './supabase'
import type { Profile, Tournament, TournamentDetails, TournamentHistoryItem, TournamentMatch, TournamentParticipant } from './types'

const profileColumns = 'id,username,display_name,avatar_url,country,efootball_id,platform,favourite_club,playing_style,bio,rating,wins,losses,draws,created_at,last_seen_at'
const matchColumns = 'id,tournament_id,round_number,match_number,player1_id,player2_id,player1_submitted_for,player1_submitted_against,player2_submitted_for,player2_submitted_against,player1_score,player2_score,winner_id,status,created_at,completed_at'

export type TournamentInput = { title: string; description: string; max_players: number; starts_at: string | null }
export type TournamentSettings = TournamentInput & { registration_open: boolean }

async function profilesById(ids: (string | null)[]): Promise<Map<string, Profile>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (!supabase || !unique.length) return new Map()
  const { data, error } = await supabase.from('profiles').select(profileColumns).in('id', unique)
  if (error) throw error
  return new Map((data ?? []).map(profile => [profile.id, profile as Profile]))
}

export async function getTournaments(): Promise<{ tournament: Tournament; participant_count: number; player_ids: string[]; organizer: Profile | null; winner: Profile | null }[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(50)
  if (error) throw error
  const tournaments = (data ?? []) as Tournament[]
  if (!tournaments.length) return []
  const ids = tournaments.map(row => row.id)
  const { data: entries, error: participantError } = await supabase.from('tournament_participants').select('tournament_id,player_id').in('tournament_id', ids)
  if (participantError) throw participantError
  const byTournament = new Map<string, number>()
  for (const entry of entries ?? []) byTournament.set(entry.tournament_id, (byTournament.get(entry.tournament_id) ?? 0) + 1)
  const profiles = await profilesById(tournaments.flatMap(t => [t.organizer_id, t.winner_id]))
  const idsByTournament = new Map<string, string[]>()
  for (const entry of entries ?? []) idsByTournament.set(entry.tournament_id, [...(idsByTournament.get(entry.tournament_id) ?? []), entry.player_id])
  return tournaments.map(tournament => ({ tournament, participant_count: byTournament.get(tournament.id) ?? 0, player_ids: idsByTournament.get(tournament.id) ?? [], organizer: profiles.get(tournament.organizer_id) ?? null, winner: profiles.get(tournament.winner_id ?? '') ?? null }))
}

export async function getTournamentDetails(id: string): Promise<TournamentDetails | null> {
  if (!supabase) return null
  const { data: tournament, error } = await supabase.from('tournaments').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!tournament) return null
  const [participantResult, matchResult] = await Promise.all([
    supabase.from('tournament_participants').select('tournament_id,player_id,seed,joined_at').eq('tournament_id', id).order('seed'),
    supabase.from('tournament_matches').select(matchColumns).eq('tournament_id', id).order('round_number').order('match_number'),
  ])
  if (participantResult.error) throw participantResult.error
  if (matchResult.error) throw matchResult.error
  const rawParticipants = participantResult.data ?? []
  const rawMatches = matchResult.data ?? []
  const profiles = await profilesById([
    ...rawParticipants.map(row => row.player_id),
    ...rawMatches.flatMap(row => [row.player1_id, row.player2_id]),
  ])
  const participants = rawParticipants.map(row => ({ ...row, profile: profiles.get(row.player_id) ?? null })) as TournamentParticipant[]
  const matches = rawMatches.map(row => ({ ...row, player1: profiles.get(row.player1_id ?? '') ?? null, player2: profiles.get(row.player2_id ?? '') ?? null })) as TournamentMatch[]
  return { tournament: tournament as Tournament, participants, matches }
}

export async function getPlayerTournamentHistory(playerId: string): Promise<TournamentHistoryItem[]> {
  if (!supabase) return []
  const { data: entries, error } = await supabase.from('tournament_participants').select('tournament_id,joined_at').eq('player_id', playerId).order('joined_at', { ascending: false }).limit(30)
  if (error) throw error
  if (!entries?.length) return []
  const { data: rows, error: tournamentError } = await supabase.from('tournaments').select('*').in('id', entries.map(row => row.tournament_id))
  if (tournamentError) throw tournamentError
  const byId = new Map((rows ?? []).map(row => [row.id, row as Tournament]))
  return entries.flatMap(entry => {
    const tournament = byId.get(entry.tournament_id)
    return tournament ? [{ tournament, joined_at: entry.joined_at, is_winner: tournament.winner_id === playerId }] : []
  })
}

export async function getPlayerTournamentWinCount(playerId: string): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase.from('tournaments').select('id', { count: 'exact', head: true }).eq('winner_id', playerId).eq('status', 'completed')
  if (error) throw error
  return count ?? 0
}

export async function searchTournamentPlayers(query: string): Promise<Profile[]> {
  if (!supabase) return []
  const term = query.trim()
  if (term.length < 2) return []
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`
  const [usernameResult, nameResult] = await Promise.all([
    supabase.from('profiles').select(profileColumns).ilike('username', pattern).order('rating', { ascending: false }).limit(10),
    supabase.from('profiles').select(profileColumns).ilike('display_name', pattern).order('rating', { ascending: false }).limit(10),
  ])
  if (usernameResult.error) throw usernameResult.error
  if (nameResult.error) throw nameResult.error
  const candidates = new Map<string, Profile>()
  for (const row of [...(usernameResult.data ?? []), ...(nameResult.data ?? [])]) {
    candidates.set(row.id, row as Profile)
  }
  return [...candidates.values()].sort((a, b) => b.rating - a.rating).slice(0, 10)
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Connect Supabase before using tournaments.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

export const createTournament = (input: TournamentInput) => call<string>('create_tournament', {
  p_title: input.title, p_description: input.description, p_max_players: input.max_players, p_starts_at: input.starts_at,
})
export const joinTournament = (id: string) => call<void>('join_tournament', { p_tournament_id: id })
export const addTournamentPlayer = (tournamentId: string, playerId: string) => call<void>('add_tournament_player', { p_tournament_id: tournamentId, p_player_id: playerId })
export const removeTournamentPlayer = (tournamentId: string, playerId: string) => call<void>('remove_tournament_player', { p_tournament_id: tournamentId, p_player_id: playerId })
export const updateTournamentSettings = (id: string, input: TournamentSettings) => call<void>('update_tournament_settings', {
  p_tournament_id: id, p_title: input.title, p_description: input.description, p_max_players: input.max_players,
  p_starts_at: input.starts_at, p_registration_open: input.registration_open,
})
export const startTournament = (id: string) => call<void>('start_tournament', { p_tournament_id: id })
export const submitTournamentResult = (id: string, ownScore: number, opponentScore: number) => call<void>('submit_tournament_result', {
  p_match_id: id, p_own_score: ownScore, p_opponent_score: opponentScore,
})
export const resolveTournamentResult = (id: string, score1: number, score2: number) => call<void>('resolve_tournament_result', {
  p_match_id: id, p_score1: score1, p_score2: score2,
})

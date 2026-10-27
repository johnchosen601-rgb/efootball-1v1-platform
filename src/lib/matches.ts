import { supabase } from './supabase'
import { PLAYING_STYLES, type ChatMessage, type Match, type MatchHistoryItem, type MatchRequest, type Profile } from './types'

const profileColumns = 'id,username,display_name,avatar_url,country,efootball_id,platform,favourite_club,playing_style,bio,rating,wins,losses,draws,created_at,last_seen_at,is_deleted'

const withMatchesPlayed = (profile: Profile) => ({ ...profile, matches_played: profile.wins + profile.losses + profile.draws })

export async function getProfiles(): Promise<Profile[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('profiles').select(profileColumns).eq('is_deleted', false).order('rating', { ascending: false }).limit(50)
  if (error) throw error
  return ((data ?? []) as Profile[]).map(withMatchesPlayed)
}
export async function getProfile(profileId: string): Promise<Profile | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('profiles').select(profileColumns).eq('id', profileId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return withMatchesPlayed(data as Profile)
}
export async function getProfilesByIds(profileIds: string[]): Promise<Profile[]> {
  if (!supabase || !profileIds.length) return []
  const { data, error } = await supabase.from('profiles').select(profileColumns).in('id', [...new Set(profileIds)])
  if (error) throw error
  return (data ?? []) as Profile[]
}
export async function getProfileRank(rating: number): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_deleted', false).gt('rating', rating)
  if (error) throw error
  return (count ?? 0) + 1
}
export async function getProfileMatches(profileId: string, limit = 10) {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('get_profile_match_history', { p_profile_id: profileId, p_limit: limit })
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; player1_id: string; player2_id: string; player1_score: number | null; player2_score: number | null; winner_id: string | null; status: string; created_at: string }>
  const opponentIds = [...new Set(rows.map(match => match.player1_id === profileId ? match.player2_id : match.player1_id))]
  const { data: opponents, error: profilesError } = opponentIds.length ? await supabase.from('profiles').select(profileColumns).in('id', opponentIds) : { data: [], error: null }
  if (profilesError) throw profilesError
  const byId = new Map((opponents ?? []).map(profile => [profile.id, profile as Profile]))
  return rows.map(match => {
    const isPlayerOne = match.player1_id === profileId
    return {
      ...match,
      opponent: byId.get(isPlayerOne ? match.player2_id : match.player1_id) ?? null,
      outcome: !match.winner_id ? 'draw' as const : match.winner_id === profileId ? 'win' as const : 'loss' as const,
      ownScore: isPlayerOne ? match.player1_score : match.player2_score,
      opponentScore: isPlayerOne ? match.player2_score : match.player1_score,
    }
  })
}
export async function updateProfile(profileId: string, values: Pick<Profile, 'username' | 'display_name' | 'country' | 'efootball_id' | 'platform' | 'favourite_club' | 'playing_style' | 'bio' | 'avatar_url'>): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (values.playing_style !== null && !PLAYING_STYLES.includes(values.playing_style as typeof PLAYING_STYLES[number])) {
    throw new Error('Choose one of the available eFootball playing styles.')
  }
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user || auth.user.id !== profileId) throw new Error('You can only edit your own player profile.')
  const { error } = await supabase.from('profiles').update(values).eq('id', profileId)
  if (error) throw error
}
export async function touchProfile(profileId: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', profileId)
  if (error) throw error
}
export async function getOpenRequests(): Promise<MatchRequest[]> {
  if (!supabase) return []
  const { data: auth } = await supabase.auth.getUser()
  if (auth.user) {
    const { error: expireError } = await supabase.rpc('expire_match_requests')
    if (expireError) throw expireError
  }
  const { data, error } = await supabase.from('match_requests').select(`id,user_id:player_id,created_at,expires_at,message,profiles!match_requests_player_id_fkey(${profileColumns})`).eq('status', 'open').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(request => {
    return { ...request, profiles: request.profiles as unknown as Profile }
  }) as unknown as MatchRequest[]
}
export async function createRequest(): Promise<string> {
  if (!supabase) throw new Error('Connect Supabase to request a match.')
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!authData.user) throw new Error('Sign in to request a match.')
  const { data, error } = await supabase.from('match_requests').insert({ player_id: authData.user.id }).select('id').single()
  if (error) throw error
  return data.id as string
}
export async function joinRequest(requestId: string): Promise<string> {
  if (!supabase) throw new Error('Connect Supabase to join a match.')
  const { data, error } = await supabase.rpc('join_match_request', { p_request_id: requestId })
  if (error) throw error
  if (!data) throw new Error('This match request has expired. Refresh the live field to see current challenges.')
  return data as string
}
export async function cancelRequest(requestId: string): Promise<void> {
  if (!supabase) throw new Error('Connect Supabase to cancel a match.')
  const { error } = await supabase.rpc('cancel_match_request', { p_request_id: requestId })
  if (error) throw error
}
export async function getMatch(matchId: string): Promise<Match> {
  if (!supabase) throw new Error('Connect Supabase to open a private match room.')
  const { data, error } = await supabase.from('matches').select('id,request_id,player1_id,player2_id,player1_score,player2_score,player1_evidence_path,player2_evidence_path,status,winner_id,created_at,completed_at,room_code,result_deadline_at,opponent_deadline_at,void_reason').eq('id', matchId).single()
  if (error) throw error
  const row = data as { id: string; player1_id: string; player2_id: string; player1_score: number | null; player2_score: number | null; player1_evidence_path: string | null; player2_evidence_path: string | null; status: string; winner_id: string | null; created_at: string; room_code: string | null; result_deadline_at: string | null; opponent_deadline_at: string | null; void_reason: string | null }
  return {
    ...row,
    player_one_id: row.player1_id,
    player_two_id: row.player2_id,
    requester_id: row.player1_id,
    player_one_score: row.player1_score,
    player_two_score: row.player2_score,
    player_one_evidence_path: row.player1_evidence_path ?? null,
    player_two_evidence_path: row.player2_evidence_path ?? null,
    room_code: row.room_code ?? null,
  }
}
export async function getMatchHistory(): Promise<MatchHistoryItem[]> {
  if (!supabase) return []
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user) return []
  const { data, error } = await supabase.from('matches').select('id,player_one_id:player1_id,player_two_id:player2_id,status,player_one_score:player1_score,player_two_score:player2_score,winner_id,created_at').or(`player1_id.eq.${auth.user.id},player2_id.eq.${auth.user.id}`).order('created_at', { ascending: false }).limit(50)
  if (error) throw error
  return (data ?? []) as MatchHistoryItem[]
}
export async function shareRoomCode(matchId: string, code: string): Promise<void> {
  if (!supabase) throw new Error('Connect Supabase to share a room code.')
  const { error } = await supabase.rpc('share_match_room_code', { p_match_id: matchId, p_room_code: code })
  if (error) throw error
}
export async function sendMessage(matchId: string, body: string): Promise<void> {
  if (!supabase) throw new Error('Connect Supabase to send private messages.')
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  if (!auth.user) throw new Error('Sign in to send private messages.')
  const { error } = await supabase.from('chat_messages').insert({ match_id: matchId, sender_id: auth.user.id, message: body.trim() })
  if (error) throw error
}
export async function getMessages(matchId: string): Promise<ChatMessage[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('chat_messages').select('id,match_id,sender_id,message,created_at').eq('match_id', matchId).order('created_at').limit(100)
  if (error) throw error
  return (data ?? []) as ChatMessage[]
}
export async function submitResult(matchId: string, ownScore: number, opponentScore: number, evidencePath: string | null): Promise<string> {
  if (!supabase) throw new Error('Connect Supabase to submit a result.')
  const { data, error } = await supabase.rpc('submit_match_result', { p_match_id: matchId, p_own_score: ownScore, p_opponent_score: opponentScore, p_evidence_path: evidencePath })
  if (error) throw error
  return data as string
}

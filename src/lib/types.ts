export const PLAYING_STYLES = ['Possession Game', 'Quick Counter (QC)', 'Long Ball Counter (LBC)', 'Long Ball', 'Out Wide', 'Overload'] as const

export type Profile = {
  id: string; username: string; display_name: string | null; country: string | null;
  avatar_url: string | null; rating: number; wins: number; losses: number;
  draws: number; matches_played: number; efootball_id: string | null;
  platform: string | null; favourite_club: string | null; playing_style: string | null;
  bio: string | null; created_at: string; last_seen_at: string | null; is_deleted: boolean;
}
export type MatchRequest = { id: string; user_id: string; created_at: string; expires_at: string; profiles: Profile }
export type Match = { id: string; player_one_id: string; player_two_id: string; requester_id: string; room_code: string | null; status: string; player_one_score: number | null; player_two_score: number | null; player_one_evidence_path: string | null; player_two_evidence_path: string | null; winner_id: string | null; created_at: string; result_deadline_at: string | null; opponent_deadline_at: string | null; void_reason: string | null }
export type MatchHistoryItem = Pick<Match, 'id' | 'player_one_id' | 'player_two_id' | 'status' | 'player_one_score' | 'player_two_score' | 'winner_id' | 'created_at'>
export type ChatMessage = { id: string; match_id: string; sender_id: string; message: string; created_at: string }
export type CompletedProfileMatch = {
  id: string; player1_id: string; player2_id: string; player1_score: number;
  player2_score: number; winner_id: string | null; status: string; created_at: string;
  opponent: Profile | null; outcome: 'win' | 'loss' | 'draw';
}
export type TournamentStatus = 'registration' | 'in_progress' | 'completed' | 'cancelled'
export type Tournament = {
  id: string; organizer_id: string; title: string; description: string; max_players: number;
  status: TournamentStatus; registration_open: boolean; starts_at: string | null;
  created_at: string; started_at: string | null; completed_at: string | null; winner_id: string | null;
}
export type TournamentParticipant = { tournament_id: string; player_id: string; seed: number; joined_at: string; profile: Profile | null }
export type TournamentMatch = {
  id: string; tournament_id: string; round_number: number; match_number: number;
  player1_id: string | null; player2_id: string | null;
  player1_submitted_for: number | null; player1_submitted_against: number | null;
  player2_submitted_for: number | null; player2_submitted_against: number | null;
  player1_score: number | null; player2_score: number | null; winner_id: string | null;
  status: 'pending' | 'awaiting_confirmation' | 'disputed' | 'completed'; created_at: string; completed_at: string | null;
  player1: Profile | null; player2: Profile | null;
}
export type TournamentDetails = { tournament: Tournament; participants: TournamentParticipant[]; matches: TournamentMatch[] }
export type TournamentHistoryItem = { tournament: Tournament; joined_at: string; is_winner: boolean }

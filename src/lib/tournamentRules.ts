export const TOURNAMENT_MATCH_RULES = [
  { label: 'Match duration', value: '10 minutes or longer' },
  { label: 'Team condition', value: 'Excellent for both players' },
  { label: 'Penalties', value: 'On' },
  { label: 'Substitutions', value: 'Maximum allowed by the current eFootball match settings' },
  { label: 'Extra Time', value: 'On' },
  { label: 'Extra Substitutions', value: 'On during Extra Time' },
] as const

export const TOURNAMENT_RESULT_POLICY = {
  decisiveWinnerRequired: true,
  tieBreakSequence: ['Extra Time', 'Penalties'] as const,
  submissionGuidance: 'Submit the final result after Extra Time and penalties if needed. Knockout results must have a winner.',
} as const

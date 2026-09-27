export type LoginChoice = 'undecided' | 'gateway' | 'official' | 'later'
export interface SetupStatus {
  completed: boolean
  choice: LoginChoice
  gatewayReady: boolean
  officialProvider?: string
  officialPhase?: string
}

export interface HarnessInstallation {
  id: string
  name: string
  installed: boolean
  version?: string
  path?: string
  error?: string
  runnable: boolean
  instructions: string
  website: string
  maintenanceAction?: 'install' | 'update'
  maintenance?: {
    state: 'running' | 'completed' | 'failed'
    message: string
    startedAt: string
    finishedAt?: string
  }
}

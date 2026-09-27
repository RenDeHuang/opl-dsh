export interface HarnessInstallation {
  id: string
  name: string
  installed: boolean
  version?: string
  path?: string
  /** Where the host found the executable; useful when the desktop PATH differs from a shell. */
  detectedBy?: 'configured-path' | 'shell-path' | 'known-path' | 'app-bundle'
  error?: string
  runnable: boolean
  instructions: string
  website: string
  installable?: boolean
  maintenanceAction?: 'install' | 'update'
  maintenance?: {
    state: 'running' | 'completed' | 'failed'
    message: string
    startedAt: string
    finishedAt?: string
  }
}

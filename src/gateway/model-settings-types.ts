export interface ModelDraft { id: string; name?: string; contextWindow?: number; [key: string]: unknown }
export interface GatewayModelSettings {
  groups: { id: string; name: string; api: string; models: ModelDraft[]; enabled?: boolean; rateMultiplier?: number; ready: boolean; state: 'ready' | 'unauthorized' | 'unconfigured' | 'error'; revision: number }[]
}

/** Account groups are credential scopes. Protocol and model configuration live in DSH settings. */
export const GATEWAY_GROUPS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    credential: 'OPL_GATEWAY_DEEPSEEK_API_KEY',
    provider: 'opl-gateway',
    api: 'messages',
  },
  {
    id: 'codex',
    name: 'Codex',
    credential: 'OPL_GATEWAY_CODEX_API_KEY',
    provider: 'opl-gateway-openai',
    api: 'openai-responses',
  },
  {
    id: 'grok',
    name: 'Grok',
    credential: 'OPL_GATEWAY_GROK_API_KEY',
    provider: 'opl-gateway-grok',
    api: 'openai-responses',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    credential: 'OPL_GATEWAY_GEMINI_API_KEY',
    provider: 'opl-gateway-gemini',
    api: 'openai-completions',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    credential: 'OPL_GATEWAY_KIRO_API_KEY',
    provider: 'opl-gateway-kiro',
    api: 'anthropic-messages',
  },
  {
    id: 'aws',
    name: 'AWS',
    credential: 'OPL_GATEWAY_AWS_API_KEY',
    provider: 'opl-gateway-aws',
    api: 'anthropic-messages',
  },
] as const
export type GatewayGroupId = (typeof GATEWAY_GROUPS)[number]['id']
export type GatewayGroupName = (typeof GATEWAY_GROUPS)[number]['name']
export const internalGatewayProvider = (id: string) =>
  GATEWAY_GROUPS.some((group) => group.id !== 'deepseek' && group.provider === id)

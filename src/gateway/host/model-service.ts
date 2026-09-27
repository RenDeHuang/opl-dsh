/** Gateway owns its model configuration independently of any Harness. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { gatewayModelSettings, editGatewayModels, discoverGatewayModels } from './model-settings.ts'
import { setGatewayGroupEnabled } from './group-settings.ts'
import type { GatewayAccountStatus } from '../contracts/account.ts'
import type { GatewayModelSettings, ModelDraft } from '../contracts/models.ts'
import type { GatewayModelEdit } from '../../contracts/types.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    oplGatewayModels: GatewayModelsService
  }
}
export class GatewayModelsService extends TypertRemoteService {
  static inject = ['settings', 'credentials', 'llm']
  constructor(ctx: Context) {
    super(ctx, 'oplGatewayModels')
  }
  @Remote('read')
  read(): Promise<GatewayModelSettings> {
    return gatewayModelSettings(this.ctx)
  }
  @Remote('edit')
  edit(request: GatewayModelEdit): Promise<GatewayModelSettings> {
    return editGatewayModels(this.ctx, request)
  }
  @Remote('discover')
  discover(request: { group: string }): Promise<ModelDraft[]> {
    return discoverGatewayModels(this.ctx, request)
  }
  @Remote('activate')
  activate(request: { id: string; enabled: boolean }): Promise<GatewayAccountStatus> {
    return setGatewayGroupEnabled(this.ctx, request.id, request.enabled)
  }
}

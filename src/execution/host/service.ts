/** Typed UI boundary; lifecycle, authorization and sessions stay in the execution owner. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { HarnessService } from './harness.ts'
import type {
  HarnessSessionsRequest,
  HarnessSessionsPage,
  HarnessDetailRequest,
  HarnessDetailPage,
  HarnessTaskSummary,
} from '../contracts/views.ts'
import type {
  ExecutionCatalog,
  HarnessCatalog,
  HarnessSnapshot,
  HarnessInstallation,
  HarnessSelection,
  HarnessStartRequest,
  HarnessPromptRequest,
  SessionRequest,
  CooperationSettings,
  HarnessOrigin,
  DelegateRequest,
  ReviewRequest,
  ReportRequest,
} from '../../contracts/types.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    oplExecution: ExecutionService
  }
}
export class ExecutionService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly execution: HarnessService,
  ) {
    super(ctx, 'oplExecution')
  }
  @Remote('catalog')
  catalog(): Promise<ExecutionCatalog> {
    return this.execution.executionCatalog()
  }
  @Remote('save-catalog')
  saveCatalog(request: { catalog: ExecutionCatalog }): Promise<ExecutionCatalog> {
    return this.execution.saveExecutionCatalog(request.catalog)
  }
  @Remote('list')
  list(): Promise<HarnessCatalog> {
    return this.execution.list()
  }
  @Remote('combinations')
  combinations(): Promise<HarnessCatalog['combinations']> {
    return this.execution.combinations()
  }
  @Remote('sessions')
  sessions(request: HarnessSessionsRequest): Promise<HarnessSessionsPage> {
    return this.execution.sessions(request)
  }
  @Remote('detail')
  detail(request: HarnessDetailRequest): Promise<HarnessDetailPage> {
    return this.execution.detail(request)
  }
  @Remote('harness-installations')
  installations(): Promise<HarnessInstallation[]> {
    return this.execution.installations()
  }
  @Remote('harness-update')
  async update(request: { id: string }): Promise<null> {
    await this.execution.updateHarness(request.id)
    return null
  }
  @Remote('start')
  start(request: HarnessStartRequest): Promise<HarnessSnapshot> {
    return this.execution.start(request)
  }
  @Remote('prompt')
  prompt(request: HarnessPromptRequest): Promise<HarnessSnapshot> {
    return this.execution.prompt(request)
  }
  @Remote('snapshot')
  snapshot(request: SessionRequest): Promise<HarnessSnapshot> {
    return this.execution.snapshot(request)
  }
  @Remote('wait')
  wait(
    request: { sessionId: string; operationId?: string },
    signal: AbortSignal,
  ): Promise<HarnessSnapshot> {
    return this.execution.wait(request, signal)
  }
  @Remote('delegate')
  delegate(request: DelegateRequest, signal: AbortSignal): Promise<HarnessSnapshot> {
    return this.execution.delegateFrom(request.origin, request, signal)
  }
  @Remote('report')
  report(request: ReportRequest): Promise<{ saved: boolean; operationId: string }> {
    return this.execution.submitReport(request.origin, request)
  }
  @Remote('review')
  review(request: ReviewRequest): Promise<HarnessSnapshot> {
    return this.execution.reviewTask(request.origin, request)
  }
  @Remote('result')
  result(
    request: { origin: HarnessOrigin; sessionId: string; operationId?: string; wait?: boolean },
    signal: AbortSignal,
  ): Promise<HarnessSnapshot> {
    return this.execution.resultFor(request.origin, request, signal)
  }
  @Remote('cancel-task')
  cancelTask(request: { origin: HarnessOrigin; sessionId: string }): Promise<HarnessSnapshot> {
    return this.execution.cancelTask(request.origin, request.sessionId)
  }
  @Remote('cancel')
  cancel(request: SessionRequest): Promise<HarnessSnapshot> {
    return this.execution.cancel(request)
  }
  @Remote('answer')
  answer(request: {
    sessionId: string
    approvalId: string
    optionId?: string
  }): Promise<HarnessSnapshot> {
    return this.execution.answer(request)
  }
  @Remote('model-selection')
  modelSelection(request: SessionRequest): Promise<HarnessSelection> {
    return this.execution.modelSelection(request.sessionId)
  }
  @Remote('select-combination')
  selectCombination(request: {
    sessionId: string
    combination: string
  }): Promise<{ kind: string; sessionId: string }> {
    return this.execution.selectCombination(request)
  }
  @Remote('select-effort')
  async selectEffort(request: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<null> {
    await this.execution.invoke('select-effort', request)
    return null
  }
  @Remote('cooperation-settings')
  cooperationSettings(): CooperationSettings {
    return this.execution.cooperationSettings()
  }
  @Remote('save-cooperation-settings')
  saveCooperationSettings(request: CooperationSettings): Promise<CooperationSettings> {
    return this.execution.saveCooperationSettings(request)
  }
  @Remote('tasks')
  tasks(request: { origin: HarnessOrigin }): Promise<HarnessSnapshot[]> {
    return this.execution.tasksFor(request.origin)
  }
  @Remote('task-summaries')
  taskSummaries(request: { origin: HarnessOrigin }): Promise<HarnessTaskSummary[]> {
    return this.execution.taskSummaries(request.origin)
  }
  @Remote('retry-delivery')
  retryDelivery(request: SessionRequest): Promise<HarnessSnapshot> {
    return this.execution.retryDelivery(request.sessionId)
  }
}

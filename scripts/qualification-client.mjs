/** CDP pipe client restricted to the Electron process spawned by qualification. */
import { writeFile, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export class DesktopPipe {
  nextId = 0
  pending = new Map()
  events = []
  constructor(child) {
    this.input = child.stdio[3]
    this.input.on('error', (error) => {
      for (const call of this.pending.values()) {
        clearTimeout(call.timer)
        call.reject(error)
      }
      this.pending.clear()
    })
    let buffered = ''
    child.stdio[4].setEncoding('utf8')
    child.stdio[4].on('data', (chunk) => {
      buffered += chunk
      let boundary
      while ((boundary = buffered.indexOf('\0')) >= 0) {
        const bytes = buffered.slice(0, boundary)
        buffered = buffered.slice(boundary + 1)
        if (!bytes) continue
        const message = JSON.parse(bytes)
        if (!message.id) {
          if (message.method === 'Runtime.exceptionThrown') this.events.push(message)
          continue
        }
        const pending = this.pending.get(message.id)
        if (!pending) continue
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        message.error
          ? pending.reject(new Error(message.error.message))
          : pending.resolve(message.result)
      }
    })
    child.once('exit', () => {
      for (const call of this.pending.values()) {
        clearTimeout(call.timer)
        call.reject(new Error('隔离桌面 CDP 已关闭'))
      }
      this.pending.clear()
    })
  }
  command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('CDP 超时：' + method))
      }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.input.write(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0',
      )
    })
  }
  async evaluate(session, expression) {
    const value = await this.command(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      session,
    )
    if (value.exceptionDetails) throw new Error('Client 执行失败：' + value.exceptionDetails.text)
    return value.result.value
  }
}

export async function verifyDesktopClient(pipe, screenshotPrefix, progress = () => {}) {
  const result = {
    clientMounted: false,
    settingsSlots: [],
    runtimeExceptions: null,
    screenshots: [],
    screenshotFailures: [],
  }
  progress(result)
  await Promise.all(
    ['execution-settings', 'catalog', 'collaboration', 'gateway-models', 'failure'].map((name) =>
      rm(screenshotPrefix + '-' + name + '.png', { force: true }),
    ),
  )
  let session
  // The actual desktop content is a WebContentsView, separate from the native shell.
  for (let attempt = 0; attempt < 90 && !session; attempt++) {
    const { targetInfos } = await pipe.command('Target.getTargets')
    for (const target of targetInfos.filter(
      (target) =>
        target.type === 'page' &&
        (/^https?:\/\/127\.0\.0\.1(?::|\/)/.test(target.url) ||
          target.url.startsWith('dsh-app://app/')),
    )) {
      const attached = await pipe.command('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
      })
      if (
        await pipe.evaluate(
          attached.sessionId,
          'Boolean(document.body && globalThis.__ModuleLoader__)',
        )
      ) {
        session = attached.sessionId
        break
      }
      await pipe.command('Target.detachFromTarget', { sessionId: attached.sessionId })
    }
    if (!session) await delay(500)
  }
  if (!session) throw new Error('未发现官方桌面 Client 页面')
  await pipe.command('Runtime.enable', {}, session)
  await pipe.command('Page.enable', {}, session)
  const errors = () =>
    pipe.events.filter(
      (event) => event.sessionId === session && event.method === 'Runtime.exceptionThrown',
    )
  // The DOM assertions are the qualification signal; screenshots are retained
  // evidence. The hosted Windows runner can stall Page.captureScreenshot (no
  // compositor frame is produced), so capture is best-effort: every miss is
  // recorded in the result instead of discarding an otherwise valid outcome, and
  // a diagnostic capture never replaces the failure that triggered it.
  async function captureScreenshot(name) {
    for (const params of [{ format: 'png' }, { format: 'png', fromSurface: false }]) {
      try {
        const screenshot = await pipe.command('Page.captureScreenshot', params, session)
        const file = screenshotPrefix + '-' + name + '.png'
        await writeFile(file, Buffer.from(screenshot.data, 'base64'))
        return file
      } catch {}
    }
    return null
  }
  async function captureFailureScreenshot() {
    await captureScreenshot('failure')
  }
  async function waitFor(expression, description) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await pipe.evaluate(session, expression)) return
      await delay(250)
    }
    const buttons = await pipe.evaluate(
      session,
      "Array.from(document.querySelectorAll('button,[role=menuitem]')).filter(x=>x.getClientRects().length).map(x=>x.getAttribute('aria-label')||x.textContent?.trim()).filter(Boolean)",
    )
    await captureFailureScreenshot()
    throw new Error(description + '；当前入口：' + JSON.stringify(buttons))
  }
  const clickLabel = (labels) =>
    `(() => { const labels=${JSON.stringify(labels)}; const node=Array.from(document.querySelectorAll('button,[role=menuitem]')).find(x=>x.getClientRects().length && !x.disabled && (labels.includes((x.getAttribute('aria-label')||x.textContent||'').trim()) || x.matches('[role=menuitem]') && labels.some(label => (x.textContent||'').trim().startsWith(label)))); if(!node)return false; node.click(); return true })()`
  await waitFor("document.body.innerText.includes('OPL')", 'OPL Client 未挂载')
  result.clientMounted = true
  // Fresh profile onboarding uses its real button and real setup RPC.
  await pipe.evaluate(session, clickLabel(['稍后登录', 'Sign in later']))
  await waitFor(
    clickLabel([
      '账户菜单',
      'Account menu',
      '账户与设置',
      'Account and settings',
      '更多',
      'More',
      '设置',
      'Settings',
    ]),
    '账户或设置入口未挂载',
  )
  if (!(await pipe.evaluate(session, "Boolean(document.querySelector('[role=dialog] nav'))"))) {
    await waitFor(clickLabel(['设置', 'Settings']), '设置菜单不可见')
  }
  await waitFor("Boolean(document.querySelector('[role=dialog] nav'))", '官方设置容器未打开')
  const panels = [
    { label: ['Harness'], marker: 'execution-settings' },
    { label: ['运行配置'], marker: 'catalog' },
    { label: ['协作与自动化'], marker: 'collaboration' },
    { label: ['模型', 'Models'], marker: 'gateway-models' },
  ]
  const screenshots = result.screenshots
  for (const panel of panels) {
    await waitFor(clickLabel(panel.label), panel.label[0] + ' 插槽未注册')
    await waitFor(
      `(() => {const node=document.querySelector('[data-opl-panel="${panel.marker}"]'); return Boolean(node && node.getClientRects().length && node.innerText.trim() && node.getAttribute('aria-busy') !== 'true' && !node.querySelector('[aria-busy="true"]'))})()`,
      panel.label[0] + ' 未加载',
    )
    const alerts = await pipe.evaluate(
      session,
      `Array.from(document.querySelectorAll('[data-opl-panel="${panel.marker}"] [role=alert]')).filter(x=>x.getClientRects().length).map(x=>x.textContent?.trim()).filter(Boolean)`,
    )
    if (alerts.length) {
      await captureFailureScreenshot()
      throw new Error(panel.label[0] + ' 报错：' + alerts.join('; '))
    }
    const file = await captureScreenshot(panel.marker)
    if (file) screenshots.push(file)
    else result.screenshotFailures.push(panel.marker)
    result.settingsSlots.push(panel.marker)
  }
  result.runtimeExceptions = errors().length
  if (errors().length)
    throw new Error(
      '官方 Client 抛出运行异常：' +
        errors()
          .map((event) => event.params.exceptionDetails.text)
          .join('; '),
    )
  return result
}

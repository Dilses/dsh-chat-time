/**
 * 插件行为冒烟测试：用假的 ctx 驱动真实的 apply() 与 waterfall 监听器，
 * 不依赖 Cordis 运行时。运行： node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply, name } from '../index.js'

/** 最小 ctx 替身：只提供 ctx.on / ctx.get，并记录监听器。 */
function makeCtx(services = {}) {
  const handlers = new Map()
  const ctx = {
    handlers,
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    get(name) {
      return services[name]
    },
  }
  return ctx
}

/** 创建一条用户消息形状的不可变对象。 */
function userMessage(text, sourceKind = 'user') {
  return Object.freeze({
    id: `msg-${text}-${sourceKind}`,
    role: 'user',
    content: Object.freeze([{ type: 'text', text }]),
    source: Object.freeze({ kind: sourceKind }),
  })
}

/** 装配一次 waterfall 调用：返回最终决策。 */
async function run(config, messages, { startsRequestSeries = true } = {}) {
  const ctx = makeCtx()
  apply(ctx, config)
  const handler = ctx.handlers.get('agent/pre-step')
  assert.equal(typeof handler, 'function', 'apply() 应注册 agent/pre-step 监听器')
  const decision = { kind: 'enter', messages, startsRequestSeries }
  return handler({ agent: { id: 'session' }, messages, turn: 1, step: 1 }, async () => decision)
}

const TAG = /^<meta time="(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})">/

// 1. 文本消息：标签拼进首块文本，输出与需求示例一致。
{
  const message = userMessage('你好')
  const result = await run(undefined, [message])
  assert.equal(result.kind, 'enter')
  assert.equal(result.messages.length, 1)
  const text = result.messages[0].content[0].text
  assert.match(text, TAG)
  assert.match(text, /^<meta time="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}">你好$/)
  assert.equal(result.messages[0].content.length, 1, '首块是文本块时不应新开块')
  assert.notEqual(result.messages[0], message, '不得就地修改原消息')
  assert.equal(message.content[0].text, '你好', '原消息内容必须保持不变')
  assert.equal(result.messages[0].id, message.id, '必须保留消息 id')
  assert.equal(result.startsRequestSeries, true, '必须展开并保留 decision 其它字段')
}

// 2. 首块不是文本（图片）：在最前面插入文本块，原块保持引用。
{
  const image = Object.freeze({ type: 'image', attachment: Object.freeze({ id: 'a' }) })
  const message = Object.freeze({ id: 'img', role: 'user', content: Object.freeze([image]), source: Object.freeze({ kind: 'user' }) })
  const result = await run(undefined, [message])
  assert.equal(result.messages[0].content.length, 2)
  assert.match(result.messages[0].content[0].text, TAG)
  assert.equal(result.messages[0].content[1], image, '原内容块应原样保留')
}

// 3. 非用户来源的消息不注入，且保持同一引用。
{
  const relayed = userMessage('插件写入的上下文', 'plugin')
  const result = await run(undefined, [relayed])
  assert.equal(result.messages[0], relayed)
}

// 3b. 父代理派给 subagent 的任务提示以 kind:'user' 投递，因此同样会被打标（README 已写明）。
{
  const taskPrompt = userMessage('子任务：数到三', 'user')
  const result = await run(undefined, [taskPrompt])
  assert.match(result.messages[0].content[0].text, TAG)
}

// 4. 混合数组：只改写用户消息，其余元素引用不变。
{
  const context = Object.freeze({ id: 'ctx', role: 'user', content: Object.freeze([{ type: 'text', text: '<context/>' }]), source: Object.freeze({ kind: 'runtime-context' }) })
  const message = userMessage('第一条')
  const result = await run(undefined, [message, context])
  assert.match(result.messages[0].content[0].text, TAG)
  assert.equal(result.messages[1], context)
}

// 5. 同一步骤的多条用户消息共用一个时间戳。
{
  const first = userMessage('一')
  const second = userMessage('二')
  const result = await run(undefined, [first, second])
  const stamp = (m) => TAG.exec(m.content[0].text)[1]
  assert.equal(stamp(result.messages[0]), stamp(result.messages[1]))
}

// 6. enabled:false 时不注册监听器。
{
  const ctx = makeCtx()
  apply(ctx, { enabled: false })
  assert.equal(ctx.handlers.size, 0)
}

// 7. 自定义模板与占位符替换（含多个占位符）。
{
  const result = await run({ template: '[{time}][{time}]' }, [userMessage('hi')])
  assert.match(result.messages[0].content[0].text, /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\]\[\1\]hi$/)
}

// 8. 显式 timeZone：UTC 输出应等于当前 UTC 时间（容忍分钟边界 90 秒）。
{
  const result = await run({ timeZone: 'UTC' }, [userMessage('utc')])
  const stamp = TAG.exec(result.messages[0].content[0].text)[1]
  const asUtc = Date.parse(`${stamp}:00Z`)
  assert.ok(Number.isFinite(asUtc), '时间戳应可解析')
  assert.ok(Math.abs(asUtc - Date.now()) <= 90_000, 'UTC 时区输出应贴近当前时刻')
}

// 9. 时间获取失败：原样放行，且只告警一次。
{
  const message = userMessage('boom')
  const ctx = makeCtx()
  apply(ctx, undefined)
  const handler = ctx.handlers.get('agent/pre-step')
  const decision = { kind: 'enter', messages: [message], startsRequestSeries: true }
  const next = async () => decision

  const realDate = globalThis.Date
  const warnings = []
  const realWarn = console.warn
  let now = 0
  globalThis.Date = class extends realDate {
    constructor(...args) {
      if (args.length === 0) throw new Error('clock unavailable')
      super(...args)
    }

    static now() { return realDate.now() }
  }
  console.warn = (...args) => warnings.push(args)
  try {
    const first = await handler({}, next)
    const second = await handler({}, next)
    assert.equal(first, decision, '时间失败时必须返回原决策')
    assert.equal(second, decision)
    assert.equal(warnings.length, 1, '告警只应出现一次')
    assert.equal(now, 0)
  } finally {
    globalThis.Date = realDate
    console.warn = realWarn
  }
}

// 10. 非 enter 决策（reject）原样返回。
{
  const ctx = makeCtx()
  apply(ctx, undefined)
  const handler = ctx.handlers.get('agent/pre-step')
  const rejection = { kind: 'reject' }
  assert.equal(await handler({}, async () => rejection), rejection)
}

// 11. 非法配置在加载阶段抛错。
{
  assert.throws(() => apply(makeCtx(), { template: 'no placeholder' }), /config\.template/)
  assert.throws(() => apply(makeCtx(), { enabled: 'yes' }), /config\.enabled/)
  assert.throws(() => apply(makeCtx(), { timeZone: 'Mars/Olympus' }), /config\.timeZone/)
  assert.throws(() => apply(makeCtx(), { sourceKinds: [] }), /config\.sourceKinds/)
  assert.throws(() => apply(makeCtx(), { stripTitleTag: 'no' }), /config\.stripTitleTag/)
  assert.throws(() => apply(makeCtx(), 'nope'), /config must be a mapping/)
}

/** 等一个宏任务，让 queueMicrotask 里排队的标题清理跑完。 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

// 12. 标题清洗：带标签的标题被追加一条干净 revision，用户重命名不动。
{
  const appended = []
  const session = { append: (type, data) => { appended.push({ type, data }) } }
  const ctx = makeCtx()
  apply(ctx, undefined)
  const onEvent = ctx.handlers.get('session/event')
  assert.equal(typeof onEvent, 'function', 'apply() 应注册 session/event 监听器')

  const tag = '<meta time="2026-11-23T14:35">'
  onEvent(session, {
    type: 'session/title',
    data: { title: `${tag}修复插件问题`, messageSeqs: [3], source: { kind: 'fallback' } },
  })
  await flush()
  assert.equal(appended.length, 1)
  assert.equal(appended[0].type, 'session/title')
  assert.equal(appended[0].data.title, '修复插件问题')
  assert.deepEqual([...appended[0].data.messageSeqs], [3])
  assert.equal(appended[0].data.source.kind, 'fallback')

  // 已清洗的标题不会再次追加（否则会自我循环）。
  onEvent(session, { type: 'session/title', data: { title: '修复插件问题', messageSeqs: [3], source: { kind: 'fallback' } } })
  await flush()
  assert.equal(appended.length, 1)

  // 用户主动重命名（source.kind === 'user'）即使带标签也不干预。
  onEvent(session, { type: 'session/title', data: { title: `${tag}我起的名字`, messageSeqs: [3], source: { kind: 'user' } } })
  await flush()
  assert.equal(appended.length, 1)

  // 其他事件类型直接忽略。
  onEvent(session, { type: 'turn/start', data: { turn: 1 } })
  await flush()
  assert.equal(appended.length, 1)

  // stripTitleTag:false 时完全不注册该监听器。
  const offCtx = makeCtx()
  apply(offCtx, { stripTitleTag: false })
  assert.equal(offCtx.handlers.has('session/event'), false)
  assert.equal(offCtx.handlers.has('agent/pre-step'), true)
}

// 12b. 旧会话补清洗：会话打开时按当前标题补一次。
{
  const appended = []
  const session = { id: 'session', append: (type, data) => { appended.push({ type, data }) } }
  const withTag = { title: '<meta time="2026-11-23T13:52">早先的消息', messageSeqs: [7], source: { kind: 'fallback' } }
  const ctx = makeCtx({ sessionTitle: { get: () => withTag } })
  apply(ctx, undefined)
  const onCreated = ctx.handlers.get('session/created')
  assert.equal(typeof onCreated, 'function')
  onCreated(session)
  await flush()
  assert.equal(appended.length, 1)
  assert.equal(appended[0].data.title, '早先的消息')
  assert.deepEqual([...appended[0].data.messageSeqs], [7])

  // 会话标题服务不可用时（非 Web profile）安静跳过。
  const bareCtx = makeCtx()
  apply(bareCtx, undefined)
  bareCtx.handlers.get('session/created')(session)
  await flush()
  assert.equal(appended.length, 1)
}

// 13. 浏览器侧 user-text 规则：隐藏开头的标签，普通文本与手写伪标签不受影响。
{
  const loaded = []
  globalThis.window = { __ModuleLoader__: { load: module => loaded.push(module) } }
  await import('../client.js')
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-chat-time')

  const plugin = loaded[0].factory()
  assert.deepEqual(plugin.inject, ['uiConversation'])
  const rules = []
  plugin.apply({ uiConversation: { userText: { register: rule => { rules.push(rule); return () => {} } } } })
  assert.equal(rules.length, 1)
  const rule = rules[0]

  const text = '<meta time="2026-11-23T14:35">你好'
  const node = rule.match(text, 0)
  assert.equal(node.id, 'text')
  assert.equal(node.start, 0)
  assert.equal(node.end, '<meta time="2026-11-23T14:35">'.length)
  assert.equal(node.data.display, '', 'display 为空串才能隐藏标签')
  assert.equal(node.data.text, '<meta time="2026-11-23T14:35">')
  assert.equal(text.slice(node.end), '你好', '隐藏后剩余文本必须是用户原文')

  // 自定义 template 只要保持“标签 + ISO 时间”形状，同样被隐藏。
  assert.equal(rule.match('<when at="2026-11-23T14:35">hi', 0).end, '<when at="2026-11-23T14:35">'.length)
  // 普通消息、手写不带 ISO 时间的伪标签、已越过的标签都不认领。
  assert.equal(rule.match('普通消息', 0), undefined)
  assert.equal(rule.match('<meta time="abc">x', 0), undefined)
  assert.equal(rule.match(text, node.end), undefined)
  assert.equal(rule.match('', 0), undefined)
}

// 14. 包名一致性：Loader 行、客户端 bundle id、package.json name 必须相同。
// 否则 DSH 的 client-modules 扫描按行名匹配 package.json name 时会跳过本包，
// 浏览器半不会进入启动图（气泡里的标签就不会被隐藏）。
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(patch.includes(`name: '${pkg.name}'`), 'cordis.patch.yml 的行名必须等于 package.json name')
  assert.ok(client.includes(`id: '${pkg.name}'`), 'client.js 的 bundle id 必须等于 package.json name')
}

console.log(`ok — ${name}：14 组用例全部通过`)

/**
 * dsh-chat-time —— 在每条用户消息最前面注入“当前本地时间”元数据标签。
 *
 * 设计要点：
 * 1. 触发点是 `agent/pre-step` 瀑布事件：agent loop 在把消息并入会话日志、发起模型
 *    请求之前调用它一次。我们只在 kind === 'enter' 的决策上追加标签，因此带标签的
 *    消息才会被 append 进 durable log——同一步骤的后续请求、会话重放和 fork 看到的
 *    都是同一份带标签的内容。轨迹页读的是原始事件，因此只有在那里能看到标签。
 * 2. 我们从不修改 claim 到的原始 message 对象，只返回改写后的副本；一次 pre-step
 *    调用中每条消息只加一次标签。
 * 3. 时间直接读取 Host 进程的本地时间分量（getFullYear/getHours...），不做任何 UTC
 *    换算；也可通过 timeZone 显式指定 IANA 时区。
 * 4. 时间获取或格式化失败时不注入：原样放行原始决策，绝不让注入错误打断对话。
 * 5. 前端隐藏：聊天气泡由 client.js 的 user-text 规则隐藏，会话标题由这里的
 *    `session/title` 清洗逻辑隐藏；两者都只影响显示，不改写已被模型看到的消息。
 */

/** Cordis 函数式插件的名字。 */
export const name = 'chat-time'

/** 默认标签模板；`{time}` 会被替换为格式化后的时间。 */
const DEFAULT_TEMPLATE = '<meta time="{time}">'

/** 默认只处理真正的用户消息（GUI/CLI 提交的 source.kind 为 'user'）。 */
const DEFAULT_SOURCE_KINDS = Object.freeze(['user'])

/**
 * 两位数字补零。
 * @param {number} value 非负整数。
 * @returns {string} 至少两位的十进制字符串。
 */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * 把时间格式化为“分钟精度的 ISO 8601 本地时间”，不含时区偏移，例如 2026-11-23T14:35。
 *
 * - 不传 timeZone：直接读取 Date 的本地时间分量，结果就是 Host 的系统本地时间。
 * - 传 timeZone：用 Intl 按指定 IANA 时区取各分量（固定 h23，避免午夜出现 "24"）。
 *
 * @param {Date} date 取样时刻。
 * @param {string | undefined} timeZone 可选的 IANA 时区名。
 * @returns {string} 形如 `YYYY-MM-DDTHH:mm` 的字符串。
 * @throws {Error} 当 Intl 无法给出完整时间分量时（极少见的运行时异常）。
 */
function isoMinute(date, timeZone) {
  if (timeZone === undefined) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
      + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  const hour = part('hour')
  const minute = part('minute')
  if (year === undefined || month === undefined || day === undefined
    || hour === undefined || minute === undefined) {
    throw new Error(`[chat-time] cannot format a local time for time zone "${timeZone}"`)
  }
  // 某些 ICU 版本在 h23/h24 边界会给出 "24"，取模回绕到 00。
  return `${year}-${month}-${day}T${pad2(Number(hour) % 24)}:${minute}`
}

/**
 * 用模板生成最终标签文本。用 split/join 而不是 String#replace，避免替换串里的
 * `$` 序列被当作替换模式解释。
 * @param {string} template 含 `{time}` 占位符的模板。
 * @param {string} time 已格式化的时间串。
 * @returns {string} 标签文本。
 */
function renderTag(template, time) {
  return template.split('{time}').join(time)
}

/** 转义正则字面量，供把模板编译成匹配器使用。 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * 由模板推导出“本插件注入的标签”的匹配器。
 *
 * 只匹配模板中 `{time}` 位置为分钟精度 ISO 时间的形式，因此不会吞掉用户自己写的
 * 文本（例如手写的 `<meta time="abc">` 不会被当作插件标签）。
 *
 * @param {string} template 含 `{time}` 占位符的模板。
 * @returns {RegExp} 全局匹配器。
 */
function tagPattern(template) {
  const source = template.split('{time}')
    .map(part => escapeRegExp(part))
    .join('\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}')
  return new RegExp(source, 'gu')
}

/**
 * 把标签拼到消息内容最前面。
 *
 * 首块是文本块时与它合并，产出与需求示例完全一致的单块文本；首块是图片/文件时则在
 * 最前面插入一个新的文本块，保留原有块不动。整个过程不修改传入的数组或块对象。
 *
 * @param {ReadonlyArray<{ type: string, text?: string }>} content 原始内容块。
 * @param {string} tag 要前置的标签文本。
 * @returns {ReadonlyArray<object>} 新的内容块数组。
 */
function withTag(content, tag) {
  const [first, ...rest] = content
  if (first !== undefined && first.type === 'text') {
    return [{ ...first, text: tag + String(first.text ?? '') }, ...rest]
  }
  return [{ type: 'text', text: tag }, ...content]
}

/**
 * 校验并补全插件配置。配置来自 cordis.patch.yml 中本插件行的 `config`；纯 JS 插件
 * 没有 Schemastery 依赖，所以在这里做显式校验并在非法时抛出可读的错误（插件激活
 * 会失败并给出原因，而不是带着坏配置默默运行）。
 *
 * @param {unknown} raw 行上的原始 config。
 * @returns {{ enabled: boolean, template: string, timeZone: string | undefined, sourceKinds: Set<string>, stripTitleTag: boolean }}
 * @throws {TypeError} 配置字段非法时。
 */
function readConfig(raw) {
  const input = raw === undefined || raw === null ? {} : raw
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('[chat-time] config must be a mapping')
  }

  const enabled = input.enabled ?? true
  if (typeof enabled !== 'boolean') {
    throw new TypeError('[chat-time] config.enabled must be a boolean')
  }

  const template = input.template ?? DEFAULT_TEMPLATE
  if (typeof template !== 'string' || !template.includes('{time}')) {
    throw new TypeError('[chat-time] config.template must be a string containing the {time} placeholder')
  }

  const timeZone = input.timeZone
  if (timeZone !== undefined && timeZone !== null) {
    if (typeof timeZone !== 'string' || timeZone.length === 0) {
      throw new TypeError('[chat-time] config.timeZone must be an IANA time zone name')
    }
    try {
      // 这里只做一次“能否解析”的探测；非法时区会在格式化时才抛 RangeError。
      new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    } catch {
      throw new TypeError(`[chat-time] config.timeZone is not a valid IANA time zone: ${timeZone}`)
    }
  }

  const sourceKinds = input.sourceKinds ?? DEFAULT_SOURCE_KINDS
  if (!Array.isArray(sourceKinds) || sourceKinds.length === 0
    || sourceKinds.some((kind) => typeof kind !== 'string' || kind.length === 0)) {
    throw new TypeError('[chat-time] config.sourceKinds must be a non-empty array of message source kinds')
  }

  const stripTitleTag = input.stripTitleTag ?? true
  if (typeof stripTitleTag !== 'boolean') {
    throw new TypeError('[chat-time] config.stripTitleTag must be a boolean')
  }

  return {
    enabled,
    template,
    timeZone: typeof timeZone === 'string' ? timeZone : undefined,
    sourceKinds: new Set(sourceKinds),
    stripTitleTag,
  }
}

/**
 * 插件入口：注册 `agent/pre-step` 瀑布监听器。
 *
 * 监听器注册在本插件自己的 context 上，插件卸载或热替换时由 Cordis 自动注销。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件 context。
 * @param {unknown} config 行配置。
 */
export function apply(ctx, config) {
  const settings = readConfig(config)
  if (!settings.enabled) return

  /** 运行期失败只告警一次，避免每条消息刷日志。 */
  let warned = false
  const warnOnce = (reason, error) => {
    if (warned) return
    warned = true
    console.warn(`[chat-time] skipped injection because ${reason}:`, error)
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    // 先让下游（以及默认实现，它会追加 runtime context 消息）给出决策，再改写。
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    const messages = decision.messages
    if (messages === undefined || messages.length === 0) return decision

    let tag
    try {
      // 一个步骤只取一次时间：同一步骤内并入的多条用户消息共用一个时间戳。
      tag = renderTag(settings.template, isoMinute(new Date(), settings.timeZone))
    } catch (error) {
      // 时间获取失败 → 不注入，原样放行。
      warnOnce('the local time could not be read', error)
      return decision
    }

    let tagged
    try {
      tagged = messages.map((message) => (
        settings.sourceKinds.has(message?.source?.kind)
          ? { ...message, content: withTag(message.content, tag) }
          : message
      ))
    } catch (error) {
      // 改写本身出错（消息形状异常等）→ 同样不注入，绝不打断本轮对话。
      warnOnce('a message could not be rewritten', error)
      return decision
    }

    // 没有任何消息被改写时保持原决策对象，避免无意义的新引用。
    if (!tagged.some((message, index) => message !== messages[index])) return decision

    // 必须展开 decision：startsRequestSeries 等字段要原样交回 agent loop。
    return { ...decision, messages: tagged }
  })

  if (!settings.stripTitleTag) return

  // 会话标题（侧边栏、会话头部、文档标题）取自第一条用户消息原文，因此会带上标签。
  // 这里在标题事件提交后追加一条清洗过的 revision：只改标题，不动消息本身，
  // 也不影响轨迹页（它渲染的是原始消息事件）。自动标题 provider 稍后仍会正常覆盖。
  const titleTag = tagPattern(settings.template)

  /** 追加一条去掉标签的标题 revision；无需清洗时不动。 */
  const cleanTitle = (session, source) => {
    if (source?.source?.kind === 'user') return // 用户主动重命名：不做干预
    const title = source?.title
    if (typeof title !== 'string') return
    const cleaned = title.replace(titleTag, ' ').replace(/\s+/gu, ' ').trim()
    if (cleaned.length === 0 || cleaned === title) return
    queueMicrotask(() => {
      try {
        session.append('session/title', {
          title: cleaned,
          messageSeqs: [...source.messageSeqs],
          source: { kind: 'fallback' },
        })
      } catch (error) {
        // 会话可能已关闭：清洗失败不影响会话本身，告警一次即可。
        warnOnce('a session title could not be cleaned', error)
      }
    })
  }

  // 新产生的标题（回退标题、模型标题）就地清洗。
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'session/title') cleanTitle(session, event.data)
  })

  // 早于本插件产生的旧标题：会话被打开时补清洗一次。
  ctx.on('session/created', (session) => {
    const snapshot = ctx.get('sessionTitle')?.get(session)
    if (snapshot !== undefined) cleanTitle(session, snapshot)
  })
}

/**
 * 油猴脚本的 DOM 层验证：用 jsdom 复刻三种界面结构，确认
 * 1) 会话导航预览里的标签被剥掉；
 * 2) 用户气泡里的标签被剥掉（没装浏览器半时的兜底）；
 * 3) 运行轨迹里的原文保持不动；
 * 4) 用户自己写的不带 ISO 时间的伪标签、普通消息不受影响。
 * 运行： node test/userscript.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// jsdom 不随插件发布（它只是测试依赖），优先从当前工程解析，其次从本机的 DSH 检出解析。
// 找不到就跳过，避免在没有 DSH 检出的机器上让测试变成失败。
function loadJsdom() {
  const bases = [
    import.meta.url,
    process.env.DSH_INSTALL_DIR === undefined ? undefined : `${process.env.DSH_INSTALL_DIR}/package.json`,
    'D:/Repo/dsh/package.json',
  ]
  for (const base of bases) {
    if (base === undefined) continue
    try {
      return createRequire(base)('jsdom')
    } catch {
      // 换下一个候选位置。
    }
  }
  return undefined
}

const jsdom = loadJsdom()
if (jsdom === undefined) {
  console.log('skip — 找不到 jsdom（可先 pnpm add -D jsdom，或在 DSH 检出里运行），跳过油猴脚本 DOM 测试')
  process.exit(0)
}
const { JSDOM } = jsdom

const source = await readFile(new URL('../userscript/dsh-chat-time-hide.user.js', import.meta.url), 'utf8')

const TAG = '<meta time="2026-11-23T14:35">'
// 真实界面里标签是 React 写入的文本节点；这里用 HTML 字符串构造 DOM，
// 所以必须转义成实体，否则 <meta> 会被解析成元素而不是文本。
const TAG_HTML = '&lt;meta time="2026-11-23T14:35"&gt;'

const dom = new JSDOM(`<!doctype html><html><body>
  <nav class="TurnNavigator_rail__a1b2">
    <div role="tooltip" class="TurnNavigator_preview__a1b2">
      <div class="TurnNavigator_previewPrompt__a1b2">${TAG_HTML}你知道现在的时间吗</div>
      <div class="TurnNavigator_previewResponse__a1b2">知道，2026 年 11 月 23 日 14:12……</div>
    </div>
  </nav>
  <div id="bubble-plain" data-message-bubble=""><span class="UserText_root__c3d4">${TAG_HTML}气泡里的消息</span></div>
  <section class="TrajectoryTable_root__e5f6">
    <pre class="TrajectoryTable_markdownPreview__e5f6">${TAG_HTML}轨迹里的原文</pre>
    <div id="bubble-trajectory" data-message-bubble=""><span>${TAG_HTML}轨迹里万一也用气泡</span></div>
  </section>
  <div id="bubble-normal" data-message-bubble=""><span>普通消息，没有标签</span></div>
  <div id="bubble-pseudo" data-message-bubble=""><span>&lt;meta time="abc"&gt;用户手写的伪标签</span></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true })

const { window } = dom
window.eval(source)

/** 等一帧 + 宏任务，让 MutationObserver 与 rAF/setTimeout 批处理跑完。 */
const settle = () => new Promise(resolve => window.setTimeout(resolve, 80))

await settle()

const text = selector => window.document.querySelector(selector).textContent

// 1. 会话导航预览：标签被剥掉，正文保留。
assert.equal(text('.TurnNavigator_previewPrompt__a1b2'), '你知道现在的时间吗')
assert.equal(text('.TurnNavigator_previewResponse__a1b2'), '知道，2026 年 11 月 23 日 14:12……')

// 2. 气泡：首屏清理生效。
assert.equal(text('[data-message-bubble] > .UserText_root__c3d4'), '气泡里的消息')

// 3. 轨迹页原样（含“万一也用气泡”的兜底排除）。
assert.equal(text('.TrajectoryTable_markdownPreview__e5f6'), `${TAG}轨迹里的原文`)
assert.equal(text('#bubble-trajectory'), `${TAG}轨迹里万一也用气泡`)

// 4. 普通消息与不带 ISO 时间的伪标签都不动。
assert.equal(text('#bubble-normal'), '普通消息，没有标签')
assert.equal(text('#bubble-pseudo'), '<meta time="abc">用户手写的伪标签')

// 5. 悬浮预览是后挂载的：动态插入后也应被清理。
const late = window.document.createElement('div')
late.className = 'TurnNavigator_previewPrompt__a1b2'
late.textContent = '<meta time="2026-11-23T15:02">后来的预览'
window.document.querySelector('.TurnNavigator_preview__a1b2').append(late)
await settle()
assert.equal(late.textContent, '后来的预览', '动态插入的预览也要清理')

// 6. 已清理的文本再次变更（React 重渲染）后仍会被处理。
late.textContent = '<meta time="2026-11-23T15:03">重渲染后'
await settle()
assert.equal(late.textContent, '重渲染后')

console.log('ok — 油猴脚本：6 组 DOM 断言全部通过')
dom.window.close()

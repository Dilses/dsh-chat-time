// ==UserScript==
// @name         DSH · 隐藏聊天时间标签
// @namespace    dsh-chat-time
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/Dilses/dsh-chat-time/refs/heads/main/userscript/dsh-chat-time.user.js
// @downloadURL  https://raw.githubusercontent.com/Dilses/dsh-chat-time/refs/heads/main/userscript/dsh-chat-time.user.js
// @description  隐藏 DSH 界面里的 <meta time="..."> 注入标签（会话导航预览、用户消息气泡）；运行轨迹页保持原文
// @author       dsh-chat-time
// @match        http://127.0.0.1:3080/*
// @match        http://localhost:3080/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * 背景：dsh-chat-time 插件把 `<meta time="2026-11-23T14:35">` 拼进用户消息原文，
 * 模型和会话日志需要它，运行轨迹页也靠它核对“模型到底收到了什么”。
 * 但有几处界面（会话导航的悬浮预览、以及没装浏览器半时的气泡）直接把原文当字符串渲染，
 * 没有插件扩展点，所以这里在 DOM 层补一刀：只改显示，不动任何数据。
 *
 * 目标范围刻意收得很窄，避免误伤运行轨迹页：
 *   - previewPrompt               会话导航（TurnNavigator）预览的提示行；
 *   - [role=tooltip][class*=preview]  同一张预览卡片的兜底匹配；
 *   - [data-message-bubble]       用户消息气泡（插件已处理，这里只是兜底）。
 * 轨迹页用的是 markdownPreview / jsonPreview 之类类名，且没有 data-message-bubble，不会命中。
 */
(function () {
  'use strict'

  /** 与插件注入的标签同形：开头一个标签，且标签内含分钟精度 ISO 时间。 */
  const LEADING_TAG = /^[ \t]*<[A-Za-z][\w:.-]*\b[^<>]*?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[^<>]*?>[ \t]*/

  /** 需要清理的容器。 */
  const SELECTORS = [
    '[class*="previewPrompt"]',
    '[role="tooltip"][class*="preview"]',
    '[data-message-bubble]',
  ].join(',')

  /** 兜底排除：类名或标记里带 trajectory 的区域保留原文。 */
  const EXCLUDE = /trajectory/i

  /** 读取元素的类名/标记，兼容 SVG 的 SVGAnimatedString。 */
  function marksOf(element) {
    return `${element.getAttribute('class') ?? ''} ${element.getAttribute('data-testid') ?? ''}`
  }

  /**
   * 容器是否落在运行轨迹区域内——那里必须保留原文，一律不动。
   * @param {Element} box 目标容器。
   * @returns {boolean} 是否需要跳过。
   */
  function excluded(box) {
    for (let up = box; up !== null; up = up.parentElement) {
      if (EXCLUDE.test(marksOf(up))) return true
    }
    return false
  }

  /**
   * 找到需要清理的容器；不在范围内、或在轨迹页内时返回 null。
   * @param {Node} node 发生变动的节点。
   * @returns {Element | null} 需要清理的容器。
   */
  function containerOf(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (element === null) return null
    const box = element.closest(SELECTORS)
    if (box === null || excluded(box)) return null
    return box
  }

  /**
   * 把容器内以标签开头的文本节点改写成去掉标签的形式。
   * 只动文本节点的显示值，不改 React 状态、不发请求。
   * @param {Element} box 目标容器。
   */
  function strip(box) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.nodeValue
      if (text === null || text === '' || !LEADING_TAG.test(text)) continue
      node.nodeValue = text.replace(LEADING_TAG, '')
    }
  }

  /** 同一帧内合并多次改动的待处理容器。 */
  const pending = new Set()
  let frame = 0

  function flush() {
    frame = 0
    const boxes = [...pending]
    pending.clear()
    for (const box of boxes) {
      if (!box.isConnected) continue
      try {
        strip(box)
      } catch (error) {
        // 单个容器出错不影响其它容器，也不该刷屏。
        console.warn('[dsh-chat-time] 清理预览文本失败：', error)
      }
    }
  }

  function schedule() {
    if (frame !== 0) return
    frame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(flush)
      : setTimeout(flush, 16)
  }

  /**
   * 记录一次变动涉及的容器。
   * @param {Node} node 变动节点。
   */
  function queue(node) {
    const box = containerOf(node)
    if (box === null) return
    pending.add(box)
    schedule()
  }

  // 悬浮预览是 React 在 hover 时才挂载的，所以既要首屏扫一遍，也要监听后续变化。
  try {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          queue(record.target)
          continue
        }
        for (const node of record.addedNodes) queue(node)
        queue(record.target)
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  } catch (error) {
    console.warn('[dsh-chat-time] 无法监听 DOM 变化，仅做一次首屏清理：', error)
  }

  try {
    // 首屏已有节点同样要走轨迹排除，不能直接 strip。
    document.querySelectorAll(SELECTORS).forEach((box) => {
      if (!excluded(box)) strip(box)
    })
  } catch (error) {
    console.warn('[dsh-chat-time] 首屏清理失败：', error)
  }
})()

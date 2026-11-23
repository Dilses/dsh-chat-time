/**
 * dsh-chat-time 的浏览器侧：把用户消息开头的本地时间标签从显示中隐藏。
 *
 * 宿主侧把标签写进消息本身（模型必须看到，轨迹页也必须显示原始内容），所以这里只做
 * 显示层裁剪：注册一条 `user-text` 规则，把消息开头那段标签声明成一个 `text` 节点，
 * 并把它的 `display` 置空。原始字符串、UTF-16 坐标和会话日志都不变。
 *
 * 识别形状是“开头一个标签、且标签内含有分钟精度 ISO 时间”，例如
 * `<meta time="2026-11-23T14:35">`。这样只认插件自己注入过的标签，不会误吞用户
 * 手写的普通文字；自定义 template 时只要保持“标签 + ISO 时间”的形状也照样生效。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-chat-time',
  factory() {
    /** 开头标签 + ISO 分钟时间；前后空白一并归入被隐藏的区间。 */
    const LEADING_TAG = /^[ \t]*<[A-Za-z][\w:.-]*\b[^<>]*?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[^<>]*?>[ \t]*/u

    return {
      inject: ['uiConversation'],
      apply(ctx) {
        ctx.uiConversation.userText.register({
          id: 'chatTimeMeta',
          // 比会话/@ 引用规则更早，确保从位置 0 开始的标签优先被认领。
          order: 5,
          match(text, from) {
            const matched = LEADING_TAG.exec(text)
            if (matched === null) return undefined
            const end = matched[0].length
            // 已经越过标签（被更靠前的规则消费过）就不再认领。
            if (from >= end) return undefined
            return {
              id: 'text',
              start: from,
              end,
              data: { text: text.slice(from, end), display: '' },
            }
          },
        })
      },
    }
  },
})

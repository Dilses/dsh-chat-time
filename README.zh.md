# 聊天时间标签（dsh-chat-time）

为每条用户消息注入一个包含**当前本地时间**的元数据标签，让模型知道这句话是什么时候说的；
界面上默认不显示这个标签，只有“运行轨迹”页能看到原文。

```text
模型与会话日志得到的消息：<meta time="2026-11-23T14:35">你好
聊天气泡里显示的内容：    你好
```

## 生效范围

- 处理所有 `source.kind === 'user'` 的消息：你在 Web GUI / CLI 提交的聊天消息，也包括父代理派给
  subagent 的任务提示（DSH 同样以 `kind: 'user'` 投递），以及通过 API 提交的用户消息。
- 跳过其它来源：`agent.inject()` 注入的上下文、runtime-context 快照、插件写入的消息。
  需要扩大或收窄范围时改 `sourceKinds`。
- 每个步骤只取一次时间：同一步骤内被合并的多条用户消息共用同一个时间戳。

## 触发时机与持久化

拦截点是 `agent/pre-step` 瀑布事件，它在消息被 claim 之后、写入会话日志与发起模型请求之前触发：

1. 只改写 `kind === 'enter'` 的决策，并展开原决策以保留 `startsRequestSeries` 等字段。
2. 改写后的消息才会被 append 进会话日志，因此**标签是持久化的**：同一步骤的后续请求、
   会话重放、fork 出来的新会话看到的都是同一份带标签内容。
3. 插件不修改 claim 到的原始 message 对象，只返回改写后的副本；一次 pre-step 调用中每条消息
   只加一次标签。

## 前端如何隐藏

标签只存在于消息原文里，显示层是另外裁剪的，两者互不影响：

- **聊天气泡 / 队列预览**：`client.js` 注册一条 `userText` 规则，把消息开头那段“标签 + 分钟时间”
  声明成一个 `display` 为空串的文本节点。原始字符串、UTF-16 坐标和日志都不变，所以复制消息仍
  拿到带标签的完整原文。
- **会话标题（侧边栏、会话头部、文档标题）**：标题取自第一条用户消息原文，Host 侧会在标题事件
  提交后追加一条去掉标签的 revision（`source.kind: 'fallback'`）。模型生成的自动标题稍后仍会
  正常覆盖它；用户主动重命名（`source.kind: 'user'`）不会被改动。早于插件产生的旧标题，会在
  该会话被打开时补清洗一次。
- **“运行轨迹”页**：直接渲染会话事件原文，因此**标签在那里可见**，这也是核对“模型到底收到了
  什么”的唯一入口。

隐藏规则只认“开头一个标签、且标签内含 `YYYY-MM-DDTHH:mm`”的形状，所以不会误吞普通文字。

### 会话导航预览：用油猴脚本兜底

“会话导航”（对话右侧那排回合刻度）的悬浮预览，以及会话搜索的正文摘录，是 DSH 在 Host 投影
（`turnOutline`）和客户端快照（`turn-navigation.ts`）里**提前算好的字符串**，不走渲染路径，
也没有插件扩展点——插件改不到它们。管理目录里附带一个 Tampermonkey 脚本补上这一块：

1. 安装 Tampermonkey（Violentmonkey 亦可）。
2. 新建脚本，把 [`userscript/dsh-chat-time-hide.user.js`](userscript/dsh-chat-time-hide.user.js) 的内容贴进去保存。
3. 刷新 DSH 页面。

脚本只裁剪显示：命中会话导航预览（`previewPrompt` / `role=tooltip` 的预览卡片）与用户气泡
（`data-message-bubble`，作为插件未加载时的兜底）后，去掉文本节点开头的标签；运行轨迹页的类名
（`markdownPreview` / `jsonPreview` 等）不在范围内，原文完整保留。`@match` 默认是
`http://127.0.0.1:3080/*` 与 `http://localhost:3080/*`，端口不同请自行修改。

> **Agent 注意**：这是主人浏览器里的持久改动。安装前必须先征得主人明确同意，细则与询问话术见
> [INSTALL.zh.md](INSTALL.zh.md) 的「Agent 必读」。

## 配置项

插件本身**不读取包内**的 `cordis.patch.yml` 作为可改配置：Host 只监听 profile 补丁层与 home 补丁层。
要改配置，请写到 profile 目录的 `cordis.patch.yml`（本机为 `D:\.dsh\profiles\chat\cordis.patch.yml`）
里，用行 id `chat-time` 覆盖：

```yaml
- id: chat-time
  name: '@local/dsh-chat-time'
  config:
    template: '<meta time="{time}">'
    # enabled: false
    # stripTitleTag: false
    # timeZone: Asia/Shanghai
```

覆盖会**整体替换**该行的 config；省略的字段回落到下面的默认值。保存后 Host 会重新加载插件；
涉及 `client.js` 或 `dsh.client` 清单的改动需要重启一次 DSH 才会作用到浏览器。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 设为 `false` 时插件不注册任何监听器，等同于关闭。 |
| `template` | string | `<meta time="{time}">` | 标签模板，必须包含 `{time}`；可改成任意包裹文本。 |
| `timeZone` | string | Host 进程本地时区 | 可选的 IANA 时区名（如 `Asia/Shanghai`）。默认直接使用 Host 的系统本地时间，不做 UTC 换算。 |
| `sourceKinds` | string[] | `["user"]` | 需要注入的消息来源种类白名单（对应 `message.source.kind`）。 |
| `stripTitleTag` | boolean | `true` | 是否清洗会话标题里的标签。设为 `false` 时标题保持原样（侧边栏会显示标签）。 |

字段类型非法、模板缺少 `{time}`、时区名无法解析时，插件在加载阶段直接报错并说明原因，而不是带着
坏配置静默运行。

## 失败处理

读取或格式化时间失败时**不注入**：原样返回原始决策，消息照常发送，只在 Host 日志里告警一次。
改写消息、清洗标题本身出错时同样原样放行，错误不会冒泡到 agent loop，因此不会中断对话。

## 时间格式

`YYYY-MM-DDTHH:mm`，ISO 8601 分钟精度，不带时区偏移。日期分量取自本地时间，`getHours()` 得到
几点就是几点，不受 UTC 换算影响。

## 已知限制

- 时间取的是**标签生成时刻**（消息进入步骤时），不是按发送键的时刻。消息在 agent 忙碌时排队，
  二者会相差排队时长。
- 时间来自 **Host 进程的本地时区**。Host 跑在与你不同时区的服务器上时，请显式设置 `timeZone`。
- 把 `template` 改成不含“标签 + ISO 时间”形状的纯文本（例如 `[{time}]`）时，前端隐藏规则认不出它，
  气泡与标题会重新显示这段前缀。
- 会话搜索结果的正文摘录仍来自原始内容，因此包含标签（油猴脚本目前不处理这块）。
- 复制消息得到的文本也来自原始内容，保留标签。
- 油猴脚本依赖 DSH 的 CSS Modules 类名（`previewPrompt`）与 `data-message-bubble` 属性；DSH 改版后如果这两处换了名字，需要同步调整脚本里的选择器。
- 消息首块不是文本（以图片开头）时，会在最前面插入一个只含标签的文本块，原有内容块原样保留；
  空内容消息由 GUI 拦截，不会到这里。
- 标签写入后不可撤回：已产生的消息不会被改写，关闭插件只影响之后的消息；已提交的旧标题可用
  `stripTitleTag` 在下次打开会话时补清洗。

## 安装与卸载

完整步骤（含给其他 Agent 的安装规程，以及“装油猴脚本前必须先问主人”的硬性规则）见 [INSTALL.zh.md](INSTALL.zh.md)。

- 安装：**Plugins** → **Add plugin** 选择本目录（或由 `plugin_manager` `install_bundle` 安装）。安装后刷新页面，
  让浏览器加载 `client.js`。
- 卸载：在 **Plugins** 里移除该 bundle。插件不写自有存储，移除后无残留。

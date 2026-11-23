# 安装指南（人类 / Agent）

`dsh-chat-time` 由**两部分**组成，装法不同、风险不同：

| 部分 | 作用 | 必需性 | 装在哪 |
| --- | --- | --- | --- |
| **核心插件**（[index.js](index.js) + [client.js](client.js)） | 给用户消息注入本地时间标签；隐藏气泡、队列预览、会话标题里的标签 | 必需 | DSH 的 profile（服务端 + 浏览器） |
| **油猴脚本**（[userscript/dsh-chat-time-hide.user.js](userscript/dsh-chat-time-hide.user.js)） | 隐藏“会话导航”悬浮预览里的标签 | 可选 | 主人浏览器的 Tampermonkey |

> 运行轨迹页（“轨迹”标签）在两种情况下都保留原始内容，这是设计如此，不是没装好。

---

## ⛔ Agent 必读：装油猴脚本前必须先问主人

油猴脚本会常驻主人的浏览器、在页面里执行代码，是**主人浏览器环境里的持久改动**，不属于“顺手装个插件”。
所以，作为 Agent：

1. **先征得明确同意，再做任何一步。** 包括：不要替主人打开 Tampermonkey 安装页；不要在没问过的前提下
   直接甩给主人一套“照着点几下”的安装步骤；不要把脚本注入到正在运行的页面里；不要修改主人的浏览器配置。
2. **询问时讲清三件事**：它改什么、它需要什么、不装的后果。
3. **沉默不是同意。** 主人跳过问题、说“随便”“你看着办”、或只回复其它内容时，按“未同意”处理，不要装。
4. **被拒绝不要重复追问。** 明确告知：插件本体已经可用，脚本随时可以后加。
5. 核心插件本身的安装同样要走权限审批（`plugin_manager` 需要全权限或一次批准），**不要为了绕过审批去手改 profile 的
   `package.json` / `cordis.patch.yml`**。

可以直接用下面这段去问（按需改写，别删掉风险与后果）：

```text
要不要顺手把“会话导航”悬浮预览里的标签也隐藏掉？
需要在你浏览器里装一个 Tampermonkey 脚本（约 150 行，只在页面里把文本开头的标签抹掉，不联网、不写存储、
不改任何数据）。不装完全不影响使用，只是把鼠标移到对话右侧那排回合刻度上时，预览里还能看到 <meta time="…">。
要装的话我把脚本内容发你，你在 Tampermonkey 里新建脚本粘贴保存、刷新页面即可——这两步得你自己点。
```

脚本可核对的事实：`@grant none`（不申请任何脚本管理器权限）、无 `fetch`/`XMLHttpRequest`/`localStorage`、
只调用 `document.createTreeWalker` 与 `node.nodeValue` 改写显示文本。

---

## 一、人类安装

### 1.1 核心插件（必需）

1. 确认 DSH Web 正在运行（本机是 `http://127.0.0.1:3080`）。
2. 打开 **插件（Plugins）** → **Add plugin** → 选择本目录（含 `package.json` 与 `cordis.patch.yml` 的那一层）。
3. 安装结果应为已启用、无警告；在插件列表里能看到 **聊天时间标签 / Chat time tag**。
4. 刷新页面，让浏览器加载 `client.js`（气泡隐藏靠它）。若界面提示需要重启，重启一次 DSH 即可。

### 1.2 油猴脚本（可选）

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（Violentmonkey 亦可）。
2. 点扩展图标 → **添加新脚本** → 清空模板，粘贴 [userscript/dsh-chat-time-hide.user.js](userscript/dsh-chat-time-hide.user.js) 全文 → 保存。
3. 刷新 DSH 页面。脚本头部的 `@match` 是 `127.0.0.1:3080` 与 `localhost:3080`，端口不同就改那两行。
4. 把鼠标移到对话右侧的回合刻度上：悬浮预览里不应再出现 `<meta time="…">`。

---

## 二、Agent 安装

### 2.1 准备：先读、再判断、再动手

1. 读 [README.md](README.md) 了解能力、配置项和已知限制；不要凭包名猜行为。
2. 确认目标 DSH 的 profile：环境变量 `DSH_PROFILE`（名字）与 `DSH_PROFILE_DIR`（目录）。
3. 判断是否已经装过：用 `plugin_manager` 的 `list_plugins`（需要审批），或用 `cordis_inspect_query`
   的 Host `Config.listConfigs` 过滤 `@local/dsh-chat-time`（无需审批）。已安装就别重复装。

### 2.2 装核心插件

```text
plugin_manager action=install_bundle target=<本目录的绝对路径>
```

判断标准，按顺序：

1. 返回里 `application` 必须是 `applied`；`warnings` 应为空。
2. `changed: true` 表示真的装上了；返回 `already-installed` 时不要重复装，转去验证。
3. 用 `cordis_inspect_query`（Host `Config.listConfigs`，`name: "@local/dsh-chat-time"`）确认条目存在。
4. 告诉主人需要**刷新页面**；若返回或插件页提示重启，请主人重启 DSH。

不要做的事：不要手写 profile 的 `package.json`/`cordis.patch.yml` 来“手动安装”，不要在 profile 目录跑包管理器，
不要为了拿到权限去换 profile。

### 2.3 装油猴脚本（先问主人！）

1. 按本节开头的规则先征得同意。**未同意就停在这里**，并明确告诉主人：插件本体已可用。
2. 同意后：把脚本内容或文件路径交给主人，并给出两步人工操作（新建脚本、粘贴保存、刷新）。
   Agent 通常**无法**代替主人完成 Tampermonkey 的确认点击——不要尝试，也不要要求主人把扩展权限放开。
3. 装好之后按 2.4 一起验证。

### 2.4 验证清单

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 新开一个会话，发一条消息 | 气泡里只有你打的字，没有 `<meta time="…">` |
| 2 | 看侧边栏该会话标题 | 标题不含标签；旧会话点开一次会被自动清洗 |
| 3 | 打开该会话的**轨迹**页 | 用户消息里能看到 `<meta time="…">` 原文 |
| 4 | 鼠标悬停对话右侧的回合刻度 | 预览不含标签（**需要油猴脚本**） |
| 5 | 队列里排一条消息（agent 忙碌时发送） | 队列预览不含标签 |

第 4 条不通过时，先确认脚本是否启用、URL 是否命中 `@match`；仍不行就看 2.5。

### 2.5 排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 气泡里仍带标签 | 浏览器没加载 `client.js` | 刷新页面；仍不行则重启 DSH |
| 侧边栏标题仍带标签 | 标题清洗未生效（Host 半未加载） | 重启 DSH；旧会话打开一次会自动清洗 |
| 导航预览仍带标签 | 油猴脚本未启用 / 选择器与当前版本类名不一致 | 让主人在预览卡片上“检查元素”，把含 `preview` 的类名发来，补进脚本顶部 `SELECTORS` |
| 时间不是本地时间 | Host 进程不在主人时区 | 在 profile 的 `cordis.patch.yml` 里给 `chat-time` 行设 `timeZone` |
| 改配置没反应 | 改的是包内 `cordis.patch.yml` | 只有 profile 的补丁层会被监听，见 README 的「配置项」 |
| 轨迹里看不到标签 | 消息是在装插件之前发的 | 正常：只对插件生效后的消息注入 |

---

## 三、卸载

1. 插件：**插件（Plugins）** 里移除 `@local/dsh-chat-time`（或 `plugin_manager` `remove_bundle`）。插件不写自有存储，无残留。
2. 油猴脚本：删除 Tampermonkey 里的脚本条目，刷新页面。
3. 已经注入到历史消息里的标签不会被改回去——它们已经写进会话日志，属于当时的真实内容。

---

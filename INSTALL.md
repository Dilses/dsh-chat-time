# Installation guide (humans / agents)

> English · [汉语版](INSTALL.zh.md)

`dsh-chat-time` consists of **two parts**, which are installed differently and carry different risks:

| Part | Purpose | Required | Installed in |
| --- | --- | --- | --- |
| **Core plugin** ([index.js](index.js) + [client.js](client.js)) | Injects a local-time tag into user messages; hides the tag in bubbles, queue previews, and conversation titles | Required | The DSH profile (server + browser) |
| **Userscript** ([userscript/dsh-chat-time-hide.user.js](userscript/dsh-chat-time-hide.user.js)) | Hides the tag in the "conversation navigation" hover preview | Optional | The owner's browser, via Tampermonkey |

> The run trace page (the "Trace" tab) keeps the original content in both cases. That is by design, not a sign of a broken install.

---

## ⛔ Agents must read: ask the owner before installing the userscript

The userscript lives permanently in the owner's browser and executes code in the page. It is a **persistent change to the owner's browser environment**,
not "just installing a plugin on the side".
So, as an agent:

1. **Get explicit consent first, then take any step.** That includes: do not open the Tampermonkey install page on the owner's behalf; do not
   hand the owner a "just click these few things" install recipe without asking first; do not inject the script into a running page; do not
   modify the owner's browser configuration.
2. **When asking, cover three things**: what it changes, what it requires, and what happens if it is not installed.
3. **Silence is not consent.** If the owner skips the question, says "whatever", "do as you see fit", or replies only about something else, treat it as
   "not consented" and do not install.
4. **Do not keep asking after a refusal.** State clearly: the plugin itself already works, and the script can be added at any time.
5. Installing the core plugin itself also goes through permission approval (`plugin_manager` requires full permissions or a one-time approval).
   **Do not hand-edit the profile's `package.json` / `cordis.patch.yml` just to get around approval.**

You can ask with the following text (rewrite as needed, but do not drop the risks and consequences):

```text
Would you like me to also hide the tags in the "conversation navigation" hover preview?
That needs a Tampermonkey script in your browser (about 150 lines; it only strips the tag at the start of the text
inside the page — no network, no storage writes, no data changes). Not installing it does not affect usage at all; it just
means that when you move the mouse over the row of turn ticks on the right side of the conversation, the preview still
shows <meta time="…">.
If you want it, I'll send you the script: you create a new script in Tampermonkey, paste it in, save, and refresh the
page — those two steps are for you to click.
```

Facts you can verify in the script: `@grant none` (requests no script-manager privileges), no `fetch`/`XMLHttpRequest`/`localStorage`, and it only calls
`document.createTreeWalker` and `node.nodeValue` to rewrite the displayed text.

---

## 1. Human installation

### 1.1 Core plugin (required)

1. Make sure DSH Web is running (locally, `http://127.0.0.1:3080`).
2. Open **Plugins** → **Add plugin** → select this directory (the level that contains `package.json` and `cordis.patch.yml`).
3. The result should be enabled with no warnings; **Chat time tag** should appear in the plugin list.
4. Refresh the page so the browser loads `client.js` (bubble hiding depends on it). If the UI says a restart is required, restart DSH once.

### 1.2 Userscript (optional)

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser (Violentmonkey works too).
2. Click the extension icon → **Add new script** → clear the template, paste the full contents of
   [userscript/dsh-chat-time-hide.user.js](userscript/dsh-chat-time-hide.user.js) → save.
3. Refresh the DSH page. The script header's `@match` entries are `127.0.0.1:3080` and `localhost:3080`; change those two lines if your port differs.
4. Move the mouse over the turn ticks on the right side of the conversation: `<meta time="…">` should no longer appear in the hover preview.

---

## 2. Agent installation

### 2.1 Preparation: read first, then judge, then act

1. Read [README.md](README.md) to learn the capabilities, configuration fields, and known limitations; do not guess behavior from the package name.
2. Identify the target DSH profile: environment variables `DSH_PROFILE` (name) and `DSH_PROFILE_DIR` (directory).
3. Determine whether it is already installed: use `plugin_manager`'s `list_plugins` (requires approval), or `cordis_inspect_query`'s
   Host `Config.listConfigs` filtered by `@local/dsh-chat-time` (no approval needed). If it is installed, do not install it again.

### 2.2 Install the core plugin

```text
plugin_manager action=install_bundle target=<absolute path of this directory>
```

Criteria, in order:

1. `application` in the response must be `applied`; `warnings` should be empty.
2. `changed: true` means it was really installed; if the response is `already-installed`, do not install again — move on to verification.
3. Use `cordis_inspect_query` (Host `Config.listConfigs`, `name: "@local/dsh-chat-time"`) to confirm the entry exists.
4. Tell the owner to **refresh the page**; if the response or the plugin page says a restart is required, ask the owner to restart DSH.

What not to do: do not hand-write the profile's `package.json`/`cordis.patch.yml` to "install manually", do not run a package manager in the profile directory,
and do not switch profiles just to obtain permissions.

### 2.3 Install the userscript (ask the owner first!)

1. Get consent per the rules at the start of this section. **If there is no consent, stop here**, and clearly tell the owner: the plugin itself already works.
2. After consent: hand the script contents or file path to the owner, and give the two manual steps (create a new script, paste and save, refresh).
   Agents usually **cannot** perform Tampermonkey's confirmation clicks on the owner's behalf — do not try, and do not ask the owner to loosen the extension's permissions.
3. Once installed, verify together per 2.4.

### 2.4 Verification checklist

| # | Action | Expected |
| --- | --- | --- |
| 1 | Open a new conversation and send a message | The bubble contains only what you typed, no `<meta time="…">` |
| 2 | Look at that conversation's title in the sidebar | The title has no tag; opening an old conversation once cleans it up automatically |
| 3 | Open the **Trace** page of that conversation | `<meta time="…">` is visible verbatim in the user message |
| 4 | Hover the turn ticks on the right side of the conversation | The preview contains no tag (**requires the userscript**) |
| 5 | Queue a message (send while the agent is busy) | The queue preview contains no tag |

If item 4 fails, first check whether the script is enabled and whether the URL matches `@match`; if it still fails, see 2.5.

### 2.5 Troubleshooting

| Symptom | Possible cause | Remedy |
| --- | --- | --- |
| The bubble still has the tag | The browser did not load `client.js` | Refresh the page; if that still fails, restart DSH |
| The sidebar title still has the tag | Title stripping is not active (the Host half is not loaded) | Restart DSH; opening an old conversation once cleans it up automatically |
| The navigation preview still has the tag | The userscript is disabled / the selectors do not match the current version's class names | Have the owner "Inspect element" on the preview card and send you the class name containing `preview`, then add it to `SELECTORS` at the top of the script |
| The time is not local time | The Host process is not in the owner's time zone | Set `timeZone` on the `chat-time` line in the profile's `cordis.patch.yml` |
| Config changes have no effect | You edited the `cordis.patch.yml` inside the package | Only the profile's patch layer is watched; see "Configuration" in the README |
| No tag in the trace | The message was sent before the plugin was installed | Expected: tags are only injected into messages after the plugin takes effect |

---

## 3. Uninstallation

1. Plugin: remove `@local/dsh-chat-time` in **Plugins** (or use `plugin_manager` `remove_bundle`). The plugin writes no storage of its own, so nothing is left behind.
2. Userscript: delete the script entry in Tampermonkey and refresh the page.
3. Tags already injected into past messages are not reverted — they have already been written into the conversation log and are the real content of that moment.

---

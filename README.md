# Chat time tag (dsh-chat-time)

> English · [汉语版](README.zh.md)

Injects a metadata tag containing the **current local time** into every user message, so the model knows when that message was sent;
the UI hides this tag by default, and only the "Trace" page shows the raw text.

```text
Message the model and the conversation log receive: <meta time="2026-11-23T14:35">Hello
Content shown in the chat bubble:                   Hello
```

## Scope

- Handles every message with `source.kind === 'user'`: chat messages you submit in the Web GUI / CLI, the task prompts a parent agent hands to
  a subagent (DSH delivers those as `kind: 'user'` too), and user messages submitted through the API.
- Skips other sources: context injected via `agent.inject()`, runtime-context snapshots, and messages written by plugins.
  Change `sourceKinds` to widen or narrow the scope.
- The time is taken once per step: multiple user messages merged within the same step share one timestamp.

## Trigger point and persistence

The interception point is the `agent/pre-step` waterfall event, which fires after messages are claimed but before they are written to the
conversation log and before the model request is issued:

1. Only decisions with `kind === 'enter'` are rewritten, and the original decision is spread to preserve fields such as `startsRequestSeries`.
2. Only the rewritten messages are appended to the conversation log, so **the tag is persisted**: later requests in the same step,
   conversation replay, and a forked conversation all see the same tagged content.
3. The plugin does not modify the claimed original message object; it returns a rewritten copy, and each message
   is tagged only once within one pre-step call.

## How the frontend hides it

The tag exists only in the raw message text; the display layer trims it separately, so the two do not affect each other:

- **Chat bubbles / queue previews**: `client.js` registers a `userText` rule that declares the leading "tag + minute time" of a message
  as a text node whose `display` is an empty string. The raw string, its UTF-16 offsets, and the log are unchanged, so copying a message still
  yields the complete raw text including the tag.
- **Conversation titles (sidebar, conversation header, document title)**: the title is taken from the raw text of the first user message, and the Host side
  appends a revision with the tag stripped after the title event is submitted (`source.kind: 'fallback'`). A model-generated automatic title still
  overrides it normally later; an explicit rename by the user (`source.kind: 'user'`) is left untouched. Old titles created before the plugin existed are
  cleaned up once when that conversation is opened.
- **The "Trace" page**: renders conversation events directly, so **the tag is visible there** — that is also the only place to verify
  what the model actually received.

The hiding rule only recognizes the shape "one tag at the start whose content contains `YYYY-MM-DDTHH:mm`", so it does not swallow ordinary text.

### Conversation navigation preview: covered by the userscript

The hover preview of "conversation navigation" (the row of turn ticks on the right side of the conversation), and the body excerpts in conversation search,
are strings **computed ahead of time** by DSH in the Host projection (`turnOutline`) and the client snapshot (`turn-navigation.ts`). They do not go through
the render path, and there is no plugin extension point — the plugin cannot touch them. A Tampermonkey script ships alongside this package to cover that part:

1. Install Tampermonkey (Violentmonkey works too).
2. Create a new script, paste in the contents of [`userscript/dsh-chat-time-hide.user.js`](userscript/dsh-chat-time-hide.user.js), and save.
3. Refresh the DSH page.

The script trims the display only: after matching the conversation navigation preview (`previewPrompt` / preview cards with `role=tooltip`) and user bubbles
(`data-message-bubble`, as a fallback when the plugin is not loaded), it strips the tag at the start of the text node; the Trace page's class names
(`markdownPreview` / `jsonPreview`, etc.) are out of scope, so the raw text is preserved there in full. `@match` defaults to
`http://127.0.0.1:3080/*` and `http://localhost:3080/*`; change them if your port differs.

> **Note for agents**: this is a persistent change in the owner's browser. Obtain the owner's explicit consent before installing; for the details and
> the wording to use when asking, see "Agents must read" in [INSTALL.md](INSTALL.md).

## Configuration

The plugin does **not** read the `cordis.patch.yml` inside the package as modifiable configuration: the Host only watches the profile patch layer and the home patch layer.
To change configuration, write it into the profile directory's `cordis.patch.yml` (on this machine, `D:\.dsh\profiles\chat\cordis.patch.yml`),
overriding with the line id `chat-time`:

```yaml
- id: chat-time
  name: '@local/dsh-chat-time'
  config:
    template: '<meta time="{time}">'
    # enabled: false
    # stripTitleTag: false
    # timeZone: Asia/Shanghai
```

The override **replaces the whole config** of that line; omitted fields fall back to the defaults below. After saving, the Host reloads the plugin;
changes involving `client.js` or the `dsh.client` manifest take effect in the browser only after DSH is restarted once.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | When set to `false`, the plugin registers no listeners at all, which is equivalent to turning it off. |
| `template` | string | `<meta time="{time}">` | Tag template; must contain `{time}`; may be any wrapping text. |
| `timeZone` | string | Local time zone of the Host process | Optional IANA time zone name (e.g. `Asia/Shanghai`). By default the Host's system local time is used directly, with no UTC conversion. |
| `sourceKinds` | string[] | `["user"]` | Allowlist of message source kinds to inject into (matches `message.source.kind`). |
| `stripTitleTag` | boolean | `true` | Whether to strip the tag from conversation titles. When set to `false`, titles stay as-is (and the sidebar shows the tag). |

If a field has an invalid type, the template lacks `{time}`, or the time zone name cannot be resolved, the plugin reports an error at load time
and explains why, instead of silently running with bad configuration.

## Failure handling

If reading or formatting the time fails, **nothing is injected**: the original decision is returned unchanged, the message is sent as usual, and only
a single warning is logged on the Host. Errors while rewriting the message or stripping the title are likewise passed through unchanged; errors never
bubble up to the agent loop, so the conversation is not interrupted.

## Time format

`YYYY-MM-DDTHH:mm`, ISO 8601 with minute precision and no time zone offset. The date components come from local time; whatever
`getHours()` returns is the hour, unaffected by UTC conversion.

## Known limitations

- The time is the **moment the tag is generated** (when the message enters the step), not the moment the send key is pressed. Messages queue up while the agent is busy,
  so the two differ by the queueing time.
- The time comes from the **Host process's local time zone**. When the Host runs on a server in a different time zone from yours, set `timeZone` explicitly.
- If you change `template` to plain text that does not have the "tag + ISO time" shape (e.g. `[{time}]`), the frontend hiding rule will not recognize it,
  and the bubble and title will show that prefix again.
- The body excerpts in conversation search results still come from the raw content, so they include the tag (the userscript does not handle that yet).
- The text you get when copying a message also comes from the raw content and keeps the tag.
- The userscript depends on DSH's CSS Modules class names (`previewPrompt`) and the `data-message-bubble` attribute; if a DSH redesign renames either of these,
  the selectors in the script need to be updated to match.
- When the first block of a message is not text (it starts with an image), a text block containing only the tag is inserted at the very front and the existing content blocks
  are kept as-is; empty messages are blocked by the GUI and never reach this path.
- Tags cannot be retracted once written: messages already produced are not rewritten, and disabling the plugin only affects later messages; old titles that were
  already submitted can be cleaned up on the next open via `stripTitleTag`.

## Installation and uninstallation

See [INSTALL.md](INSTALL.md) for the full steps (including the installation procedure for other agents and the hard rule "ask the owner before installing the userscript").

- Install: **Plugins** → **Add plugin**, select this directory (or install via `plugin_manager` `install_bundle`). Refresh the page after installing
  so the browser loads `client.js`.
- Uninstall: remove the bundle in **Plugins**. The plugin keeps no storage of its own, so nothing remains after removal.

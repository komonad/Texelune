# texelune-editor

Framework-independent Rust/WASM/WebGPU text editor. Each instance owns its document, layout Worker, GPU renderer and Shadow DOM. WASM module code and fetched assets are shared by the browser module and HTTP caches. Fonts and generated WASM are included in the package.

See [JavaScript / TypeScript API](API.md) for coordinate conventions, callbacks, providers, overlays, word selection, indentation and lifecycle contracts. Public declarations are included in `index.d.ts` and `lsp.d.ts`.

Common shortcuts include logical-line copy/cut with an empty selection, line selection/deletion/movement/duplication, indentation and word navigation. `keybindings` remaps commands, disables a binding with `null`, or installs an asynchronous handler with an `AbortSignal`; `onKeyDown` takes priority. `executeCommand()` exposes the built-in commands to application controls. Definition providers serve Ctrl/Meta-click, F12 and middle-click navigation; `middleClickDefinition:false` disables the middle button binding.

```js
import { createEditor } from 'texelune-editor';

const editor = await createEditor(container, {
  value: 'fn main() {}', filename: 'main.rs',
  theme: 'paper', fontSize: 17, wrap: true,
  syntax: true, performance: false,
});
const unsubscribe = editor.on('change', ({ detail }) => {
  console.log(detail.version, detail.start, detail.end, detail.text);
});
editor.setTheme('dusk');
editor.setInlays([{anchor: 3, text: ': fn()', block: false}]);
unsubscribe();
editor.destroy();
```

Give the container an explicit height, such as `height: 600px`. Serve the package assets over HTTPS or localhost with JavaScript, CSS, font and WASM MIME types. Worker URLs are relative to their modules. Direct ESM usage is available at `/packages/editor/index.js` in the development server. No application global or demo stylesheet is required. Removing the custom element disposes the instance. An instance is not reusable after disposal; create a new one when remounting.

`text`, `slice`, `select`, `insert`, `replace`, `setHighlights` and inlay anchors use Unicode scalar offsets and half-open ranges. `positionAt` and `offsetAt` convert between scalar offsets and zero-based UTF-16 LSP positions using Ropey's UTF-16 index. Grapheme segmentation and visual BiDi caret movement remain inside the editor. `setHighlights(spans, readVersion)` accepts ranges in their original read version. The layout Worker replays subsequent edits before installing them at its current version. Resident highlights follow the same start/end affinities as rich-text decorations, including inherited styles inside inserted or replaced text. A new batch atomically replaces this provisional layer. Persistent formatting has precedence and stays in the document undo history.

The layout Worker retains at most 4,096 scalar edit maps. Future versions, expired history and results older than an accepted analysis are rejected without clearing resident highlights. LSP requests a fresh checkpoint when rebasing history expires. Worker recovery installs the saved highlight checkpoint at its source version during document replay, then applies subsequent transactions. `frame.highlight_source_version` and `frame.highlight_spans` expose the represented analysis and resident range count.

Events include `change`, `documentchange`, `selectionchange`, `completionchange`, `diagnosticschange`, `themechange`, `notice` and `dispose`. `load()` replaces the document and emits `documentchange`; ordinary transactions emit `change`. `frame`, `caret`, `stats`, `performance` and `root` provide diagnostics and integration access. Initial creation resolves after the renderer and document are initialized; visible layout arrives asynchronously through the layout Worker. Scene replacement waits for complete visible layout and commits glyph-atlas writes with geometry, retaining the resident scene during asynchronous edits.

Scenes include bounded geometry outside the viewport. `scroll` records the requested position; `renderedScroll` stays inside the resident scene's `scroll_min/scroll_max` coverage until a complete replacement arrives. Hit testing, caret geometry and overlays use the rendered position. Small movements within coverage render immediately, while large asynchronous jumps retain text on screen.

## Completion

`LspClient.attach()` installs an asynchronous completion provider with the hover, definition and diagnostic bindings. Ctrl/Meta+Space requests candidates beside the caret; typing identifiers, `.` or `:` requests after a configurable debounce. Up/Down choose a candidate, Enter/Tab accept and Escape closes the list. Pointer selection retains input focus. Theme colors apply to the popup.

Use `completionProvider`, `automaticCompletion` and `completionDelay` for custom sources, and `triggerCompletion()`, `acceptCompletion()`, `hideCompletion()` or the corresponding keyboard commands for application controls. `completion` and `completionchange` expose pending state and candidates. Document or selection changes cancel requests. Typing and deletion inside resident replacement ranges map those candidates to the current version and filter them while awaiting the next batch. The popup container stays mounted during refresh, retaining selection and scroll where possible. Rows align kind, label and detail columns. Acceptance runs through edit hooks as one undoable replacement. Snippets and candidates requiring additional edits are excluded. See the [completion contract](API.md#补全) for bounds and cancellation semantics.

## Brackets

Configurable `bracketPairs` define distinct single-scalar endpoints, including fullwidth brackets. Empty-selection input automatically closes opening brackets; typing the existing closing bracket advances the caret. `autoClosingBrackets` and `skipClosingBrackets` independently control these behaviors. IME pairing takes place on commit. API edits and paste preserve literal text.

`bracketMatching` highlights the pair near the caret using visual cell geometry. `matchBrackets(offset?,signal?)` performs a cancellable, bounded-slice asynchronous scan, and `skipClosingBracket(close?)` exposes the closing-bracket action. Bind `goToBracket` through `keybindings` for navigation. `bracketMatchingProvider` accepts syntax-aware results from an application or Worker; the default lexical matcher includes brackets in comments and strings. See the [bracket contract](API.md#括号) for defaults, coordinate rules and limits.

## Diagnostics

`setDiagnostics(items, readVersion = editor.version)` accepts scalar ranges with messages and optional severity (1 error, 2 warning, 3 information, 4 hint), source and code. It rejects noncurrent versions without erasing current markers. `diagnostics` is a read-only snapshot; `diagnosticschange` reports updates. Transactions and document replacement clear obsolete reports. Diagnostics do not enter undo history.

The component draws virtualized underlines and gutter marks, composes messages with symbol hover, and shows severity counts. F8 / Shift+F8 or `goToDiagnostic(1 | -1)` navigate diagnostics with wrapping and BiDi-aware reveal. The four diagnostic colors are theme settings. `LspClient.attach()` binds diagnostic events automatically and releases only markers it still owns on detach or disconnect.

## Themes

```js
editor.setTheme({
  name: 'My theme',
  colors: { background: '#ffffff', foreground: '#292e3b', caret: '#2959cc' },
  tokens: {
    keyword: '#8041ae', function: '#315eb6', struct: '#20638b',
    comment: {foreground: '#7c879b', italic: true},
    'variable.readonly': {foreground: '#995222', bold: true},
    '*.deprecated': {underline: true},
  },
});
```

Colors accept `#RRGGBB` or `#RRGGBBAA`. Partial themes inherit Paper defaults. Token rules apply in order: type, each wildcard modifier, each type-specific modifier. Styles include foreground, background, bold, italic and underline. Theme changes update GPU clear/caret colors, layout defaults, selection, inlays and editor chrome; the LSP adapter recolors cached semantic tokens without requesting them again.

## LSP adapter

```js
import { LspClient } from 'texelune-editor/lsp';
const language = new LspClient(editor, {
  url: 'ws://127.0.0.1:4173/lsp',
  rootUri: workspaceRootUri, uri: documentUri, languageId: 'rust',
});
language.addEventListener('diagnostics', ({detail}) => renderProblems(detail.diagnostics));
await language.connect();
const hover = await language.hover(editor.selection.head);
const completions = await language.complete();
language.dispose();
```

The adapter uses a dedicated Worker for JSON-RPC, a Rust rope replica, UTF-16 positions and semantic token processing. It negotiates the semantic-token legend, UTF-16 encoding and document synchronization mode. Incremental changes are grouped after 30ms; servers requiring full synchronization receive snapshots from the Worker. Semantic and pull diagnostic requests use a 120ms debounce; push diagnostics are also supported. RPC requests time out after 10s, initialization after 20s, and the public connection attempt after 25s.

Use `url` for WebSocket transport, or `workerUrl` for a browser language server:

```js
const language = new LspClient(editor, {
  workerUrl: new URL('./language-server.js', import.meta.url).href,
  workerType: 'module',
  rootUri: 'file:///workspace/', uri: 'file:///workspace/main.ts', languageId: 'typescript',
});
```

`workerUrl` takes precedence over `url`. The adapter owns the server Worker and exchanges JSON-RPC objects through `postMessage`; no Content-Length framing or JSON string encoding is used. `workerType` defaults to `'module'`; classic Workers can use `'classic'`. The server must implement LSP initialization and UTF-16 positions. Cancellation sends `$/cancelRequest`. A Worker RPC timeout terminates the server and reports an error; `connect()` starts a fresh session. Disconnecting, disposing, or exceeding the document limit releases the adapter and server Workers. The Pages demo includes a TypeScript implementation under `web/`.

Each semantic request owns an immutable rope snapshot and its read version. Because semantic-token responses omit a document version, a read barrier holds outgoing `didChange` notifications until the response or timeout. Local document edits, layout and rendering remain independent. The response's UTF-16 positions are decoded against its snapshot, never against the current replica. The layout Worker then rebases scalar ranges through its ordered edit history. At most one semantic request is active; intervening edits request one follow-up analysis and do not cancel the active read. The barrier releases buffered writes on response, timeout or document replacement. Interactive queries wait for this synchronization point and retain strict document-version checks.

Document replacement cancels semantic reads; superseded diagnostics and same-kind interactive requests also send `$/cancelRequest`. Document epochs isolate different documents, and source versions/publication order prevent older analyses from replacing newer ones. Token conversion and theme styling yield around 1.5ms chunks. Theme changes reuse cached scalar ranges and their source version. Rust-analyzer's mutable-variable modifier maps immutable bindings to the readonly theme rule.

The default LSP synchronization ceiling is 2MiB. Crossing it terminates the LSP Worker before obtaining a full document string; document editing, navigation, rendering and streamed stress imports remain available. The adapter exposes diagnostics, hover, definition and completion responses. `attach()` binds hover, definition and completion providers to component widgets and commands. Consumers handle external document loading. The completion popup accepts plain replacements and omits items requiring snippets or additional edits.

WebSocket servers send one JSON-RPC object per text message. The included Rust development server bridges those messages to `rust-analyzer` Content-Length-framed stdio, binds to loopback, validates the browser Origin and kills each language-server process when its connection closes. `TEXELUNE_LSP_COMMAND` configures the executable path. The demo workspace is `examples/code-workspace`; open document buffers are held by the language server and do not write to source files.

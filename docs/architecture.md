# Architecture

## Component boundary

`packages/editor/index.js` exports `createEditor`, `TexeluneEditorElement`, built-in themes and theme resolution. The custom element owns a Shadow DOM with canvas, input bridge, chrome and overlays. Each instance owns its document, layout Worker and GPU renderer; browser caches share module code and asset downloads.

`runtime.js` submits Rust transactions, synchronizes Workers, accepts current frames and manages resources. `interactions.js` handles cancellable provider reads and navigation. `overlays.js` positions DOM widgets without changing document height; block inlays participate in layout.

## Documents and coordinates

`src/document.rs` stores Ropey text, persistent decorations, selection and undo history. Transactions use Unicode scalar offsets and increasing versions. UTF-8 byte offsets belong to shaping inputs; JavaScript and LSP columns use UTF-16. Conversion is explicit.

`caret.rs` maps display graphemes to glyph clusters. `visual.rs` retains row order and affinity at direction boundaries. Extended grapheme deletion uses bounded input-path scans and defers large clusters to the navigation Worker. `interaction.rs` supplies logical-line and Unicode word ranges.

## Layout and rendering

The layout Worker owns a rope replica, font system, paragraph cache, height index, scheduler and glyph atlas. Viewport requests have independent sequence numbers. Only complete visible layouts with matching document versions and viewport requests replace the scene. `FrameStager` retains ordered atlas patches from intermediate frames; texture writes and geometry upload commit together. Incomplete layouts and new atlas generations leave the resident GPU scene intact until a replacement is ready.

Each scene includes up to half a viewport, capped at 256 CSS pixels, of geometry on either side when contiguous cached blocks are available. Its `scroll_min/scroll_max` bounds account for paragraph and long-line window coverage. The requested scroll and rendered scroll remain separate until replacement. GPU translation, navigation hit testing, caret geometry, gutter labels and DOM overlays share the rendered scroll. Moving beyond cached coverage retains a complete resident image while the Worker prepares the target.

Cosmic Text performs paragraph shaping and BiDi layout; Swash rasterizes glyphs. WebGPU draws instanced quads. Transferable `Float32Array` / `Uint32Array` buffers carry geometry and navigation; debug object views decode them lazily.

The height index retains measured heights as estimates across invalidation. Logical-line edits splice its entries. Height refinement preserves a document anchor and schedules newly uncovered viewport blocks.

Paragraph jobs yield between calls around a 2ms cooperative budget. A single shaping call is not preemptible. A stale layout Worker can be rebuilt from the initial source and ordered transactions. The navigation Worker is lazy.

## Asynchronous highlighting and LSP

Persistent formatting belongs to document history. External highlights form a replaceable layer and follow edits with the same anchor affinities. Incoming batches retain their read version and rebase through at most 4096 scalar edit maps. Future, expired or older committed analyses preserve the resident layer.

`lsp-worker.js` owns WebSocket or Worker JSON-RPC and a Rust mirror. Semantic reads own immutable rope snapshots. A read barrier temporarily holds outgoing `didChange` notifications while editing, layout and rendering continue. Results decode UTF-16 against the snapshot and publish scalar ranges with that version; layout replays subsequent edits. Response, timeout or document replacement releases the barrier. One follow-up analysis coalesces intervening edits.

Interactive queries wait for synchronization and retain strict version checks. Definitions normalize `Location` and `LocationLink`; local targets become scalar ranges, external targets retain URI and UTF-16 ranges. File URI comparison normalizes Windows drive case.

The optional Rust server bridges WebSocket JSON to rust-analyzer stdio. It binds to loopback, validates Origin, restricts methods and limits sessions. Source reads canonicalize paths and stay inside the size-limited demo workspace. The editor does not persist source files.

## Source map

| Area | Files |
| --- | --- |
| Model and highlight history | `src/document.rs`, `src/highlights.rs` |
| Caret and BiDi navigation | `src/caret.rs`, `src/visual.rs` |
| Layout, heights, scheduling | `src/layout.rs`, `src/index.rs`, `src/scheduler.rs` |
| Large ASCII and imports | `src/fast_layout.rs`, `src/import.rs` |
| WASM and GPU | `src/browser.rs`, `src/gpu.rs`, `src/quads.wgsl` |
| Host lifecycle | `packages/editor/runtime.js`, `index.js` |
| Providers, widgets and diagnostics | `interactions.js`, `overlays.js`, `diagnostics.js`, `editing.js` in the component |
| Language service | `lsp.js`, `lsp-worker.js`, `rpc.js`, `theme.js` in the component |

See [API](../packages/editor/API.md), [integration](integration.md) and [performance](performance.md).

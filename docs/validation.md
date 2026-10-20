# Validation

## Completion and demonstration documents

`tests/browser/completion-check.js` covers manual and automatic suggestions, prefix replacement, ranking and preselection, keyboard/pointer acceptance, focus retention, one-step undo, shortcut and edit-hook overrides, request cancellation, document replacement at version zero and provider deadlines. The native check accepts a real rust-analyzer completion; the static check accepts a TypeScript Worker completion. Unit tests validate scalar ranges after emoji, combining identifiers, full-word replacement, bounded inference and LSP completion defaults. The TypeScript workspace passes semantic checks and exposes catalog member suggestions.

The code examples contain catalog operations, generic collections, asynchronous iteration, text statistics and multilingual strings. The Unicode and BiDi documents include language-specific marks, emoji ZWJ, flags, variation selectors, invisible separators, directional isolates and long wrapped combinations.

## Keyboard commands and middle-click navigation

`tests/browser/commands-check.js` exercises native and asynchronous clipboard access, empty-selection line copy/cut, CRLF and trailing-empty-line deletion, undo selection restoration, linewise paste, edit-hook vetoes, line transforms, Unicode word deletion, binding overrides, disabled bindings and callback precedence. It validates a Worker-prepared line duplication, cancellation by later input, streamed copy and remapped asynchronous cut. Unit tests cover normalized platform bindings, IME/AltGraph exclusions, directed scalar selection mapping, Unicode separators and EOF line transforms. The real language-service definition check uses middle-click to open and select a cross-file definition.

`tests/browser/commands-stress-check.js` starts a transformation on a 100MiB logical line, observes main-thread timer progress, inserts subsequent input and verifies immediate Worker termination with no stale transaction. Whole-line selection uses range metadata. Unit checks cover transform deadlines, denied clipboard writes and cancelled cuts; pointer checks cover cancelled and timed-out definition requests.

## Diagnostic presentation and scene continuity

`tests/browser/diagnostics-check.js` validates rust-analyzer error underlines, hover messages, gutter severity, F8 navigation and problem-list reveal. It also covers all four diagnostic severities, mixed Unicode/BiDi ranges, EOF point diagnostics, stale-batch rejection, edit invalidation and binding ownership. The static Pages check validates the same editor markers from the TypeScript Worker, including reopening the same URI at document version zero. Unit tests compare diagnostic interval queries with a full scan over nested ranges.

`tests/browser/flicker-check.js` edits a 100MiB mixed document with alternating newlines and characters, samples resident scenes during asynchronous layout, and verifies that all published scenes have complete visible layout and nonzero geometry. It also restarts the layout Worker and runs a warm benchmark. Frame-staging tests cover patches retained from incomplete frames and replacement atlas/Worker generations. CPU patch work is measured inside the frame commit.

## Component and language services

- Interaction checks cover complete logical-line gutter selection, Unicode and locale-specific word providers, combining and ZWJ clusters, RTL words, pointer hover, Ctrl navigation, F12, multiple targets, custom overlay disposal, edit transformation/cancellation, custom keyboard handlers and optimistic version guards. Asynchronous indentation and hover results cannot overwrite later input.
- Real rust-analyzer checks exercise pointer hover, origin-range link decoration, same-document scalar targets and cross-file UTF-16 targets. The Studio opens a workspace module and selects its definition. File URI comparison normalizes Windows drive case; the source endpoint rejects absolute paths, traversal and canonical paths outside the workspace.
- `examples/component-api.ts` passes strict TypeScript checking against the public declarations. `packages/editor/API.md` documents units, transaction sources, cancellation, lifecycle and integration boundaries.
- The independent `texelune-editor` ESM package contains styles, Workers, fonts, WASM and TypeScript declarations. The application imports its public entry point. Two instances retain independent documents, versions and themes; removing one releases its Worker and leaves the other editable. Removing an instance during initialization cancels creation.
- The Rust WebSocket/stdio bridge connects to rust-analyzer 1.93.0. Browser checks validate semantic token colors in GPU glyph geometry, cached-token recoloring without document transactions, incremental edits, pull diagnostics with scalar ranges, diagnostic navigation, symbol hover after emoji/RTL prefixes, local-binding completion and its replacement range, stale query rejection, disconnect and reconnect.
- A 100MiB streamed import remains virtualized and pauses the LSP adapter before full-text synchronization. The default language-service synchronization ceiling is 2MiB. This ceiling does not constrain editor document size.
- Protocol/theme/client tests cover out-of-order replies, protocol errors, timeouts and cancellation, URI identity, provider binding ownership, server configuration requests, relative semantic token coordinates, modifier precedence, document epochs, acceptance of earlier read versions, rejection of older committed analyses and the large-document guard. Two editing-policy tests cover indentation and asynchronous deadlines. Eight metric tests remain separate.
- Native UTF-16 conversion tests cover astral scalars, combining sequences, CRLF and end-of-document clamping. Shaping tests cover multilingual fallback under italic themes, alongside grapheme/BiDi caret mapping.
- TypeScript declarations pass strict checking with DOM and ES2022 libraries. The package supports direct module loading without the Studio application.
- An extracted `.tgz` runs on a separate localhost server with only a mount element and an ESM import. Fonts, CSS, WASM, layout Worker, text insertion and theme switching load from the extracted package; no Studio global is present and the browser reports no errors.

## Asynchronous highlight consistency

- Scroll regression checks retain the viewport across inline edits, delayed highlight batches, manual scrolling, paragraph splits and undo. Splitting a partially visible wrapped paragraph keeps the caret in its visible neighborhood; editing an offscreen caret still reveals it. Height-index splices preserve measurements outside the edited paragraph range, and layout refinement schedules any newly uncovered viewport blocks.
- Native tests compare resident highlight mapping and a delayed batch rebased through the same edit timeline against document rich-text decorations. Cases include insertion, replacement, deletion, formatting-only transactions, undo, combining text, emoji and RTL content. Rope snapshot indexing retains original UTF-16 coordinates after line and astral edits. Expired history preserves resident styles and accepts a fresh checkpoint.
- `cargo run --locked --example delayed_lsp -- 4175` starts a controllable loopback fixture. `tests/browser/lsp-concurrency-check.js` holds semantic responses while the browser performs three edits. Glyph colors retain inherited styling, and the server document remains at the requested read version. A layout Worker restart retains the checkpoint and maps its following edits.
- Releasing an earlier response decodes its emoji-containing read snapshot and installs rebased colors at the current document version. Buffered incremental changes reproduce the final server document, and a coalesced follow-up analysis replaces provisional styles. An older analysis cannot roll the committed source version back. The fixture computes results from its document at response time, exercising the read barrier.
- A 150ms injected request timeout sends cancellation, releases buffered server writes and leaves the current rich-text layer editable and visible. At most one semantic request remains active. `highlight_source_version` records the analysis version independently of the rendered document version.

## Continuous live telemetry

- The component headline and chart show normal rendering samples before any benchmark runs. Scene updates record Worker work and main-thread CPU work; redraws use a separate sample window. The GPU estimate uses at most 32 render-pass samples. Unavailable or quantized-zero GPU timings produce an FPS upper bound identified in sampling status.
- The browser regression checks first-load values without a benchmark, fresh samples after typing, redraw/GPU sampling during continuous rendering, separate benchmark results, benchmark invalidation without clearing live measurements, reset recovery, and live telemetry on a 100MiB document.
- An unfocused idle editor retains the latest sample with its age and does not submit extra frames just to refresh telemetry. The chart and headline use the same statistics snapshot at up to four updates per second.
- Eight metrics unit tests cover bounded statistics, submission rate, benchmark/latency/CPU separation, live Worker/main/GPU estimates, update/redraw isolation, idle retention, GPU quantization and missing timers, correlated update completion, backpressure and reset invalidation.

## Offscreen throughput benchmark

The host reports an AMD Ryzen 7 9800X3D and NVIDIA GeForce RTX 5090. The browser exposes the adapter as `nvidia / blackwell`, with the device description redacted. These measurements are environment-specific observations. New raw samples can be exported from the performance panel.

| Scene | Target pixels | Quads per frame | Mean cost | Equivalent FPS |
| --- | --- | --- | --- | --- |
| Default document, complete warm frame | 1130 × 557 | 357 | 0.2316ms | 4,318 |
| Default document, scene reused | 1130 × 557 | 357 | 0.2178ms | 4,591 |
| 100MiB mixed document, complete warm frame | 1130 × 557 | 780 | 0.3259ms | 3,068 |
| 100MiB mixed document, fullscreen warm frame | 1406 × 899 | 1,248 | 0.4531ms | 2,207 |

Each run discards a 64-frame warmup and scores five 64-frame batches. Every scored batch waits for GPU completion. Warm mode rebuilds scene geometry and navigation, transfers both binary buffers, parses navigation, uploads geometry and renders each frame at the target size. Layout caches are reused. Redraw mode retains scene geometry. The reported cost is total scored batch time divided by 320 frames; it includes dispatch and batch completion callback overhead. This is an offscreen throughput measurement, not per-frame P95, onscreen presentation rate, cold shaping or edit-to-display latency. Results vary with viewport, text density and system load.

The regression checks that benchmarks preserve text and selection, editing cancels active work, scene changes invalidate scores, expanded fullscreen geometry is actually drawn, and reported frame counts and costs match the scored batches. Worker chunks contain at most eight frames and require main-thread acknowledgement. Both threads yield around 1.5ms work slices.

## Fullscreen and equivalent FPS

- Native browser fullscreen retains formatting controls, the status bar and the performance panel. Entering and leaving fullscreen resizes the WebGPU canvas to the viewport dimensions at the active device pixel ratio.
- Toolbar entry/exit, Alt+Enter, Escape and external fullscreen exit preserve document text and selection. Missing or rejected Fullscreen API requests use a page-sized editor fallback; Escape restores the normal layout.
- Live work estimates occupy the component headline; measured batch throughput has a separate optional benchmark section. Source changes invalidate the benchmark score while preserving live samples. Browser assertions verify the displayed inverse relationship of live cost and FPS.
- Browser fault injection delays the GPU completion promise by 90ms and Worker dispatch by 85ms. Both delays appear in update latency. Cached continuous redraws do not add update samples, and resetting statistics during an outstanding update preserves the final scene.
- A shared update trace spans request dispatch, visible layout readiness, scene construction, rasterization, transfer, uploads, submission and the GPU completion callback. Viewport readiness does not wait for background prefetch. Callback scheduling uncertainty remains part of latency. The separate request-to-completion latency includes the rAF wait.

## Editor overlay and 100MiB regression

The expanded regression validates the performance panel as a child of the editor viewport, mixed-direction visual arrow navigation, underline toggling, font size changes, drag scrolling, exact-size streamed import and cancellation.

- A 100MiB mixed-script fixture contains exactly 104,857,600 UTF-8 bytes, 63,529,600 Unicode scalars and 1,008,001 logical lines. The observed WASM capacities are approximately 130.8MiB on the main thread and 165.1MiB in the layout Worker; the lazy navigation Worker remains unallocated. Dragging the scrollbar reaches approximately line 719,531.
- A 16MiB single ASCII line with soft wrapping retains approximately 1,733–1,737 visible quads. Twenty sequential edits produce approximately 1.1–1.8ms layout slices. Input-to-submit measurements remain approximately 28–31ms in the automated browser with approximately 32Hz cadence.
- A separate 100MiB single-line fixture retains approximately 1,732 quads initially. The first eligibility scan and viewport layout take approximately 134.8ms in the Worker. Edits at the beginning, middle and end retain fewer than 2,000 quads and preserve precise caret positions. Steady-state layout jobs are approximately 1–2ms; idle frames may contain no layout work.
- Disabling wrapping on that fixture and moving to the document end retains 87 quads, exposes the final caret and resets vertical scrolling to zero.
- Cancelling a new streamed import preserves the active document. Fifty consecutive visual left moves through wrapped RTL text cross rows correctly.
- The 100MiB regression observes no main-thread Long Tasks in the browser that exposes the Long Tasks API. This is not a universal device guarantee.
- Geometry and navigation move through transferable Float32Array and Uint32Array buffers. The production path does not serialize per-glyph JavaScript objects; debug views decode them lazily. CPU frame metrics include committed atlas patch work, geometry preparation and render submission. GPU duration is measured separately using sampled timestamp queries when available, with quantized zero readings identified explicitly.

The ASCII path does not establish acceptable performance for arbitrarily long complex BiDi paragraphs. Those retain full paragraph shaping and remain a performance limitation.

## Environment

- Date: 2026-10-20
- Host: Windows, Rust 1.93.0, `wasm32-unknown-unknown`
- Browser: Microsoft Edge 154 headless through Playwright, WebGPU active
- Viewport: 1440 × 1050 CSS pixels
- Browser rAF median in the throughput validation session: approximately 6.9ms, approximately 144Hz

Display cadence and offscreen throughput do not establish an editing latency SLO. Cold imports and complex paragraph shaping remain outside a universal 144Hz acceptance claim.

## Native and WASM checks

- Native unit and integration tests pass.
- All 766 Unicode 17 grapheme break cases pass at three rope prefix lengths, in both navigation directions.
- All 91,707 Unicode 16 BiDi character cases pass paragraph level, resolved level and visual order checks.
- Glyph/grapheme caret mapping tests pass, including RTL, isolates and wrapped text.
- Release WASM builds successfully.

## Browser regression

The bracket/completion scenario covers ASCII and fullwidth pairing, grouped undo/redo, committed composition, custom astral endpoints, shared indentation definitions, BiDi match geometry, edit interception and cancellation across document replacement. Closing-bracket traversal preserves combining graphemes, including a 20,000-mark cluster resolved by the navigation Worker. A 100MiB unmatched bracket query yields to the event loop and cancels without constructing a full document string.

Completion refresh is observed with a retained DOM reference, removal observer and visibility sampling through typing, Backspace and a delayed provider. Resident candidates accept against mapped current replacement ranges before the next response. The scenario detects no popup replacement or hidden interval. Native rust-analyzer completion, static TypeScript Worker completion, viewport-edge placement, keyboard and mouse acceptance also pass.

The browser scenarios exercise real keyboard events and editor controls, with the development API used to load fixtures and inspect document state:

- Insert, Backspace, undo and redo.
- Whole-grapheme deletion for combining accents, skin-tone ZWJ emoji, flags, keycaps, Indic text and Hangul Jamo.
- Mixed Arabic/Hebrew/Latin layout and RTL visual ArrowLeft navigation.
- Bold, italic, foreground and background application without changing source text.
- Inline hint and block inlay insertion without changing source text.
- Synthetic composition with multiple candidate updates and one grouped undo.
- Soft wrapping changes geometry without inserting source newlines.
- External highlight provider messages.
- A 100,000-line fixture containing 6,666,669 Unicode scalars. The observed layout cache contains 46 blocks and the visible scene contains 870 quads.
- A grapheme containing 20,000 combining marks. Backspace resolves its boundary in the navigation Worker and removes the entire grapheme.
- Editing during a 480,000 UTF-16-unit mixed-script paragraph's asynchronous layout. The measured document insertion call takes approximately 0.4ms; the slowest paragraph layout call takes approximately 3,658ms. The final document contains the inserted text and retains the full paragraph.

A short continuous-render sample on the large-line fixture records approximately 0.5ms P95 for CPU encoding/submission. That sample precedes the expanded CPU-frame instrumentation and excludes first-load costs, GPU execution time and some message/atlas processing. It must not be interpreted as an end-to-end frame or 144Hz guarantee.

An earlier regression with expanded frame-loop instrumentation records approximately 0.7ms warm CPU-frame P95 on the same fixture. CPU-frame instrumentation includes atlas patch commits and geometry upload; GPU execution remains separately timed.

The browser reports no application errors in the passing regression run. Real OS IME, clipboard permission variations, assistive technology, mobile editing, GPU loss recovery and broad hardware performance remain to be validated.

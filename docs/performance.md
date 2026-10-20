# Performance and limitations

## Execution model

Input commits local transactions without waiting for shaping. Layout, BiDi, font selection and rasterization run in a Worker. Scheduling yields between paragraph jobs around a 2ms cooperative budget; **one Cosmic Text paragraph call remains non-preemptible**. Worker rebuilding is the cancellation boundary for paragraph-wide algorithms.

Visible blocks and nearby paragraphs are cached. Height estimates survive invalidation. GPU submissions are bounded; device-loss recovery attempts to rebuild renderer resources and layout state.

Intermediate layout frames can contain only part of the viewport. They contribute atlas patches to a staging buffer but do not replace the resident scene. A matching complete visible frame commits texture patches and geometry together, including atlas-generation changes. Editing therefore retains the last complete image while replacement layout runs. CPU-frame metrics count patch work once, inside that commit.

## Large documents

The deterministic fixture builds exact UTF-8 byte sizes in Rust ropes. Each call handles at most 64KiB and JavaScript yields around 1.5ms chunks. The document changes atomically after import, so cancellation preserves it. Synthetic descriptors avoid an extra 100MiB source string.

Printable ASCII paragraphs over 8192 characters without inlays use fixed-column viewport windows, Basic shaping and no ligatures. Geometry follows viewport size; initial eligibility still scans the paragraph. Tabs, Unicode/BiDi and inlays use full paragraph shaping.

The default LSP synchronization ceiling is 2MiB, independent of editor size. Crossing it pauses the service before serializing the entire document. `text` creates a complete JS string; large-document integrations should use `documentInfo` and `slice`.

Line transforms above 8192 scalars use a short-lived Worker. The main thread transfers rope slices of at most 4096 scalars and yields around 1.5ms intervals; Worker completion applies one version- and selection-checked transaction. Large copy/cut operations stream text into an asynchronous clipboard payload. Edits, selection changes, document replacement, reconfiguration, disposal and command deadlines cancel preparation; cut deletes text only after a successful clipboard write. Atomic document replacement work and callbacks still run on the main thread and scale with the modified range.

## Metrics

| Metric | Meaning |
| --- | --- |
| Live work estimate | P95 of same-kind Worker plus main CPU work, plus mean GPU render-pass samples; equivalent FPS is the inverse. |
| Complete frame generation | An update traced through queueing, layout, scene/raster work, transfer, upload, submission and GPU completion callback, with isolated rAF wait reported separately. |
| Request-to-completion latency | Wall-clock delay including scheduling and rAF waits. |
| Submission / rAF FPS | Submission and browser callback cadence. |
| Offscreen benchmark | Batch throughput using current text, viewport, font and GPU pipeline without VSync. |

Update and cached-redraw samples are separate. The work estimate excludes asynchronous waiting and GPU copy execution. GPU timers can be unavailable, pending or quantized to zero. Queue completion includes scheduling and callback latency and is not GPU execution time.

The benchmark warms 64 frames and scores five rounds of 64. Warm mode rebuilds scene/navigation while reusing layout; redraw mode reuses scene geometry. Batches wait for GPU completion. Worker chunks contain at most eight frames and require acknowledgement. Editing or scene changes cancel or invalidate results.

Sample windows are bounded; the panel refreshes at most four times per second. Idle periods retain sample age. WASM memory is linear-memory capacity, not process RSS; GPU memory is an explicit-resource estimate.

## Boundaries

- Complex Unicode/BiDi paragraphs can take substantial full-shaping time. The ASCII path does not bound arbitrary scripts.
- Font parsing, arbitrary file import, large paste and large undo are not fully chunked. A deferred paste still performs its transaction on the main thread.
- Dense persistent decorations use linear lists; style changes can relayout. Atlas-patch transfer has no per-frame byte quota.
- Logical-line edits rebuild the height index; unvisited long paragraphs retain estimates.
- Unwrapped ASCII uses a caret-following horizontal window; there is no separate horizontal scrollbar.
- Ligature carets use grapheme subdivision, not GDEF caret tables.
- Automated composition tests do not replace OS IME validation. Complete screen-reader navigation, EditContext, multiple cursors and rich HTML import/export are not implemented.
- Completion excludes snippet/additional-edit items; LSP supplies no built-in persistence.

144Hz is a target, **not a universal acceptance result**. Validate representative text, scripts, decorations, viewport and hardware. See [validation](validation.md) and [contribution checks](../CONTRIBUTING.md).

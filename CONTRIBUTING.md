# Contributing

## Setup

Follow the [fresh-clone instructions](README.md#run-from-a-fresh-clone). Source JS is ESM without a transpilation step; Rust changes require `npm run build`. `rust-toolchain.toml` and lockfiles pin the build and dependency graph.

`npm run serve` starts the loopback demo on port 4173. For another port, use `cargo run --locked --release --bin serve -- 4174`. The language-service fixture workspace is under `examples/code-workspace`.

## Required checks

```sh
npm ci
npm test
npm run test:types
npm run check:docs
cargo fmt --all -- --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo clippy --locked --lib --target wasm32-unknown-unknown -- -D warnings
npm run build
npm run check:package
```

The CI workflow runs these checks on Linux, then packs the component. It does not publish to a package registry. `npm run check:package` inspects the actual npm file list to verify entries, Workers, WASM, fonts and declarations.

## Browser checks

Start the demo, then open a dedicated Playwright CLI browser session:

```sh
npx --yes --package @playwright/cli playwright-cli -s=texelune open http://127.0.0.1:4173/web/ --browser msedge
npx --yes --package @playwright/cli playwright-cli -s=texelune resize 1440 1050
npx --yes --package @playwright/cli playwright-cli -s=texelune run-code --filename=tests/browser/interactions-check.js
npx --yes --package @playwright/cli playwright-cli -s=texelune run-code --filename=tests/browser/commands-check.js
npx --yes --package @playwright/cli playwright-cli -s=texelune run-code --filename=tests/browser/commands-stress-check.js
npx --yes --package @playwright/cli playwright-cli -s=texelune run-code --filename=tests/browser/definition-check.js
npx --yes --package @playwright/cli playwright-cli -s=texelune run-code --filename=tests/browser/component-lsp-check.js
npx --yes --package @playwright/cli playwright-cli -s=texelune run-code --filename=tests/browser/scroll-check.js
npx --yes --package @playwright/cli playwright-cli -s=texelune run-code --filename=tests/browser/large-edit-check.js
```

Use an installed Chrome/Edge channel supported by the CLI and WebGPU. `definition-check` and `component-lsp-check` require rust-analyzer. Checks replace the fixture document and belong in a dedicated test page. They are manual integration checks, separate from headless unit/type CI.

For deterministic asynchronous highlights, run `cargo run --locked --example delayed_lsp -- 4175`, then `tests/browser/lsp-concurrency-check.js`. The fixture exposes held semantic reads and releases them from the test; it binds to loopback.

Other browser scenarios cover fullscreen, metrics, GPU-completion latency injection, benchmark cancellation, Unicode editing and streamed imports. See [validation](docs/validation.md) and [performance semantics](docs/performance.md).

## Change boundaries

- Keep browser component code independent of Studio DOM and globals.
- Keep document ranges in Unicode scalar coordinates; convert UTF-16 at integration boundaries.
- Preserve paragraph context for BiDi and grapheme correctness.
- Keep asynchronous publications versioned and cancellation-aware. Editing must not wait on language services.
- Keep declarations, API documentation and integration examples consistent with runtime behavior.
- Generated WASM, dependency directories, screenshots from test runs, local archives and machine-specific benchmark exports stay out of commits. Documentation images are selected assets under `docs/images`.
- Preserve bundled font and Unicode license files when changing assets.

For a bug report, include the browser/OS, reproducible text or a synthetic fixture, exact selection/edits and expected behavior. Performance reports should distinguish input latency, frame work, GPU duration and presentation cadence.

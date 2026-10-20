# Integration and deployment

## Distribution and entry points

Build the repository with `npm ci` and `npm run build`. `npm run pack:editor` produces a self-contained archive under `output/`. The private workspace is not a registry release. A separate application can install that archive or use a local `file:` dependency on `packages/editor` after building.

| Entry | Exports |
| --- | --- |
| `texelune-editor` | `createEditor`, `TexeluneEditorElement`, `themes`, `resolveTheme` and public TypeScript types |
| `texelune-editor/lsp` | `LspClient` and language-service types |
| `texelune-editor/theme` | Theme resolution, token-style and color helpers |

The component is browser ESM. It has no React/Vue peer dependency and no CommonJS or SSR implementation. Import the JavaScript entry only on the client; importing it evaluates the custom-element class and registration. `import type` is safe for server-compiled TypeScript.

## GitHub Pages demo

The [hosted demo](https://komonad.github.io/Texelune/) is built and deployed by `.github/workflows/pages.yml` on pushes to `main`. The workflow compiles WASM and uploads only the static site under `output/pages/`. All module, Worker, font and WASM URLs resolve under the project path.

To generate the same site locally:

```sh
npm run build
npm run build:pages
python -m http.server 4176 --directory output
```

Open `http://127.0.0.1:4176/pages/`. `tests/browser/pages-check.js` exercises this subpath deployment with the Playwright CLI, including Worker language analysis, timeouts and large-text loading. The generated `web/config.js` selects the TypeScript workspace snapshot and Worker server. The source configuration uses the local Rust server endpoints.

GitHub Pages serves the editor, themes, Unicode examples and stress fixtures. TypeScript Language Service 6.0.3 runs in a dedicated Worker behind a JSON-RPC/LSP adapter, providing semantic highlights, diagnostics, hover, definitions and completion. Its compiler and standard-library declarations are copied from the pinned `typescript-browser` npm alias into the site with their licenses; no CDN or backend connection is required. The demo analyzes one open document with the bundled standard libraries; external npm modules and project discovery are not provided.

Rust analysis remains available through `npm run serve`, which runs the rust-analyzer WebSocket bridge. The native TypeScript compiler used for repository type checks is separate from the browser language-service dependency.

## Asset contract

Preserve this relative layout when deploying the packed component:

```text
component/
  index.js, runtime.js, worker.js, navigation.js, lsp-worker.js, ...
  editor.css
  pkg/texelune_editor.js
  pkg/texelune_editor_bg.wasm
  fonts/*.ttf and license notices
```

CSS is loaded into Shadow DOM, fonts are fetched, and module Workers/WASM are resolved relative to their modules. A predictable integration is to copy the **entire package** to a same-origin static directory and dynamically import `/component/index.js`. This avoids depending on bundler-specific transforms of module Workers, `import.meta.url`, WASM and font URLs.

Bundled applications may import the package by name, but must configure their bundler to emit every referenced asset and verify the production build. The repository validates direct browser ESM and the packed layout; it does not establish a bundler/version compatibility matrix. Do not deploy only the JavaScript entry file.

Serve `.js` as JavaScript, `.css` as CSS, `.wasm` as `application/wasm`, and `.ttf` as `font/ttf`. Use HTTPS or localhost. Put the component on the same origin unless module/font/Worker CORS has been explicitly configured. Cross-origin isolation and `SharedArrayBuffer` are not required.

A content-security policy must permit the actual module, stylesheet, Worker, WASM and font requests. Depending on deployment/browser, WASM compilation may require `script-src 'wasm-unsafe-eval'`; Workers need the relevant `worker-src`, and font fetches/LSP WebSockets need appropriate `connect-src`. DOM chrome uses inline styles for measured coordinates. No policy should be copied without testing against the host application's security model.

For a Vite host, copy the installed package into its public directory:

```sh
node --input-type=module -e "import {cpSync} from 'node:fs'; cpSync('node_modules/texelune-editor', 'public/component', {recursive:true, dereference:true})"
```

Repeat this copy after updating the package. Vite serves that directory at `/component/` and copies it to the production output.

## Vanilla JavaScript

```js
const {createEditor} = await import('/component/index.js');
const container = document.getElementById('editor');
container.style.height = '600px';
const editor = await createEditor(container, {value: 'Hello 👩🏽‍💻 שלום'});
const stop = editor.on('change', ({detail}) => saveTransaction(detail));

function unmount() {
  stop();
  editor.destroy();
}
```

Creation resolves before all layout jobs finish. Listen to `frame` if an integration needs visible layout readiness. Do not read the entire document on every keypress for large text; consume incremental `change` events and use `slice` or `documentInfo`.

## React

This example uses Vite's `public/component/` static directory and import-ignore annotation; other bundlers need their equivalent external-URL setting. Browser imports stay inside the effect. The editor is an uncontrolled instance with an initial value and incremental callbacks.

```tsx
import {useEffect, useRef} from 'react';
import type {EditorAPI, EditorChange} from 'texelune-editor';

export function TextEditor({initialValue, onChange}: {
  initialValue: string;
  onChange: (change: EditorChange) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const container = mount.current!;
    let disposed = false;
    let editor: EditorAPI | undefined;
    const moduleUrl = '/component/index.js';
    const loading = import(/* @vite-ignore */ moduleUrl) as Promise<typeof import('texelune-editor')>;
    void loading.then(module => {
      if (disposed) return;
      return module.createEditor(container, {
        value: initialValue,
        onChange: (transaction: EditorChange) => change.current(transaction),
      });
    }).then(instance => {
      if (!instance) return;
      if (disposed) instance.destroy();
      else editor = instance;
    }).catch(error => {
      if (!disposed && error.name !== 'AbortError') console.error(error);
    });
    return () => {
      disposed = true;
      editor?.destroy();
      container.replaceChildren();
    };
  }, [initialValue]);

  return <div ref={mount} style={{height: 600}} />;
}
```

The effect handles disposal before asynchronous initialization and React development remounts. Do not feed each emitted edit back as a new `initialValue`; that replaces the instance. To switch documents in a retained instance, use `load()`. To update hooks, use `configure()`.

## Vue

```vue
<template><div ref="mount" style="height: 600px" /></template>
<script setup lang="ts">
import {onMounted, onBeforeUnmount, ref} from 'vue';
import type {EditorAPI} from 'texelune-editor';

const mount = ref<HTMLDivElement>();
let editor: EditorAPI | undefined;
let disposed = false;
onMounted(async () => {
  try {
    const moduleUrl = '/component/index.js';
    const {createEditor} = await import(/* @vite-ignore */ moduleUrl) as typeof import('texelune-editor');
    if (disposed) return;
    const instance = await createEditor(mount.value!, {value: 'Hello'});
    if (disposed) instance.destroy();
    else editor = instance;
  } catch (error) {
    if (!disposed) console.error(error);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  editor?.destroy();
  mount.value?.replaceChildren();
});
</script>
```

The module type assertion follows the installed package declarations while the import URL stays browser-resolved. The custom element also disposes itself on removal.

## Editing and asynchronous integrations

`onBeforeEdit` is synchronous and can transform/cancel text replacements. `onChange` observes committed transactions. Formatting and undo/redo are separate history operations; document replacement emits `documentchange`. See the [API reference](../packages/editor/API.md) for all interception paths and return values.

Providers receive a version and `AbortSignal`. Long computation belongs in an application Worker or service. A Promise alone does not move synchronous computation away from input. Use a host document identity together with `applyEdit(request, readVersion)` for delayed changes; `load()` starts a new document at version zero.

## Language services

```js
import {LspClient} from '/component/lsp.js';
const language = new LspClient(editor, {
  url: 'wss://example.test/lsp',
  rootUri: 'file:///workspace', uri: 'file:///workspace/main.rs',
  languageId: 'rust',
});
const detach = language.attach();
await language.connect();
// On unmount:
detach();
language.dispose();
```

The adapter speaks JSON-RPC over WebSocket, one JSON object per text message. It does not launch a server from the browser. The bundled loopback rust-analyzer bridge is a development service, not a hosted multi-user backend. Applications supply authenticated backend/session policy and external-file loading when needed.

`attach()` binds hover/definition providers. Diagnostics and completion UI are application-controlled. Cross-file navigation goes through `onNavigate` or the cancellable `navigate` event. Default synchronization stops above 2MiB while editing continues. Immutable semantic read snapshots and replayed highlight ranges preserve provisional styles during asynchronous analysis.

## Browser and accessibility boundaries

Check `navigator.gpu` in the application's capability/error UI. Creation rejects when WebGPU, CSS, fonts or renderer initialization fails. Chromium/Edge have automated coverage; other engines, embedded webviews, IMEs and hardware require separate validation. Rendering has no Canvas fallback.

The textarea bridge exposes an input label and keyboard commands. Full document screen-reader navigation is not implemented. Do not represent the component as an accessible replacement for a native text control in an application requiring that capability. Public entry imports belong on the client in SSR frameworks.

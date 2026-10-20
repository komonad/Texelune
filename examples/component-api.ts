import {createEditor, type EditorAPI, type IndentContext, type TextRange} from '../packages/editor/index.js';
import {LspClient} from '../packages/editor/lsp.js';

export async function mount(container: HTMLElement, workspace: {rootUri: string; uri: string; text: string}) {
  const editor: EditorAPI = await createEditor(container, {
    value: workspace.text, filename: 'main.rs', autoIndent: 'brackets', indentUnit: '  ',
    onBeforeEdit: request => request.text.includes('\0') ? false : request,
    onKeyDown(event, instance) {
      if (event.key === 'F2') { instance.insert('symbol'); return true; }
    },
  });
  const off = editor.on('change', ({detail}) => console.log(detail.version, detail.text));
  const frameOff = editor.on('frame', ({detail}) => console.log(detail.visible_ready, detail.layout_ms));
  const client = new LspClient(editor, {url: 'ws://127.0.0.1:4173/lsp', rootUri: workspace.rootUri, uri: workspace.uri});
  const detach = client.attach();
  client.addEventListener('diagnostics', ({detail}) => console.log(detail.diagnostics.map(item => item.message)));
  await client.connect();
  const widget = editor.addOverlay({anchor: 0, content: 'Module', placement: 'above'});
  widget.update({anchor: 1});
  editor.configure({autoIndent: async (context: IndentContext) => ({text: '\n' + context.leadingWhitespace})});
  editor.configure({wordProvider: undefined});
  const range: TextRange = await editor.wordRange(0);
  editor.select(range.start, range.end);
  const revision = editor.version;
  editor.applyEdit({start: 0, end: 0, text: '// module\n'}, revision);
  return () => {widget.dispose();off();frameOff();detach();client.dispose();editor.destroy();};
}

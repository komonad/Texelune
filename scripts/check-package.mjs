import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../packages/editor/package.json',import.meta.url),'utf8'));
if(manifest.private!==true)throw new Error('The component workspace must remain private.');
const result=spawnSync(process.execPath,[process.env.npm_execpath,'pack','./packages/editor','--dry-run','--json'],{cwd:root,encoding:'utf8'});
if(result.status!==0)throw new Error(result.stderr||'Package inspection failed');
const files=new Set(JSON.parse(result.stdout)[0].files.map(file=>file.path));
const required=['index.js','index.d.ts','lsp.js','lsp.d.ts','theme.js','theme.d.ts','worker.js','navigation.js','lsp-worker.js','lsp-transport.js','diagnostics.js','frame.js','commands.js','command-runtime.js','command-worker.js','editor.css','pkg/texelune_editor.js','pkg/texelune_editor_bg.wasm','README.md','API.md','LICENSE'];
for(const name of ['JetBrainsMono-Regular','JetBrainsMono-Bold','JetBrainsMono-Italic','JetBrainsMono-BoldItalic','NotoSansSC','NotoSansArabic','NotoSansHebrew','NotoSansDevanagari','NotoEmoji'])required.push(`fonts/${name}.ttf`);
for(const name of ['JetBrainsMono','notosanssc','notosansarabic','notosanshebrew','notosansdevanagari','notoemoji'])required.push(`fonts/${name}-OFL.txt`);
for(const file of required)if(!files.has(file))throw new Error(`Missing package asset: ${file}`);
for(const file of files)if(/(^|\/)(tests|node_modules|target)\//.test(file)||(file.startsWith('pkg/')&&!file.startsWith('pkg/texelune_editor')))throw new Error(`Unexpected package asset: ${file}`);
console.log(`Package contains ${files.size} files, including all entries, Workers, WASM and fonts.`);

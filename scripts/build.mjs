import {existsSync,mkdirSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const version='0.2.108';
const metadata=JSON.parse(execFileSync('cargo',['metadata','--locked','--no-deps','--format-version','1'],{cwd:root,encoding:'utf8'}));
const target=metadata.target_directory;
const cached=join(target,'tools',`wasm-bindgen-${version}-x86_64-pc-windows-msvc`,'wasm-bindgen.exe');
let bindgen='wasm-bindgen';
if(spawnSync(bindgen,['--version'],{encoding:'utf8'}).status!==0&&process.platform==='win32'&&existsSync(cached))bindgen=cached;
const found=spawnSync(bindgen,['--version'],{encoding:'utf8'});
if(found.status!==0||!found.stdout.trim().endsWith(' '+version)){
  throw new Error(`wasm-bindgen ${version} is required. Install with: cargo install wasm-bindgen-cli --version ${version} --locked`);
}
function run(command,args){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
run('cargo',['build','--locked','--release','--lib','--target','wasm32-unknown-unknown']);
mkdirSync(join(root,'packages/editor/pkg'),{recursive:true});
run(bindgen,['--target','web','--out-dir','packages/editor/pkg',join(target,'wasm32-unknown-unknown/release/texelune_editor.wasm')]);

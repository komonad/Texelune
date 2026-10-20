import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const outputRoot=join(root,'output');
const output=join(outputRoot,'pages');
const component=join(root,'packages/editor');
for(const name of ['texelune_editor.js','texelune_editor_bg.wasm']){
  if(!existsSync(join(component,'pkg',name)))throw new Error('Build the WASM component with npm run build first.');
}
if(!output.startsWith(outputRoot+sep)||relative(outputRoot,output)!=='pages')throw new Error('Invalid Pages output directory.');
rmSync(output,{recursive:true,force:true});
mkdirSync(join(output,'packages'),{recursive:true});
cpSync(join(root,'web'),join(output,'web'),{recursive:true});
cpSync(component,join(output,'packages/editor'),{recursive:true,filter:source=>!relative(component,source).split(sep).includes('node_modules')});
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])cpSync(join(root,name),join(output,name));
const workspace={rootUri:'file:///texelune-demo/',uri:'file:///texelune-demo/main.ts',filename:'main.ts',languageId:'typescript',server:'TypeScript Worker',text:readFileSync(join(root,'examples/worker-workspace/main.ts'),'utf8'),maxDocumentBytes:2*1048576};
function write(name,text){const path=join(output,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
write('web/workspace.json',JSON.stringify(workspace)+'\n');
write('web/config.js',"export const services={workspace:'./workspace.json',source:null,lsp:null,worker:'./typescript-server.js'};\n");
const typescript=join(root,'node_modules/typescript-browser');
const libraries=Object.fromEntries(readdirSync(join(typescript,'lib')).filter(name=>/^lib.*\.d\.ts$/.test(name)).map(name=>[name,readFileSync(join(typescript,'lib',name),'utf8')]));
write('web/vendor/typescript/libraries.json',JSON.stringify(libraries));
for(const [source,target]of [['lib/typescript.js','typescript.js'],['LICENSE.txt','LICENSE.txt'],['ThirdPartyNoticeText.txt','ThirdPartyNoticeText.txt']])cpSync(join(typescript,source),join(output,'web/vendor/typescript',target));
write('.nojekyll','');
write('index.html','<!doctype html>\n<html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./web/"><title>Texelune</title><a href="./web/">编辑器演示</a></html>\n');
console.log(`Static demo: ${output}`);

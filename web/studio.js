import {createEditor,themes,resolveTheme} from '../packages/editor/index.js';
import {LspClient} from '../packages/editor/lsp.js';
import {samples} from './samples.js';
import {workspaceRelativeUri} from '../packages/editor/uris.js';

const $=id=>document.getElementById(id);
const controls=[...document.querySelectorAll('button,select,input,textarea')];
for(const control of controls)control.disabled=true;
let editor,lsp,workspace,currentTheme=structuredClone(themes.paper),currentFile='rust',hoverTimer=0,diagnostics=[];
const buffers=new Map();
async function openTarget(target,instance,signal){
  if(target.start!==undefined)return false;
  const relative=target.uri?workspaceRelativeUri(target.uri,workspace.rootUri):null;
  if(relative===null){status('目标位于示例工作区之外：'+(target.uri??''));return true;}
  let document=buffers.get(target.uri);
  if(!document){const response=await fetch('/api/source?path='+encodeURIComponent(relative),{signal});if(!response.ok)throw Error('无法读取工作区跳转目标');document=await response.json();}
  if(signal.aborted)return true;
  buffers.set(lsp.options.uri,{text:editor.text});lsp.options.uri=target.uri;
  editor.load(document.text,relative.split('/').at(-1));currentFile='workspace';$('document-name').textContent=relative;
  const range=target.selectionRange??target.range,start=editor.offsetAt(range.start),end=editor.offsetAt(range.end);
  editor.select(start,end);editor.reveal(start);editor.focus();return true;
}
function status(message){$('app-status').textContent=message;}
function panel(name){for(const button of document.querySelectorAll('[data-panel]')){const active=button.dataset.panel===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}for(const nameOption of ['theme','problems','inspect'])$('panel-'+nameOption).hidden=nameOption!==name;}
for(const button of document.querySelectorAll('[data-panel]'))button.onclick=()=>panel(button.dataset.panel);
function updateThemeFields(){
  $('theme-json').value=JSON.stringify(currentTheme,null,2);
  for(const key of ['keyword','function','type']){const value=currentTheme.tokens[key];$('token-'+key).value=typeof value==='string'?value:value?.foreground??'#000000';}
  $('readonly-bold').checked=!!currentTheme.tokens['variable.readonly']?.bold;
}
function applyTheme(theme){
  try{resolveTheme(theme);editor.setTheme(theme);currentTheme=structuredClone(theme);updateThemeFields();$('theme-feedback').classList.remove('error');$('theme-feedback').textContent='已应用 '+(theme.name??'Custom')+'，语义样式同步更新。';}
  catch(error){$('theme-feedback').classList.add('error');$('theme-feedback').textContent=error.message;}
}
$('theme-preset').onchange=event=>{const theme=themes[event.target.value];if(theme)applyTheme(theme);};
for(const key of ['keyword','function','type'])$('token-'+key).oninput=event=>{const theme=structuredClone(currentTheme);theme.name='Custom';theme.tokens[key]=event.target.value;if(key==='type')for(const type of ['struct','enum','interface','class'])theme.tokens[type]=event.target.value;$('theme-preset').value='custom';applyTheme(theme);};
$('readonly-bold').onchange=event=>{const theme=structuredClone(currentTheme);theme.name='Custom';const value=theme.tokens['variable.readonly'];theme.tokens['variable.readonly']={...(typeof value==='string'?{foreground:value}:value),bold:event.target.checked};$('theme-preset').value='custom';applyTheme(theme);};
$('apply-theme').onclick=()=>{try{const theme=JSON.parse($('theme-json').value);applyTheme(theme);$('theme-preset').value='custom';}catch(error){$('theme-feedback').classList.add('error');$('theme-feedback').textContent=error.message;}};
$('reset-theme').onclick=()=>{applyTheme(structuredClone(themes.paper));$('theme-preset').value='paper';};

function renderDiagnostics(items){
  diagnostics=items;$('problem-count').textContent=items.length;$('diagnostics').replaceChildren();
  if(!items.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='当前没有诊断。';$('diagnostics').append(empty);return;}
  for(const item of items){const button=document.createElement('button');button.className='diagnostic'+(item.severity===1?' error':'');button.setAttribute('role','listitem');const message=document.createElement('span');message.textContent=item.message;const location=document.createElement('small');location.textContent=`${item.source??'rust-analyzer'} · Ln ${item.range.start.line+1}:${item.range.start.character+1}`;button.append(message,location);button.onclick=()=>{editor.select(item.start,item.end);editor.focus();editor.scrollTo(Math.max(0,item.range.start.line*28-120));};$('diagnostics').append(button);}
}
function plainContents(contents){if(typeof contents==='string')return contents;if(Array.isArray(contents))return contents.map(plainContents).join('\n\n');return contents?.value??'';}
async function hover(){try{const result=await lsp.hover();$('hover-result').textContent=plainContents(result?.contents)||'光标处没有符号信息。';return result;}catch(error){if(!/changed|session/.test(error.message))$('hover-result').textContent=error.message;}}
$('hover-request').onclick=hover;
async function complete(){
  panel('inspect');$('completions').replaceChildren();
  try{const revision=editor.version,items=await lsp.complete();for(const item of items.filter(i=>!i.additionalEdits&&!i.snippet).slice(0,24)){const button=document.createElement('button');button.textContent=item.label;button.title=item.detail;button.onclick=()=>{if(editor.version!==revision){status('文档已更新，请重新请求补全。');return;}editor.replace(item.start,item.end,item.text);editor.focus();$('completions').replaceChildren();};$('completions').append(button);}if(!items.length)status('当前位置没有补全结果。');return items;}catch(error){status(error.message);return [];}
}
$('completion-request').onclick=complete;
$('refresh-lsp').onclick=()=>lsp.refresh();
async function reconnect(){if(!editor)return;if(!['rust','workspace'].includes(currentFile)){status('切换到 Rust 工作区文件可连接语言服务。');return;}try{await lsp.connect();}catch(error){status(error.message);}}
$('reconnect').onclick=reconnect;
function setFile(key){
  currentFile=key;clearTimeout(hoverTimer);lsp.disconnect();renderDiagnostics([]);$('highlight-source').textContent=key==='rust'?'LSP 连接中…':'纯文本 · Unicode 布局';
  document.querySelectorAll('[data-sample]').forEach(button=>button.classList.toggle('active',button.dataset.sample===key));
  const name=key==='rust'?'main.rs':key+'.txt';$('document-name').textContent=name;editor.setSyntax(key==='rust');lsp.options.uri=workspace.uri;editor.load(key==='rust'?(buffers.get(workspace.uri)?.text??workspace.text):samples[key],name);if(key==='rust')void reconnect();
}
document.querySelectorAll('[data-sample]').forEach(button=>button.onclick=()=>setFile(button.dataset.sample));
async function synthetic(bytes,code=false){currentFile='stress';lsp.disconnect();renderDiagnostics([]);$('highlight-source').textContent='大文档 · 语言服务暂停';$('document-name').textContent=(bytes/1048576)+'MiB.txt';editor.setSyntax(code);await editor.loadSynthetic(bytes,code);status('大文档已加载，编辑器独立运行。');}
$('large-100mb').onclick=()=>synthetic(100*1048576);
$('long-code').onclick=()=>synthetic(16*1048576,true);
function stress(kind){currentFile='stress';lsp.disconnect();const worker=new Worker(new URL('./stress.js',import.meta.url));status('生成测试文档…');worker.onmessage=({data})=>{editor.load(data,kind+'.txt');editor.setSyntax(false);$('document-name').textContent=kind+'.txt';$('highlight-source').textContent='文本布局';worker.terminate();status('测试文档已加载。');};worker.postMessage(kind);}
for(const kind of ['large','long','combining'])$(kind).onclick=()=>stress(kind);

async function boot(){
  try{
    const response=await fetch('/api/workspace');if(!response.ok)throw new Error('Workspace service unavailable');workspace=await response.json();
    editor=await createEditor($('editor-container'),{value:workspace.text,filename:'main.rs',theme:currentTheme,performance:true,autoIndent:'brackets',indentUnit:'    ',onNavigate:openTarget});
    window.texelune=editor;
    const url=new URL('/lsp',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    lsp=new LspClient(editor,{url:url.href,rootUri:workspace.rootUri,uri:workspace.uri,languageId:'rust',maxDocumentBytes:workspace.maxDocumentBytes});
    lsp.attach();
    lsp.addEventListener('status',({detail})=>{$('connection-label').textContent={ready:'rust-analyzer',indexing:'索引中',connecting:'连接中',disconnected:'未连接',paused:'同步暂停',waiting:'等待服务',error:'连接失败'}[detail.state]??detail.state;$('connection-dot').className='connection-dot '+detail.state;status(detail.message);});
    lsp.addEventListener('tokens',({detail})=>{$('highlight-source').textContent=`LSP semantic · ${detail.count} tokens`;$('component-state').textContent=`WebGPU · ${detail.theme}`;});
    lsp.addEventListener('timing',({detail})=>$('service-cost').textContent='语义请求与处理 '+detail.elapsed.toFixed(1)+' ms');
    lsp.addEventListener('diagnostics',({detail})=>renderDiagnostics(detail.diagnostics));
    editor.root.host.addEventListener('selectionchange',()=>{clearTimeout(hoverTimer);if(!editor.selection||$('panel-inspect').hidden)return;hoverTimer=setTimeout(hover,350);});
    editor.root.host.addEventListener('change',()=>{clearTimeout(hoverTimer);renderDiagnostics([]);$('completions').replaceChildren();});
    editor.root.host.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.code==='Space'){event.preventDefault();void complete();}},{capture:true});
    editor.root.host.addEventListener('notice',({detail})=>status(detail));
    updateThemeFields();
    window.studio={editor,lsp,get diagnostics(){return diagnostics;},setFile,applyTheme,hover,complete};
    for(const control of controls)control.disabled=false;
    await reconnect();
  }catch(error){status(error.message);$('connection-label').textContent='启动失败';console.error(error);}
}
void boot();

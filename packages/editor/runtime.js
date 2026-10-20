import init, {Editor, Renderer, DocumentImport, VisualNavigation} from './pkg/texelune_editor.js';
import {PerformanceStats,PerformancePanel,FrameTracker,liveFpsText,liveCostText} from './performance.js';
import {prepareDocument} from './import.js';
import {inspectableFrame,FrameStager} from './frame.js';
import {BenchmarkRunner} from './benchmark.js';
import {resolveTheme,applyThemeCSS} from './theme.js';
import {scalarLength,indentInsertion,deadline} from './editing.js';
import {OverlayLayer} from './overlays.js';
import {Interactions} from './interactions.js';
import {DiagnosticLayer} from './diagnostics.js';
import {compileKeybindings,editorCommands} from './commands.js';
import {CommandController} from './command-runtime.js';
import {CompletionController} from './completion.js';
import {BracketController,bracketPairs} from './brackets.js';
let wasmPromise;

export async function mountEditor(root,options={}){
options={...options,bracketPairs:bracketPairs(options.bracketPairs)};
const initialTheme=resolveTheme(options.theme);
const controller=new AbortController(),signal=controller.signal;
let destroyed=false,animation=0;
const emit=(type,detail)=>{root.host.dispatchEvent(new CustomEvent(type,{detail}));const callback={change:'onChange',selectionchange:'onSelectionChange'}[type];if(api&&callback&&options[callback])try{options[callback](detail,api);}catch(error){notice(error.message);}};
const $ = id => root.getElementById(id);
const canvas=$('canvas'), input=$('input'), viewport=$('viewport');
let editor,renderer,worker,navigation,fonts,ready=false,workerReady=false,navReady=false;
let initialSource={kind:'text',text:(options.value??'')};
let initialText=(options.value??''), changes=[], inlays=[], externalHighlights=null, workerQueue=[], navQueue=[];
let generation=0,request=0,latest=null,scroll=0,width=800,height=600,scale=1;
let dirty=true,inFlight=0,blink=true,lastBlink=0,lastFrame=0,lastEdit=0,lastInputVersion=-1;
let affinity=null,dragging=false,composition=null,preferredX=null;
let pendingFrame=null,workerStarted=0,lastProgress=0,lastWorkerVersion=-1;
let rendererGeneration=0,recovering=false;
const frameStager=new FrameStager();
let restartTimer=0,drawCount=0,intervals=[],submitTimes=[],lastMetrics=0,lastLatency=null;
const formatDefaults={bold:false,italic:false,underline:false,foreground:null,background:null};
const performanceStats=new PerformanceStats(),performancePanel=new PerformancePanel(performanceStats,root);
const frameTracker=new FrameTracker(performanceStats);
let postingTrace=null;
let theme=initialTheme;
applyThemeCSS(root.host,theme);
let wasm,layoutMemory=null,navMemory=0,visual=null,fontSize=17,importEpoch=0,adapterLabel='';
let motionQueue=[],motionPending=null,motionSerial=0,drainingMotions=false;
let lastDrawCalls=0,scrollDrag=null;
let pendingLiveWorkerMs=0,pendingLiveUpdate=false,lastGpuRequest=-Infinity;
let chromeScroll=NaN;
let api,interactions,diagnostics,editPending,wordSerial=0,wordPending=new Map(),wordReads=new Set(),selectionSerial=0,selectionDrag=null,selectionAbort,documentGeneration=0;
let commands,completion,brackets;
const mac=/Mac|iPhone|iPad/.test(navigator.platform);
let keybindingOptions={...options.keybindings},keybinding=compileKeybindings(keybindingOptions,mac);
const overlays=new OverlayLayer(viewport,offset=>{const c=visual?.resolve(offset,null);if(!c)return null;const y=c.y-(scroll-(latest?.scroll??scroll));return y+c.h>0&&y<height?{...c,y}:null;});
function reportProvider(kind,error){emit('providererror',{kind,error});}
function cancelEdit(){editPending?.abort();editPending=null;commands?.cancel();}
function cancelWords(){for(const read of wordReads)read.abort();wordReads.clear();for(const pending of [...wordPending.values()])pending.reject();}
function edit(start,end,text,source='api',caretOffset,selectionAfter){
  const generation=documentGeneration;
  let request={start,end,text,source,caretOffset,version:version(),selection:currentSelection()};
  try{
    const transformed=options.onBeforeEdit?.(request,api);
    if(transformed===false)return false;
    if(transformed?.then)throw new TypeError('onBeforeEdit must return synchronously');
    if(transformed)request={...request,...transformed};
    const event=new CustomEvent('beforeedit',{detail:request,cancelable:true});if(!root.host.dispatchEvent(event))return false;
    if(destroyed||generation!==documentGeneration||request.version!==version())return false;
    if(!Number.isSafeInteger(request.start)||!Number.isSafeInteger(request.end)||request.start<0||request.end<request.start||request.end>editor.length()||typeof request.text!=='string')throw new RangeError('Invalid edit range');
    if(request.caretOffset!==undefined&&(!Number.isSafeInteger(request.caretOffset)||request.caretOffset<0))throw new RangeError('Invalid caret offset');
    const change=editor.replace(request.start,request.end,request.text);
    change.source=request.source;
    const relative=request.caretOffset;
    if(relative!==undefined){const position=request.start+Math.max(0,Math.min(scalarLength(request.text),relative));editor.select(position,position);change.selection=currentSelection();}
    else if(selectionAfter&&request.start===start&&request.end===end&&request.text===text){editor.select(Math.max(0,Math.min(editor.length(),selectionAfter.anchor)),Math.max(0,Math.min(editor.length(),selectionAfter.head)));change.selection=currentSelection();}
    commit(change);return true;
  }catch(error){reportProvider('edit',error);return false;}
}
function insertText(text,source='input',caretOffset){const s=currentSelection(),start=Math.min(s.anchor,s.head),end=Math.max(s.anchor,s.head);return source==='input'&&brackets?brackets.input(text,start,end):edit(start,end,text,source,caretOffset);}
async function insertNewline(){
  cancelEdit();const abort=editPending=new AbortController(),revision=version(),s=currentSelection(),start=Math.min(s.anchor,s.head),end=Math.max(s.anchor,s.head);
  const position=editor.position_at(start),range=editor.line_range(position.line);
  const nextLine=editor.line_range(editor.position_at(end).line);
  const prefix=editor.slice(range[0],Math.min(start,range[0]+4096)),leadingWhitespace=prefix.match(/^[\t ]*/)[0];
  const context={editor:api,version:revision,selection:s,position,before:editor.slice(Math.max(range[0],start-4096),start),after:editor.slice(end,Math.min(nextLine[1],end+4096)),leadingWhitespace,indentUnit:options.indentUnit??'    ',bracketPairs:options.bracketPairs,truncated:start-range[0]>4096||nextLine[1]-end>4096,signal:abort.signal};
  try{
    const strategy=options.autoIndent??'keep';
    const result=typeof strategy==='function'?await deadline(()=>strategy(context),abort.signal,options.providerTimeout??8000):indentInsertion(context,strategy);
    if(abort.signal.aborted||destroyed)return false;
    const now=currentSelection();if(abort.signal.aborted||revision!==version()||now.anchor!==s.anchor||now.head!==s.head)return false;
    return result!==null&&insertText(typeof result==='string'?result:result.text,'newline',result?.caretOffset);
  }catch(error){abort.abort();if(error.name!=='AbortError')reportProvider('indent',error);return false;}
  finally{if(editPending===abort)editPending=null;}
}
async function wordRange(offset,signal){
  if(signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
  if(options.wordProvider){
    const abort=new AbortController(),cancel=()=>abort.abort();wordReads.add(abort);signal?.addEventListener('abort',cancel,{once:true});
    const revision=version(),line=lineRange(editor.position_at(offset).line),start=Math.max(line.start,offset-2048),end=Math.min(line.end,offset+2048);
    try{
      const result=await deadline(()=>options.wordProvider({editor:api,version:revision,offset,position:editor.position_at(offset),signal:abort.signal,text:editor.slice(start,end),start,truncated:start>line.start||end<line.end}),abort.signal,options.providerTimeout??8000);
      if(destroyed||revision!==version())throw new DOMException('Document changed','AbortError');
      if(result){if(!Number.isSafeInteger(result.start)||!Number.isSafeInteger(result.end)||result.start<0||result.end<result.start||result.end>editor.length())throw new RangeError('Invalid word range');return result;}
    }catch(error){abort.abort();throw error;}finally{wordReads.delete(abort);signal?.removeEventListener('abort',cancel);}
  }
  const immediate=editor.word_range(offset,false);if(immediate)return Promise.resolve({start:immediate[0],end:immediate[1]});
  if(!navigation)startNavigation();const id=++wordSerial,revision=version();
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);wordPending.delete(id);};
    const cancel=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};
    const timer=setTimeout(()=>{cleanup();reject(new DOMException('Word selection timed out','TimeoutError'));},8000);
    signal?.addEventListener('abort',cancel,{once:true});wordPending.set(id,{resolve:range=>{cleanup();if(revision===version())resolve({start:range[0],end:range[1]});else reject(new DOMException('Document changed','AbortError'));},reject:cancel});
    navPost({type:'word',id,offset,version:revision});
  });
}
function lineRange(line){const [start,end]=editor.line_range(line);return{start,end};}
async function selectWord(offset){selectionAbort?.abort();const abort=selectionAbort=new AbortController(),token=++selectionSerial,revision=version();try{const range=await wordRange(offset,abort.signal);if(!abort.signal.aborted&&!destroyed&&token===selectionSerial&&version()===revision){editor.select(range.start,range.end);selectionChanged();}}catch(error){if(error.name!=='AbortError')reportProvider('word',error);}}
const benchmarkRunner=new BenchmarkRunner({
  renderer:()=>ready?renderer:null,worker:()=>worker,
  consume(frame){
    if(!frame.visible_ready||Number(frame.version)!==version()||frame.request!==request)throw new Error('Benchmark scene is not current');
    if(frame.patches.length)renderer.patch(frame.patches);
    renderer.upload(frame.instances);const nav=VisualNavigation.from_packed(frame.packed_navigation);nav.free();
    renderer.draw_offscreen(width,height,0);
  },
  draw(){renderer.draw_offscreen(width,height,latest?scroll-latest.scroll:0);return latest?.quad_count??0;},
  restore(){if(ready&&latest)renderer.upload(latest.instances);dirty=true;},
  onState(state){
    if(state.report){Object.assign(state.report,{adapter:renderer.adapter_name()||adapterLabel,width:canvas.width,height:canvas.height,bytes:editor.bytes(),font_size:fontSize});performanceStats.setBenchmark(state.report);lastMetrics=0;}
    performancePanel.benchmarkState(state);
  }
});
async function runBenchmark(mode='warm'){
  if(!ready||!workerReady||!latest?.visible_ready||latest.request!==request||Number(latest.version)!==version())throw new Error('Visible layout is not ready');
  return benchmarkRunner.run(mode);
}
performancePanel.onBenchmark=mode=>{if(benchmarkRunner.active)benchmarkRunner.cancel();else runBenchmark(mode).catch(error=>{if(error.name!=='AbortError')notice(String(error));});};
performancePanel.onReset=()=>{benchmarkRunner.cancel();dirty=true;lastMetrics=0;lastGpuRequest=-Infinity;};
performancePanel.onCancel=()=>{importEpoch++;performancePanel.task(null);notice('Import cancelled');};
function cancelMotions(){motionQueue=[];motionPending=null;motionSerial++;}
function intent(action){if(motionPending||motionQueue.length)motionQueue.push({action});else action();}
function enqueueMotion(command,extend){motionQueue.push({command,extend});drainMotions();}
function acceptMotion(hit,job){
  if(!hit)return;
  const selection=currentSelection();editor.select(job.extend?selection.anchor:hit.offset,hit.offset);affinity=hit;
  selectionChanged(true);post({type:'selection',selection:currentSelection(),reveal:true,affinity});ensureCaret();
}
function drainMotions(){
  if(drainingMotions||motionPending)return;drainingMotions=true;
  try{
    while(motionQueue.length&&!motionPending){
      const job=motionQueue.shift();
      if(job.action){job.action();continue;}
      const selection=currentSelection(),c=caret();
      if(job.command==='up'||job.command==='down')preferredX??=c?.x;else preferredX=null;
      if(!job.extend&&selection.anchor!==selection.head&&['left','right'].includes(job.command)){
        const a=visual?.resolve(selection.anchor,null),b=visual?.resolve(selection.head,affinity);
        if(a&&b){acceptMotion(visual.collapse(selection.anchor,selection.head,job.command==='right'),job);continue;}
      }
      const hit=latest&&Number(latest.version)===version()?visual?.motion(selection.head,affinity,job.command,preferredX??undefined):null;
      if(hit){acceptMotion(hit,job);continue;}
      const token=++motionSerial;motionPending={token,job,version:version(),offset:selection.head};
      post({type:'navigate',token,version:version(),offset:selection.head,affinity,command:job.command,preferred_x:preferredX});
    }
  }finally{drainingMotions=false;}
}
function setFontSize(value){fontSize=Math.max(10,Math.min(40,Math.round(value)||17));$('font-size').value=fontSize;renderer?.set_font_size(fontSize);input.style.fontSize=fontSize+'px';sendView();post({type:'selection',selection:currentSelection(),reveal:true,affinity});dirty=true;}
function notice(text){$('notice').textContent=text;emit('notice',text);}
let fullscreenPending=false;
const workspace=$('editor-workspace');
function fullscreenActive(){return root.fullscreenElement===workspace||workspace.classList.contains('is-fullscreen');}
function syncFullscreen(){
  const active=fullscreenActive(),button=$('fullscreen-toggle');
  root.host.toggleAttribute('fullscreen',active);
  button.textContent=active?'退出全屏':'全屏';button.setAttribute('aria-pressed',String(active));
  button.setAttribute('aria-label',active?'退出全屏':'全屏编辑器');button.title=(active?'退出全屏':'全屏编辑器')+' (Alt+Enter)';
  if(ready)input.focus({preventScroll:true});
}
async function toggleFullscreen(){
  if(fullscreenPending)return;fullscreenPending=true;
  try{
    if(root.fullscreenElement===workspace)await document.exitFullscreen();
    else if(workspace.classList.contains('is-fullscreen'))workspace.classList.remove('is-fullscreen');
    else{
      try{if(!workspace.requestFullscreen)throw new Error('Fullscreen unavailable');await workspace.requestFullscreen();}
      catch{workspace.classList.add('is-fullscreen');}
    }
  }catch(error){notice('Fullscreen: '+error.message);}
  finally{fullscreenPending=false;syncFullscreen();}
}
function resumeTrace(trace){if(frameTracker.matches(trace)){postingTrace=trace;queueMicrotask(()=>postingTrace=null);}}
function post(message){
  if(benchmarkRunner.active)benchmarkRunner.cancel();
  if(performanceStats.benchmark){performanceStats.benchmark=null;performancePanel.benchmarkState({cancelled:true});}
  if(!postingTrace||!frameTracker.matches(postingTrace)){postingTrace=frameTracker.begin(performance.timeOrigin+performance.now());queueMicrotask(()=>postingTrace=null);}
  message={...message,trace:postingTrace};
  if(workerReady)worker.postMessage(message);else workerQueue.push(message);
}
function navPost(message){if(navReady)navigation.postMessage(message);else navQueue.push(message);}
function releaseFrameBackpressure(){
  if(inFlight>=2)return;const now=performance.timeOrigin+performance.now();
  for(const scene of [latest,pendingFrame])if(scene?.blockedAt!=null){scene.backpressureMs+=now-scene.blockedAt;scene.blockedAt=null;}
}
function version(){return Number(editor.version());}
function currentSelection(){return editor.selection();}
function updateStatus(){
  const s=currentSelection();
  emit('selectionchange',s);
  $('position').textContent=`Offset ${s.head.toLocaleString()}${s.anchor!==s.head?` · ${Math.abs(s.head-s.anchor).toLocaleString()} selected`:''}`;
  $('size').textContent=`${editor.length().toLocaleString()} chars · ${editor.lines().toLocaleString()} lines`;
}
function sendView(){
  post({type:'view',width,height,scale,scroll,font_size:fontSize,wrap:$('wrap').checked,code:$('code').checked,request:++request});
}
function selectionChanged(keepAffinity=false){
  cancelEdit();selectionAbort?.abort();selectionSerial++;
  if(!keepAffinity){affinity=null;if(!drainingMotions)cancelMotions();}
  post({type:'selection',selection:currentSelection()});
  dirty=true; blink=true;lastBlink=performance.now();updateStatus();
}
function commit(change){
  if(!change)return;
  cancelEdit();interactions?.changed();cancelWords();
  clearDiagnostics();
  for(const item of overlays.items)item.anchor=Editor.map_anchor(item.anchor,change.start,change.end,scalarLength(change.text));
  if(!drainingMotions)cancelMotions();
  inlays=inlays.map(i=>({...i,anchor:Editor.map_anchor(i.anchor,change.start,change.end,[...change.text].length)}));
  changes.push(change);post({type:'change',change});if(navigation)navPost({type:'change',change});
  emit('change',{...change,version:version()});
  // View requests are replaceable; document transactions remain strictly ordered.
  sendView();
  lastEdit=performance.now();lastInputVersion=version();affinity=null;preferredX=null;
  selectionChanged();
  if(performance.now()-lastProgress>150 && lastWorkerVersion<version()-1) {
    clearTimeout(restartTimer);
    restartTimer=setTimeout(()=>{if(lastWorkerVersion<version()-1&&performance.now()-lastProgress>250)startWorker();},100);
  }
}
function applyToggle(attribute){commit(editor.toggle(attribute));input.focus({preventScroll:true});}
function clearDiagnostics(){if(diagnostics?.items.length){diagnostics.set([]);emit('diagnosticschange',{version:version(),diagnostics:diagnostics.items});}}
function goToDiagnostic(direction=1){
  const selection=currentSelection(),item=diagnostics.index.next(Math.min(selection.anchor,selection.head),direction);if(!item)return null;
  editor.select(item.start,item.end);selectionChanged();post({type:'reveal',offset:item.start});input.focus({preventScroll:true});
  interactions.show(diagnostics.hover(item.start),item.start);return item;
}
function applyStyle(style){
  commit(editor.format({...formatDefaults,...style}));input.focus({preventScroll:true});
}
function resize(){
  const r=viewport.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);scale=Math.min(devicePixelRatio||1,3);
  canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  renderer?.resize(canvas.width,canvas.height);if(ready)sendView();dirty=true;
}
function setScroll(value){
  interactions?.reset();
  completion?.hide();
  const max=Math.max(0,(latest?.total_height||height)-height);
  scroll=Math.max(0,Math.min(max,value));sendView();dirty=true;
}
function caret(){
  if(!visual||!latest||Number(latest.version)!==version())return null;
  const hit=visual.resolve(currentSelection().head,affinity);
  return hit?{...hit,y:hit.y-(scroll-latest.scroll)}:null;
}
function hitAt(x,y){
  if(!visual||!latest||Number(latest.version)!==version())return null;
  const hit=visual?.hit_test(x,y+(scroll-(latest?.scroll??scroll)));return hit?{...hit,y:hit.y-(scroll-latest.scroll)}:null;
}
function ensureCaret(){
  const c=caret();if(!c)return;
  if(c.y<0)setScroll(scroll+c.y-16);else if(c.y+c.h>height)setScroll(scroll+c.y+c.h-height+16);
}
function deferBoundary(forward,action,extend=false){
  if(!navigation)startNavigation();
  navPost({type:'boundary',position:currentSelection().head,selection:currentSelection(),version:version(),forward,action,extend});
  notice('Resolving an extended grapheme cluster in a worker…');
}
function deleteText(forward){const range=editor.deletion_range(forward);if(range)edit(range[0],range[1],'','delete');else deferBoundary(forward,'delete');}
function startWorker(){
  benchmarkRunner.cancel();
  pendingLiveWorkerMs=0;pendingLiveUpdate=false;
  worker?.terminate();workerReady=false;workerQueue=[];
  pendingFrame=null;generation++;lastProgress=performance.now();workerStarted=lastProgress;
  const replay=changes.length;
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  const mine=generation;
  worker.onmessage=({data:m})=>{
    if(m.generation!==mine||mine!==generation)return;
    if(m.type.startsWith('benchmark_')){void benchmarkRunner.handle(m);return;}
    lastProgress=performance.now();
    if(m.type==='progress'){performancePanel.task('布局副本 · '+(m.progress*100).toFixed(0)+'%',m.progress);return;}
    if(m.type==='motion'){
      const pending=motionPending;if(!pending||pending.token!==m.token)return;motionPending=null;
      performanceStats.record('navigation',m.navigation_ms);
      resumeTrace(m.trace);
      if(pending.version===version()&&pending.offset===currentSelection().head)acceptMotion(m.hit,pending.job);
      drainMotions();return;
    }
    if(m.type==='ready'){
      layoutMemory=m.memory;performancePanel.task(null);
      workerReady=true;
      for(const message of workerQueue)worker.postMessage(message);
      workerQueue=[];sendView();post({type:'selection',selection:currentSelection()});
    }else if(m.type==='frame'){
      // Atlas writes and geometry switch together when the visible layout is complete.
      const visibleReady=frameStager.stage(m.frame,mine);
      layoutMemory=m.memory;
      m.frame.worker_ms=m.elapsed;
      if(m.frame.jobs_processed)performanceStats.record('layout',m.frame.layout_ms);
      for(const [name,value]of Object.entries({scene:m.frame.scene_ms,raster:m.frame.raster_ms,serialize:m.marshal_ms,transport:performance.timeOrigin+performance.now()-m.sent_at}))performanceStats.record(name,value);
      m.frame.patches=[];
      lastWorkerVersion=Number(m.frame.version);
      if(visibleReady&&lastWorkerVersion===version()&&m.frame.request===request&&frameTracker.accepts(m.trace)){m.frame.trace=m.trace;m.frame.ready_at=performance.timeOrigin+performance.now();m.frame.backpressureMs=0;m.frame.blockedAt=inFlight>=2?m.frame.ready_at:null;pendingFrame=m.frame;dirty=true;}
      if(m.frame.jobs_processed)$('worker').innerHTML=`${m.frame.layout_ms.toFixed(2)}<small>ms</small>`;
      $('jobs').textContent=`${m.frame.pending} jobs · ${m.frame.cached_blocks} cached blocks`;
      $('state').textContent=m.frame.pending?'Refining layout':'Ready';
    }else if(m.type==='error'){
      notice(`Layout error: ${m.message}`);$('state').textContent='Layout failed';
    }
  };
  worker.onerror=e=>{notice(`Worker: ${e.message}`);$('state').textContent='Worker failed';};
  worker.postMessage({type:'init',generation:mine,fonts,source:initialSource,changes:changes.slice(0,replay),inlays,theme:theme.engine,highlights:externalHighlights});
  sendView();
}
function startNavigation(){
  navigation?.terminate();navReady=false;navQueue=[];
  navigation=new Worker(new URL('./navigation.js',import.meta.url),{type:'module'});
  navigation.onmessage=({data:m})=>{
    if(m.memory)navMemory=m.memory;
    if(m.type==='ready'){navReady=true;for(const message of navQueue)navigation.postMessage(message);navQueue=[];return;}
    if(m.type==='word'){wordPending.get(m.id)?.resolve(m.range);return;}
    if(m.version!==version())return;
    const s=currentSelection();if(s.head!==m.selection.head||s.anchor!==m.selection.anchor)return;
    if(m.action==='delete')edit(Math.min(s.head,m.position),Math.max(s.head,m.position),'','delete');
    else{editor.select(m.extend?s.anchor:m.position,m.position);selectionChanged();if(m.action==='bracket')api.reveal();}
    notice('Grapheme boundary resolved');
  };
  navigation.postMessage({type:'init',source:initialSource,changes:[...changes]});
}
function installDocument(next,source,name){
  documentGeneration++;cancelEdit();interactions?.changed();cancelWords();
  clearDiagnostics();
  for(const item of [...overlays.items]){item.element.remove();overlays.items.delete(item);}
  importEpoch++;performancePanel.task(null);cancelMotions();composition=null;input.value='';
  renderer?.invalidate();frameStager.reset();$('loading').style.display='flex';$('loading').querySelector('b').textContent='Preparing document layout';$('loading-detail').textContent='Loading the visible region…';
  editor?.free();editor=next;initialSource=source;initialText=source.text??'';changes=[];inlays=[];externalHighlights=null;
  navigation?.terminate();navigation=null;navReady=false;navQueue=[];navMemory=0;
  visual?.free();visual=null;scroll=0;latest=null;affinity=null;lastInputVersion=-1;lastWorkerVersion=-1;lastEdit=0;lastLatency=null;
  $('filename').textContent=name;startWorker();updateStatus();dirty=true;emit('documentchange',{name,version:version(),bytes:editor.bytes()});
}
function loadText(text,name='untitled.txt'){installDocument(new Editor(text),{kind:'text',text},name);}
async function loadSynthetic(bytes=100*1048576,code=false){
  const mine=++importEpoch,started=performance.now();performancePanel.show(true);
  performancePanel.task('生成 '+(bytes/1048576).toFixed(0)+' MiB 文档…',0,true);
  try{
    const job=await prepareDocument(DocumentImport,bytes,p=>performancePanel.task('生成 '+(bytes/1048576).toFixed(0)+' MiB · '+(p*100).toFixed(0)+'%',p,true),()=>mine!==importEpoch,code);
    if(mine!==importEpoch){job.free();return;}
    installDocument(job.finish_editor(),{kind:'synthetic',bytes,code},(bytes/1048576).toFixed(0)+(code?'-single-line':'')+'MiB.txt');
    performanceStats.record('import',performance.now()-started);notice('Document imported: '+(bytes/1048576).toFixed(0)+' MiB UTF-8');
  }catch(error){if(error.name!=='AbortError')notice('Import failed: '+error);if(mine===importEpoch)performancePanel.task(null);}
}
function addInlay(block){
  const anchor=currentSelection().head;
  inlays.push({anchor,text:block?'Evaluation result: 42':': Text',block});
  post({type:'inlays',inlays});sendView();input.focus({preventScroll:true});
}
function positionInput(){
  const c=caret();input.style.left=`${Math.max(54,Math.min(width-20,c?.x||66))}px`;
  input.style.top=`${Math.max(0,Math.min(height-28,c?.y||16))}px`;
}
function updateChrome(){
  if(!latest)return;
  chromeScroll=scroll;
  const delta=scroll-latest.scroll;
  const labels=latest.labels.filter(l=>l.y-delta>-28&&l.y-delta<height);
  $('numbers').replaceChildren(...labels.map(l=>{const el=document.createElement('span');el.textContent=l.line;el.style.top=`${l.y-delta}px`;return el;}));
  const total=Math.max(height,latest.total_height),track=height,thumb=Math.max(36,track*height/total);
  $('thumb').style.height=`${thumb}px`;$('thumb').style.top=`${(track-thumb)*scroll/Math.max(1,total-height)}px`;
  positionInput();
  overlays.update(overlays.range?latest.navigation.cells:[],delta);
  diagnostics?.render();
  brackets?.render();
}
function loop(time){
  if(destroyed)return;
  const frameStart=performance.now();performanceStats.tick(time);
  if(pendingFrame&&(Number(pendingFrame.version)!==version()||pendingFrame.request!==request))pendingFrame=null;
  const drawStartedAt=performance.timeOrigin+frameStart,hasNewFrame=!!pendingFrame;
  if(lastFrame){intervals.push(time-lastFrame);if(intervals.length>180)intervals.shift();}lastFrame=time;
  if(time-lastBlink>530){blink=!blink;lastBlink=time;if(editor&&root.activeElement===input&&currentSelection().head===currentSelection().anchor)dirty=true;}
  if(pendingFrame&&!benchmarkRunner.active){
    latest=pendingFrame;pendingFrame=null;
    latest=inspectableFrame(latest);
    pendingLiveWorkerMs+=Math.max(0,latest.worker_ms||0);pendingLiveUpdate=true;
    const atlas=frameStager.take(latest),patchStart=performance.now();
    if(atlas.reset)renderer.invalidate();renderer.patch(atlas.patches);
    const patchTime=performance.now()-patchStart;if(atlas.patches.length)performanceStats.record('atlas',patchTime);
    const uploadStart=performance.now();renderer.upload(latest.instances);visual?.free();visual=VisualNavigation.from_packed(latest.packed_navigation);performanceStats.record('geometry',performance.now()-uploadStart);
    // Height corrections preserve the worker's document anchor.
    scroll=latest.scroll;updateChrome();
    emit('frame',latest);
    $('loading').style.display='none';
  }
  if(renderer&&ready&&!benchmarkRunner.active&&inFlight<2&&(dirty||$('continuous').checked)){
    if(latest&&scroll!==chromeScroll)updateChrome();
    const c=caret(),s=currentSelection();
    try{
      let drew=false;
      const renderStart=performance.now();
      const showCaret=!!c&&blink&&s.head===s.anchor&&root.activeElement===input;
      if(pendingLiveUpdate||time-lastGpuRequest>250){renderer.request_sample();lastGpuRequest=time;}
      if(renderer.draw(width,height,latest?scroll-latest.scroll:0,c?.x||66,c?.y||16,showCaret)){
        drew=true;
        performanceStats.record('render',performance.now()-renderStart);performanceStats.draw(performance.now());lastDrawCalls=(latest?.quad_count?1:0)+(showCaret?1:0);
        const rendererEpoch=rendererGeneration,sampleEpoch=performanceStats.epoch,hadScene=!!latest;
        const trace=latest?.visible_ready?frameTracker.claim(latest.trace):null;
        const completion={readyAt:latest?.ready_at,drawStartedAt,backpressureMs:latest?.backpressureMs??0,version:Number(latest?.version),request:latest?.request};
        inFlight++;const submittedAt=performance.now();
        renderer.submitted().then(()=>{
          if(destroyed||rendererEpoch!==rendererGeneration||sampleEpoch!==performanceStats.epoch)return;
          const finishedAt=performance.timeOrigin+performance.now();
          if(trace)frameTracker.complete(trace,{...completion,finishedAt});
          else if(!hasNewFrame&&latest)performanceStats.record('redraw',finishedAt-drawStartedAt);
        }).catch(error=>notice('GPU completion: '+error)).finally(()=>{if(rendererEpoch===rendererGeneration){inFlight--;releaseFrameBackpressure();if(sampleEpoch===performanceStats.epoch)performanceStats.record('queue',performance.now()-submittedAt);}});drawCount++;
        renderer.gpu_sample()?.then(ms=>{
          if(destroyed||rendererEpoch!==rendererGeneration)return;
          if(sampleEpoch===performanceStats.epoch&&hadScene)performanceStats.record('gpu',ms);
          if(ready&&latest&&!performanceStats.series.get('gpu')?.values.length){dirty=true;lastGpuRequest=-Infinity;}
        }).catch(()=>{});
        if(latest&&lastEdit&&lastInputVersion===Number(latest.version)){lastLatency=performance.now()-lastEdit;performanceStats.record('input',lastLatency);lastEdit=0;}
      }
      const frameCpu=performance.now()-frameStart;performanceStats.record('frame',frameCpu);
      if(drew&&latest){performanceStats.recordLive({kind:pendingLiveUpdate?'update':'redraw',workerMs:pendingLiveWorkerMs,mainMs:frameCpu,now:performance.now(),gpuSupported:renderer.timestamp_supported()});pendingLiveWorkerMs=0;pendingLiveUpdate=false;}
      submitTimes.push(frameCpu);if(submitTimes.length>180)submitTimes.shift();dirty=!drew;
      if(c)positionInput();
    }catch(e){notice(String(e));recoverGPU();}
  }
  if(time-lastMetrics>250){
    const metrics=performanceStats.snapshot(time);
    $('hz').innerHTML=`${liveFpsText(metrics.live)}<small>FPS</small>`;
    $('cpu').textContent=liveCostText(metrics.live);
    $('latency').innerHTML=`${lastLatency===null?'—':lastLatency.toFixed(1)}<small>ms</small>`;
    if(workerReady&&performance.now()-lastProgress>200&&lastWorkerVersion<version())$('state').textContent='Layout running asynchronously';
    performancePanel.update(time,{frame:latest,frameTrace:frameTracker.snapshot(),adapterName:renderer?.adapter_name()||adapterLabel,bytes:editor?.bytes(),lines:editor?.lines(),mainMemory:wasm?.memory.buffer.byteLength,layoutMemory,navMemory,gpuMemory:renderer?.resource_bytes(),gpuSupported:renderer?.timestamp_supported(),drawCalls:lastDrawCalls,inFlight},metrics);
    lastMetrics=time;
  }
  animation=requestAnimationFrame(loop);
}
async function recoverGPU(){
  benchmarkRunner.cancel();
  if(recovering)return;recovering=true;ready=false;rendererGeneration++;inFlight=0;
  $('gpu').textContent='RECONNECTING';worker?.terminate();workerReady=false;latest=null;pendingFrame=null;
  try{renderer.free();renderer=null;const next=await Renderer.create(canvas);if(destroyed){next.free();return;}renderer=next;renderer.resize(canvas.width,canvas.height);renderer.set_font_size(fontSize);renderer.set_theme(theme.engine);ready=true;startWorker();dirty=true;$('gpu').textContent='WEBGPU ACTIVE';notice('GPU resources rebuilt');}
  catch(error){$('gpu').textContent='GPU UNAVAILABLE';notice(`GPU recovery failed: ${error}`);}
  finally{recovering=false;}
}

viewport.addEventListener('pointerdown',e=>{
  if(!ready||e.defaultPrevented||![0,1].includes(e.button)||e.target.closest('#scrollbar,[data-editor-widget],.performance-panel'))return;
  const r=viewport.getBoundingClientRect();
  if(e.button===1&&(options.middleClickDefinition===false||e.clientX-r.left<52))return;
  e.preventDefault();
  cancelMotions();
  input.focus({preventScroll:true});
  const hit=hitAt(e.clientX-r.left,e.clientY-r.top);
  if(!hit){notice('Preparing exact layout for this region…');sendView();return;}
  if(e.button===1||e.ctrlKey||e.metaKey){cancelEdit();void interactions?.go(hit.cluster);return;}
  interactions?.reset();
  if(e.clientX-r.left<52){
    const range=lineRange(editor.position_at(hit.offset).line),s=currentSelection();
    selectionDrag=e.shiftKey?lineRange(editor.position_at(s.anchor).line):range;
    const backwards=range.start<selectionDrag.start;editor.select(backwards?selectionDrag.end:selectionDrag.start,backwards?range.start:range.end);selectionChanged();dragging=true;viewport.setPointerCapture(e.pointerId);e.preventDefault();return;
  }
  const s=currentSelection();editor.select(e.shiftKey?s.anchor:hit.offset,hit.offset);affinity=hit;
  selectionChanged(true);dragging=true;viewport.setPointerCapture(e.pointerId);e.preventDefault();
});
for(const type of ['mousedown','auxclick'])viewport.addEventListener(type,e=>{
  if(e.button===1&&options.middleClickDefinition!==false&&!e.target.closest('#scrollbar,[data-editor-widget],.performance-panel')&&e.clientX-viewport.getBoundingClientRect().left>=52)e.preventDefault();
});
viewport.addEventListener('pointermove',e=>{
  if(e.target.closest('[data-editor-widget],.performance-panel,#scrollbar'))return;
  const r=viewport.getBoundingClientRect(),hit=hitAt(e.clientX-r.left,e.clientY-r.top);
  if(!dragging){if(e.clientX-r.left>=52)interactions?.move(e,hit);else interactions?.leave();return;}
  if(hit){
    if(selectionDrag){const range=lineRange(editor.position_at(hit.offset).line);editor.select(range.start<selectionDrag.start?selectionDrag.end:selectionDrag.start,range.start<selectionDrag.start?range.start:range.end);selectionChanged();}
    else{editor.select(currentSelection().anchor,hit.offset);affinity=hit;selectionChanged(true);}
  }
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(event,()=>{dragging=false;selectionDrag=null;});
viewport.addEventListener('pointerleave',()=>{if(!dragging)interactions?.leave();});
viewport.addEventListener('dblclick',e=>{
  if(e.target.closest('[data-editor-widget],.performance-panel,#scrollbar')||e.ctrlKey||e.metaKey)return;
  const r=viewport.getBoundingClientRect();if(e.clientX-r.left<52)return;
  const hit=hitAt(e.clientX-r.left,e.clientY-r.top);if(hit){e.preventDefault();void selectWord(hit.cluster);}
});
viewport.addEventListener('wheel',e=>{
  if(e.target.closest('[data-editor-widget]'))return;
  if(!ready)return;e.preventDefault();
  if(e.ctrlKey||e.metaKey){setFontSize(fontSize+(e.deltaY<0?1:-1));return;}
  setScroll(scroll+e.deltaY);updateChrome();
},{passive:false});
function dragScrollbar(e){
  if(!scrollDrag)return;
  const track=$('scrollbar').getBoundingClientRect(),thumb=$('thumb').getBoundingClientRect();
  const fraction=Math.max(0,Math.min(1,(e.clientY-track.top-scrollDrag.offset)/Math.max(1,track.height-thumb.height)));
  setScroll(fraction*Math.max(0,(latest?.total_height||height)-height));updateChrome();
}
$('scrollbar').addEventListener('pointerdown',e=>{
  e.preventDefault();e.stopPropagation();const thumb=$('thumb').getBoundingClientRect();
  scrollDrag={offset:e.target===$('thumb')?e.clientY-thumb.top:thumb.height/2};
  $('scrollbar').setPointerCapture(e.pointerId);dragScrollbar(e);
});
$('scrollbar').addEventListener('pointermove',dragScrollbar);
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('scrollbar').addEventListener(event,()=>scrollDrag=null);

async function executeCommand(command){
  if(!ready||destroyed||composition)return false;
  if(!editorCommands.includes(command))throw new TypeError('Unknown editor command: '+command);
  if(['copy','cut','paste'].includes(command))return commands.clipboard(command);
  if(/^(cursor|select|delete)Word(Left|Right)$/.test(command))return commands.word(command);
  if(['selectLine','deleteLine','moveLineUp','moveLineDown','duplicateLineUp','duplicateLineDown','indent','outdent','insertLineAbove','insertLineBelow'].includes(command))return commands.line(command);
  if(command==='insertTab'){
    const s=currentSelection();if(s.anchor!==s.head)return commands.line('indent');
    return insertText(options.indentUnit??'    ','tab');
  }
  if(command==='insertNewline')return insertNewline();
  if(command==='triggerCompletion'){await completion.trigger();return true;}
  if(command==='acceptCompletion')return completion.accept();
  if(command==='nextCompletion'||command==='previousCompletion')return completion.move(command==='nextCompletion'?1:-1);
  if(command==='hideCompletion'){completion.hide();return true;}
  if(command==='goToBracket'){
    const s=currentSelection(),revision=version();
    try{const match=await brackets.find(s.head);if(!match||version()!==revision||currentSelection().anchor!==s.anchor||currentSelection().head!==s.head)return false;const target=s.head>=match.close.start?match.open.start:match.close.start;editor.select(target,target);selectionChanged();api.reveal(target);return true;}
    catch(error){if(error.name!=='AbortError')reportProvider('brackets',error);return false;}
  }
  if(command==='selectAll'){editor.select(0,editor.length());selectionChanged();return true;}
  if(command==='undo'||command==='redo'){const change=editor[command]();commit(change);return !!change;}
  if(['bold','italic','underline'].includes(command)){intent(()=>applyToggle(command));return true;}
  const motion=/^(cursor|select)(Left|Right|Up|Down|LineStart|LineEnd)$/.exec(command);
  if(motion){enqueueMotion(({LineStart:'home',LineEnd:'end'})[motion[2]]??motion[2].toLowerCase(),motion[1]==='select');return true;}
  if(/^(cursor|select)Document(Start|End)$/.test(command)){
    cancelMotions();const p=command.endsWith('End')?editor.length():0;editor.select(command.startsWith('select')?currentSelection().anchor:p,p);selectionChanged();post({type:'selection',selection:currentSelection(),reveal:true,affinity:null});return true;
  }
  if(command==='deleteLeft'||command==='deleteRight'){intent(()=>deleteText(command==='deleteRight'));return true;}
  if(command==='cancel'){cancelMotions();cancelEdit();completion?.hide();brackets?.cancel();interactions?.changed();if(fullscreenActive())await toggleFullscreen();return true;}
  if(command==='goToDefinition'){if(!options.definitionProvider)return false;await interactions.go();return true;}
  if(command==='nextDiagnostic'||command==='previousDiagnostic')return !!goToDiagnostic(command==='nextDiagnostic'?1:-1);
  if(command==='toggleFullscreen'){await toggleFullscreen();return true;}
  if(command==='togglePerformance'){performancePanel.show(performancePanel.element.hidden);return true;}
  if(command.endsWith('FontSize')){setFontSize(command==='resetFontSize'?17:fontSize+(command==='decreaseFontSize'?-1:1));return true;}
  return false;
}
function keyDown(e){
  if(!ready||e.isComposing||composition)return;
  if(e.defaultPrevented)return;
  try{if(options.onKeyDown?.(e,api)===true){e.preventDefault();return;}}catch(error){reportProvider('keydown',error);}
  if(e.defaultPrevented)return;
  const command=keybinding(e);
  if(!keybinding.isOverridden(e)&&completion?.keyDown(e))return;
  if(command===undefined)return;
  if(typeof command==='string'&&['copy','cut','paste'].includes(command)){
    const key=e.key.toLowerCase(),native=(e.ctrlKey||e.metaKey)&&({c:'copy',x:'cut',v:'paste'})[key]===command||key==='insert'&&(e.ctrlKey&&command==='copy'||e.shiftKey&&command==='paste')||key==='delete'&&e.shiftKey&&command==='cut';
    if(native)return;
  }
  e.preventDefault();if(command===null)return;
  if(typeof command==='function'){void commands.run(context=>command({editor:api,event:e,signal:context.signal}));return;}
  const run=()=>{void executeCommand(command).catch(error=>reportProvider('command',error));};
  if(['cancel','toggleFullscreen','togglePerformance'].includes(command)||command.endsWith('FontSize'))run();else intent(run);
}
input.addEventListener('keydown',keyDown);
input.addEventListener('beforeinput',e=>{
  if(e.isComposing||composition)return;
  if(e.inputType==='insertText'&&e.data!==null){e.preventDefault();intent(()=>insertText(e.data));input.value='';}
  else if(e.inputType==='deleteContentBackward'||e.inputType==='deleteContentForward'){e.preventDefault();deleteText(e.inputType==='deleteContentForward');}
  else if(e.inputType==='insertLineBreak'||e.inputType==='insertParagraph'){e.preventDefault();void insertNewline();}
});
input.addEventListener('compositionstart',()=>{
  cancelMotions();editor.begin_composition();
  const s=currentSelection();composition={start:Math.min(s.anchor,s.head),end:Math.max(s.anchor,s.head),collapsed:s.anchor===s.head,text:''};input.value='';
});
input.addEventListener('compositionupdate',e=>{
  if(!composition)return;
  if(edit(composition.start,composition.end,e.data,'composition')){composition.end=composition.start+scalarLength(e.data);composition.text=e.data;}
});
input.addEventListener('compositionend',e=>{
  if(!composition)return;
  // Some input methods report the final candidate only on compositionend.
  const start=composition.start,end=composition.end;
  if(composition.text!==e.data||options.bracketPairs.some(pair=>pair.open===e.data||pair.close===e.data))brackets.input(e.data,start,end,'composition',composition.collapsed);
  editor.end_composition();composition=null;input.value='';
});
input.addEventListener('input',e=>{
  if(composition||e.isComposing)return;
  if(input.value){insertText(input.value);input.value='';}
});
input.addEventListener('copy',e=>commands?.copyEvent(e,false));
input.addEventListener('cut',e=>commands?.copyEvent(e,true));
input.addEventListener('paste',e=>commands?.pasteEvent(e));
input.addEventListener('focus',()=>{dirty=true;blink=true;});input.addEventListener('blur',()=>dirty=true);
$('bold').onclick=()=>applyToggle('bold');$('italic').onclick=()=>applyToggle('italic');$('underline').onclick=()=>applyToggle('underline');
$('foreground').onclick=()=>applyStyle({foreground:[.15,.34,.75,1]});
$('background').onclick=()=>applyStyle({background:[1.,.91,.65,1]});
$('undo').onclick=()=>{commit(editor.undo());input.focus();};$('redo').onclick=()=>{commit(editor.redo());input.focus();};
$('hint').onclick=()=>addInlay(false);$('block').onclick=()=>addInlay(true);
$('wrap').onchange=sendView;$('code').onchange=sendView;
$('font-size').onchange=e=>setFontSize(e.target.value);
$('font-smaller').onclick=()=>setFontSize(fontSize-1);$('font-larger').onclick=()=>setFontSize(fontSize+1);
$('perf-toggle').onclick=()=>performancePanel.show(performancePanel.element.hidden);
$('fullscreen-toggle').onclick=toggleFullscreen;
document.addEventListener('fullscreenchange',syncFullscreen,{signal});
document.addEventListener('keydown',e=>{
  if(e.key==='Control'||e.key==='Meta')interactions?.modifier(e);
  const origin=e.composedPath()[0];
  if(e.composedPath().includes(root.host)&&!e.composedPath().includes(input)&&!origin.closest?.('input,textarea,select,[contenteditable]')&&(e.altKey&&['Enter','p','P'].includes(e.key)||e.key==='Escape'))keyDown(e);
},{signal});
document.addEventListener('keyup',e=>{if(e.key==='Control'||e.key==='Meta')interactions?.modifier(e);},{signal});
window.addEventListener('blur',()=>interactions?.leave(),{signal});
const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(viewport);
function dispose(){
  if(destroyed)return;destroyed=true;ready=false;controller.abort();importEpoch++;rendererGeneration++;
  clearTimeout(restartTimer);cancelAnimationFrame(animation);resizeObserver.disconnect();performancePanel.destroy();
  cancelEdit();selectionAbort?.abort();completion?.destroy();brackets?.destroy();interactions?.destroy();diagnostics?.destroy();overlays.destroy();cancelWords();
  benchmarkRunner.cancel();worker?.terminate();navigation?.terminate();visual?.free();editor?.free();renderer?.free();
  renderer=null;editor=null;visual=null;root.replaceChildren();emit('dispose',null);
}
options.signal?.addEventListener('abort',dispose,{once:true});
if(options.signal?.aborted)dispose();
async function boot(){
  try{
    wasm=await(wasmPromise??=init());
    if(destroyed)throw new DOMException('Editor disposed','AbortError');
    if(!navigator.gpu)throw new Error('This browser does not expose WebGPU. Open localhost in a recent Chrome or Edge.');
    navigator.gpu.requestAdapter({powerPreference:'high-performance'}).then(adapter=>{const info=adapter?.info;adapterLabel=info?.description||[info?.vendor,info?.architecture].filter(Boolean).join(' / ');}).catch(()=>{});
    const fontNames=['JetBrainsMono-Regular','JetBrainsMono-Bold','JetBrainsMono-Italic','JetBrainsMono-BoldItalic','NotoSansSC','NotoSansArabic','NotoSansHebrew','NotoSansDevanagari','NotoEmoji'];
    const loaded=await Promise.allSettled([Renderer.create(canvas),Promise.all(fontNames.map(async name=>{
      const response=await fetch(new URL(`./fonts/${name}.ttf`,import.meta.url),{signal});if(!response.ok)throw new Error(`Font unavailable: ${name}`);return response.arrayBuffer();
    }))]);
    if(loaded[0].status==='fulfilled')renderer=loaded[0].value;
    if(loaded[1].status==='fulfilled')fonts=loaded[1].value;
    if(destroyed){renderer?.free();renderer=null;throw new DOMException('Editor disposed','AbortError');}
    const failure=loaded.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    renderer.set_theme(theme.engine);ready=true;resize();loadText(initialText,options.filename??'untitled.txt');
    setFontSize(options.fontSize??17);$('wrap').checked=options.wrap??true;$('code').checked=options.syntax??true;sendView();performancePanel.show(options.performance??false);
    $('gpu').textContent='WEBGPU ACTIVE';$('loading-detail').textContent='Preparing multilingual fonts in the layout worker…';
    animation=requestAnimationFrame(loop);
    api={
      get root(){return root;},
      get element(){return root.host;},
      on(type,listener){root.host.addEventListener(type,listener);return()=>root.host.removeEventListener(type,listener);},
      focus(){input.focus({preventScroll:true});},
      get text(){return editor.text();},get selection(){return currentSelection();},
      get frame(){return latest;},get caret(){return caret();},get performance(){return {...performanceStats.snapshot(),frameTrace:frameTracker.snapshot()};},get stats(){return {drawCount,inFlight,request,version:version(),submitTimes:[...submitTimes],intervals:[...intervals],lastLatency};},
      get version(){return version();},
      positionAt(offset){return editor.position_at(offset);},offsetAt(position){return editor.offset_at(position.line,position.character);},
      replace(start,end,text){return edit(start,end,text);},
      applyEdit(request,expectedVersion=version()){return expectedVersion===version()&&edit(request.start,request.end,request.text,request.source??'api',request.caretOffset);},
      configure(value){if(destroyed)return;const bindings='keybindings' in value?{...value.keybindings}:keybindingOptions;const compiled=compileKeybindings(bindings,mac),pairs='bracketPairs'in value?bracketPairs(value.bracketPairs):options.bracketPairs;options={...options,...value,bracketPairs:pairs};keybindingOptions=bindings;keybinding=compiled;cancelEdit();completion?.hide();brackets?.refresh();interactions?.changed();cancelWords();},
      get configuration(){return Object.fromEntries(['bracketPairs','autoClosingBrackets','skipClosingBrackets','bracketMatching','bracketMatchingProvider','autoIndent','indentUnit','hoverDelay','providerTimeout','keybindings','middleClickDefinition','automaticCompletion','completionDelay','completionProvider','wordProvider','hoverProvider','definitionProvider','onBeforeEdit','onChange','onSelectionChange','onKeyDown','onNavigate'].map(key=>[key,key==='keybindings'?{...keybindingOptions}:options[key]??({autoClosingBrackets:true,skipClosingBrackets:true,bracketMatching:true,autoIndent:'keep',indentUnit:'    ',hoverDelay:350,providerTimeout:8000,middleClickDefinition:true,automaticCompletion:true,completionDelay:120}[key])]));},
      executeCommand,
      triggerCompletion(){return completion.trigger();},
      acceptCompletion(index){return completion.accept(index);},
      hideCompletion(){completion.hide();},
      get completion(){return completion.state;},
      lineRange,wordRange,
      matchBrackets(offset=currentSelection().head,signal){return brackets.find(offset,signal);},
      skipClosingBracket(close){return brackets.skip(close);},
      addOverlay:value=>overlays.add(value),
      showHover(content,anchor=currentSelection().head){interactions.show(content,anchor);},
      hideHover(){interactions.reset();},
      goToDefinition(offset){return interactions.go(offset);},
      get diagnostics(){return diagnostics.items;},
      setDiagnostics(items,readVersion){
        if(destroyed)return false;readVersion??=version();
        if(!Number.isSafeInteger(readVersion)||readVersion!==version())return false;
        diagnostics.set(items);interactions.refresh();emit('diagnosticschange',{version:readVersion,diagnostics:diagnostics.items});return true;
      },
      goToDiagnostic,
      reveal(offset=currentSelection().head){post({type:'reveal',offset:Math.max(0,Math.min(editor.length(),offset))});},
      get scroll(){return scroll;},
      toggle(attribute){applyToggle(attribute);},
      format(style){applyStyle(style);},
      undo(){const change=editor.undo();commit(change);return !!change;},
      redo(){const change=editor.redo();commit(change);return !!change;},
      setWrap(value){$('wrap').checked=!!value;sendView();},
      setSyntax(value){$('code').checked=!!value;sendView();},
      setInlays(value){inlays=value;post({type:'inlays',inlays});sendView();},
      showPerformance(value=true){performancePanel.show(value);},
      setTheme(value){theme=resolveTheme(value);applyThemeCSS(root.host,theme);renderer.set_theme(theme.engine);post({type:'theme',theme:theme.engine});dirty=true;emit('themechange',theme);},
      get theme(){return theme;},
      destroy:dispose,
      select(a,b){editor.select(a,b);selectionChanged();},
      insert(text){return insertText(text,'api');},load:loadText,
      restartLayout:startWorker,loadSynthetic,setFontSize,scrollTo:setScroll,benchmark:runBenchmark,cancelBenchmark:()=>benchmarkRunner.cancel(),
      get documentInfo(){return {bytes:editor.bytes(),chars:editor.length(),lines:editor.lines()};},
      slice(a,b){return editor.slice(a,b);},
      setHighlights(spans,documentVersion=version()){
        if(!Number.isSafeInteger(documentVersion)||documentVersion>version()||documentVersion<Math.max(externalHighlights?.version??0,version()-Editor.highlight_history_limit()))return false;
        externalHighlights={spans,version:documentVersion};post({type:'highlights',...externalHighlights});sendView();return true;
      },
    };
    commands=new CommandController({api,options:()=>options,report:reportProvider,edit(...args){commands.release();return edit(...args);}});
    brackets=new BracketController({api,options:()=>options,edit,advance(){if(editor.horizontal(true,false)){selectionChanged();api.reveal();}else deferBoundary(true,'bracket');},report:reportProvider});
    completion=new CompletionController({api,options:()=>options,overlays,report:reportProvider,emit,edit});
    diagnostics=new DiagnosticLayer(api,viewport,$('numbers'),$('diagnostic-summary'));
    interactions=new Interactions({api,options:()=>options,overlays,wordRange,diagnosticHover:offset=>diagnostics.hover(offset),report:reportProvider});
    return api;
  }catch(error){if(!destroyed)dispose();throw error;}
}
return boot();
}

import init,{Editor} from './pkg/texelune_editor.js';
import {RpcConnection,decodeTokenData} from './rpc.js';
import {resolveTheme,tokenStyle} from './theme.js';
import {yieldTask} from './benchmark.js';
import {sameDocumentUri} from './uris.js';

let socket,rpc,mirror,options,theme,version=0,epoch=0,opened=false,initialized=false,provider=null;
let pendingChanges=[],syncTimer=0,tokenTimer=0,tokenAbort=null,tokenBatch=null,decorationEpoch=0;
let semanticJob=null,readBarrier=null,tokenSerial=0;
let quiescent=false;
let diagnosticProvider=null,diagnosticAbort=null;
let syncKind=2;
const queries=new Map();
const emit=(type,detail={})=>postMessage({type,epoch,version,...detail});
function flushChanges(){clearTimeout(syncTimer);if(!opened||!pendingChanges.length||readBarrier)return;if(syncKind!==0)rpc.notify('textDocument/didChange',{textDocument:{uri:options.uri,version},contentChanges:syncKind===1?[{text:mirror.text()}]:pendingChanges});pendingChanges=[];}
function scheduleTokens(delay=120){clearTimeout(tokenTimer);tokenTimer=setTimeout(()=>{void refreshTokens();void refreshDiagnostics();},delay);}
function invalidateQueries(){diagnosticAbort?.abort();for(const abort of queries.values())abort.abort();queries.clear();diagnosticAbort=null;}
function invalidate(){tokenAbort?.abort();invalidateQueries();tokenAbort=null;tokenBatch=null;semanticJob=null;readBarrier?.resolve();readBarrier=null;decorationEpoch++;}
function waitForRead(signal){
  if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
  if(!readBarrier)return Promise.resolve();
  const barrier=readBarrier;
  return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});barrier.promise.then(()=>{signal.removeEventListener('abort',abort);resolve();});});
}
function publishDiagnostics(items){emit('diagnostics',{diagnostics:items.map(d=>({...d,start:mirror.offset_at(d.range.start.line,d.range.start.character),end:mirror.offset_at(d.range.end.line,d.range.end.character)}))});}
async function refreshDiagnostics(){
  if(!opened||!diagnosticProvider)return;
  diagnosticAbort?.abort();const abort=diagnosticAbort=new AbortController(),revision=version,documentEpoch=epoch;
  try{await waitForRead(abort.signal);if(abort.signal.aborted||revision!==version||documentEpoch!==epoch)return;flushChanges();const report=await rpc.request('textDocument/diagnostic',{textDocument:{uri:options.uri},identifier:diagnosticProvider.identifier},{signal:abort.signal});if(!abort.signal.aborted&&revision===version&&documentEpoch===epoch&&report?.kind==='full')publishDiagnostics(report.items??[]);}
  catch(error){if(error.name!=='AbortError'&&error.code!==-32801&&error.code!==-32802)emit('status',{state:'waiting',message:error.message});}
}
async function publishTokens(){
  if(!tokenBatch)return;
  const batch=tokenBatch,appliedTheme=theme,mine=++decorationEpoch,documentEpoch=epoch,spans=[];let start=performance.now();
  for(const token of batch.tokens){
    spans.push({start:token.start,end:token.end,style:tokenStyle(appliedTheme,token.type,token.modifiers)});
    if(performance.now()-start>1.5){await yieldTask();start=performance.now();if(mine!==decorationEpoch||documentEpoch!==epoch||batch!==tokenBatch)return;}
  }
  if(mine===decorationEpoch&&documentEpoch===epoch&&batch===tokenBatch)emit('tokens',{version:batch.version,batch:mine,spans,count:spans.length,legend:provider?.legend,theme:appliedTheme.name});
}
async function refreshTokens(){
  if(!opened||!provider)return;
  if(semanticJob){semanticJob.dirty=true;return;}
  const abort=tokenAbort=new AbortController(),revision=version,documentEpoch=epoch,started=performance.now();
  const job=semanticJob={abort,revision,epoch:documentEpoch,serial:++tokenSerial,dirty:false},snapshot=mirror.snapshot();
  flushChanges();
  const barrier={};barrier.promise=new Promise(resolve=>barrier.resolve=resolve);readBarrier=barrier;
  try{
    const method=provider.full?'textDocument/semanticTokens/full':'textDocument/semanticTokens/range';
    const params={textDocument:{uri:options.uri}};
    if(!provider.full)params.range={start:{line:0,character:0},end:mirror.position_at(mirror.length())};
    let result;
    // The server document stays at the read version until this response arrives.
    try{result=await rpc.request(method,params,{signal:abort.signal});}
    finally{if(readBarrier===barrier){readBarrier=null;barrier.resolve();flushChanges();}}
    if(abort.signal.aborted||documentEpoch!==epoch)return;
    const tokens=decodeTokenData(result?.data??[],provider.legend),mapped=[];let begin=performance.now();
    if(provider.legend.tokenModifiers.includes('mutable'))for(const token of tokens)if(['variable','parameter','const','static'].includes(token.type)&&!token.modifiers.includes('mutable'))token.modifiers.push('readonly');
    for(const token of tokens){
      const start=snapshot.offset_at(token.line,token.character),end=snapshot.offset_at(token.line,token.character+token.length);
      if(end>start)mapped.push({...token,start,end});
      if(performance.now()-begin>1.5){await yieldTask();begin=performance.now();if(abort.signal.aborted||documentEpoch!==epoch)return;}
    }
    tokenBatch={version:revision,serial:job.serial,tokens:mapped};
    await publishTokens();
    if(documentEpoch===epoch)emit('timing',{sourceVersion:revision,elapsed:performance.now()-started});
  }catch(error){if(error.name!=='AbortError'&&documentEpoch===epoch){emit('status',{state:'waiting',message:error.message});if(error.code===-32801||error.code===-32802)scheduleTokens(250);}}
  finally{snapshot.free();if(readBarrier===barrier){readBarrier=null;barrier.resolve();flushChanges();}if(semanticJob===job){semanticJob=null;tokenAbort=null;if(job.dirty||version!==revision)scheduleTokens(0);}}
}
function didOpen(){if(!initialized||!mirror)return;rpc.notify('textDocument/didOpen',{textDocument:{uri:options.uri,languageId:options.languageId??'rust',version,text:mirror.text()}});opened=true;pendingChanges=[];scheduleTokens(0);}
function openDocument(m){
  invalidate();clearTimeout(syncTimer);clearTimeout(tokenTimer);
  if(opened)rpc.notify('textDocument/didClose',{textDocument:{uri:options.uri}});
  opened=false;epoch=m.epoch;version=m.version;mirror?.free();mirror=new Editor(m.text);options={...options,uri:m.uri??options.uri};pendingChanges=[];didOpen();
}
async function connect(m){
  options=m.options;theme=resolveTheme(m.theme);await init();openDocument(m);for(const pending of early.splice(0))handle(pending);
  socket=new WebSocket(options.url);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(new DOMException('LSP connection timed out','TimeoutError'));},10000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(new Error('Cannot connect to language server'));};socket.onclose=()=>{clearTimeout(timer);reject(new Error('Language server disconnected'));};});
  rpc=new RpcConnection(message=>socket.send(JSON.stringify(message)),{
    timeout:options.timeout??10000,
    onRequest:async(method,params)=>{
      if(method==='workspace/configuration')return(params.items??[]).map(()=>({checkOnSave:false,check:{enable:false},diagnostics:{enable:true},cargo:{buildScripts:{enable:false}},procMacro:{enable:false}}));
      if(method==='workspace/workspaceFolders')return[{uri:options.rootUri,name:'code-workspace'}];
      if(method==='workspace/semanticTokens/refresh'||method==='workspace/diagnostic/refresh'){scheduleTokens(60);return null;}
      return null;
    },
    onNotification(method,params){
      if(method==='textDocument/publishDiagnostics'&&sameDocumentUri(params.uri,options.uri)&&(params.version==null||params.version===version))publishDiagnostics(params.diagnostics??[]);
      if(method==='$/progress'&&params.value?.kind==='end')scheduleTokens(100);
      if(method==='experimental/serverStatus'){quiescent=params.quiescent;emit('status',{state:params.quiescent?'ready':'indexing',quiescent:params.quiescent,message:params.message??(params.quiescent?'rust-analyzer 已就绪':'索引工作区…')});if(params.quiescent)scheduleTokens(50);}
      if(method==='texelune/serverError')emit('status',{state:'error',message:params.message});
    }
  });
  socket.onmessage=event=>{try{void rpc.receive(JSON.parse(event.data));}catch(error){emit('status',{state:'error',message:error.message});}};
  socket.onclose=()=>{rpc.close();initialized=false;opened=false;emit('status',{state:'disconnected',message:'LSP 连接已断开'});};
  const result=await rpc.request('initialize',{
    processId:null,rootUri:options.rootUri,workspaceFolders:[{uri:options.rootUri,name:'code-workspace'}],clientInfo:{name:'texelune-web',version:'0.3.0'},
    capabilities:{experimental:{serverStatusNotification:true},general:{positionEncodings:['utf-16']},workspace:{diagnostics:{refreshSupport:true},configuration:true,workspaceFolders:true,semanticTokens:{refreshSupport:true}},textDocument:{definition:{linkSupport:true},diagnostic:{dynamicRegistration:false,relatedDocumentSupport:false},synchronization:{dynamicRegistration:false},hover:{contentFormat:['plaintext']},completion:{completionItem:{snippetSupport:false}},publishDiagnostics:{versionSupport:true},semanticTokens:{requests:{full:true,range:true},tokenTypes:['namespace','type','class','enum','interface','struct','typeParameter','parameter','variable','property','enumMember','event','function','method','macro','keyword','modifier','comment','string','number','regexp','operator','decorator'],tokenModifiers:['declaration','definition','readonly','static','deprecated','abstract','async','modification','documentation','defaultLibrary'],formats:['relative'],overlappingTokenSupport:false,multilineTokenSupport:false}}},
    initializationOptions:{checkOnSave:false,check:{enable:false},cargo:{buildScripts:{enable:false}},procMacro:{enable:false},diagnostics:{enable:true}}
  },{timeout:20000});
  if(result.capabilities.positionEncoding&&result.capabilities.positionEncoding!=='utf-16')throw new Error('Language server must support UTF-16 positions');
  provider=result.capabilities.semanticTokensProvider;diagnosticProvider=result.capabilities.diagnosticProvider;
  const sync=result.capabilities.textDocumentSync;syncKind=typeof sync==='number'?sync:sync?.change??0;
  initialized=true;rpc.notify('initialized',{});didOpen();emit('connected',{server:result.serverInfo??{name:'Language server'},capabilities:result.capabilities,indexing:!quiescent&&result.serverInfo?.name?.includes('rust-analyzer')});
}
async function query(m){
  if(!opened||m.epoch!==epoch||m.version!==version){emit('reply',{id:m.id,error:'Document changed or LSP is not connected'});return;}
  const documentEpoch=epoch,revision=version;
  queries.get(m.method)?.abort();const abort=new AbortController();abort.requestId=m.id;queries.set(m.method,abort);
  try{
    await waitForRead(abort.signal);if(abort.signal.aborted||documentEpoch!==epoch||revision!==version)throw new DOMException('Document changed','AbortError');flushChanges();
    let result=await rpc.request(m.method,{textDocument:{uri:options.uri},position:mirror.position_at(m.offset),...(m.method==='textDocument/completion'?{context:{triggerKind:1}}:{})},{signal:abort.signal});
    if(documentEpoch!==epoch||revision!==version)throw new DOMException('Document changed','AbortError');
    if(m.method==='textDocument/completion'){
      const items=Array.isArray(result)?result:result?.items??[];
      result=items.slice(0,80).map(item=>{const edit=item.textEdit,range=edit?.range??edit?.replace;return{label:item.label,detail:item.detail??'',text:edit?.newText??item.insertText??item.label,start:range?mirror.offset_at(range.start.line,range.start.character):m.offset,end:range?mirror.offset_at(range.end.line,range.end.character):m.offset,additionalEdits:!!item.additionalTextEdits?.length,snippet:item.insertTextFormat===2};});
    }
    if(m.method==='textDocument/hover'&&result?.range)result={...result,start:mirror.offset_at(result.range.start.line,result.range.start.character),end:mirror.offset_at(result.range.end.line,result.range.end.character)};
    if(m.method==='textDocument/definition'){
      result=(Array.isArray(result)?result:result?[result]:[]).map(item=>{
        const uri=item.targetUri??item.uri,range=item.targetRange??item.range,selectionRange=item.targetSelectionRange??range;
        const target={uri,range,selectionRange};
        if(sameDocumentUri(uri,options.uri)){target.start=mirror.offset_at(selectionRange.start.line,selectionRange.start.character);target.end=mirror.offset_at(selectionRange.end.line,selectionRange.end.character);}
        if(item.originSelectionRange)target.originRange={start:mirror.offset_at(item.originSelectionRange.start.line,item.originSelectionRange.start.character),end:mirror.offset_at(item.originSelectionRange.end.line,item.originSelectionRange.end.character)};
        return target;
      });
    }
    emit('reply',{id:m.id,result});
  }catch(error){emit('reply',{id:m.id,error:error.message});}
  finally{if(queries.get(m.method)===abort)queries.delete(m.method);}
}
const early=[];let booting=false;
self.onmessage=({data:m})=>{
  if(m.type==='connect'){
    booting=true;void connect(m).then(()=>{booting=false;for(const pending of early.splice(0))handle(pending);}).catch(error=>{emit('status',{state:'error',message:error.message});rpc?.close();socket?.close();});
  }else if(booting&&!mirror)early.push(m);
  else handle(m);
};
function handle(m){
  try{
    if(m.type==='open')openDocument(m);
    else if(m.type==='change'&&m.epoch===epoch){
      if(m.version!==version+1)throw new Error('LSP document version gap');
      const range={start:mirror.position_at(m.start),end:mirror.position_at(m.end)};
      mirror.replace(m.start,m.end,m.text);version=m.version;invalidateQueries();
      if(semanticJob)semanticJob.dirty=true;
      if(opened)pendingChanges.push({range,text:m.text});
      clearTimeout(syncTimer);syncTimer=setTimeout(flushChanges,30);scheduleTokens();
    }else if(m.type==='theme'){theme=resolveTheme(m.theme);void publishTokens();}
    else if(m.type==='query')void query(m);
    else if(m.type==='cancel'&&m.epoch===epoch){for(const abort of queries.values())if(abort.requestId===m.id)abort.abort();}
    else if(m.type==='refresh')scheduleTokens(0);
  }catch(error){emit('status',{state:'error',message:error.message});}
}

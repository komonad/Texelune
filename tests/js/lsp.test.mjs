import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RpcConnection,decodeTokenData} from '../../packages/editor/rpc.js';
import {resolveTheme,tokenStyle} from '../../packages/editor/theme.js';
import {LspClient} from '../../packages/editor/lsp.js';
import {sameDocumentUri,workspaceRelativeUri} from '../../packages/editor/uris.js';

test('file URI identity normalizes drive case and encoding without widening workspace boundaries',()=>{
  assert(sameDocumentUri('file:///D:/dev/a%20b/main.rs','file:///d:/dev/a b/main.rs'));
  assert.equal(workspaceRelativeUri('file:///d:/dev/demo/src/main.rs','file:///D:/dev/demo'),'src/main.rs');
  assert.equal(workspaceRelativeUri('file:///d:/dev/demo-other/main.rs','file:///D:/dev/demo'),null);
});

test('RPC matches out-of-order results and rejects protocol errors',async()=>{
  const sent=[],rpc=new RpcConnection(message=>sent.push(message));
  const first=rpc.request('first',{}),second=rpc.request('second',{});
  await rpc.receive({id:sent[1].id,result:2});await rpc.receive({id:sent[0].id,result:1});
  assert.deepEqual(await Promise.all([first,second]),[1,2]);
  const failed=rpc.request('failed',{});await rpc.receive({id:sent.at(-1).id,error:{code:-32801,message:'Content modified'}});
  await assert.rejects(failed,error=>error.code===-32801);assert.equal(rpc.pending.size,0);rpc.close();
});
test('timeouts and aborts send cancellation and discard late results',async()=>{
  const sent=[],rpc=new RpcConnection(message=>sent.push(message),{timeout:15});
  const timed=rpc.request('slow',{}),id=sent[0].id;
  await assert.rejects(timed,{name:'TimeoutError'});assert.deepEqual(sent.at(-1),{jsonrpc:'2.0',method:'$/cancelRequest',params:{id}});
  await rpc.receive({id,result:'late'});assert.equal(rpc.pending.size,0);
  const abort=new AbortController(),cancelled=rpc.request('cancel',{}, {signal:abort.signal});abort.abort();await assert.rejects(cancelled,{name:'AbortError'});
  const pending=rpc.request('closing',{});rpc.close();await assert.rejects(pending,/closed/);assert.equal(rpc.pending.size,0);
});
test('server requests receive a matching response without consuming client requests',async()=>{
  const sent=[],rpc=new RpcConnection(message=>sent.push(message),{onRequest:async(method,params)=>method==='workspace/configuration'?params.items.map(()=>({checkOnSave:false})):null});
  await rpc.receive({id:'configuration',method:'workspace/configuration',params:{items:[{}]}});
  assert.deepEqual(sent[0],{jsonrpc:'2.0',id:'configuration',result:[{checkOnSave:false}]});rpc.close();
});
test('relative semantic tokens retain UTF-16 columns and modifier bits',()=>{
  const legend={tokenTypes:['variable','function'],tokenModifiers:['declaration','readonly']};
  assert.deepEqual(decodeTokenData([0,3,2,0,2,0,4,5,1,1,2,1,4,0,0],legend),[
    {line:0,character:3,length:2,type:'variable',modifiers:['readonly']},
    {line:0,character:7,length:5,type:'function',modifiers:['declaration']},
    {line:2,character:1,length:4,type:'variable',modifiers:[]},
  ]);assert.throws(()=>decodeTokenData([0,0],legend));assert.throws(()=>decodeTokenData([-1,0,1,0,0],legend));
});
test('partial themes merge defaults and apply wildcard and typed modifier styles',()=>{
  const theme=resolveTheme({tokens:{variable:'#123456','*.readonly':{italic:true},'variable.readonly':{bold:true}}});
  assert.equal(theme.colors.background,'#ffffff');assert.deepEqual(tokenStyle(theme,'variable',['readonly']),{foreground:[0x12/255,0x34/255,0x56/255,1],italic:true,bold:true});
  assert.deepEqual(resolveTheme('dusk').engine.background,[0x20/255,0x23/255,0x31/255,1]);
  assert.throws(()=>resolveTheme({colors:{background:'red'}}));
});
test('LSP client accepts earlier read versions for rebasing without rolling newer highlights back',()=>{
  const host=new EventTarget(),applied=[],editor={root:{host},version:4,documentInfo:{bytes:12},setHighlights:(...args)=>applied.push(args)};
  const client=new LspClient(editor,{});client.epoch=2;
  client.receive({type:'tokens',epoch:1,version:4,spans:[{}]});assert.equal(applied.length,0);
  client.receive({type:'tokens',epoch:2,version:3,batch:1,spans:[]});assert.deepEqual(applied,[[[],3]]);
  client.receive({type:'tokens',epoch:2,version:4,batch:2,spans:[]});
  client.receive({type:'tokens',epoch:2,version:3,batch:3,spans:[]});
  client.receive({type:'tokens',epoch:2,version:4,batch:1,spans:[]});
  client.receive({type:'tokens',epoch:2,version:5,batch:4,spans:[]});
  assert.deepEqual(applied,[[[],3],[[],4]]);client.dispose();
});
test('large-document guard pauses LSP before reading a full document string',async()=>{
  const host=new EventTarget(),editor={root:{host},documentInfo:{bytes:100*1048576},get text(){throw new Error('Full text must not be read');}};
  const client=new LspClient(editor,{});await client.connect();assert.equal(client.state,'paused');client.dispose();
});

test('interactive query abort releases public pending state and forwards cancellation',async()=>{
  const sent=[],editor={root:{host:new EventTarget()},version:0,selection:{head:0}},client=new LspClient(editor,{});
  client.state='ready';client.worker={postMessage:message=>sent.push(message),terminate(){}};
  const abort=new AbortController(),pending=client.definition(0,{signal:abort.signal});abort.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(client.pending.size,0);
  assert.equal(sent[0].method,'textDocument/definition');assert.deepEqual(sent[1],{type:'cancel',id:sent[0].id,epoch:client.epoch});
  client.dispose();
});

test('provider binding disposal preserves a later custom provider',()=>{
  let configuration={hoverProvider:()=>null};const original=configuration.hoverProvider;
  const editor={root:{host:new EventTarget()},get configuration(){return{...configuration};},configure:patch=>Object.assign(configuration,patch)};
  const client=new LspClient(editor,{}),detach=client.attach(),custom=()=>({contents:'custom'});
  editor.configure({definitionProvider:custom});detach();detach();
  assert.equal(configuration.hoverProvider,original);assert.equal(configuration.definitionProvider,custom);client.dispose();
});

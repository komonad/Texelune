import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript-browser';
import {TypeScriptService,tokenTypes,tokenModifiers} from '../../web/typescript-service.js';
import {decodeTokenData} from '../../packages/editor/rpc.js';

const lib=new URL('../../node_modules/typescript-browser/lib/',import.meta.url);
const libraries=Object.fromEntries(readdirSync(lib).filter(name=>/^lib.*\.d\.ts$/.test(name)).map(name=>[name,readFileSync(new URL(name,lib),'utf8')]));
const uri='file:///texelune-demo/main.ts';
test('browser TypeScript service preserves UTF-16 edits and resolves semantic symbols',()=>{
  const service=new TypeScriptService(ts,libraries);
  const text='const emoji = "👩🏽‍💻"; const greeting = "hello";\r\nconsole.log(greeting);\r\n';
  service.handle('textDocument/didOpen',{textDocument:{uri,text,version:4}});
  const position={line:1,character:14};
  const hover=service.handle('textDocument/hover',{textDocument:{uri},position});
  assert.match(hover.contents.value,/greeting/);
  const targets=service.handle('textDocument/definition',{textDocument:{uri},position});
  assert.equal(targets[0].targetSelectionRange.start.character,text.indexOf('greeting'));
  const result=service.handle('textDocument/semanticTokens/full',{textDocument:{uri}});
  const tokens=decodeTokenData(result.data,{tokenTypes,tokenModifiers});
  assert(tokens.some(token=>token.type==='variable'&&token.modifiers.includes('readonly')));
  assert(tokens.some(token=>token.type==='keyword'));
  assert(tokens.every(token=>token.length>0));
  assert.deepEqual(service.handle('textDocument/diagnostic',{textDocument:{uri}}).items,[]);
  const start=text.indexOf('"hello"');
  service.handle('textDocument/didChange',{textDocument:{uri,version:5},contentChanges:[{range:{start:{line:0,character:start},end:{line:0,character:start+7}},text:'42'}]});
  assert(service.document(uri).text.includes('greeting = 42'));
  assert.match(service.handle('textDocument/hover',{textDocument:{uri},position}).contents.value,/42/);
  service.handle('shutdown',{});
});
test('browser TypeScript service returns real type errors and prefix replacement ranges',()=>{
  const service=new TypeScriptService(ts,libraries);
  service.handle('textDocument/didOpen',{textDocument:{uri,text:'const count: number = "wrong";\nconst greeting = "hi";\ngreet',version:1}});
  const diagnostics=service.handle('textDocument/diagnostic',{textDocument:{uri}}).items;
  assert(diagnostics.some(item=>item.code===2322&&item.severity===1));
  const item=service.handle('textDocument/completion',{textDocument:{uri},position:{line:2,character:5}}).items.find(item=>item.label==='greeting');
  assert.deepEqual(item.textEdit,{range:{start:{line:2,character:0},end:{line:2,character:5}},newText:'greeting'});
  service.handle('textDocument/didChange',{textDocument:{uri,version:2},contentChanges:[{text:'const greeting = "hi";\ngreeting'}]});
  const middle=service.handle('textDocument/completion',{textDocument:{uri},position:{line:1,character:3}}).items.find(item=>item.label==='greeting');
  assert.deepEqual(middle.textEdit,{range:{start:{line:1,character:0},end:{line:1,character:8}},newText:'greeting'});
  service.handle('textDocument/didChange',{textDocument:{uri,version:0},contentChanges:[{text:'stale'}]});
  assert(service.document(uri).text.includes('greeting'));
  service.handle('textDocument/didClose',{textDocument:{uri}});
  assert.throws(()=>service.document(uri),/not open/);
  service.handle('shutdown',{});
});

test('reopening a URI at version zero invalidates the compiler snapshot from the preceding session',()=>{
  const service=new TypeScriptService(ts,libraries);
  service.handle('textDocument/didOpen',{textDocument:{uri,text:'const previousName = "hello";\nconsole.log(previousName);',version:0}});
  service.handle('textDocument/semanticTokens/full',{textDocument:{uri}});
  service.handle('textDocument/didClose',{textDocument:{uri}});
  const text='const x: number = "wrong";';
  service.handle('textDocument/didOpen',{textDocument:{uri,text,version:0}});
  const items=service.handle('textDocument/diagnostic',{textDocument:{uri}}).items;
  assert(items.some(item=>item.code===2322));
  const tokens=decodeTokenData(service.handle('textDocument/semanticTokens/full',{textDocument:{uri}}).data,{tokenTypes,tokenModifiers});
  assert(tokens.every(token=>token.line===0&&token.character+token.length<=text.length));
  assert.match(service.handle('textDocument/hover',{textDocument:{uri},position:{line:0,character:6}}).contents.value,/x: number/);
  service.handle('shutdown',{});
});

test('the browser workspace has valid types and offers catalog member completions',()=>{
  const service=new TypeScriptService(ts,libraries),text=readFileSync(new URL('../../examples/worker-workspace/main.ts',import.meta.url),'utf8');
  service.handle('textDocument/didOpen',{textDocument:{uri,text,version:0}});
  const errors=service.handle('textDocument/diagnostic',{textDocument:{uri}}).items.filter(item=>item.severity===1);
  assert.deepEqual(errors,[]);
  const offset=text.indexOf('catalog.register')+'catalog.'.length,prefix=text.slice(0,offset).split('\n');
  const result=service.handle('textDocument/completion',{textDocument:{uri},position:{line:prefix.length-1,character:prefix.at(-1).length}});
  assert(result.items.some(item=>item.label==='register'));assert(result.items.some(item=>item.label==='search'));
  service.handle('shutdown',{});
});

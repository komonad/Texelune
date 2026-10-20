import test from 'node:test';
import assert from 'node:assert/strict';
import {compileKeybindings,planLineEdit,scalarCount,lineEnding} from '../../packages/editor/commands.js';
import {CommandController} from '../../packages/editor/command-runtime.js';

const key=(name,modifiers={})=>({key:name,...modifiers});
const plan=(command,text,selection,extra={})=>planLineEdit(command,{start:0,end:scalarCount(text),selection,indentUnit:'  ',...extra},text);

test('bindings normalize modifiers, aliases and platform Mod; overrides win by normalized key',()=>{
  const custom=()=>{};
  const resolve=compileKeybindings({'Ctrl+C':null,'Control+ArrowLeft':custom,'Ctrl+Y':'undo'});
  assert.equal(resolve(key('c',{ctrlKey:true})),null);
  assert.equal(resolve(key('ArrowLeft',{ctrlKey:true})),custom);
  assert.equal(resolve(key('y',{ctrlKey:true})),'undo');
  assert.equal(resolve(key('ArrowLeft',{shiftKey:true})),'selectLeft');
  assert.equal(resolve(key('+',{ctrlKey:true,shiftKey:true})),'increaseFontSize');
  assert.equal(compileKeybindings({},true)(key('c',{metaKey:true})),'copy');
  assert.equal(compileKeybindings({},true)(key('c',{ctrlKey:true})),undefined);
  assert.throws(()=>compileKeybindings({'Ctrl+Q':'unknown'}),TypeError);
  assert.throws(()=>compileKeybindings({'Hyper+Q':'undo'}),TypeError);
});

test('bindings leave IME, AltGraph, dead keys and unbound shortcuts to the host',()=>{
  const resolve=compileKeybindings();
  assert.equal(resolve(key('a',{ctrlKey:true,isComposing:true})),undefined);
  assert.equal(resolve(key('a',{ctrlKey:true,getModifierState:()=>true})),undefined);
  assert.equal(resolve(key('Dead')),undefined);
  assert.equal(resolve(key('q',{ctrlKey:true})),undefined);
});

test('indent and outdent preserve directed scalar selections and line separators',()=>{
  const text='😀a\r\n  אב\r\n';
  const indented=plan('indent',text,{anchor:9,head:0});
  assert.equal(indented.text,'  😀a\r\n    אב\r\n');
  assert.deepEqual(indented.selection,{anchor:13,head:0});
  const out=plan('outdent',indented.text,indented.selection);
  assert.equal(out.text,text);assert.deepEqual(out.selection,{anchor:9,head:0});
  assert.equal(plan('outdent','\tx\n x',{anchor:1,head:5}).text,'x\nx');
  assert.equal(plan('indent','',{anchor:0,head:0}).text,'  ');
});

test('line duplication handles unterminated EOF, reverse selections and astral scalars',()=>{
  assert.deepEqual(plan('duplicateLineDown','😀x',{anchor:2,head:0}),{start:2,end:2,text:'\n😀x',selection:{anchor:5,head:3}});
  assert.deepEqual(plan('duplicateLineUp','😀x',{anchor:1,head:1}),{start:0,end:0,text:'😀x\n',selection:{anchor:1,head:1}});
  const out=plan('duplicateLineDown','a\r\n',{anchor:1,head:0});
  assert.equal(out.text,'a\r\n');assert.deepEqual(out.selection,{anchor:4,head:3});
});

test('line moves transfer EOF separators without merging logical lines',()=>{
  const text='a\r\n😀b';
  assert.deepEqual(plan('moveLineUp',text,{anchor:4,head:5},{split:3}),{start:0,end:5,text:'😀b\r\na',selection:{anchor:1,head:2}});
  assert.deepEqual(plan('moveLineDown',text,{anchor:0,head:1},{split:3}),{start:0,end:5,text:'😀b\r\na',selection:{anchor:4,head:5}});
  assert.equal(plan('moveLineDown','a\n',{anchor:1,head:1},{split:2}).text,'\na');
  assert.equal(plan('moveLineUp','a\n',{anchor:2,head:2},{split:2}).text,'\na');
  assert.equal(lineEnding('a\r\n'),'\r\n');assert.equal(lineEnding('a\u2029'),'\u2029');
});

function fixture(text,selection){
  const chars=[...text],lines=[];let start=0;
  for(let offset=0;offset<chars.length;offset++)if(chars[offset]==='\n'){lines.push({start,end:offset+1});start=offset+1;}
  lines.push({start,end:chars.length});
  const edits=[],api={selection,version:0,documentInfo:{chars:chars.length,lines:lines.length},lineRange:i=>lines[i],positionAt:offset=>({line:lines.findLastIndex(line=>line.start<=offset)}),slice:(a,b)=>chars.slice(a,b).join('')};
  const controller=new CommandController({api,options:()=>({}),report:(kind,error)=>{throw error;},edit:(...args)=>{edits.push(args);return true;}});
  return{controller,api,edits};
}

test('native copy and cut use logical lines; final lines share their preceding separator',()=>{
  for(const [text,position,payload,range]of [['a\nb',3,'b\n',[1,3]],['a\r\nb',4,'b\r\n',[1,4]],['a\n',2,'\n',[1,2]],['',0,'\n',null]]){
    const {controller,edits}=fixture(text,{anchor:position,head:position}),data=new Map();
    controller.copyEvent({preventDefault(){},clipboardData:{setData:(k,v)=>data.set(k,v)}},true);
    assert.equal(data.get('text/plain'),payload);
    assert.equal(data.get('application/x-texelune-line'),'1');
    assert.deepEqual(edits.map(edit=>edit.slice(0,2)),range?[range]:[]);
  }
});

test('selected copy is exact and a selection ending at the next line excludes that line',()=>{
  const {controller,edits}=fixture('ab\ncd\nef',{anchor:3,head:1}),data=new Map();
  assert.deepEqual(controller.block(),{first:0,last:0,start:0,end:3,selection:{anchor:3,head:1}});
  controller.copyEvent({preventDefault(){},clipboardData:{setData:(k,v)=>data.set(k,v)}},false);
  assert.equal(data.get('text/plain'),'b\n');assert.equal(data.has('application/x-texelune-line'),false);assert.equal(edits.length,0);
});

test('line-transform timeout terminates its Worker without applying a transaction',async()=>{
  const original=globalThis.Worker;let terminated=0;
  globalThis.Worker=class{postMessage(){}terminate(){terminated++;}};
  try{
    const {controller,edits}=fixture('x'.repeat(9000),{anchor:2,head:2}),errors=[];
    controller.a.options=()=>({providerTimeout:5});controller.a.report=(kind,error)=>errors.push({kind,error});
    assert.equal(await controller.line('indent'),false);
    assert.equal(terminated,1);assert.equal(edits.length,0);
    assert.equal(errors[0].kind,'command');assert.equal(errors[0].error.name,'TimeoutError');
  }finally{if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;}
});

test('asynchronous cut never deletes after cancellation or a denied clipboard write',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');let complete;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:()=>new Promise(resolve=>complete=resolve)}}});
  try{
    const {controller,edits}=fixture('alpha\nbeta',{anchor:1,head:1}),errors=[];
    controller.a.report=(kind,error)=>errors.push({kind,error});
    const pending=controller.clipboard('cut');controller.cancel();complete();
    assert.equal(await pending,false);assert.equal(edits.length,0);
    navigator.clipboard.writeText=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));
    assert.equal(await controller.clipboard('cut'),false);assert.equal(edits.length,0);
    assert.equal(errors[0].kind,'clipboard');assert.equal(errors[0].error.name,'NotAllowedError');
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {bracketPairs,defaultBracketPairs,scanBrackets} from '../../packages/editor/brackets.js';
import {indentInsertion} from '../../packages/editor/editing.js';
const editor=text=>{const chars=[...text];return{documentInfo:{chars:chars.length},slice:(start,end)=>chars.slice(start,end).join('')};};
const find=(text,offset,pairs=defaultBracketPairs)=>scanBrackets(editor(text),offset,pairs,new AbortController().signal);

test('bracket matching uses scalar ranges, strict nesting and logical order in mixed scripts',async()=>{
  const text='👩🏽‍💻 (مرحبا [x] שלום)';
  const chars=[...text],open=chars.indexOf('('),close=chars.indexOf(')');
  assert.deepEqual(await find(text,open),{open:{start:open,end:open+1},close:{start:close,end:close+1}});
  assert.deepEqual(await find(text,close+1),await find(text,open));
  assert.deepEqual(await find('（【值】）',1),{open:{start:1,end:2},close:{start:3,end:4}});
  assert.equal(await find('([)]',0),null);assert.equal(await find('(',1),null);assert.equal(await find('abc',2),null);
});
test('bracket definitions are immutable, bounded and unambiguous Unicode scalars',async()=>{
  const input=[{open:'🟦',close:'🟥'}],pairs=bracketPairs(input);input[0].open='x';
  assert(Object.isFrozen(pairs)&&Object.isFrozen(pairs[0]));
  assert.deepEqual(await find('🟦x🟥',0,pairs),{open:{start:0,end:1},close:{start:2,end:3}});
  for(const value of [[{open:'/*',close:'*/'}],[{open:'"',close:'"'}],[{open:'(',close:')'},{open:')',close:']'}],[{open:'\ud800',close:')'}],[{open:' ',close:')'}]])assert.throws(()=>bracketPairs(value),TypeError);
  assert.deepEqual(bracketPairs([]),[]);
  assert.deepEqual(indentInsertion({before:'🟦',after:'🟥',leadingWhitespace:'',indentUnit:'  ',bracketPairs:pairs},'brackets'),{text:'\n  \n',caretOffset:3});
});
test('large bracket scans bound every read and yield before cancellation',async()=>{
  const abort=new AbortController();let slices=0,maxRead=0,yielded=false;
  const e={documentInfo:{chars:100*1048576},slice(start,end){slices++;maxRead=Math.max(maxRead,end-start);return start===0?'(':'x'.repeat(end-start);}};
  await assert.rejects(scanBrackets(e,0,defaultBracketPairs,abort.signal,async()=>{yielded=true;abort.abort();}),{name:'AbortError'});
  assert(yielded&&slices>1);assert(maxRead<=1024);
  await assert.rejects(scanBrackets(e,0,defaultBracketPairs,abort.signal),{name:'AbortError'});
});

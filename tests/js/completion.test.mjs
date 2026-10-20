import test from 'node:test';
import assert from 'node:assert/strict';
import {completionPrefix,prepareCompletions,advanceCompletions} from '../../packages/editor/completion.js';
import {normalizeCompletions} from '../../packages/editor/completion-protocol.js';

const editor=text=>({documentInfo:{chars:[...text].length},slice:(a,b)=>[...text].slice(a,b).join('')});
test('resident completion replacements follow typing and deletion before asynchronous refresh',()=>{
  const items=prepareCompletions([{label:'greeting'},{label:'group'}],editor('gr'),2);
  const typed=advanceCompletions(items,{start:2,end:2,text:'e'},editor('gre'),3);
  assert.deepEqual(typed.map(item=>[item.label,item.start,item.end]),[['greeting',0,3]]);
  const removed=advanceCompletions(typed,{start:2,end:3,text:''},editor('gr'),2);
  assert.equal(removed[0].end,2);
  assert.deepEqual(advanceCompletions(items,{start:0,end:2,text:'x'},editor('x'),1),[]);
  assert.deepEqual(advanceCompletions(items,{start:2,end:2,text:'.'},editor('gr.'),3),[]);
});
test('completion ranges use scalar offsets after emoji and preserve Unicode identifier prefixes',()=>{
  const e=editor('👩🏽‍💻 αβ');assert.deepEqual(completionPrefix(e,7),{start:5,end:7});
  const result=prepareCompletions([{label:'αβγ',text:'αβγ'},{label:'other'}],e,7);
  assert.equal(result.length,1);assert.equal(result[0].start,5);assert.equal(result[0].end,7);
});
test('completion filtering, stable ranking and validation bound candidate work',()=>{
  const result=prepareCompletions([{label:'alpha',sortText:'2'},{label:'alpine',sortText:'1',preselect:true},{label:'algebra',snippet:true},{label:'alto',additionalEdits:true},{label:'bad',start:-1},{label:'bad',end:99}],editor('al'),2);
  assert.deepEqual(result.map(i=>i.label),['alpine','alpha']);assert(result.every(Object.isFrozen));
  assert.equal(prepareCompletions(Array.from({length:1000},()=>({label:'alpha'})),editor('a'),1).length,200);
  assert.throws(()=>prepareCompletions({},editor('a'),1),TypeError);
});
test('LSP completion defaults, insert/replace edits and prefix fallback normalize in the read version',()=>{
  const text='😀 greet',chars=[...text],mirror={length:()=>chars.length,slice:(a,b)=>chars.slice(a,b).join(''),offset_at:(line,column)=>[...text.slice(0,column)].length};
  const plain=normalizeCompletions([{label:'greeting'}],mirror,7)[0];assert.equal(plain.start,2);assert.equal(plain.end,7);
  const range={start:{line:0,character:3},end:{line:0,character:8}};
  const result=normalizeCompletions({itemDefaults:{editRange:{insert:range,replace:range},insertTextFormat:2},items:[{label:'greeting',textEditText:'greeting($1)',preselect:true}]},mirror,7)[0];
  assert.equal(result.start,2);assert.equal(result.end,7);assert.equal(result.text,'greeting($1)');assert(result.snippet&&result.preselect);
});

test('completion guesses replace a whole identifier and bound pathological words',()=>{
  const result=prepareCompletions([{label:'greeting'}],editor('greeting'),3)[0];assert.equal(result.start,0);assert.equal(result.end,8);
  const canonical=prepareCompletions([{label:'éclair'}],editor('e\u0301'),2)[0];assert.equal(canonical.end,2);
  assert.deepEqual(prepareCompletions([{label:'a'}],editor('a'.repeat(10000)),5000),[]);
});

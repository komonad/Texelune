import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indentInsertion,deadline} from '../../packages/editor/editing.js';

test('indent policies preserve whitespace and place the caret inside bracket pairs',()=>{
  const context={before:'\tfn main() {',after:'}',leadingWhitespace:'\t',indentUnit:'  '};
  assert.deepEqual(indentInsertion(context,'none'),{text:'\n'});
  assert.deepEqual(indentInsertion(context,'keep'),{text:'\n\t'});
  assert.deepEqual(indentInsertion(context,'brackets'),{text:'\n\t  \n\t',caretOffset:4});
  assert.deepEqual(indentInsertion({...context,after:'value'},'brackets'),{text:'\n\t  '});
  assert.deepEqual(indentInsertion({...context,before:'    value'},'brackets'),{text:'\n\t'});
});

test('provider deadlines settle without waiting for stale asynchronous work',async()=>{
  const abort=new AbortController();
  const pending=deadline(()=>new Promise(()=>{}),abort.signal,1000);abort.abort();
  await assert.rejects(pending,{name:'AbortError'});
  await assert.rejects(deadline(()=>new Promise(()=>{}),new AbortController().signal,5),{name:'TimeoutError'});
  assert.equal(await deadline(()=>42,new AbortController().signal),42);
});

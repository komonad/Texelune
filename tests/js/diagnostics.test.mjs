import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticIndex} from '../../packages/editor/diagnostics.js';

test('diagnostic intervals use half-open ranges, include point errors and choose the highest severity',()=>{
  const items=[{start:4,end:12,message:'warning',severity:2},{start:6,end:8,message:'error',severity:1},{start:12,end:12,message:'point',severity:3}];
  const index=new DiagnosticIndex(items,15);
  assert.deepEqual(index.at(7).map(item=>item.message),['warning','error']);
  assert.equal(index.best(7,8).message,'error');
  assert.equal(index.at(8).length,1);
  assert.deepEqual(index.at(12).map(item=>item.message),['point']);
  assert.equal(index.at(13).length,0);
  assert.equal(index.next(6).message,'point');
  assert.equal(index.next(4,-1).message,'point');
  items[0].start=99;assert.equal(index.items[0].start,4);
  assert.throws(()=>new DiagnosticIndex([{start:2,end:1,message:'invalid'}]));
});
test('interval lookup matches a full scan for nested and disjoint diagnostic ranges',()=>{
  let seed=13;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  const items=Array.from({length:2000},(_,i)=>{const start=Math.floor(random()*10000);return{start,end:start+Math.floor(random()*600),message:String(i),severity:1+Math.floor(random()*4)};});
  const index=new DiagnosticIndex(items);
  for(let i=0;i<100;i++){
    const start=Math.floor(random()*11000),end=start+1+Math.floor(random()*100);
    const expected=index.items.filter(item=>item.start<end&&Math.max(item.end,item.start+1)>start);
    assert.deepEqual(index.search(start,end,Infinity),expected);
    assert.equal(index.best(start,end)?.severity,expected.length?Math.min(...expected.map(item=>item.severity)):undefined);
  }
});

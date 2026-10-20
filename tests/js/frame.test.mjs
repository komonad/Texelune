import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameStager} from '../../packages/editor/frame.js';

test('partial frames retain atlas writes until a complete scene can replace the resident one',()=>{
  const frames=new FrameStager(),first={atlas_epoch:0,visible_ready:true,patches:['a']};
  assert.equal(frames.stage(first,1),true);
  assert.deepEqual(frames.take(first),{reset:true,patches:['a']});
  const partial={atlas_epoch:0,visible_ready:false,patches:['b']};
  assert.equal(frames.stage(partial,1),false);
  assert.throws(()=>frames.take(partial),/complete/);
  const complete={atlas_epoch:0,visible_ready:true,patches:['c']};frames.stage(complete,1);
  assert.deepEqual(frames.take(complete),{reset:false,patches:['b','c']});
});
test('atlas generations and replacement Workers cannot overwrite a resident atlas before a full frame',()=>{
  const frames=new FrameStager(),frame=(epoch,ready,patches)=>({atlas_epoch:epoch,visible_ready:ready,patches});
  const old=frame(0,true,['old']);frames.stage(old,1);frames.take(old);
  const pending=frame(1,false,['new-a']);frames.stage(pending,1);
  assert.equal(frames.active,'1:0');
  const replaced=frame(1,true,['new-b']);frames.stage(replaced,1);
  const final=frame(1,true,['new-c']);frames.stage(final,1);
  assert.deepEqual(frames.take(final),{reset:true,patches:['new-a','new-b','new-c']});
  const worker=frame(0,true,['worker']);frames.stage(worker,2);
  assert.deepEqual(frames.take(worker),{reset:true,patches:['worker']});
});

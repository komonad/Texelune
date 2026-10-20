import{test}from'node:test';
import assert from'node:assert/strict';
import{Samples,PerformanceStats,FrameTracker,equivalentFps}from'../../packages/editor/performance.js';
test('bounded samples discard invalid readings and report nearest-rank percentiles',()=>{
  const s=new Samples(100);for(let i=0;i<200;i++)s.push(i);s.push(NaN);s.push(-1);
  assert.deepEqual(s.summary(),{count:100,last:199,p50:149,p95:194,p99:198,max:199});
});
test('submitted FPS is independent of rAF and idle time ages both rates',()=>{
  const s=new PerformanceStats();for(let i=0;i<120;i++){s.tick(100+i*1000/120);if(i%2===0)s.draw(100+i*1000/120);}
  const result=s.snapshot(1100);assert.equal(result.renderFps,60);assert.equal(result.rafFps,120);
  assert.equal(s.snapshot(2200).renderFps,0);s.reset();assert.equal(s.series.size,0);
});
test('measured throughput, latency percentiles and CPU cost remain distinct',()=>{
  const s=new PerformanceStats();s.tick(100);s.draw(100);
  s.record('frame',.1);assert.equal(s.snapshot(2200).equivalentFps,null);
  for(let i=0;i<19;i++)s.record('completeFrame',20);s.record('completeFrame',100);
  const snapshot=s.snapshot(2200);assert.equal(snapshot.renderFps,0);assert.equal(snapshot.equivalentFps,null);assert.equal(snapshot.latencyEquivalentFps,50);assert.equal(snapshot.cpuEquivalentFps,10000);
  s.setBenchmark({frames:320,elapsed_ms:80,samples:[{frames:64,elapsed:16}]});assert.equal(s.snapshot(2200).equivalentFps,null);assert.equal(s.snapshot(2200).benchmark.fps,4000);assert.equal(s.snapshot(2200).benchmark.mean_ms,.25);
  s.record('completeFrame',100);assert.equal(s.snapshot(2200).latencyEquivalentFps,10);assert.equal(s.snapshot(2200).benchmark.fps,4000);
  assert.throws(()=>s.setBenchmark({frames:0,elapsed_ms:80}));
  for(const value of [0,-1,NaN,Infinity,undefined])assert.equal(equivalentFps(value),null);
  s.reset();assert.equal(s.snapshot(2200).equivalentFps,null);
});
test('live work combines Worker and main CPU costs with sampled GPU independently of benchmark results',()=>{
  const s=new PerformanceStats();s.recordLive({kind:'update',workerMs:2,mainMs:1,now:100,gpuSupported:true});
  let live=s.snapshot(100).live;assert.equal(live.cost_ms,3);assert.equal(live.bound,true);assert.equal(live.gpu_status,'pending');
  s.record('gpu',.2);s.record('gpu',.4);live=s.snapshot(110).live;
  assert.equal(live.cost_ms,3.3);assert.equal(live.bound,false);assert.equal(live.kind,'update');
  const fps=s.snapshot(110).equivalentFps;s.setBenchmark({frames:320,elapsed_ms:80});assert.equal(s.snapshot(110).equivalentFps,fps);
  s.recordLive({kind:'redraw',mainMs:.1,now:1700,gpuSupported:true});live=s.snapshot(1700).live;
  assert.equal(live.kind,'redraw');assert.ok(Math.abs(live.cost_ms-.4)<1e-9);assert.equal(s.snapshot(5000).live.cost_ms,live.cost_ms);
  assert.equal(s.snapshot(5000).live.age_ms,3300);s.benchmark=null;assert.equal(s.snapshot(5000).live.cost_ms,live.cost_ms);
  s.recordLive({kind:'update',workerMs:4,mainMs:1,now:5100,gpuSupported:true});assert.equal(s.snapshot(10000).live.kind,'update');
});
test('GPU quantization and missing timers remain explicit without erasing live samples',()=>{
  const s=new PerformanceStats();s.record('gpu',0);s.recordLive({kind:'redraw',mainMs:.2,now:100,gpuSupported:true});
  assert.equal(s.snapshot(100).live.gpu_status,'below-resolution');assert.equal(s.snapshot(100).live.bound,true);
  s.recordLive({kind:'redraw',mainMs:0,now:200,gpuSupported:true});assert.equal(s.snapshot(200).live.at,100);
  s.recordLive({kind:'update',workerMs:.3,mainMs:.1,now:300});assert.equal(s.snapshot(300).live.gpu_status,'unavailable');
  s.reset();assert.equal(s.snapshot(400).live,null);
});
test('frame generation spans the same update through GPU completion and excludes only its rAF wait',()=>{
  const s=new PerformanceStats(),tracker=new FrameTracker(s),trace=tracker.begin(100);
  assert.equal(tracker.snapshot().state,'pending');assert.equal(s.snapshot(100).equivalentFps,null);
  assert.deepEqual(tracker.claim(trace),trace);assert.equal(tracker.claim(trace),null);
  const times={readyAt:130,drawStartedAt:160,finishedAt:165,version:7,request:9};
  assert.equal(tracker.complete(trace,times),true);
  assert.equal(s.snapshot(200).metrics.completeFrame.last,35);
  assert.deepEqual(s.lastCompletedFrame,{id:trace.id,version:7,request:9,generation_ms:35,latency_ms:65,raf_wait_ms:30,backpressure_ms:0});
  assert.equal(tracker.complete(trace,times),false);assert.equal(s.snapshot(200).metrics.completeFrame.count,1);
});
test('GPU backpressure remains part of full generation cost',()=>{
  const s=new PerformanceStats(),tracker=new FrameTracker(s),trace=tracker.begin(100);tracker.claim(trace);
  assert.equal(tracker.complete(trace,{readyAt:130,drawStartedAt:160,finishedAt:165,backpressureMs:20}),true);
  assert.equal(s.lastCompletedFrame.generation_ms,55);assert.equal(s.lastCompletedFrame.raf_wait_ms,10);assert.equal(s.lastCompletedFrame.backpressure_ms,20);
});
test('superseded updates, pending completions after reset and invalid clock order cannot publish samples',()=>{
  const s=new PerformanceStats(),tracker=new FrameTracker(s),first=tracker.begin(0);tracker.claim(first);
  const second=tracker.begin(1),times={readyAt:2,drawStartedAt:3,finishedAt:4};
  assert.equal(tracker.complete(first,times),false);assert.equal(tracker.claim(first),null);
  tracker.claim(second);assert.equal(tracker.complete(second,{...times,drawStartedAt:1}),false);
  s.reset();assert.equal(tracker.accepts(second),true);assert.equal(tracker.matches(second),false);assert.equal(tracker.complete(second,times),false);assert.equal(tracker.snapshot().state,'none');assert.equal(s.lastCompletedFrame,null);
  const third=tracker.begin(10);tracker.claim(third);
  assert.equal(tracker.complete(third,{readyAt:20,drawStartedAt:25,finishedAt:40}),true);assert.equal(s.snapshot(50).metrics.completeFrame.last,25);
});

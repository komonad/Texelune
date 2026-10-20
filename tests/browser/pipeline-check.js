async page=>{
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const settled=()=>page.waitForFunction(()=>window.texelune?.performance.frameTrace.state==='complete'&&window.texelune.frame.pending===0&&Number(window.texelune.frame.version)===window.texelune.stats.version,null,{timeout:30000});
  const reset=()=>page.getByRole('button',{name:'重置',exact:true}).click();
  await page.reload();await settled();
  await page.evaluate(()=>{window.texelune.load('timing אבג text\nnext','pipeline.txt');window.texelune.select(0,0);});await settled();
  await page.evaluate(async()=>{
    const {Renderer}=await import('../packages/editor/pkg/texelune_editor.js');
    window.__timingHooks={Renderer,submitted:Renderer.prototype.submitted,postMessage:Worker.prototype.postMessage};
    const original=Renderer.prototype.submitted;
    Renderer.prototype.submitted=function(){return original.call(this).then(()=>new Promise(resolve=>setTimeout(resolve,90)));};
  });
  try{
    await reset();await page.evaluate(()=>window.texelune.insert('g'));await settled();
    const gpu=await page.evaluate(()=>window.texelune.performance);
    assert(gpu.lastCompletedFrame.generation_ms>=80,'complete generation waits for the GPU completion callback');
    assert(gpu.lastCompletedFrame.version===await page.evaluate(()=>window.texelune.stats.version),'GPU completion identifies the same document version');
    assert(gpu.latencyEquivalentFps<gpu.cpuEquivalentFps,'completion latency is separate from CPU cost');
    const count=gpu.metrics.completeFrame.count;
    await page.getByRole('checkbox',{name:'连续渲染',exact:true}).check();await page.waitForTimeout(350);
    assert(await page.evaluate(()=>window.texelune.performance.metrics.completeFrame.count)===count,'cached redraws cannot dilute full-update samples');
    await page.waitForFunction(()=>window.texelune.stats.inFlight===2);
    await page.evaluate(()=>window.texelune.insert('b'));await settled();
    const pressure=await page.evaluate(()=>window.texelune.performance);
    assert(pressure.lastCompletedFrame.backpressure_ms>0,'GPU backpressure is observed');
    assert(pressure.lastCompletedFrame.generation_ms>=80+pressure.lastCompletedFrame.backpressure_ms,'GPU backpressure remains in generation cost');
    await page.getByRole('checkbox',{name:'连续渲染',exact:true}).uncheck();await page.waitForFunction(()=>window.texelune.stats.inFlight===0);
    await page.evaluate(()=>{
      const hooks=window.__timingHooks;hooks.Renderer.prototype.submitted=hooks.submitted;
      Worker.prototype.postMessage=function(message,...rest){setTimeout(()=>hooks.postMessage.call(this,message,...rest),85);};
    });
    await reset();await page.evaluate(()=>window.texelune.insert('w'));await settled();
    const worker=await page.evaluate(()=>window.texelune.performance);
    assert(worker.lastCompletedFrame.generation_ms>=75,'complete generation includes asynchronous Worker dispatch');
    assert(Math.abs(worker.lastCompletedFrame.latency_ms-worker.lastCompletedFrame.raf_wait_ms-worker.lastCompletedFrame.generation_ms)<.001,'generation and display scheduling waiting are separated');
    assert(worker.latencyEquivalentFps===1000/worker.metrics.completeFrame.p95,'latency summary derives from paired update samples');
    await page.evaluate(()=>window.texelune.insert('r'));await reset();
    await page.waitForFunction(()=>window.texelune.frame&&Number(window.texelune.frame.version)===window.texelune.stats.version&&window.texelune.frame.pending===0);
    assert(await page.evaluate(()=>window.texelune.text.startsWith('gbwr')),'resetting statistics retains pending scene updates');
    await page.evaluate(report=>window.__pipelineReport=report,{gpu,pressure,worker});
  }finally{
    await page.evaluate(()=>{const h=window.__timingHooks;h.Renderer.prototype.submitted=h.submitted;Worker.prototype.postMessage=h.postMessage;delete window.__timingHooks;document.querySelector('texelune-editor').shadowRoot.getElementById('continuous').checked=false;});
  }
}

async page=>{
  const assert=(value,message)=>{if(!value)throw Error(message);};
  await page.goto('http://127.0.0.1:4173/web/');await page.waitForFunction(()=>!!window.texelune);
  await page.evaluate(()=>{window.studio.lsp.disconnect();window.texelune.showPerformance(false);});
  const stable=()=>page.waitForFunction(()=>{const e=window.texelune;return e?.frame?.visible_ready&&e.frame.request===e.stats.request&&Number(e.frame.version)===e.version;},null,{timeout:60000});
  await page.evaluate(()=>window.texelune.loadSynthetic(100*1048576,true));await stable();
  const result=await page.evaluate(async()=>{
    const e=window.texelune,NativeWorker=window.Worker;let created=0,terminated=0,ticks=0;
    window.Worker=class extends NativeWorker{constructor(url,options){super(url,options);this.command=String(url).includes('/command-worker.js');if(this.command)created++;}terminate(){if(this.command)terminated++;return super.terminate();}};
    const timer=setInterval(()=>ticks++,0);
    try{
      e.select(10,10);const pending=e.executeCommand('indent');
      await new Promise(resolve=>setTimeout(resolve,25));e.insert('!');
      const applied=await pending;
      return{applied,created,terminated,ticks,prefix:e.slice(0,11),bytes:e.documentInfo.bytes,selection:e.selection};
    }finally{clearInterval(timer);window.Worker=NativeWorker;}
  });
  await page.evaluate(result=>window.__commandsStressReport=result,result);
  assert(!result.applied&&result.created===1&&result.terminated===1,'a pending 100MiB line transform is cancelled and its Worker terminated');
  assert(result.ticks>0&&result.prefix.endsWith('!')&&result.bytes===100*1048576+1&&result.selection.head===11,'preparation yields to input and does not overwrite the following transaction');await stable();
  const line=await page.evaluate(async()=>{const e=window.texelune;await e.executeCommand('selectLine');return{selection:e.selection,chars:e.documentInfo.chars};});
  assert(line.selection.anchor===0&&line.selection.head===line.chars,'selecting a 100MiB logical line uses range metadata');
  await page.evaluate(()=>{window.texelune.select(11,11);window.texelune.focus();});await page.keyboard.type('x');await stable();
  assert(await page.evaluate(()=>window.texelune.frame.visible_ready&&window.texelune.frame.quad_count>0&&window.texelune.selection.head===12),'editing remains available after cancellation');
}

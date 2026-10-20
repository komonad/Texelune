async page=>{
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  await page.goto('http://127.0.0.1:4173/web/');
  await page.waitForFunction(()=>window.texelune?.frame?.visible_ready);
  await page.evaluate(()=>window.texelune.loadSynthetic(100*1048576));
  const stable=()=>page.waitForFunction(()=>window.texelune.frame?.visible_ready&&window.texelune.frame.request===window.texelune.stats.request&&window.texelune.frame.pending===0&&Number(window.texelune.frame.version)===window.texelune.version,null,{timeout:60000});await stable();
  await page.evaluate(()=>{const e=window.texelune;window.__flickerFrames=[];window.__retained=[];e.on('frame',({detail:f})=>window.__flickerFrames.push({version:Number(f.version),ready:f.visible_ready,quads:f.quad_count}));e.select(10,10);e.focus();const observe=()=>{if(window.__observeFrames){window.__retained.push({version:e.version,resident:Number(e.frame?.version),quads:e.frame?.quad_count});requestAnimationFrame(observe);}};window.__observeFrames=true;requestAnimationFrame(observe);});
  for(let i=0;i<15;i++){await page.keyboard.press('Enter');await page.waitForTimeout(40);await page.keyboard.type('x');await page.waitForTimeout(40);}
  await stable();
  const frames=await page.evaluate(()=>{window.__observeFrames=false;return{published:window.__flickerFrames,resident:window.__retained,bytes:window.texelune.documentInfo.bytes};});
  assert(frames.published.length>10,'continuous editing produces replacement scenes');
  assert(frames.published.every(frame=>frame.ready&&frame.quads>0),'only complete visible scenes replace the resident frame');
  assert(frames.resident.every(frame=>frame.quads>0),'the resident scene survives asynchronous layout');
  assert(frames.bytes>100*1048576,'100 MiB document remains editable');
  await page.evaluate(()=>{window.texelune.restartLayout();});await stable();
  const result=await page.evaluate(()=>window.texelune.benchmark('warm'));
  assert(result.frames>0,'warm benchmark uses a complete staged atlas');
}

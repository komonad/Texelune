async page=>{
  const stable=()=>page.waitForFunction(()=>window.texelune?.frame&&Number(window.texelune.frame.version)===window.texelune.stats.version&&window.texelune.frame.request===window.texelune.stats.request&&window.texelune.frame.pending===0,null,{timeout:30000});
  const assert=(v,message)=>{if(!v)throw Error(message);};
  await page.reload();await page.waitForFunction(()=>window.studio?.lsp.state==='ready');await stable();await page.evaluate(()=>window.studio.lsp.disconnect());
  await page.evaluate(()=>window.texelune.loadSynthetic(100*1048576,true));await stable();
  const initial=await page.evaluate(()=>({info:window.texelune.documentInfo,quads:window.texelune.frame.rects.length,layout:window.texelune.frame.layout_ms}));
  assert(initial.info.bytes===100*1048576&&initial.info.lines===1,'100 MiB single line');
  const measurements=[];
  for(const position of [0,50*1048576,100*1048576]){
    await page.evaluate(offset=>{window.texelune.select(offset,offset);window.texelune.insert('X');},position);await stable();
    measurements.push(await page.evaluate(()=>({info:window.texelune.documentInfo,layout:window.texelune.frame.layout_ms,quads:window.texelune.frame.rects.length,caret:window.texelune.caret,latency:window.texelune.stats.lastLatency,metrics:window.texelune.performance})));
  }
  assert(measurements.every(m=>m.quads<10000&&m.caret),'bounded long-line geometry and precise caret');
  await page.getByRole('checkbox',{name:'Soft wrap',exact:true}).uncheck();await stable();
  await page.evaluate(()=>{document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();});
  await page.keyboard.press('Control+End');await page.waitForFunction(()=>!!window.texelune.caret);await stable();
  assert(await page.evaluate(()=>!!window.texelune.caret&&window.texelune.frame.rects.length<1000),'unwrapped large-line end stays bounded');
  await page.getByRole('checkbox',{name:'Soft wrap',exact:true}).check();await stable();
  const preserved=await page.evaluate(()=>window.texelune.documentInfo.bytes);
  await page.evaluate(()=>{window.__cancelledImport=window.texelune.loadSynthetic(100*1048576);});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.evaluate(()=>window.__cancelledImport);await stable();
  assert((await page.evaluate(()=>window.texelune.documentInfo.bytes))===preserved,'cancel preserves active document');
  await page.evaluate(()=>window.texelune.load('אבגדה וזחטי כלמנס '.repeat(50),'rtl-wrap.txt'));await stable();
  await page.evaluate(()=>{document.querySelector('texelune-editor').shadowRoot.getElementById('viewport').style.width='420px';window.texelune.select(0,0);document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();});await stable();
  const route=[];let previous=await page.evaluate(()=>window.texelune.caret);
  for(let i=0;i<50;i++){
    await page.keyboard.press('ArrowLeft');
    const hit=await page.evaluate(()=>window.texelune.caret);
    if(!hit)await stable();
    const next=await page.evaluate(()=>window.texelune.caret);
    assert(next&&(next.y>previous.y||next.x<previous.x-.01),'RTL visual movement crosses wrapped rows');route.push(next);previous=next;
  }
  assert(route.some(h=>h.y>16),'RTL wrap crosses a visual line');
  await page.evaluate(()=>document.querySelector('texelune-editor').shadowRoot.getElementById('viewport').style.width='');await stable();
  await page.evaluate(report=>window.__largeEditReport=report,{initial,measurements,rtlSteps:route.length});
}

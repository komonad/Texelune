async page=>{
  const stable=()=>page.waitForFunction(()=>window.texelune?.frame&&Number(window.texelune.frame.version)===window.texelune.stats.version&&window.texelune.frame.request===window.texelune.stats.request&&window.texelune.frame.pending===0,null,{timeout:30000});
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  await page.reload();await page.waitForFunction(()=>window.studio?.lsp.state==='ready');await stable();await page.evaluate(()=>window.studio.lsp.disconnect());
  const bounds=await page.evaluate(()=>{const p=document.querySelector('texelune-editor').shadowRoot.getElementById('performance-panel').getBoundingClientRect(),v=document.querySelector('texelune-editor').shadowRoot.getElementById('viewport').getBoundingClientRect();return{inside:document.querySelector('texelune-editor').shadowRoot.getElementById('performance-panel').parentElement.id==='viewport'&&p.left>=v.left&&p.right<=v.right&&p.top>=v.top&&p.bottom<=v.bottom};});
  assert(bounds.inside,'performance panel remains inside editor');
  await page.getByRole('button',{name:'隐藏性能面板'}).click();
  await page.evaluate(()=>window.texelune.load('ab אב גד 12 שלום xyz','bidi-regression.txt'));await stable();
  await page.evaluate(()=>{window.texelune.select(0,0);document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();});
  let previous=await page.evaluate(()=>window.texelune.caret);
  const route=[];
  for(let i=0;i<15;i++){
    await page.keyboard.press('ArrowRight');
    const next=await page.evaluate(()=>window.texelune.caret);
    assert(next&&(next.y>previous.y||next.x>previous.x+.01),'BiDi ArrowRight must traverse a visual cell');
    route.push({offset:next.offset,x:next.x,y:next.y});previous=next;
  }
  for(let i=0;i<15;i++)await page.keyboard.press('ArrowLeft');
  assert((await page.evaluate(()=>window.texelune.selection)).head===0,'BiDi reverse route');
  await page.evaluate(()=>window.texelune.load('underline abc','decoration.txt'));await stable();
  await page.evaluate(()=>window.texelune.select(0,9));
  await page.getByRole('button',{name:'Underline',exact:true}).click();await stable();
  assert(await page.evaluate(()=>window.texelune.frame.rects.some(r=>r.uv[2]===0&&r.bounds[3]===1.25)),'underline geometry');
  await page.getByRole('button',{name:'Underline',exact:true}).click();await stable();
  assert(await page.evaluate(()=>!window.texelune.frame.rects.some(r=>r.uv[2]===0&&r.bounds[3]===1.25)),'underline toggle off');
  await page.getByRole('spinbutton',{name:'字体大小'}).fill('24');
  await page.getByRole('spinbutton',{name:'字体大小'}).press('Tab');await stable();
  assert(await page.evaluate(()=>window.texelune.frame.hits[0].h>35),'font size affects layout metrics');
  await page.evaluate(()=>window.texelune.setFontSize(17));await stable();
  await page.evaluate(()=>window.texelune.loadSynthetic(16*1048576,true));await stable();
  assert((await page.evaluate(()=>window.texelune.documentInfo)).bytes===16*1048576,'single-line fixture exact bytes');
  const fast=[];
  for(let i=0;i<20;i++){
    await page.evaluate(()=>window.texelune.insert('x'));await stable();
    fast.push(await page.evaluate(()=>({layout:window.texelune.frame.layout_ms,latency:window.texelune.stats.lastLatency,quads:window.texelune.frame.rects.length})));
  }
  assert(fast.every(s=>s.quads<10000),'long wrapped line only retains visible geometry');
  await page.getByRole('checkbox',{name:'连续渲染',exact:true}).check();await page.waitForTimeout(800);
  const metrics=await page.evaluate(()=>window.texelune.performance);
  await page.getByRole('checkbox',{name:'连续渲染',exact:true}).uncheck();
  await page.evaluate(()=>window.texelune.loadSynthetic(100*1048576));await stable();
  const large=await page.evaluate(()=>({info:window.texelune.documentInfo,cache:window.texelune.frame.cached_blocks,quads:window.texelune.frame.rects.length,metrics:window.texelune.performance}));
  assert(large.info.bytes===100*1048576,'100 MiB fixture exact byte size');assert(large.cache<400,'100 MiB virtualization');
  const track=await page.locator('#scrollbar').boundingBox(),thumb=await page.locator('#thumb').boundingBox();
  assert(thumb.width>=12&&track.width>=18,'scrollbar grab width');
  await page.mouse.move(thumb.x+thumb.width/2,thumb.y+thumb.height/2);await page.mouse.down();await page.mouse.move(thumb.x+thumb.width/2,track.y+track.height*.7,{steps:12});await page.mouse.up();await stable();
  const firstLine=await page.evaluate(()=>window.texelune.frame.labels[0].line);assert(firstLine>1000,'thumb drag scrolls large document');
  await page.evaluate(()=>window.texelune.scrollTo(0));await stable();
  if(await page.evaluate(()=>document.querySelector('texelune-editor').shadowRoot.getElementById('performance-panel').hidden))await page.getByRole('button',{name:'性能',exact:true}).click();
  await page.getByRole('checkbox',{name:'连续渲染',exact:true}).check();await page.waitForTimeout(1200);
  const panel=await page.evaluate(()=>({fps:document.querySelector('texelune-editor').shadowRoot.getElementById('perf-fps').textContent,doc:document.querySelector('texelune-editor').shadowRoot.getElementById('perf-document').textContent,memory:document.querySelector('texelune-editor').shadowRoot.getElementById('perf-memory').textContent,gpu:document.querySelector('texelune-editor').shadowRoot.getElementById('perf-gpu').textContent}));
  assert(panel.doc.startsWith('100.0 MiB'),'overlay reports bytes without serializing document');
  const viewport=await page.locator('#viewport').boundingBox();
  const dragPanel=async(x,y)=>{const h=await page.locator('.perf-header').boundingBox();await page.mouse.move(h.x+60,h.y+18);await page.mouse.down();await page.mouse.move(x,y,{steps:8});await page.mouse.up();};
  await page.getByRole('button',{name:'折叠性能面板'}).click();
  await dragPanel(viewport.x+viewport.width+200,viewport.y+viewport.height+200);
  await page.getByRole('button',{name:'折叠性能面板'}).click();
  const expanded=await page.locator('#performance-panel').boundingBox();
  assert(expanded.x>=viewport.x&&expanded.y>=viewport.y&&expanded.x+expanded.width<=viewport.x+viewport.width&&expanded.y+expanded.height<=viewport.y+viewport.height,'expanded panel clamps to editor after dragging');
  await dragPanel(viewport.x+viewport.width-expanded.width+30,viewport.y+28);
  await page.evaluate(()=>document.querySelector('texelune-editor').shadowRoot.querySelector('.perf-body').scrollTop=0);
  await page.screenshot({path:'output/playwright/performance-100mb.png'});
  await page.evaluate(report=>window.__featuresReport=report,{bounds,route,fast,large,panel,metrics,firstLine});
}

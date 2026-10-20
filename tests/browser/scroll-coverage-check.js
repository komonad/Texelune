async page=>{
 const assert=(value,message)=>{if(!value)throw Error(message);};
 await page.addInitScript(()=>{
  if(window.__scrollGateInstalled)return;window.__scrollGateInstalled=true;
  const Native=window.Worker,set=Object.getOwnPropertyDescriptor(Native.prototype,'onmessage').set;window.__heldScrollFrames=[];
  window.Worker=class extends Native{constructor(url,options){super(url,options);if(String(url).endsWith('/editor/worker.js'))Object.defineProperty(this,'onmessage',{set:handler=>set.call(this,event=>{if(window.__holdScrollFrames&&event.data.type==='frame')window.__heldScrollFrames.push(()=>handler.call(this,event));else if(window.__scrollDelay&&event.data.type==='frame')setTimeout(()=>handler.call(this,event),window.__scrollDelay);else handler.call(this,event);})});}};
 });
 await page.context().route('**/*',route=>route.continue());await page.goto('http://127.0.0.1:4173/web/');await page.waitForFunction(()=>window.studio?.lsp.state==='ready');
 const stable=()=>page.waitForFunction(()=>{const e=window.texelune;return e.frame?.visible_ready&&e.frame.request===e.stats.request&&Number(e.frame.version)===e.version&&e.frame.pending===0;},null,{timeout:60000});
 const state=()=>page.evaluate(()=>{
  const e=window.texelune,f=e.frame,delta=e.renderedScroll-f.scroll,height=e.root.getElementById('viewport').clientHeight;
  const rows=f.navigation.rows.map(r=>({start:r.y-delta,end:r.y+r.h-delta})).filter(r=>r.end>0&&r.start<height).sort((a,b)=>a.start-b.start);
  let end=rows[0]?.end??0,gap=0;for(const row of rows){gap=Math.max(gap,row.start-end);end=Math.max(end,row.end);}
  return{scroll:e.scroll,rendered:e.renderedScroll,origin:f.scroll,min:f.scroll_min,max:f.scroll_max,visible:f.rects.filter(r=>r.uv[2]>0&&r.bounds[1]+r.bounds[3]>delta&&r.bounds[1]<delta+height).length,first:rows[0]?.start??height,end,height,gap,held:window.__heldScrollFrames.length};
 });
 const covered=async message=>{const s=await state();assert(s.visible>0&&s.first<=28&&s.end>=s.height-28&&s.gap<1,message+': '+JSON.stringify(s));return s;};
 const hold=()=>page.evaluate(()=>{window.__holdScrollFrames=true;window.__heldScrollFrames=[];});
 const release=async()=>{await page.evaluate(()=>{window.__holdScrollFrames=false;for(const deliver of window.__heldScrollFrames.splice(0))deliver();});await stable();};
 await page.evaluate(()=>{window.studio.lsp.disconnect();const e=window.texelune;e.showPerformance(false);e.load(Array.from({length:1000},(_,i)=>`Line ${i} `+'Mixed text 中文 עברית '.repeat(5)).join('\n'),'scroll-coverage.txt');});await stable();
 await hold();await page.evaluate(()=>window.texelune.scrollTo(96));await page.waitForTimeout(80);
 const small=await covered('small scroll keeps every visible text row');assert(small.rendered===96&&small.origin===0,'prefetched geometry moves immediately before a replacement frame');
 const hit=await page.evaluate(()=>{const e=window.texelune,delta=e.renderedScroll-e.frame.scroll,h=e.frame.navigation.hits.find(h=>h.x===66&&h.y-delta>60&&h.y-delta<150),r=e.root.getElementById('viewport').getBoundingClientRect();return{offset:h.offset,x:r.left+h.x+.1,y:r.top+h.y-delta+h.h*.4};});
 await page.mouse.click(hit.x,hit.y);assert(await page.evaluate(offset=>window.texelune.selection.head===offset,hit.offset),'hit testing follows the rendered position while layout is delayed');
 await page.evaluate(offset=>{const e=window.texelune;e.setDiagnostics([{start:offset,end:offset+1,message:'Marker',severity:2}]);window.__scrollOverlay=e.addOverlay({anchor:offset,content:'Anchor'});},hit.offset);
 assert(await page.evaluate(offset=>{const e=window.texelune,cell=e.frame.navigation.cells.find(c=>c.start===offset),mark=e.root.querySelector('.diagnostic-mark'),delta=e.renderedScroll-e.frame.scroll;return mark&&Math.abs(parseFloat(mark.style.top)-(cell.bounds[1]-delta+cell.bounds[3]-3))<1&&!window.__scrollOverlay.element.hidden;},hit.offset),'diagnostics and widgets share the rendered geometry');
 await page.evaluate(()=>window.texelune.scrollTo(9000));await page.waitForTimeout(30);
 const jump=await state();assert(jump.rendered===jump.scroll&&jump.scroll===9000,'an uncached jump updates the presentation position without waiting for layout');
 const selected=await page.evaluate(()=>window.texelune.selection);await page.mouse.click(hit.x,hit.y);
 assert(await page.evaluate(s=>window.texelune.selection.head===s.head&&window.texelune.selection.anchor===s.anchor,selected),'clicks outside available geometry cannot select an unrelated resident line');
 await release();await covered('jump resolves to a complete target scene');
 await page.evaluate(()=>{window.__scrollOverlay.dispose();window.texelune.setDiagnostics([]);});
 await page.evaluate(async()=>{const {Renderer}=await import('../packages/editor/pkg/texelune_editor.js'),draw=Renderer.prototype.draw;Renderer.prototype.draw=function(width,height,delta,...rest){const result=draw.call(this,width,height,delta,...rest),audit=window.__scrollDrawAudit;if(result&&audit){const e=window.texelune;audit.draws++;if(Math.abs(e.frame.scroll+delta-e.scroll)>.01)audit.errors++;audit.delays.push(performance.now()-audit.inputAt);}return result;};});
 const smooth=[];
 for(const [bytes,singleLine,fontSize]of [[16*1048576,true,24],[100*1048576,false,17]]){
  await page.evaluate(({bytes,singleLine,fontSize})=>{window.texelune.setFontSize(fontSize);return window.texelune.loadSynthetic(bytes,singleLine);},{bytes,singleLine,fontSize});await stable();
  for(const direction of [1,-1]){
   const report=await page.evaluate(async direction=>{
    const e=window.texelune,initial=e.scroll,requests=[],start=performance.now();let active=true,frames=0,behind=0,maxLag=0,gaps=0,samples=0;
    window.__scrollDelay=20;const audit=window.__scrollDrawAudit={draws:0,errors:0,delays:[],inputAt:start};
    const off=e.on('frame',()=>{if(active){frames++;behind+=Number(e.frame.request<e.stats.request);requests.push(e.frame.request);}});
    await new Promise(resolve=>{const tick=()=>{const elapsed=performance.now()-start;audit.inputAt=performance.now();e.scrollTo(initial+direction*elapsed*2);maxLag=Math.max(maxLag,Math.abs(e.scroll-e.renderedScroll));const f=e.frame,delta=e.renderedScroll-f.scroll,height=e.root.getElementById('viewport').clientHeight,rows=f.navigation.rows;const first=Math.min(...rows.map(r=>r.y-delta)),last=Math.max(...rows.map(r=>r.y+r.h-delta));samples++;if(first>40||last<height-40)gaps++;if(elapsed<500)setTimeout(tick,8);else resolve();};tick();});
    active=false;off();window.__scrollDelay=0;window.__scrollDrawAudit=null;audit.delays.sort((a,b)=>a-b);return{frames,behind,maxLag,gaps,samples,requests,draws:audit.draws,drawErrors:audit.errors,submitP95:audit.delays[Math.floor(audit.delays.length*.95)]};
   },direction);
   assert(report.frames>=12&&report.behind>=6,'continuous input publishes compatible completed frames before scrolling stops: '+JSON.stringify(report));
   assert(report.maxLag===0&&report.draws>=12&&report.drawErrors===0,'GPU submissions follow the current input position throughout continuous scrolling: '+JSON.stringify(report));
   assert(report.gaps===0,'the prefetched scene covers continuous scrolling with delayed frame delivery: '+JSON.stringify(report));
   assert(report.requests.every((r,i)=>!i||r>=report.requests[i-1]),'out-of-order responses cannot rewind the resident scene');
   smooth.push(report);await stable();await covered('continuous scroll converges to its final target');
  }
  if(singleLine){await page.evaluate(()=>{const e=window.texelune;e.scrollTo(e.frame.total_height);});await stable();const end=await state();assert(end.rendered===end.scroll&&end.visible>0,'nonintegral line heights converge at the end of a large wrapped line');}
 }
 await page.evaluate(report=>window.__scrollCoverageReport=report,{small,jump,smooth});
}

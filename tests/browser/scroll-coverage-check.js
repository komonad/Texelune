async page=>{
 const assert=(value,message)=>{if(!value)throw Error(message);};
 await page.addInitScript(()=>{
  if(window.__scrollGateInstalled)return;window.__scrollGateInstalled=true;
  const Native=window.Worker,set=Object.getOwnPropertyDescriptor(Native.prototype,'onmessage').set;window.__heldScrollFrames=[];
  window.Worker=class extends Native{constructor(url,options){super(url,options);if(String(url).endsWith('/editor/worker.js'))Object.defineProperty(this,'onmessage',{set:handler=>set.call(this,event=>{if(window.__holdScrollFrames&&event.data.type==='frame')window.__heldScrollFrames.push(()=>handler.call(this,event));else handler.call(this,event);})});}};
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
 await page.evaluate(()=>window.texelune.scrollTo(9000));await page.waitForTimeout(80);
 const jump=await covered('large jump retains complete resident coverage');assert(jump.rendered===jump.max&&jump.rendered<jump.scroll,'large jumps stop at resident coverage until layout is ready');
 for(const y of [18000,0,40000,6000]){await page.evaluate(y=>window.texelune.scrollTo(y),y);await page.waitForTimeout(12);await covered('retargeted scroll keeps text visible');}
 await page.screenshot({path:'D:/dev/Texelune/output/playwright/scroll-coverage-held.png'});
 await release();const final=await covered('replacement reaches the requested viewport');assert(final.rendered===final.scroll&&final.origin===final.scroll,'replacement commits target scroll atomically');
 await page.evaluate(()=>{window.__scrollOverlay.dispose();window.texelune.setDiagnostics([]);});
 const stress=[];
 for(const [bytes,singleLine]of [[16*1048576,true],[100*1048576,false]]){
  await page.evaluate(({bytes,singleLine})=>window.texelune.loadSynthetic(bytes,singleLine),{bytes,singleLine});await stable();
  await hold();await page.evaluate(()=>window.texelune.scrollTo(90000));await page.waitForTimeout(80);stress.push(await covered('large fixture retains complete coverage while layout is delayed'));
  await release();await covered('large fixture replacement is complete');
  await hold();await page.evaluate(()=>window.texelune.scrollTo(0));await page.waitForTimeout(80);await covered('reverse scrolling retains complete coverage');await release();
 }
 await page.evaluate(()=>window.texelune.load('glyph cache\n'.repeat(200),'atlas-scroll.txt'));await stable();
 for(let i=0;i<12;i++){await page.mouse.move(hit.x,hit.y);await page.mouse.wheel(0,i<6?120:-120);await page.waitForTimeout(12);await covered('continuous wheel scrolling keeps glyphs visible');}await stable();
 await page.evaluate(report=>window.__scrollCoverageReport=report,{small,jump,final,stress});
}

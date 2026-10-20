async page=>{
 const assert=(value,message)=>{if(!value)throw Error(message);};
 await page.context().route('**/*',route=>route.continue());await page.goto('http://127.0.0.1:4173/web/');await page.waitForFunction(()=>window.studio?.lsp.state==='ready');
 await page.evaluate(()=>{window.studio.lsp.disconnect();const e=window.texelune;e.showPerformance(false);e.setSyntax(false);e.setFontSize(24);e.load(Array.from({length:800},(_,line)=>Array.from({length:36},(_,column)=>String.fromCodePoint(0x4e00+(line*36+column)%20000)).join('')).join('\n'),'atlas-scroll.txt');});
 const stable=()=>page.waitForFunction(()=>{const e=window.texelune;return e.frame?.visible_ready&&e.frame.request===e.stats.request&&e.frame.pending===0;},null,{timeout:30000});await stable();
 const records=[];
 for(let i=1;i<=120;i++){
  await page.evaluate(y=>window.texelune.scrollTo(y),i*360);await stable();
  const first=await page.evaluate(()=>({quads:window.texelune.frame.quad_count,epoch:window.texelune.frame.atlas_epoch,scroll:window.texelune.frame.scroll}));
  await page.evaluate(()=>window.texelune.scrollTo(window.texelune.scroll));await stable();
  const second=await page.evaluate(()=>({quads:window.texelune.frame.quad_count,epoch:window.texelune.frame.atlas_epoch}));
  assert(first.quads>0&&first.quads===second.quads,'complete scrolled frames retain every glyph without a follow-up refresh');records.push({first,second});
 }
 assert(records.at(-1).second.epoch>0,'distinct glyphs exercise atlas replacement');
 await page.evaluate(records=>window.__atlasScrollReport=records,records);
}

async page=>{
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const state=async()=>{const response=await page.request.get('http://127.0.0.1:4175/state');return response.json();};
  const waiting=s=>s.held.filter(item=>!item.cancelled&&!item.released);
  async function until(predicate,message){const deadline=Date.now()+15000;for(;;){const current=await state();if(predicate(current))return current;if(Date.now()>deadline)throw new Error(message);await page.waitForTimeout(20);}}
  async function release(request){await page.request.get('http://127.0.0.1:4175/release?id='+request.id);}
  const stable=()=>page.waitForFunction(()=>window.texelune?.frame?.visible_ready&&window.texelune.frame.pending===0&&window.texelune.frame.request===window.texelune.stats.request&&Number(window.texelune.frame.version)===window.texelune.version,null,{timeout:30000});
  const ink=()=>page.evaluate(()=>{const rects=window.texelune.frame.rects.filter(rect=>rect.uv[2]>0),near=(color,target)=>color.slice(0,3).every((v,i)=>Math.abs(v-target[i])<.001);return{red:rects.filter(r=>near(r.color,[1,0,0])).length,blue:rects.filter(r=>near(r.color,[0,0,1])).length,source:Number(window.texelune.frame.highlight_source_version),version:window.texelune.version,spans:window.texelune.frame.highlight_spans};});
  try{
    await page.goto('http://127.0.0.1:4173/web/');await page.waitForFunction(()=>window.studio?.lsp.state==='ready');
    await page.evaluate(()=>{window.studio.lsp.disconnect();window.studio.lsp.options.url='ws://127.0.0.1:4175/lsp';window.texelune.setSyntax(false);window.texelune.showPerformance(false);window.texelune.setTheme({name:'Concurrent',tokens:{keyword:'#ff0000',string:'#0000ff',function:'#008800'}});window.texelune.load('foo 👩🏽‍💻 bar\nbaz','main.rs');window.__asyncTokens=[];window.studio.lsp.addEventListener('tokens',({detail})=>window.__asyncTokens.push({source:detail.version,applied:detail.appliedVersion,batch:detail.batch}));});await page.evaluate(()=>window.studio.lsp.connect());
    const first=await until(s=>waiting(s).some(item=>item.text==='foo 👩🏽‍💻 bar\nbaz'),'initial snapshot request missing');
    await release(waiting(first).find(item=>item.text==='foo 👩🏽‍💻 bar\nbaz'));
    await page.waitForFunction(()=>window.texelune.frame?.highlight_spans===3);await stable();
    const initial=await ink();assert(initial.red===3&&initial.blue===3,'initial semantic colors are visible');
    await page.evaluate(()=>window.studio.lsp.refresh());const held=await until(s=>waiting(s).some(item=>item.text==='foo 👩🏽‍💻 bar\nbaz'),'delayed read missing');
    const read=waiting(held).find(item=>item.text==='foo 👩🏽‍💻 bar\nbaz'),writesBefore=held.writes.length,eventsBefore=await page.evaluate(()=>window.__asyncTokens.length);
    await page.evaluate(()=>{const editor=window.texelune;editor.replace(0,0,'// 🌏\n');const end=[...editor.text.slice(0,editor.text.indexOf('bar')+3)].length;editor.replace(end,end,'X');editor.replace(0,3,'');});await stable();
    await page.waitForTimeout(250);
    const during=await ink();assert(during.red===4&&during.blue===4&&during.source===0&&during.version===3,'resident spans inherit edits while the next batch is delayed');
    const frozen=await state();assert(frozen.writes.length===writesBefore,'server writes wait for the semantic read snapshot');
    assert(!frozen.held.find(item=>item.id===read.id).cancelled,'ordinary edits do not cancel an in-flight highlighter');
    await page.evaluate(()=>window.texelune.restartLayout());await stable();const recovered=await ink();assert(recovered.blue===4&&recovered.source===0,'layout restart replays the highlight checkpoint and following edits');
    await release(read);
    await page.waitForFunction(before=>window.__asyncTokens.slice(before).some(event=>event.source===0&&event.applied===3),eventsBefore);await stable();
    const rebased=await ink();assert(rebased.red===4&&rebased.blue===4&&rebased.spans===3,'late UTF-16 ranges use the captured emoji-containing snapshot and rebase to current text');
    const synced=await until(s=>waiting(s).some(item=>item.version===3),'latest coalesced read missing');
    const current=waiting(synced).find(item=>item.version===3);assert(synced.text===await page.evaluate(()=>window.texelune.text),'buffered incremental writes reproduce current text');
    assert(synced.writes.at(-1).changes===3,'changes coalesce without losing their intermediate coordinate systems');
    assert(waiting(synced).length===1,'semantic analysis has one bounded in-flight request');
    await release(current);await page.waitForFunction(()=>Number(window.texelune.frame?.highlight_source_version)===3);await stable();
    const newest=await ink();assert(newest.blue===4&&newest.red===3,'fresh results replace the provisional rich-text layer');
    await page.evaluate(()=>window.studio.lsp.receive({type:'tokens',epoch:window.studio.lsp.epoch,version:0,batch:999999,spans:[]}));
    assert((await ink()).spans===3,'an older analysis cannot replace a newer committed batch');
    const source=await page.evaluate(()=>{const editor=window.texelune,offset=[...editor.text.slice(0,editor.text.indexOf('baz'))].length;editor.select(offset,offset);return{offset,hit:editor.frame.hits.find(hit=>hit.offset===offset)};});assert(source.hit,'cached lines retain shifted document hit offsets');
    await page.evaluate(async()=>{window.studio.lsp.options.timeout=150;await window.studio.lsp.connect();const editor=window.texelune,end=[...editor.text.slice(0,editor.text.indexOf('barX')+4)].length;editor.replace(end,end,'Y');});
    await page.waitForFunction(()=>window.studio.lsp.state==='waiting');await stable();
    const timed=await until(s=>s.version===4&&s.held.some(item=>item.cancelled),'timeout did not release buffered writes');
    const afterTimeout=await ink();assert(afterTimeout.blue===5&&afterTimeout.source===3&&afterTimeout.spans===3,'timed-out analysis preserves rich-text styles and permits editing');
    await page.evaluate(report=>window.__lspConcurrencyReport=report,{initial,during,recovered,rebased,newest,afterTimeout,writes:synced.writes,timeoutWrites:timed.writes,requestCount:synced.requests});
  }finally{await page.evaluate(()=>window.studio?.lsp.disconnect());}
}

async page => {
  const report=[];
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const stable=async()=>page.waitForFunction(()=>window.texelune?.frame&&Number(window.texelune.frame.version)===window.texelune.stats.version&&window.texelune.frame.request===window.texelune.stats.request&&window.texelune.frame.pending===0&&document.querySelector('texelune-editor').shadowRoot.getElementById('state').textContent==='Ready',null,{timeout:20000});
  const load=async text=>{await page.evaluate(text=>window.texelune.load(text,'regression.txt'),text);await stable();};
  const text=()=>page.evaluate(()=>window.texelune.text);
  await page.reload();await page.waitForFunction(()=>window.studio?.lsp.state==='ready');await stable();await page.evaluate(()=>window.studio.lsp.disconnect());
  await load('abc');
  await page.evaluate(()=>{window.texelune.select(3,3);document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();});
  await page.keyboard.type('xyz');await stable();assert(await text()==='abcxyz','typing');
  await page.keyboard.press('Control+z');await stable();assert(await text()==='abcxy','undo');
  await page.keyboard.press('Control+Shift+z');await stable();assert(await text()==='abcxyz','redo');
  report.push('typing / undo / redo');
  for(const cluster of ['e\u0301','👩🏽‍💻','🇨🇳','1️⃣','क्षि','한']){
    await load('a'+cluster+'z');
    await page.evaluate(n=>{window.texelune.select(n,n);document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();},1+[...cluster].length);
    await page.keyboard.press('Backspace');await stable();assert(await text()==='az','grapheme delete '+cluster);
  }
  report.push('combining / ZWJ / skin tone / flags / keycaps / Indic / Hangul deletion');
  await load('abc אבג 123 مرحبا xyz');
  const bidi=await page.evaluate(()=>{
    const f=window.texelune.frame;
    const a=f.hits.find(h=>h.offset===4),b=f.hits.find(h=>h.offset===7);
    return {a,b,hits:f.hits};
  });
  assert(bidi.a&&bidi.b,'bidi caret map exists');
  await page.evaluate(()=>{window.texelune.select(4,7);document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();});
  await page.getByRole('button',{name:'Bold',exact:true}).click();await stable();
  assert(await text()==='abc אבג 123 مرحبا xyz','format preserves logical text');
  await page.getByRole('button',{name:'Italic',exact:true}).click();await stable();
  await page.getByRole('button',{name:'Foreground color',exact:true}).click();await stable();
  await page.getByRole('button',{name:'Background color',exact:true}).click();await stable();
  await page.getByRole('button',{name:'+ Hint',exact:true}).click();await stable();
  await page.getByRole('button',{name:'+ Block',exact:true}).click();await stable();
  assert(await text()==='abc אבג 123 مرحبا xyz','inlays preserve logical text');
  report.push('mixed BiDi / formatting / inline hint / block inlay');
  await load('אבג');
  await page.evaluate(()=>{window.texelune.select(0,0);document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();});
  await page.keyboard.press('ArrowLeft');await stable();
  assert((await page.evaluate(()=>window.texelune.selection)).head===1,'RTL visual ArrowLeft');
  report.push('RTL visual navigation');
  await load('abc');
  await page.evaluate(()=>{
    window.texelune.select(3,3);const el=document.querySelector('texelune-editor').shadowRoot.getElementById('input');el.focus();
    el.dispatchEvent(new CompositionEvent('compositionstart',{data:''}));
    for(const data of ['n','ni','你'])el.dispatchEvent(new CompositionEvent('compositionupdate',{data}));
    el.dispatchEvent(new CompositionEvent('compositionend',{data:'你'}));
  });await stable();assert(await text()==='abc你','composition text');
  await page.keyboard.press('Control+z');await stable();assert(await text()==='abc','composition grouped undo');
  report.push('synthetic composition / single undo');
  await load('wrap '.repeat(600));
  const wrapped=await page.evaluate(()=>window.texelune.frame.total_height);
  await page.getByRole('checkbox',{name:'Soft wrap',exact:true}).uncheck();await stable();
  const unwrapped=await page.evaluate(()=>window.texelune.frame.total_height);
  assert(wrapped>unwrapped,'soft wrap changes geometry');
  await page.getByRole('checkbox',{name:'Soft wrap',exact:true}).check();await stable();
  report.push('soft wrap / retained full paragraph');
  await page.evaluate(()=>window.texelune.setHighlights([{start:0,end:4,style:{foreground:[.8,.1,.2,1]}}]));await stable();
  report.push('external highlight provider');
  await page.getByRole('button',{name:'100,000 行',exact:false}).click();
  await page.waitForFunction(()=>document.querySelector('texelune-editor').shadowRoot.getElementById('filename').textContent==='large.txt',null,{timeout:30000});await stable();
  const large=await page.evaluate(()=>({length:window.texelune.text.length,blocks:window.texelune.frame.cached_blocks,rects:window.texelune.frame.rects.length}));
  assert(large.blocks<1000,'large document stays virtualized');report.push({large});
  await page.getByRole('checkbox',{name:'连续渲染'}).check();
  await page.waitForTimeout(1200);
  const perf=await page.evaluate(()=>{
    const s=window.texelune.stats;const p95=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length*.95)];
    return {submitP95:p95(s.submitTimes),rafMedian:[...s.intervals].sort((a,b)=>a-b)[Math.floor(s.intervals.length/2)],inFlight:s.inFlight};
  });report.push({performance:perf});
  await page.getByRole('checkbox',{name:'连续渲染'}).uncheck();
  console.log(JSON.stringify(report,null,2));
}

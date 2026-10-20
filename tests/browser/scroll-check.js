async page=>{
  const stable=()=>page.waitForFunction(()=>{const e=window.texelune;return e?.frame&&Number(e.frame.version)===e.version&&e.frame.request===e.stats.request&&e.frame.pending===0&&e.frame.visible_ready;},null,{timeout:30000});
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  await page.reload();await page.waitForFunction(()=>window.studio?.lsp.state==='ready');await stable();
  await page.evaluate(()=>{window.studio.lsp.disconnect();window.texelune.load(Array.from({length:80},(_,i)=>`${i} `+'wrapped text '.repeat(38)).join('\n'),'scroll.txt');});await stable();
  await page.evaluate(()=>window.texelune.scrollTo(900));await stable();
  const read=()=>page.evaluate(()=>{const e=window.texelune;return{scroll:e.frame.scroll,total:e.frame.total_height,caret:e.caret,labels:e.frame.labels.slice(0,4)};});
  const before=await read();
  await page.evaluate(()=>{const e=window.texelune,h=e.frame.hits.find(h=>h.y>100&&h.y<200);e.select(h.offset,h.offset);e.insert('x');});await stable();
  const edited=await read();
  await page.evaluate(()=>window.texelune.setHighlights([]));await stable();
  const highlighted=await read();
  await page.evaluate(report=>window.__scrollCheckReport=report,{before,edited,highlighted});
  assert(Math.abs(edited.scroll-before.scroll)<1,'visible inline edit preserves scroll');
  assert(Math.abs(highlighted.scroll-edited.scroll)<1,'asynchronous highlights preserve scroll');
  for(let i=0;i<6;i++){
    await page.evaluate(()=>{const e=window.texelune,source=e.version;e.insert('x');e.setHighlights([{start:0,end:e.documentInfo.chars-1,style:{bold:false,italic:false,underline:false,foreground:[.2,.3,.7,1],background:null}}],source);});await stable();
    assert(Math.abs((await read()).scroll-before.scroll)<1,'delayed highlight batches preserve scroll during typing');
  }
  await page.evaluate(()=>window.texelune.insert('\n'));await stable();
  const newline=await read();
  assert(Math.abs(newline.caret.y-highlighted.caret.y)<=56,'newline preserves the visible caret neighborhood');
  await page.evaluate(()=>window.texelune.load(('long wrapped text '.repeat(900)+'\n').repeat(4),'wrapped-newline.txt'));await stable();
  await page.evaluate(()=>window.texelune.scrollTo(900));await stable();
  await page.evaluate(()=>{const e=window.texelune,h=e.frame.hits.find(h=>h.y>100&&h.y<200);e.select(h.offset,h.offset);});await stable();
  const splitBefore=await read();
  await page.evaluate(()=>window.texelune.insert('\n'));await stable();
  const splitAfter=await read();
  await page.evaluate(report=>window.__scrollCheckReport=report,{before,edited,highlighted,newline,splitBefore,splitAfter});
  assert(splitAfter.caret&&Math.abs(splitAfter.caret.y-splitBefore.caret.y)<=56,'splitting a partially scrolled paragraph preserves the caret neighborhood');
  await page.evaluate(()=>window.texelune.focus());await page.keyboard.press('Control+z');await stable();
  const undone=await read();
  assert(undone.caret&&Math.abs(undone.caret.y-splitBefore.caret.y)<=28,'undoing a paragraph split preserves the visible caret');
  await page.evaluate(()=>window.texelune.scrollTo(window.texelune.frame.scroll+1200));await stable();
  const manual=await read();
  await page.evaluate(()=>window.texelune.setHighlights([]));await stable();
  const recolored=await read();
  assert(Math.abs(manual.scroll-recolored.scroll)<1,'highlight arrival respects manually scrolled viewport');
  await page.evaluate(()=>{window.texelune.select(0,0);window.texelune.insert('X');});await stable();
  const revealed=await read();
  assert(revealed.caret&&revealed.scroll<28,'editing an offscreen caret still reveals it');
  await page.evaluate(report=>window.__scrollCheckReport=report,{before,edited,highlighted,newline,splitBefore,splitAfter,undone,manual,recolored,revealed});
}

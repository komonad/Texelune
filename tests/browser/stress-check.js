async page => {
  const stable=()=>page.waitForFunction(()=>window.texelune?.frame&&Number(window.texelune.frame.version)===window.texelune.stats.version&&window.texelune.frame.request===window.texelune.stats.request&&window.texelune.frame.pending===0,null,{timeout:30000});
  await page.reload();await page.waitForFunction(()=>window.studio?.lsp.state==='ready');await stable();await page.evaluate(()=>window.studio.lsp.disconnect());
  await page.evaluate(()=>window.texelune.load('a'+'\u0301'.repeat(20000)+'z','cluster.txt'));await stable();
  await page.evaluate(()=>{window.texelune.select(20001,20001);document.querySelector('texelune-editor').shadowRoot.getElementById('input').focus();});
  await page.keyboard.press('Backspace');await page.waitForFunction(()=>window.texelune.text==='z');await stable();
  if(await page.evaluate(()=>window.texelune.text)!=='z')throw new Error('deferred cluster deletion');
  await page.getByRole('button',{name:'Long paragraph',exact:false}).click();
  await page.waitForFunction(()=>document.querySelector('texelune-editor').shadowRoot.getElementById('filename').textContent==='long.txt');
  const response=await page.evaluate(()=>{const begin=performance.now();window.texelune.select(0,0);window.texelune.insert('X');return performance.now()-begin;});
  await stable();
  const result=await page.evaluate(()=>({length:window.texelune.text.length,first:window.texelune.text[0],longestLayoutJobMs:window.texelune.frame.longest_job_ms,glyphQuads:window.texelune.frame.rects.length}));
  if(result.first!=='X')throw new Error('edit during long layout');
  await page.evaluate(report=>window.__stressReport=report,{response,result});
}

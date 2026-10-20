async page=>{
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const stable=()=>page.waitForFunction(()=>{const e=window.texelune;return e?.frame?.visible_ready&&e.frame.request===e.stats.request&&Number(e.frame.version)===e.version;},null,{timeout:30000});
  await page.goto('http://127.0.0.1:4173/web/');await page.waitForFunction(()=>window.studio?.lsp.state==='ready'&&document.getElementById('highlight-source').textContent.includes('tokens'));await stable();
  await page.evaluate(()=>{window.texelune.showPerformance(false);window.__providerErrors=[];window.texelune.on('providererror',({detail})=>window.__providerErrors.push({kind:detail.kind,message:detail.error.message}));});
  const local=await page.evaluate(async()=>{const e=window.texelune,offset=[...e.text.slice(0,e.text.indexOf('Palette::new'))].length;const targets=await window.studio.lsp.definition(offset);e.select(offset,offset);e.reveal(offset);return{offset,targets};});
  assert(local.targets.some(target=>target.start!==undefined),'same-document definitions contain scalar offsets');await stable();
  const point=await page.evaluate(offset=>{const e=window.texelune,c=e.frame.navigation.cells.find(cell=>cell.start===offset),r=e.root.getElementById('viewport').getBoundingClientRect();return{x:r.left+c.bounds[0]+2,y:r.top+c.bounds[1]+12};},local.offset);
  await page.mouse.move(point.x,point.y);await page.getByRole('tooltip').waitFor();assert((await page.getByRole('tooltip').textContent()).includes('Palette'),'real LSP hover renders at pointer');
  await page.keyboard.down('Control');await page.waitForFunction(()=>!!window.texelune.root.querySelector('.definition-range'));
  await page.screenshot({path:'output/playwright/definition-hover.png'});
  await page.mouse.click(point.x,point.y);await page.keyboard.up('Control');await stable();
  assert(await page.evaluate(()=>{const e=window.texelune,s=e.selection;return e.slice(s.anchor,s.head)==='Palette'&&e.positionAt(s.head).line<10;}),'Ctrl click reaches local type definition');
  const external=await page.evaluate(async()=>{const e=window.texelune,offset=[...e.text.slice(0,e.text.indexOf('labels::describe')+8)].length;const targets=await window.studio.lsp.definition(offset);e.select(offset,offset);e.reveal(offset);return{offset,targets};});await stable();
  const externalPoint=await page.evaluate(offset=>{const e=window.texelune,c=e.frame.navigation.cells.find(cell=>cell.start===offset),r=e.root.getElementById('viewport').getBoundingClientRect();return{x:r.left+c.bounds[0]+2,y:r.top+c.bounds[1]+12};},external.offset);
  await page.mouse.click(externalPoint.x,externalPoint.y,{button:'middle'});
  assert(external.targets.some(target=>target.uri.endsWith('/labels.rs')&&target.start===undefined),'external definition retains URI and UTF-16 range');
  await page.waitForFunction(()=>window.studio.lsp.options.uri.endsWith('/labels.rs')&&window.texelune.text.startsWith('pub fn describe'));await stable();
  assert(await page.evaluate(()=>{const e=window.texelune,s=e.selection;return e.slice(s.anchor,s.head)==='describe';}),'host opens and selects the cross-file definition');
  const blocked=await page.evaluate(async()=>({escape:(await fetch('/api/source?path=..%2F..%2FCargo.toml')).status,absolute:(await fetch('/api/source?path=C%3A%5CWindows%5Cwin.ini')).status}));
  assert(blocked.escape===404&&blocked.absolute===404,'workspace source endpoint rejects escaped and absolute paths');
  const errors=await page.evaluate(()=>window.__providerErrors);assert(!errors.length,'definition integration has no provider errors: '+JSON.stringify(errors));
  await page.evaluate(report=>window.__definitionReport=report,{local,external,blocked});
}

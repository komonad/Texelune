async page=>{
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  await page.goto('http://127.0.0.1:4173/web/');
  await page.waitForFunction(()=>window.studio?.lsp.state==='ready');
  await page.evaluate(()=>{window.texelune.showPerformance(false);window.texelune.load('fn main() {\n    let count = ;\n    println!("{count}");\n}\n','main.rs');});
  await page.waitForFunction(()=>window.texelune.diagnostics.some(item=>item.severity===1)&&window.texelune.root.querySelector('.diagnostic-mark[data-severity="1"]'),null,{timeout:30000});
  const first=await page.evaluate(()=>{const e=window.texelune,d=e.diagnostics.find(item=>item.severity===1),cell=e.frame.navigation.cells.find(cell=>cell.start<=d.start&&cell.end>d.start),bounds=e.root.getElementById('viewport').getBoundingClientRect();return{diagnostic:d,x:bounds.left+cell.bounds[0]+2,y:bounds.top+cell.bounds[1]+8};});
  await page.mouse.move(first.x,first.y);await page.getByRole('tooltip').waitFor();
  assert((await page.getByRole('tooltip').innerText()).includes(first.diagnostic.message),'diagnostic hover includes the actual LSP message');
  assert(await page.evaluate(()=>!!window.texelune.root.querySelector('#numbers .has-diagnostic')),'logical-line gutter shows diagnostic severity');
  await page.evaluate(()=>{window.texelune.select(0,0);window.texelune.focus();});await page.keyboard.press('F8');
  assert(await page.evaluate(()=>window.texelune.selection.anchor===window.texelune.diagnostics[0].start),'F8 navigates to a diagnostic');
  await page.getByRole('tab',{name:/诊断/}).click();await page.locator('.diagnostic.error').first().click();
  assert(await page.evaluate(()=>window.texelune.selection.anchor===window.texelune.diagnostics[0].start),'problem list selects the actual source range');
  await page.evaluate(()=>window.studio.lsp.disconnect());
  assert(await page.evaluate(()=>window.texelune.diagnostics.length===0&&!window.texelune.root.querySelector('.diagnostic-mark')),'disconnect clears owned markers');
  await page.evaluate(()=>{const e=window.texelune;e.load('abc 👩🏽‍💻 אבג\nnext line\n','plain.txt');});
  await page.waitForFunction(()=>Number(window.texelune.frame?.version)===window.texelune.version&&window.texelune.frame.visible_ready);
  await page.evaluate(()=>{const e=window.texelune;e.setDiagnostics([{start:0,end:3,message:'Warning text',severity:2,source:'Checker',code:'W1'},{start:5,end:8,message:'Emoji error',severity:1},{start:11,end:14,message:'Information text',severity:3},{start:e.documentInfo.chars,end:e.documentInfo.chars,message:'End hint',severity:4}]);});
  const markers=await page.evaluate(()=>({severities:[...window.texelune.root.querySelectorAll('.diagnostic-mark')].map(mark=>Number(mark.dataset.severity)),stale:window.texelune.setDiagnostics([],window.texelune.version+1),count:window.texelune.diagnostics.length}));
  assert([1,2,3,4].every(severity=>markers.severities.includes(severity)),'all severities, Unicode ranges and an EOF point have visible markers');
  assert(!markers.stale&&markers.count===4,'future diagnostic batches cannot erase current markers');
  const navigation=await page.evaluate(()=>{const e=window.texelune;e.select(0,0);return{next:e.goToDiagnostic(1).start,previous:e.goToDiagnostic(-1).start};});
  assert(navigation.next===5&&navigation.previous===0,'reverse navigation leaves the selected diagnostic');
  await page.evaluate(()=>{window.texelune.select(0,0);window.texelune.insert('x');});
  assert(await page.evaluate(()=>window.texelune.diagnostics.length===0&&!window.texelune.root.querySelector('.diagnostic-mark')),'editing clears obsolete messages immediately');
}

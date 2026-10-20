async page=>{
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const stable=()=>page.waitForFunction(()=>window.texelune?.frame&&Number(window.texelune.frame.version)===window.texelune.stats.version&&window.texelune.frame.request===window.texelune.stats.request&&window.texelune.frame.pending===0,null,{timeout:30000});
  await page.reload();await page.waitForFunction(()=>window.studio?.lsp.state==='ready');await stable();await page.evaluate(()=>window.studio.lsp.disconnect());
  const text='Layout viewport · אבג · مرحبا\nFullscreen editing';
  await page.evaluate(text=>{window.texelune.load(text,'viewport.txt');window.texelune.select(4,4);},text);await stable();
  const initial=await page.locator('#viewport').boundingBox();
  await page.getByRole('button',{name:'全屏编辑器',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('texelune-editor').shadowRoot.fullscreenElement?.id==='editor-workspace');await stable();
  const fullscreen=await page.evaluate(()=>{
    const v=document.querySelector('texelune-editor').shadowRoot.getElementById('viewport').getBoundingClientRect(),p=document.querySelector('texelune-editor').shadowRoot.getElementById('performance-panel').getBoundingClientRect(),c=document.querySelector('texelune-editor').shadowRoot.getElementById('canvas');
    return{height:v.height,width:v.width,panelInside:p.left>=v.left&&p.top>=v.top&&p.right<=v.right&&p.bottom<=v.bottom,canvasWidth:c.width,canvasHeight:c.height,scale:Math.min(devicePixelRatio||1,3)};
  });
  assert(fullscreen.height>initial.height,'fullscreen expands editor viewport');assert(fullscreen.panelInside,'fullscreen retains performance panel inside editor');
  assert(fullscreen.canvasWidth===Math.round(fullscreen.width*fullscreen.scale)&&fullscreen.canvasHeight===Math.round(fullscreen.height*fullscreen.scale),'fullscreen resizes GPU canvas');
  await page.getByRole('checkbox',{name:'连续渲染',exact:true}).check();await page.waitForTimeout(1000);
  await page.waitForFunction(()=>window.texelune.performance.frameTrace.state==='complete');
  await page.evaluate(()=>window.texelune.benchmark('warm'));await page.waitForTimeout(300);
  const metrics=await page.evaluate(()=>({stats:window.texelune.performance,label:document.querySelector('texelune-editor').shadowRoot.querySelector('.perf-headline small').textContent,display:Number(document.querySelector('texelune-editor').shadowRoot.getElementById('perf-fps').textContent.replace(/[^0-9.]/g,'')),generation:Number.parseFloat(document.querySelector('texelune-editor').shadowRoot.getElementById('perf-frame').textContent.replace(/^[^0-9]*/,''))}));
  assert(Math.abs(metrics.stats.equivalentFps-1000/metrics.stats.live.cost_ms)<.001,'equivalent FPS uses live work estimate');
  assert(metrics.label.includes('等效 FPS'),'headline describes equivalent FPS');
  assert(Math.abs(metrics.display*metrics.generation-1000)<20,'headline FPS and frame cost use same metric');
  await page.screenshot({path:'output/playwright/fullscreen.png'});
  await page.getByRole('checkbox',{name:'连续渲染',exact:true}).uncheck();
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();
  await page.waitForFunction(()=>!document.fullscreenElement);await stable();
  assert((await page.locator('#viewport').boundingBox()).height===initial.height,'exit restores viewport size');
  await page.locator('#input').focus();await page.keyboard.press('Alt+Enter');
  await page.waitForFunction(()=>document.querySelector('texelune-editor').shadowRoot.fullscreenElement?.id==='editor-workspace');await stable();
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.fullscreenElement);await stable();
  assert(await page.evaluate(text=>window.texelune.text===text&&window.texelune.selection.head===4,text),'fullscreen shortcuts preserve document and selection');
  await page.getByRole('button',{name:'全屏编辑器',exact:true}).click();
  await page.waitForFunction(()=>!!document.fullscreenElement);await page.evaluate(()=>document.exitFullscreen());await stable();
  assert(await page.getByRole('button',{name:'全屏编辑器',exact:true}).getAttribute('aria-pressed')==='false','external fullscreen exit synchronizes button');
  for(const unavailable of [false,true]){
    await page.evaluate(unavailable=>Object.defineProperty(document.querySelector('texelune-editor').shadowRoot.getElementById('editor-workspace'),'requestFullscreen',{configurable:true,value:unavailable?undefined:()=>Promise.reject(new Error('Fullscreen denied'))}),unavailable);
    await page.getByRole('button',{name:'全屏编辑器',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('texelune-editor').shadowRoot.getElementById('editor-workspace').classList.contains('is-fullscreen'));await stable();
    assert((await page.locator('#viewport').boundingBox()).height>initial.height,'fullscreen fallback expands editor');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('texelune-editor').shadowRoot.getElementById('editor-workspace').classList.contains('is-fullscreen'));await stable();
    await page.evaluate(()=>delete document.querySelector('texelune-editor').shadowRoot.getElementById('editor-workspace').requestFullscreen);
  }
  assert(await page.evaluate(text=>window.texelune.text===text,text),'fullscreen fallback preserves document');
  await page.evaluate(report=>window.__viewportReport=report,{initial,fullscreen,metrics});
}

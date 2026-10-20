const LIMIT=360;
export const equivalentFps=ms=>Number.isFinite(ms)&&ms>0?1000/ms:null;
export class Samples {
  constructor(limit=LIMIT){this.limit=limit;this.values=[];}
  push(value){if(Number.isFinite(value)&&value>=0){this.values.push(value);if(this.values.length>this.limit)this.values.shift();}}
  summary(){const a=[...this.values].sort((a,b)=>a-b),n=a.length;return {count:n,last:this.values.at(-1)??null,p50:n?a[Math.floor((n-1)*.5)]:null,p95:n?a[Math.ceil(n*.95)-1]:null,p99:n?a[Math.ceil(n*.99)-1]:null,max:n?a[n-1]:null};}
}
export class PerformanceStats {
  constructor(){this.reset();}
  reset(){this.epoch=(this.epoch??0)+1;this.series=new Map();this.raf=[];this.draws=[];this.started=0;this.lastTick=0;this.longTasks=0;this.longestTask=0;this.lastCompletedFrame=null;this.benchmark=null;this.liveFrames={};}
  setBenchmark(report){const {frames,elapsed_ms}=report;if(!Number.isFinite(frames)||frames<=0||!Number.isFinite(elapsed_ms)||elapsed_ms<=0)throw new Error('Invalid benchmark');this.benchmark={...report,fps:1000*frames/elapsed_ms,mean_ms:elapsed_ms/frames};this.series.set('benchmarkFrame',new Samples());for(const sample of report.samples||[])this.record('benchmarkFrame',sample.elapsed/sample.frames);}
  record(name,value){if(!this.series.has(name))this.series.set(name,new Samples());this.series.get(name).push(value);}
  recordLive({kind,workerMs=0,mainMs,now,gpuSupported=false}){
    if(!['update','redraw'].includes(kind)||![workerMs,mainMs,now].every(Number.isFinite)||workerMs<0||mainMs<0||workerMs+mainMs<=0)return;
    this.record('work-'+kind,workerMs+mainMs);this.liveFrames[kind]={at:now,workerMs,mainMs,gpuSupported};
  }
  liveSnapshot(now){
    const update=this.liveFrames.update,redraw=this.liveFrames.redraw;
    const kind=update&&(!redraw||redraw.at<update.at||now-update.at<1500)?'update':redraw?'redraw':update?'update':null;
    if(!kind)return null;
    const frame=this.liveFrames[kind],cpu=this.series.get('work-'+kind).summary(),gpu=this.series.get('gpu')?.values.slice(-32)||[];
    const gpuMs=frame.gpuSupported&&gpu.length?gpu.reduce((n,v)=>n+v,0)/gpu.length:null;
    const bound=gpuMs===null||gpuMs===0,costMs=cpu.p95+(gpuMs??0);
    return {kind,cost_ms:costMs,cpu_ms:cpu.p95,gpu_ms:gpuMs,bound,fps:equivalentFps(costMs),age_ms:Math.max(0,now-frame.at),at:frame.at,samples:cpu.count,worker_ms:frame.workerMs,main_ms:frame.mainMs,gpu_status:!frame.gpuSupported?'unavailable':gpuMs===null?'pending':gpuMs===0?'below-resolution':'sampled'};
  }
  tick(now){if(!this.started)this.started=now;if(this.lastTick)this.record('rafInterval',now-this.lastTick);this.lastTick=now;this.raf.push(now);this.trim(now);}
  draw(now){this.draws.push(now);this.trim(now);}
  trim(now){while(this.raf[0]<now-1000)this.raf.shift();while(this.draws[0]<now-1000)this.draws.shift();}
  snapshot(now=performance.now()){this.trim(now);const seconds=Math.min(1,Math.max(.001,(now-this.started)/1000)),metrics=Object.fromEntries([...this.series].map(([k,v])=>[k,v.summary()])),live=this.liveSnapshot(now);return {equivalentFps:live?.fps??null,live,benchmark:this.benchmark,latencyEquivalentFps:equivalentFps(metrics.completeFrame?.p95),cpuEquivalentFps:equivalentFps(metrics.frame?.p95),renderFps:this.draws.length/seconds,rafFps:this.raf.length/seconds,longTasks:this.longTasks,longestTask:this.longestTask,lastCompletedFrame:this.lastCompletedFrame,metrics};}
}
export class FrameTracker {
  constructor(stats,root){
    this.root=root;this.stats=stats;this.serial=0;this.current=null;}
  begin(startedAt){this.current={id:++this.serial,startedAt,epoch:this.stats.epoch,state:'pending'};return {...this.current};}
  accepts(trace){return !!trace&&trace.id===this.current?.id;}
  matches(trace){return this.accepts(trace)&&trace.epoch===this.stats.epoch;}
  claim(trace){if(!this.matches(trace)||this.current.state!=='pending')return null;this.current.state='submitted';return trace;}
  complete(trace,{readyAt,drawStartedAt,finishedAt,backpressureMs=0,version,request}){
    if(!this.matches(trace)||this.current.state!=='submitted')return false;
    if(![trace.startedAt,readyAt,drawStartedAt,finishedAt,backpressureMs].every(Number.isFinite)||readyAt<trace.startedAt||drawStartedAt<readyAt||finishedAt<drawStartedAt||backpressureMs<0||backpressureMs>drawStartedAt-readyAt)return false;
    const rafWait=drawStartedAt-readyAt-backpressureMs,latency=finishedAt-trace.startedAt,generation=latency-rafWait;
    this.stats.record('completeFrame',generation);this.stats.record('frameWait',rafWait);this.stats.record('updateLatency',latency);
    this.stats.record('backpressure',backpressureMs);
    this.stats.lastCompletedFrame={id:trace.id,version,request,generation_ms:generation,latency_ms:latency,raf_wait_ms:rafWait,backpressure_ms:backpressureMs};
    this.current.state='complete';return true;
  }
  snapshot(){return this.current?.epoch===this.stats.epoch?{...this.current}:{state:'none'};}
}
const ms=n=>Number.isFinite(n)?`${n.toFixed(2)} ms`:'—';
const mib=n=>Number.isFinite(n)?`${(n/1048576).toFixed(1)} MiB`:'—';
const count=n=>Number.isFinite(n)?n.toLocaleString():'—';
export const liveFpsText=live=>live?.fps?live.fps.toFixed(0):'—';
export const liveCostText=live=>live?`${live.cost_ms.toFixed(live.cost_ms<1?3:2)} ms`:'—';

export class PerformancePanel {
  constructor(stats,root){
    this.root=root;
    this.stats=stats;this.lastUpdate=0;this.paused=false;this.context={};
    this.element=document.createElement('section');this.element.id='performance-panel';this.element.className='performance-panel';this.element.setAttribute('aria-label','渲染性能');
    this.element.innerHTML=`<div class="perf-header"><span class="perf-grip">⠿</span><b>渲染性能</b><span id="perf-live">LIVE</span><button id="perf-minimize" aria-label="折叠性能面板">−</button><button id="perf-hide" aria-label="隐藏性能面板">×</button></div>
      <div class="perf-body"><div class="perf-headline"><div><small>实时等效 FPS · 工作估算</small><strong id="perf-fps">—</strong></div><div><small>实时工作耗时 · P95</small><strong id="perf-frame">—</strong></div></div>
      <svg class="perf-chart" viewBox="0 0 320 44" aria-label="实时帧工作耗时估算"><line id="perf-budget" x1="0" x2="320"/><polyline id="perf-line" fill="none"/></svg><div class="perf-chart-label"><span>最近 96 个同类帧 · 工作估算</span><span>虚线 = 6.94 ms / 144 Hz</span></div><p id="perf-sampling" class="perf-sampling">等待首帧采样</p>
      <div class="perf-benchmark"><select id="perf-benchmark-mode" aria-label="基准场景"><option value="warm">完整热帧（复用布局）</option><option value="redraw">仅重绘（复用场景）</option></select><button id="perf-benchmark">运行基准</button></div><p id="perf-benchmark-status">离屏批量测量，包含 GPU 完成，不等待 VSync。</p>
      <div class="perf-benchmark-result"><span>基准等效 FPS <b id="perf-bench-fps">未运行</b></span><span>基准均摊 <b id="perf-bench-cost">—</b></span></div><p id="perf-bench-profile" class="perf-sampling"></p>
      <div id="perf-table"></div>
      <div class="perf-task" id="perf-task" hidden><div><span id="perf-task-text"></span><button id="perf-cancel">取消</button></div><progress id="perf-progress" max="1" value="0"></progress></div>
      <div class="perf-actions"><label><input id="perf-continuous" type="checkbox"> 连续渲染</label><button id="perf-pause">暂停采样</button><button id="perf-reset">重置</button><button id="perf-export">JSON</button></div>
      <p class="perf-footnote">实时估算 = 同类帧 Worker 与主线程 CPU 工作 P95 + 最近 GPU render pass 采样均值，不含异步等待或 GPU 拷贝耗时。GPU 未测得或低于分辨率时，FPS 为上限估算。响应延迟和完整热帧基准分别统计。</p></div>`;
    this.parent=this.root.getElementById('viewport');this.parent.append(this.element);
    const summary=document.createElement('div');summary.className='perf-summary';
    summary.append(this.element.querySelector('.perf-headline'),this.element.querySelector('.perf-chart'),this.element.querySelector('.perf-chart-label'));
    this.element.querySelector('.perf-body').prepend(summary);
    const benchmarkSection=document.createElement('details');benchmarkSection.className='perf-benchmark-section';
    const benchmarkTitle=document.createElement('summary');benchmarkTitle.textContent='离屏基准（可选）';benchmarkSection.append(benchmarkTitle);
    for(const selector of ['.perf-benchmark','#perf-benchmark-status','.perf-benchmark-result','#perf-bench-profile'])benchmarkSection.append(this.element.querySelector(selector));
    this.element.querySelector('.perf-body').insertBefore(benchmarkSection,this.root.getElementById('perf-task'));
    this.element.addEventListener('pointerdown',e=>e.stopPropagation());
    this.element.addEventListener('wheel',e=>e.stopPropagation());
    const definitions=[['liveParts','实时 Worker / 主线程'],['layout','Layout 最近 / P95'],['gpu','GPU render pass'],['render','Render 编码 / 提交'],['cpu','主线程 CPU P95 / P99'],['scene','Scene / Raster'],['serialize','WASM→JS / 消息延迟'],['upload','几何 / 图集上传'],['input','输入→提交'],['complete','更新延迟 P95 / P99'],['trace','更新状态 / 样本数'],['pending','队列 / 布局缓存'],['redraw','缓存帧完成回调 P95'],['wait','rAF 等待 P95'],['backpressure','GPU 背压等待 P95'],['endtoend','请求→GPU 完成回调'],['submitted','实际提交 / 秒'],['raf','rAF 回调 / 秒'],['queue','Queue done'],['job','最慢段落任务'],['geometry','四边形 / draw calls'],['document','文档 UTF-8 / 行数'],['memory','WASM 主 / 布局 / 导航'],['heap','JS heap（可用时）'],['gpuMemory','GPU 资源估算'],['adapter','GPU 适配器'],['long','主线程长任务'],['overhead','面板更新开销']];
    this.root.getElementById('perf-table').innerHTML=definitions.map(([id,label])=>`<div class="perf-row"><span>${label}</span><output id="perf-${id}">—</output></div>`).join('');
    this.outputs=Object.fromEntries(definitions.map(([id])=>[id,this.root.getElementById(`perf-${id}`)]));
    this.root.getElementById('perf-hide').onclick=()=>this.show(false);
    this.root.getElementById('perf-minimize').onclick=()=>{this.element.classList.toggle('collapsed');const p=this.parent.getBoundingClientRect(),r=this.element.getBoundingClientRect();this.place(r.left-p.left,r.top-p.top);};
    this.root.getElementById('perf-reset').onclick=()=>{this.onReset?.();this.stats.reset();this.benchmarkState({running:false});};
    this.root.getElementById('perf-benchmark').onclick=()=>this.onBenchmark?.(this.root.getElementById('perf-benchmark-mode').value);
    this.root.getElementById('perf-pause').textContent='冻结面板';
    this.root.getElementById('perf-pause').onclick=e=>{this.paused=!this.paused;e.target.textContent=this.paused?'继续刷新':'冻结面板';this.root.getElementById('perf-live').textContent=this.paused?'FROZEN':'LIVE';};
    this.root.getElementById('perf-continuous').onchange=e=>{this.root.getElementById('continuous').checked=e.target.checked;};
    this.root.getElementById('perf-cancel').onclick=()=>this.onCancel?.();
    this.root.getElementById('perf-export').onclick=()=>{const blob=new Blob([JSON.stringify({...this.stats.snapshot(),context:this.context},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='texelune-performance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    const header=this.element.querySelector('.perf-header');let drag=null;
    header.onpointerdown=e=>{if(e.target.closest('button'))return;const r=this.element.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};header.setPointerCapture(e.pointerId);e.preventDefault();};
    header.onpointermove=e=>{if(!drag)return;const r=this.parent.getBoundingClientRect();this.place(e.clientX-r.left-drag.x,e.clientY-r.top-drag.y);};header.onpointerup=()=>drag=null;header.onpointercancel=()=>drag=null;
    this.resizeObserver=new ResizeObserver(()=>{this.element.style.setProperty('--editor-height',this.parent.clientHeight+'px');const r=this.element.getBoundingClientRect(),p=this.parent.getBoundingClientRect();this.place(r.left-p.left,r.top-p.top);});this.resizeObserver.observe(this.parent);
    if(globalThis.PerformanceObserver&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){this.observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){this.stats.longTasks++;this.stats.longestTask=Math.max(this.stats.longestTask,e.duration);}});this.observer.observe({type:'longtask',buffered:false});}
  }
  destroy(){this.resizeObserver.disconnect();this.observer?.disconnect();this.element.remove();}
  benchmarkState(state){this.benchmarkRunning=state.running;this.root.getElementById('perf-benchmark').textContent=state.running?'停止基准':'运行基准';this.root.getElementById('perf-benchmark-status').textContent=state.running?`测量中 · ${(state.progress*100).toFixed(0)}%`:state.report?`${state.report.frames} 帧 · ${state.report.rounds} 批 · ${state.report.mode==='warm'?'含场景生成':'复用场景'}，不含重布局`:state.cancelled?'基准已停止或失效；实时采样继续':state.error||'离屏批量测量，包含 GPU 完成，不等待 VSync。';}
  place(x,y){const p=this.parent.getBoundingClientRect(),r=this.element.getBoundingClientRect();this.element.style.right='auto';this.element.style.left=`${Math.max(0,Math.min(p.width-r.width-20,x))}px`;this.element.style.top=`${Math.max(0,Math.min(p.height-r.height,y))}px`;}
  show(value=true){this.element.hidden=!value;this.root.getElementById('perf-toggle')?.setAttribute('aria-expanded',String(value));if(value){const p=this.parent.getBoundingClientRect(),r=this.element.getBoundingClientRect();this.place(r.left-p.left,r.top-p.top);}}
  task(label,progress=null,cancellable=false){const el=this.root.getElementById('perf-task');el.hidden=!label;this.root.getElementById('perf-cancel').hidden=!cancellable;this.root.getElementById('perf-task-text').textContent=label||'';const bar=this.root.getElementById('perf-progress');if(progress===null)bar.removeAttribute('value');else bar.value=progress;}
  update(now,context,measurement=null){
    this.context=context;if(this.paused||this.element.hidden||now-this.lastUpdate<250)return;this.lastUpdate=now;
    const begin=performance.now(),snapshot=measurement??this.stats.snapshot(now),m=snapshot.metrics,last=k=>m[k]?.last,p95=k=>m[k]?.p95;
    const live=snapshot.live;
    this.root.getElementById('perf-fps').textContent=liveFpsText(live);this.root.getElementById('perf-frame').textContent=liveCostText(live);
    this.root.getElementById('perf-bench-fps').textContent=snapshot.benchmark?.fps.toFixed(0)??'未运行 / 已失效';
    this.root.getElementById('perf-bench-cost').textContent=ms(snapshot.benchmark?.mean_ms);
    this.root.getElementById('perf-bench-profile').textContent=`基准 Worker / 主线程：${ms(snapshot.benchmark?.worker_ms)} / ${ms(snapshot.benchmark?.main_ms)}`;
    const mode=live?.kind==='update'?'场景更新帧':'缓存重绘帧',gpuState={sampled:'GPU 滑动均值',pending:'GPU 待采样，FPS 上限',unavailable:'GPU 无计时，FPS 上限','below-resolution':'GPU 低于分辨率，FPS 上限'}[live?.gpu_status];
    const sampling=live?`${mode} · ${this.benchmarkRunning?'基准中，保留实时样本':live.age_ms>1000?`空闲，保留 ${(live.age_ms/1000).toFixed(1)} 秒前样本`:'实时采样'} · ${gpuState}`:'等待首帧采样';
    this.root.getElementById('perf-sampling').textContent=sampling;this.root.getElementById('perf-live').textContent=live?.age_ms>1000?'IDLE':'LIVE';
    const state={pending:'生成中',submitted:'等待 GPU 完成',complete:'已完成',none:'等待更新'}[context.frameTrace?.state]??'等待更新';
    const age=['pending','submitted'].includes(context.frameTrace?.state)?` ${ms(Math.max(0,performance.timeOrigin+now-context.frameTrace.startedAt))}`:'';
    const values={liveParts:`${ms(live?.worker_ms)} / ${ms(live?.main_ms)}`,adapter:context.adapterName||'—',complete:`${ms(p95('completeFrame'))} / ${ms(m.completeFrame?.p99)}`,trace:`${state} / ${count(m.completeFrame?.count??0)}`,redraw:ms(p95('redraw')),wait:ms(p95('frameWait')),backpressure:ms(p95('backpressure')),endtoend:ms(last('updateLatency')),cpu:`${ms(p95('frame'))} / ${ms(m.frame?.p99)}`,submitted:snapshot.renderFps.toFixed(0),raf:snapshot.rafFps.toFixed(0),render:ms(p95('render')),gpu:context.gpuSupported?(last('gpu')===0?'低于计时分辨率':ms(last('gpu'))):'不可用（无 timestamp-query）',queue:ms(last('queue')),layout:`${ms(last('layout'))} / ${ms(p95('layout'))}`,job:ms(context.frame?.longest_job_ms),scene:`${ms(last('scene'))} / ${ms(last('raster'))}`,serialize:`${ms(last('serialize'))} / ${ms(last('transport'))}`,upload:`${ms(last('geometry'))} / ${ms(last('atlas'))}`,input:ms(last('input')),pending:`${count(context.frame?.pending)} / ${count(context.frame?.cached_blocks)}`,geometry:`${count(context.frame?.quad_count)} / ${count(context.drawCalls)}`,document:`${mib(context.bytes)} / ${count(context.lines)}`,memory:`${mib(context.mainMemory)} / ${mib(context.layoutMemory)} / ${mib(context.navMemory)}`,heap:mib(performance.memory?.usedJSHeapSize),gpuMemory:mib(context.gpuMemory),long:`${snapshot.longTasks} / ${ms(snapshot.longestTask)}`,overhead:ms(last('overlay'))};
    for(const[k,v]of Object.entries(values))this.outputs[k].textContent=v;
    this.outputs.trace.textContent=`${state}${age} / ${count(m.completeFrame?.count??0)}`;
    const samples=(this.stats.series.get('work-'+live?.kind)?.values.slice(-96)||[]).map(v=>v+(live?.gpu_ms??0)),max=Math.max(10,...samples),height=40;
    this.root.getElementById('perf-line').setAttribute('points',samples.map((v,i)=>`${i*320/Math.max(1,samples.length-1)},${42-v/max*height}`).join(' '));
    const line=this.root.getElementById('perf-budget'),y=42-(1000/144)/max*height;line.setAttribute('y1',y);line.setAttribute('y2',y);
    this.root.getElementById('perf-continuous').checked=this.root.getElementById('continuous').checked;
    this.stats.record('overlay',performance.now()-begin);
  }
}

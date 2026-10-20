import init,{LayoutEngine,DocumentImport}from'./pkg/texelune_editor.js';
import{prepareDocument}from'./import.js';
import{yieldTask}from'./benchmark.js';
let engine,wasm,selection={anchor:0,head:0},scheduled=false,ready=false,generation=0,documentVersion=0,trace=null;
let benchmarkToken=null,benchmarkAck=null;
let pendingHandlerMs=0;
let sceneRevision=0,selectionRevision=0,pendingView=null,needsFrame=true,pendingLayoutMs=0;
function flushView(){if(pendingView){engine.viewport(pendingView);pendingView=null;}}
function stopBenchmark(){benchmarkToken=null;benchmarkAck?.(false);benchmarkAck=null;}
async function benchmark(m){
  benchmarkToken=m.token;let remaining=Math.min(256,Math.max(1,m.frames));
  try{
    while(remaining>0&&benchmarkToken===m.token){
      const frames=[],transfer=[],begin=performance.now();
      do{
        const start=performance.now(),frame=engine.frame(selection,0);
        frame.scene_revision=sceneRevision;frame.selection_revision=selectionRevision;frame.instances=engine.instances();frame.packed_navigation=engine.navigation();frame.worker_ms=performance.now()-start;
        if(frame.patches.length){
          postMessage({type:'frame',frame,trace,elapsed:frame.worker_ms,marshal_ms:0,memory:wasm.memory.buffer.byteLength,sent_at:performance.timeOrigin+performance.now(),generation},[frame.instances.buffer,frame.packed_navigation.buffer]);
          throw new Error('Glyph atlas is warming; retry the benchmark');
        }
        frames.push(frame);transfer.push(frame.instances.buffer,frame.packed_navigation.buffer);remaining--;
      }while(remaining>0&&frames.length<8&&performance.now()-begin<1.5);
      const ack=new Promise(resolve=>benchmarkAck=resolve);
      postMessage({type:'benchmark_frames',token:m.token,frames,generation},transfer);
      if(!await ack)break;benchmarkAck=null;await yieldTask();
    }
    if(benchmarkToken===m.token)postMessage({type:'benchmark_done',token:m.token,generation});
  }catch(error){postMessage({type:'benchmark_error',token:m.token,message:String(error),generation});}
  finally{if(benchmarkToken===m.token)benchmarkToken=null;}
}
function pump(){
  if(scheduled||!ready)return;scheduled=true;
  yieldTask().then(()=>{
    scheduled=false;
    if(benchmarkToken!==null)return;
    try{
      const start=performance.now(),handlerMs=pendingHandlerMs;pendingHandlerMs=0;
      flushView();
      const tickMs=engine.tick(2);pendingLayoutMs+=tickMs;
      if(!engine.visible_ready()||!needsFrame&&engine.pending()){
        pendingHandlerMs+=handlerMs+Math.max(0,performance.now()-start-tickMs);pump();return;
      }
      const layout=pendingLayoutMs;pendingLayoutMs=0;
      const marshalStart=performance.now();
      const frame=engine.frame(selection,layout);
      frame.scene_revision=sceneRevision;frame.selection_revision=selectionRevision;needsFrame=!frame.visible_ready;
      frame.instances=engine.instances();
      frame.packed_navigation=engine.navigation();
      const marshal=Math.max(0,performance.now()-marshalStart-frame.scene_ms-frame.raster_ms);
      postMessage({type:'frame',frame,trace,elapsed:performance.now()-start+layout-tickMs+handlerMs,marshal_ms:marshal,memory:wasm.memory.buffer.byteLength,sent_at:performance.timeOrigin+performance.now(),generation},[frame.instances.buffer,frame.packed_navigation.buffer]);
      if(engine.pending())pump();else postMessage({type:'idle',generation});
    }catch(error){postMessage({type:'error',message:String(error),generation});}
  });
}
self.onmessage=async({data:m})=>{
  const handlingStart=performance.now();
  try{
    if(m.type==='benchmark_ack'){if(m.token===benchmarkToken){benchmarkAck?.(true);benchmarkAck=null;}return;}
    if(m.type==='benchmark_cancel'||m.type==='benchmark_end'){stopBenchmark();pump();return;}
    if(m.type==='benchmark'){if(ready){stopBenchmark();void benchmark(m);}return;}
    stopBenchmark();
    if(m.trace)trace=m.trace;
    if(m.scene_revision!==undefined)sceneRevision=m.scene_revision;
    if(m.selection_revision!==undefined)selectionRevision=m.selection_revision;
    needsFrame=true;
    if(m.type==='view'){
      pendingView=m;if(ready)pump();return;
    }
    if(ready)flushView();
    if(m.type==='init'){
      generation=m.generation;wasm=await init();engine=new LayoutEngine();if(m.theme)engine.theme(m.theme);
      for(const font of m.fonts)engine.font(new Uint8Array(font));
      if(m.source?.kind==='synthetic'){
        const job=await prepareDocument(DocumentImport,m.source.bytes,progress=>postMessage({type:'progress',progress,generation}),()=>false,m.source.code);engine.install_import(job);
      }else engine.load(m.source?.text??m.text??'');
      documentVersion=0;
      if(m.highlights?.version===0)engine.highlights(0n,m.highlights.spans);
      for(const change of m.changes||[]){engine.apply(change);documentVersion=change.version;if(m.highlights?.version===documentVersion)engine.highlights(BigInt(documentVersion),m.highlights.spans);}
      if(m.inlays?.length)engine.inlays(m.inlays);
      ready=true;postMessage({type:'ready',memory:wasm.memory.buffer.byteLength,generation});
    }else if(m.type==='change'){engine.apply(m.change);documentVersion=m.change.version;selection=m.change.selection;}
    else if(m.type==='selection'){selection=m.selection;if(m.reveal)engine.reveal_caret(selection.head,m.affinity??null);}
    else if(m.type==='reveal')engine.reveal(m.offset);
    else if(m.type==='navigate'){
      if(m.version===documentVersion){const start=performance.now(),hit=engine.navigate(m);postMessage({type:'motion',hit,trace,token:m.token,version:m.version,navigation_ms:performance.now()-start,generation});}
    }else if(m.type==='inlays')engine.inlays(m.inlays);
    else if(m.type==='theme')engine.theme(m.theme);
    else if(m.type==='highlights')engine.highlights(BigInt(m.version),m.spans);
    if(m.type!=='init')pendingHandlerMs+=performance.now()-handlingStart;
    if(ready)pump();
  }catch(error){postMessage({type:'error',message:String(error),generation});}
};

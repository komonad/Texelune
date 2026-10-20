import init,{Editor,DocumentImport}from'./pkg/texelune_editor.js';
import{prepareDocument}from'./import.js';
let editor,wasm;
self.onmessage=async({data:m})=>{
  if(m.type==='init'){
    wasm=await init();
    editor=m.source?.kind==='synthetic'?(await prepareDocument(DocumentImport,m.source.bytes,()=>{},()=>false,m.source.code)).finish_editor():new Editor(m.source?.text??m.text??'');
    for(const c of m.changes||[])editor.replace(c.start,c.end,c.text);
    postMessage({type:'ready',memory:wasm.memory.buffer.byteLength});
  }else if(m.type==='change')editor.replace(m.change.start,m.change.end,m.change.text);
  else if(m.type==='boundary')postMessage({type:'boundary',position:editor.boundary_exact(m.position,m.forward),version:m.version,selection:m.selection,action:m.action,forward:m.forward,extend:m.extend,memory:wasm.memory.buffer.byteLength});
  else if(m.type==='word')postMessage({type:'word',id:m.id,range:editor.word_range(m.offset,true),version:m.version,memory:wasm.memory.buffer.byteLength});
};

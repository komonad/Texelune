export class LspClient extends EventTarget {
  constructor(editor,options){
    super();this.editor=editor;this.options={maxDocumentBytes:2*1048576,...options};this.epoch=0;this.serial=0;this.pending=new Map();this.abort=new AbortController();this.state='disconnected';
    const host=editor.root.host,signal=this.abort.signal;
    host.addEventListener('change',event=>this.changed(event.detail),{signal});
    host.addEventListener('documentchange',()=>this.open(),{signal});
    host.addEventListener('themechange',()=>this.worker?.postMessage({type:'theme',theme:editor.theme}),{signal});
    host.addEventListener('dispose',()=>this.dispose(),{signal});
  }
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  status(state,message){this.state=state;this.emit('status',{state,message});}
  async connect(){
    this.disconnect();
    if(this.editor.documentInfo.bytes>this.options.maxDocumentBytes){this.status('paused','文档超过 LSP 同步上限，编辑与布局继续运行');return;}
    this.status('connecting','连接 rust-analyzer…');
    this.worker=new Worker(new URL('./lsp-worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data:m})=>this.receive(m);
    this.worker.onerror=event=>{this.status('error',event.message);this.connectPending?.reject(new Error(event.message));this.rejectPending();};
    const snapshot={text:this.editor.text,version:this.editor.version,epoch:++this.epoch};
    const connected=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.connectPending=null;this.disconnect();reject(new Error('LSP initialization timed out'));},25000);this.connectPending={resolve:result=>{clearTimeout(timer);this.connectPending=null;resolve(result);},reject:error=>{clearTimeout(timer);this.connectPending=null;reject(error);}};});
    this.worker.postMessage({type:'connect',options:this.options,theme:this.editor.theme,...snapshot});
    return connected;
  }
  receive(m){
    if(m.epoch!==this.epoch)return;
    if(m.type==='status'){if('quiescent'in m)this.quiescent=m.quiescent;this.status(m.state,m.message);if(['error','disconnected'].includes(m.state)){this.connectPending?.reject(new Error(m.message));this.rejectPending();this.worker?.terminate();this.worker=null;}return;}
    if(m.type==='connected'){this.capabilities=m.capabilities;this.status(m.indexing?'indexing':'ready',m.server.name+(m.indexing?' 正在索引工作区…':' 已连接'));this.connectPending?.resolve(m);this.emit('connected',m);return;}
    if(m.type==='reply'){const pending=this.pending.get(m.id);if(!pending)return;pending.cleanup();if(m.error||pending.version!==this.editor.version)pending.reject(new Error(m.error??'Document changed'));else pending.resolve(m.result);return;}
    if(m.type==='tokens'){
      if(m.version>this.editor.version||m.version<(this.highlightSource??-1)||m.version===this.highlightSource&&(m.batch??0)<(this.highlightBatch??0))return;
      if(this.editor.setHighlights(m.spans,m.version)===false){this.refresh();return;}
      this.highlightSource=m.version;this.highlightBatch=m.batch??0;this.emit('tokens',{...m,appliedVersion:this.editor.version});return;
    }
    if(m.version!==this.editor.version)return;
    if(m.type==='diagnostics'||m.type==='timing')this.emit(m.type,m);
  }
  open(){
    if(!this.worker)return;
    this.highlightSource=-1;this.highlightBatch=0;
    if(this.editor.documentInfo.bytes>this.options.maxDocumentBytes){this.disconnect();this.status('paused','大文档暂停 LSP，同步上限 '+(this.options.maxDocumentBytes/1048576)+' MiB');return;}
    this.rejectPending();this.worker.postMessage({type:'open',epoch:++this.epoch,version:this.editor.version,text:this.editor.text,uri:this.options.uri});
  }
  changed(change){
    if(!this.worker)return;
    if(this.editor.documentInfo.bytes>this.options.maxDocumentBytes){this.disconnect();this.status('paused','大文档暂停 LSP，编辑继续运行');return;}
    const {start,end,text,version}=change;this.worker.postMessage({type:'change',epoch:this.epoch,start,end,text,version});
  }
  query(method,offset=this.editor.selection.head,{signal}={}){
    if(signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
    if(!this.worker||!['ready','indexing','waiting'].includes(this.state))return Promise.reject(new Error('LSP is not connected'));
    const id=++this.serial,version=this.editor.version;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);this.pending.delete(id);};
      const stop=error=>{cleanup();this.worker?.postMessage({type:'cancel',id,epoch:this.epoch});reject(error);};
      const cancel=()=>stop(new DOMException('Cancelled','AbortError'));
      const timer=setTimeout(()=>stop(new DOMException('LSP request timed out','TimeoutError')),12000);
      signal?.addEventListener('abort',cancel,{once:true});this.pending.set(id,{resolve,reject,cleanup,version});this.worker.postMessage({type:'query',id,epoch:this.epoch,version,method,offset});
    });
  }
  hover(offset,options){return this.query('textDocument/hover',offset,options);}
  complete(offset,options){return this.query('textDocument/completion',offset,options);}
  definition(offset,options){return this.query('textDocument/definition',offset,options);}
  attach(){
    this.detach?.();const previous=this.editor.configuration;
    const providers={hoverProvider:context=>this.worker?this.hover(context.offset,{signal:context.signal}):null,definitionProvider:context=>this.worker?this.definition(context.offset,{signal:context.signal}):null};
    this.editor.configure(providers);let attached=true;
    const detach=()=>{if(!attached)return;attached=false;const current=this.editor.configuration,restore={};for(const key of Object.keys(providers))if(current[key]===providers[key])restore[key]=previous[key];this.editor.configure(restore);};
    this.detach=detach;return detach;
  }
  refresh(){this.worker?.postMessage({type:'refresh'});}
  rejectPending(){for(const pending of [...this.pending.values()]){pending.cleanup();pending.reject(new Error('LSP session changed'));}this.pending.clear();}
  disconnect(){this.worker?.terminate();this.worker=null;this.epoch++;this.highlightSource=-1;this.highlightBatch=0;this.quiescent=false;this.connectPending?.reject(new Error('LSP session disconnected'));this.rejectPending();this.status('disconnected','LSP 未连接');}
  dispose(){this.detach?.();this.detach=null;this.disconnect();this.abort.abort();}
}

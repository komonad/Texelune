import {deadline,plainContents} from './editing.js';

export class Interactions {
  constructor({api,options,overlays,wordRange,report}){
    Object.assign(this,{api,options,overlays,wordRange,report});this.key=null;this.timer=0;this.hover=null;this.pointer=null;
  }
  context(offset,signal){return{editor:this.api,offset,position:this.api.positionAt(offset),version:this.api.version,signal};}
  reset(){
    clearTimeout(this.timer);this.read?.abort();this.read=null;this.key=null;this.target=null;
    this.hover?.dispose();this.hover=null;this.overlays.range=null;this.overlays.update([],0);
    this.api.root.getElementById('viewport')?.classList.remove('has-definition');
  }
  changed(){this.reset();this.navigation?.abort();}
  leave(){this.pointer=null;this.reset();}
  move(event,hit){
    this.pointer={offset:hit?.cluster??hit?.offset,ctrl:event.ctrlKey||event.metaKey};
    if(!hit){this.reset();return;}
    const offset=this.pointer.offset,ctrl=this.pointer.ctrl,key=`${this.api.version}:${offset}:${ctrl}`;
    if(ctrl&&this.target&&offset>=this.target.range.start&&offset<this.target.range.end)return;
    if(this.key===key)return;this.reset();this.key=key;
    const provider=ctrl?this.options().definitionProvider:this.options().hoverProvider;
    if(!provider)return;
    const abort=this.read=new AbortController(),context=this.context(offset,abort.signal);
    this.timer=setTimeout(async()=>{
      try{
        const result=await deadline(()=>provider(context),abort.signal,this.options().providerTimeout??8000);
        if(abort.signal.aborted||context.version!==this.api.version)return;
        if(ctrl){
          const targets=Array.isArray(result)?result:result?[result]:[];if(!targets.length)return;
          const range=targets[0].originRange??await this.wordRange(offset,abort.signal);
          if(abort.signal.aborted||context.version!==this.api.version)return;
          this.target={targets,range};this.overlays.range=range;
          this.api.root.getElementById('viewport').classList.add('has-definition');
          this.show(targets.length===1?'Ctrl+单击跳转 · '+this.label(targets[0]):`Ctrl+单击 · ${targets.length} 个跳转目标`,offset);
          this.overlays.update(this.api.frame?.navigation.cells??[],this.api.frame?this.api.scroll-this.api.frame.scroll:0);
        }else if(result){
          const content=result instanceof Node?result:typeof result==='string'?result:result.contents;
          const text=content instanceof Node?content:plainContents(content);
          if(text)this.show(text,result.start??offset);
        }
      }catch(error){abort.abort();if(error.name!=='AbortError')this.report(ctrl?'definition':'hover',error);}
    },ctrl?80:(this.options().hoverDelay??350));
  }
  modifier(event){if(this.pointer)this.move(event,{cluster:this.pointer.offset});}
  show(content,anchor){this.hover?.dispose();this.hover=this.overlays.add({anchor,content,className:'hover-widget'});this.hover.element.setAttribute('role','tooltip');}
  label(target){return `${decodeURIComponent((target.uri??'').split('/').at(-1)??'')}:${(target.selectionRange??target.range)?.start.line+1||1}`;}
  async go(offset=this.api.selection.head){
    this.navigation?.abort();const abort=this.navigation=new AbortController(),context=this.context(offset,abort.signal);
    try{
      const provider=this.options().definitionProvider;if(!provider)return;
      let targets=this.target&&offset>=this.target.range.start&&offset<this.target.range.end?this.target.targets:null;
      if(!targets){const result=await deadline(()=>provider(context),abort.signal,this.options().providerTimeout??8000);targets=Array.isArray(result)?result:result?[result]:[];}
      if(abort.signal.aborted||context.version!==this.api.version)return;
      this.reset();
      if(targets.length===1)await this.navigate(targets[0],context);
      else if(targets.length){
        const content=document.createElement('div');content.setAttribute('role','listbox');content.setAttribute('aria-label','跳转目标');
        for(const target of targets){const button=document.createElement('button');button.textContent=this.label(target);button.onclick=()=>void this.navigate(target,context).catch(error=>this.report('navigation',error));content.append(button);}
        this.show(content,offset);
      }
    }catch(error){abort.abort();if(error.name!=='AbortError')this.report('definition',error);}
  }
  async navigate(target,context){
    if(context.signal.aborted||context.version!==this.api.version)return;
    const event=new CustomEvent('navigate',{detail:target,cancelable:true});
    if(!this.api.element.dispatchEvent(event))return;
    const handler=this.options().onNavigate;
    if(handler&&await deadline(()=>handler(target,this.api,context.signal),context.signal,this.options().providerTimeout??8000))return;
    if(context.signal.aborted||context.version!==this.api.version)return;
    this.reset();
    if(Number.isSafeInteger(target.start)){this.api.select(target.start,target.end??target.start);this.api.reveal(target.start);this.api.focus();}
  }
  destroy(){this.changed();}
}

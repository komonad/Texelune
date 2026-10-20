import {deadline} from './editing.js';

export function completionPrefix(editor,offset){
  const start=Math.max(0,offset-513),before=editor.slice(start,offset),after=editor.slice(offset,Math.min(editor.documentInfo.chars,offset+513));
  const prefix=[...(before.match(/[\p{ID_Continue}$]+$/u)?.[0]??'')],suffix=[...(after.match(/^[\p{ID_Continue}$]+/u)?.[0]??'')];
  return{start:offset-prefix.length,end:offset+suffix.length,...(prefix.length>512||suffix.length>512?{truncated:true}:{})};
}

export function prepareCompletions(items,editor,offset){
  if(items===null||items===undefined)return[];
  if(!Array.isArray(items))throw new TypeError('Completion provider must return an array');
  const fallback=completionPrefix(editor,offset),length=editor.documentInfo.chars;
  return items.slice(0,200).flatMap((item,index)=>{
    if(!item||typeof item.label!=='string'||item.snippet||item.additionalEdits)return[];
    if(fallback.truncated&&(item.start===undefined||item.end===undefined))return[];
    const start=item.start??fallback.start,end=item.end??fallback.end,text=item.text??item.label;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>offset||end<offset||end>length||typeof text!=='string')return[];
    if(offset-start>4096)return[];
    const prefix=editor.slice(start,offset),filterText=item.filterText??item.label;
    if(typeof filterText!=='string'||!filterText.normalize('NFC').toLowerCase().startsWith(prefix.normalize('NFC').toLowerCase()))return[];
    return[{...item,start,end,text,detail:typeof item.detail==='string'?item.detail:'',sortText:typeof item.sortText==='string'?item.sortText:item.label,_order:index}];
  }).sort((a,b)=>a.sortText<b.sortText?-1:a.sortText>b.sortText?1:a._order-b._order).map(({_order,...item})=>Object.freeze(item));
}

export class CompletionController {
  constructor({api,options,overlays,report,emit,edit}){
    Object.assign(this,{api,options,overlays,report,emit,edit});this.items=[];this.index=0;this.serial=0;this.timer=0;this.pending=false;this.composing=false;
    this.controller=new AbortController();const signal=this.controller.signal,host=api.element,input=this.input=api.root.getElementById('input'),viewport=api.root.getElementById('viewport');
    host.addEventListener('change',event=>this.changed(event.detail),{signal});
    host.addEventListener('selectionchange',()=>{if(this.checkpoint&&!this.valid())this.hide();},{signal});
    host.addEventListener('documentchange',()=>this.hide(),{signal});
    input.addEventListener('compositionstart',()=>{this.composing=true;this.hide();},{signal});
    input.addEventListener('compositionend',()=>{this.composing=false;if(options().automaticCompletion!==false)this.schedule();},{signal});
    input.addEventListener('blur',()=>this.hide(),{signal});
    window.addEventListener('blur',()=>this.hide(),{signal});
    this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(viewport);
    host.addEventListener('frame',()=>{if(this.widget&&!this.pending)this.highlight();},{signal});
    for(const type of ['pointerdown','wheel'])viewport.addEventListener(type,event=>{if(!event.target.closest('.completion-widget'))this.hide();},{capture:true,signal});
    input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-expanded','false');
  }
  get state(){return{visible:!!this.widget,pending:this.pending,index:this.index,items:[...this.items]};}
  publish(){this.emit('completionchange',this.state);}
  valid(){if(this.destroyed)return false;const s=this.api.selection,c=this.checkpoint;return !!c&&this.api.version===c.version&&s.anchor===c.anchor&&s.head===c.head;}
  capture(){const s=this.api.selection;this.checkpoint={...s,version:this.api.version};}
  hide(){
    const active=this.pending||!!this.widget||!!this.items.length;
    clearTimeout(this.timer);this.read?.abort();this.read=null;this.serial++;this.pending=false;this.checkpoint=null;this.items=[];this.index=0;
    this.widget?.dispose();this.widget=null;this.input.removeAttribute('aria-controls');this.input.removeAttribute('aria-activedescendant');this.input.setAttribute('aria-expanded','false');
    this.overlays.layer.classList.remove('has-completion');
    if(active)this.publish();
  }
  changed(change){
    const wasOpen=!!this.items.length;this.hide();
    if(this.composing||this.options().automaticCompletion===false||!this.options().completionProvider)return;
    const typed=change.source==='input'&&change.text.length<=2&&/^[\p{ID_Continue}$.:]$/u.test(change.text);
    if(typed||wasOpen&&change.source==='delete')this.schedule(change.text);
  }
  schedule(character){
    this.hide();if(this.destroyed||!this.options().completionProvider||this.composing||this.api.root.activeElement!==this.input||this.api.selection.anchor!==this.api.selection.head)return;
    this.capture();this.pending=true;this.publish();
    this.timer=setTimeout(()=>{if(this.valid())void this.trigger('automatic',character);else this.hide();},Math.max(0,this.options().completionDelay??120));
  }
  async trigger(triggerKind='invoked',triggerCharacter){
    this.hide();if(this.destroyed)return[];const provider=this.options().completionProvider,s=this.api.selection;
    if(!provider||this.composing||s.anchor!==s.head)return[];
    this.capture();const serial=this.serial,abort=this.read=new AbortController(),offset=s.head;
    this.api.reveal(offset);
    const context={editor:this.api,offset,position:this.api.positionAt(offset),version:this.api.version,signal:abort.signal,triggerKind,triggerCharacter};
    this.pending=true;this.render();this.publish();
    try{
      const result=await deadline(()=>provider(context),abort.signal,this.options().providerTimeout??8000);
      if(abort.signal.aborted||serial!==this.serial||!this.valid())return[];
      this.items=prepareCompletions(result,this.api,offset);this.pending=false;this.index=Math.max(0,this.items.findIndex(item=>item.preselect));
      if(!this.items.length){this.hide();return[];}
      this.render();this.publish();return[...this.items];
    }catch(error){if(serial===this.serial){this.hide();if(error.name!=='AbortError')this.report('completion',error);}return[];}
    finally{if(this.read===abort)this.read=null;}
  }
  render(){
    const content=document.createElement('div');
    if(this.pending){content.setAttribute('role','status');content.className='completion-loading';content.textContent='查询补全…';}
    else{
      content.id='completion-listbox';content.setAttribute('role','listbox');content.setAttribute('aria-label','补全候选');
      this.items.forEach((item,index)=>{
        const button=document.createElement('button');button.id='completion-option-'+index;button.className='completion-item';button.type='button';button.tabIndex=-1;button.setAttribute('role','option');button.dataset.index=index;
        button.setAttribute('aria-selected',String(index===this.index));
        const label=document.createElement('span');label.className='completion-label';label.textContent=item.label.slice(0,200);
        const detail=document.createElement('span');detail.className='completion-detail';detail.textContent=item.detail.slice(0,500);button.append(label,detail);
        button.addEventListener('pointerdown',event=>{if(event.button===0){event.preventDefault();this.accept(index);}});content.append(button);
      });
      this.input.setAttribute('aria-controls',content.id);
    }
    this.widget?.dispose();this.widget=this.overlays.add({anchor:this.checkpoint.head,content,className:'completion-widget'});
    this.overlays.layer.classList.add('has-completion');
    this.fit();
    this.input.setAttribute('aria-expanded','true');this.highlight();
  }
  fit(){if(!this.widget)return;this.widget.element.style.setProperty('--completion-height',Math.max(0,Math.min(260,this.overlays.viewport.clientHeight-16))+'px');this.widget.update({});}
  highlight(){
    if(!this.widget||this.pending)return;
    this.widget.element.querySelector('[aria-selected=true]')?.setAttribute('aria-selected','false');
    const selected=this.widget.element.querySelector('#completion-option-'+this.index);selected?.setAttribute('aria-selected','true');
    if(selected){this.input.setAttribute('aria-activedescendant',selected.id);const parent=this.widget.element,top=selected.offsetTop,bottom=top+selected.offsetHeight;if(top<parent.scrollTop)parent.scrollTop=top;else if(bottom>parent.scrollTop+parent.clientHeight)parent.scrollTop=bottom-parent.clientHeight;}
  }
  move(delta){if(!this.items.length||!this.valid())return false;this.index=((this.index+delta)%this.items.length+this.items.length)%this.items.length;this.highlight();this.publish();return true;}
  accept(index=this.index){
    const item=this.items[index];if(!item||!this.valid()){this.hide();return false;}
    this.hide();if(this.destroyed)return false;const applied=this.edit(item.start,item.end,item.text,'completion');if(!this.destroyed)this.api.focus();return applied;
  }
  keyDown(event){
    if(event.ctrlKey||event.metaKey||event.altKey)return false;
    if(event.key==='Escape'&&this.widget){event.preventDefault();this.hide();return true;}
    if(event.shiftKey)return false;
    if(!this.items.length)return false;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();return this.move(event.key==='ArrowDown'?1:-1);}
    if(event.key==='PageDown'||event.key==='PageUp'){event.preventDefault();return this.move(event.key==='PageDown'?8:-8);}
    if(!event.shiftKey&&(event.key==='Enter'||event.key==='Tab')){event.preventDefault();return this.accept();}
    return false;
  }
  destroy(){this.destroyed=true;this.resize.disconnect();this.hide();this.controller.abort();this.input.removeAttribute('aria-autocomplete');this.input.removeAttribute('aria-haspopup');}
}

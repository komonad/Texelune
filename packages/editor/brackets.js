import {deadline} from './editing.js';

export const defaultBracketPairs=Object.freeze(['()','[]','{}','（）','【】','「」','『』','〈〉','《》'].map(pair=>Object.freeze({open:pair[0],close:pair[1]})));
const cancelled=()=>new DOMException('Bracket matching cancelled','AbortError');

export function bracketPairs(value=defaultBracketPairs){
  if(!Array.isArray(value)||value.length>64)throw new TypeError('bracketPairs must contain at most 64 pairs');
  const used=new Set();
  return Object.freeze(Array.from(value,pair=>{
    if(!pair||typeof pair.open!=='string'||typeof pair.close!=='string'||[...pair.open].length!==1||[...pair.close].length!==1||/[\p{Mark}\p{Control}\p{Surrogate}\p{White_Space}]/u.test(pair.open+pair.close)||used.has(pair.open)||used.has(pair.close)||pair.open===pair.close)throw new TypeError('Bracket endpoints must be distinct Unicode scalars');
    used.add(pair.open);used.add(pair.close);return Object.freeze({open:pair.open,close:pair.close});
  }));
}

export async function scanBrackets(editor,offset,pairs,signal,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))){
  if(signal.aborted)throw cancelled();
  const length=editor.documentInfo.chars;
  if(!Number.isSafeInteger(offset)||offset<0||offset>length)throw new RangeError('Invalid bracket offset');
  const endpoints=new Map();for(const pair of pairs){endpoints.set(pair.open,{pair,forward:true});endpoints.set(pair.close,{pair,forward:false});}
  let origin=offset,char=editor.slice(offset,Math.min(offset+1,length));
  if(!endpoints.has(char)&&offset>0){origin=offset-1;char=editor.slice(origin,offset);}
  const endpoint=endpoints.get(char);if(!endpoint)return null;
  const {forward}=endpoint,stack=[forward?endpoint.pair.close:endpoint.pair.open];
  let position=forward?origin+1:origin,lastYield=performance.now();
  while(forward?position<length:position>0){
    if(signal.aborted)throw cancelled();
    const start=forward?position:Math.max(0,position-1024),end=forward?Math.min(length,position+1024):position;
    const chars=[...editor.slice(start,end)];
    for(let i=forward?0:chars.length-1;forward?i<chars.length:i>=0;forward?i++:i--){
      const entry=endpoints.get(chars[i]);if(!entry)continue;
      if(entry.forward===forward){if(stack.length>=65536)return null;stack.push(forward?entry.pair.close:entry.pair.open);}
      else{
        if(stack.pop()!==chars[i])return null;
        if(!stack.length){const other=start+i;return{open:{start:Math.min(origin,other),end:Math.min(origin,other)+1},close:{start:Math.max(origin,other),end:Math.max(origin,other)+1}};}
      }
    }
    position=forward?end:start;
    if(performance.now()-lastYield>=1){await yieldTask();lastYield=performance.now();}
  }
  if(signal.aborted)throw cancelled();return null;
}

export class BracketController {
  constructor({api,options,edit,advance,report}){
    Object.assign(this,{api,options,edit,advance,report});this.reads=new Set();this.match=null;this.controller=new AbortController();
    this.layer=document.createElement('div');this.layer.className='bracket-layer';this.layer.setAttribute('aria-hidden','true');api.root.getElementById('viewport').append(this.layer);
    const signal=this.controller.signal;
    for(const event of ['change','selectionchange','documentchange'])api.element.addEventListener(event,()=>this.refresh(),{signal});
    api.element.addEventListener('frame',()=>this.render(),{signal});
    this.refresh();
  }
  cancel(){this.serial=(this.serial??0)+1;for(const read of this.reads)read.abort();this.reads.clear();this.match=null;this.layer.replaceChildren();}
  async find(offset=this.api.selection.head,signal){
    const api=this.api,version=api.version,abort=new AbortController(),cancel=()=>abort.abort();
    if(!Number.isSafeInteger(offset)||offset<0||offset>api.documentInfo.chars)throw new RangeError('Invalid bracket offset');
    if(signal?.aborted)throw cancelled();signal?.addEventListener('abort',cancel,{once:true});this.reads.add(abort);
    try{
      const provider=this.options().bracketMatchingProvider;
      const match=await deadline(()=>provider?provider({editor:api,offset,position:api.positionAt(offset),version,signal:abort.signal}):scanBrackets(api,offset,this.options().bracketPairs,abort.signal),abort.signal,this.options().providerTimeout??8000);
      if(abort.signal.aborted||api.version!==version)throw cancelled();
      if(match){const {open,close}=match,length=api.documentInfo.chars;if(!open||!close||![open.start,open.end,close.start,close.end].every(Number.isSafeInteger)||open.start<0||open.end<=open.start||close.start<open.end||close.end<=close.start||close.end>length)throw new RangeError('Invalid bracket match');}
      return match?{open:{...match.open},close:{...match.close}}:null;
    }finally{abort.abort();this.reads.delete(abort);signal?.removeEventListener('abort',cancel);}
  }
  refresh(){
    this.cancel();const s=this.api.selection;if(this.options().bracketMatching===false||s.anchor!==s.head)return;
    const serial=this.serial;
    void this.find(s.head).then(match=>{if(serial===this.serial){this.match=match;this.render();}}).catch(error=>{if(serial===this.serial&&error.name!=='AbortError')this.report('brackets',error);});
  }
  render(){
    const api=this.api,frame=api.frame,delta=api.renderedScroll-(frame?.scroll??api.renderedScroll),boxes=[];
    if(this.drawnFrame===frame&&this.drawnMatch===this.match&&this.drawnDelta===delta&&this.drawnVersion===api.version)return;
    this.drawnFrame=frame;this.drawnMatch=this.match;this.drawnDelta=delta;this.drawnVersion=api.version;
    if(this.match&&Number(frame?.version)===api.version)for(const cell of frame.navigation.cells){
      const {open,close}=this.match;if(!(cell.end>open.start&&cell.start<open.end||cell.end>close.start&&cell.start<close.end))continue;
      const [x,y,w,h]=cell.bounds;if(y-delta+h<0||y-delta>this.layer.clientHeight)continue;
      const box=document.createElement('div');box.className='bracket-match';Object.assign(box.style,{left:x+'px',top:y-delta+'px',width:w+'px',height:h+'px'});boxes.push(box);
    }
    this.layer.replaceChildren(...boxes);
  }
  skip(close){
    const api=this.api,s=api.selection;if(s.anchor!==s.head||this.options().skipClosingBrackets===false)return false;
    const next=api.slice(s.head,Math.min(s.head+1,api.documentInfo.chars));
    if((close!==undefined&&next!==close)||!this.options().bracketPairs.some(pair=>pair.close===next))return false;
    this.advance();return true;
  }
  input(text,start,end,source='input',composed=false){
    const api=this.api,pairs=this.options().bracketPairs,eligible=source==='composition'?composed:start===end;
    if(eligible&&this.options().skipClosingBrackets!==false&&pairs.some(pair=>pair.close===text)&&api.slice(end,Math.min(end+1,api.documentInfo.chars))===text){
      if(start===end)return this.skip(text);
      const applied=this.edit(start,end,'',source,undefined,{anchor:start,head:start});
      if(applied&&api.selection.head===start&&api.selection.anchor===start&&api.slice(start,Math.min(start+1,api.documentInfo.chars))===text)this.advance();
      return applied;
    }
    const pair=this.options().autoClosingBrackets!==false&&pairs.find(pair=>pair.open===text);
    if(pair&&eligible)return this.edit(start,end,text+pair.close,source,1);
    return this.edit(start,end,text,source);
  }
  destroy(){this.controller.abort();this.cancel();this.layer.remove();}
}

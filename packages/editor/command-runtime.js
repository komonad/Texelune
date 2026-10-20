import {planLineEdit,scalarCount,lineEnding} from './commands.js';
import {deadline} from './editing.js';

const clipboardFormat='application/x-texelune-line';
const webClipboardFormat='web '+clipboardFormat;
const smallRange=8192;
const cancelled=()=>new DOMException('Command cancelled','AbortError');

export class CommandController {
  constructor(adapter){this.a=adapter;this.pending=null;}
  cancel(){this.pending?.abort();this.pending=null;}
  release(){this.pending=null;}
  async run(task){
    this.cancel();const abort=this.pending=new AbortController(),a=this.a;
    const selection=a.api.selection,version=a.api.version;
    const context={signal:abort.signal,selection,version,valid:()=>!abort.signal.aborted&&version===a.api.version&&selection.anchor===a.api.selection.anchor&&selection.head===a.api.selection.head};
    try{return await deadline(()=>task(context),abort.signal,a.options().providerTimeout??8000);}
    catch(error){abort.abort();if(error.name!=='AbortError')a.report('command',error);return false;}
    finally{if(this.pending===abort)this.pending=null;}
  }
  block(selection=this.a.api.selection){
    const e=this.a.api,lo=Math.min(selection.anchor,selection.head),hi=Math.max(selection.anchor,selection.head);
    const first=e.positionAt(lo).line;let last=e.positionAt(hi).line;
    if(hi>lo&&e.lineRange(last).start===hi)last=Math.max(first,last-1);
    return{first,last,start:e.lineRange(first).start,end:e.lineRange(last).end,selection};
  }
  newline(){const e=this.a.api;return e.slice(0,Math.min(e.documentInfo.chars,4096)).includes('\r\n')?'\r\n':'\n';}
  clipboardRange(){
    const e=this.a.api,s=e.selection,linewise=s.anchor===s.head;
    const range=linewise?e.lineRange(e.positionAt(s.head).line):{start:Math.min(s.anchor,s.head),end:Math.max(s.anchor,s.head)};
    const suffix=linewise&&!lineEnding(e.slice(Math.max(range.start,range.end-2),range.end))?this.newline():'';
    let deleteStart=range.start;
    // The final logical line shares its separator with the preceding line.
    if(linewise&&range.end===e.documentInfo.chars&&!lineEnding(e.slice(Math.max(range.start,range.end-2),range.end))&&range.start>0){
      const previous=e.slice(Math.max(0,range.start-2),range.start);deleteStart-=scalarCount(lineEnding(previous));
    }
    return{...range,deleteStart,linewise,suffix};
  }
  copyEvent(event,cut){
    event.preventDefault();this.cancel();if(!event.clipboardData)return;
    const range=this.clipboardRange(),e=this.a.api;
    if(range.end-range.start>smallRange){void this.clipboard(cut?'cut':'copy',range);return;}
    try{
      event.clipboardData.setData('text/plain',e.slice(range.start,range.end)+range.suffix);
      if(range.linewise)event.clipboardData.setData(clipboardFormat,'1');
      if(cut&&range.end>range.deleteStart)this.a.edit(range.deleteStart,range.end,'','cut');
    }catch(error){this.a.report('clipboard',error);}
  }
  pasteEvent(event){
    event.preventDefault();if(!event.clipboardData)return;
    const text=event.clipboardData.getData('text/plain'),linewise=event.clipboardData.getData(clipboardFormat)==='1';
    if(text.length<=smallRange){this.paste(text,linewise);return;}
    void this.run(async context=>{await new Promise(resolve=>setTimeout(resolve,0));return context.valid()&&this.paste(text,linewise);});
  }
  paste(text,linewise){
    const e=this.a.api,s=e.selection;
    if(linewise&&s.anchor===s.head){const start=e.lineRange(e.positionAt(s.head).line).start;return this.a.edit(start,start,text,'paste');}
    return this.a.edit(Math.min(s.anchor,s.head),Math.max(s.anchor,s.head),text,'paste');
  }
  async blob(range,context){
    const e=this.a.api;let offset=range.start,lastYield=performance.now();
    const stream=new ReadableStream({pull:async controller=>{
      try{
        if(!context.valid())throw cancelled();
        if(offset>=range.end){if(range.suffix)controller.enqueue(range.suffix);controller.close();return;}
        const end=Math.min(range.end,offset+4096);controller.enqueue(e.slice(offset,end));offset=end;
        if(performance.now()-lastYield>1.5){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
      }catch(error){controller.error(error);}
    }});
    const blob=await new Response(stream.pipeThrough(new TextEncoderStream())).blob();
    return new Blob([blob],{type:'text/plain'});
  }
  clipboard(command,range=this.clipboardRange()){
    // Clipboard access starts in the input gesture; payload preparation can yield.
    this.cancel();const abort=this.pending=new AbortController(),e=this.a.api,selection=e.selection,version=e.version;
    const context={signal:abort.signal,valid:()=>!abort.signal.aborted&&version===e.version&&selection.anchor===e.selection.anchor&&selection.head===e.selection.head};
    let operation;
    try{
      if(command==='paste'){
        if(navigator.clipboard?.read)operation=navigator.clipboard.read().then(async items=>{
          const item=items.find(item=>item.types.includes('text/plain'));if(!item)return false;
          const text=await(await item.getType('text/plain')).text();
          const linewise=item.types.includes(webClipboardFormat)&&(await(await item.getType(webClipboardFormat)).text())==='1';
          return context.valid()&&this.paste(text,linewise);
        });
        else if(navigator.clipboard?.readText)operation=navigator.clipboard.readText().then(text=>context.valid()&&this.paste(text,false));
        else throw new Error('Clipboard read is unavailable');
      }else{
        if(navigator.clipboard?.write&&globalThis.ClipboardItem){
          const payload=this.blob(range,context);payload.catch(()=>{});
          const data={'text/plain':payload};
          if(range.linewise&&ClipboardItem.supports?.(webClipboardFormat))data[webClipboardFormat]=new Blob(['1'],{type:clipboardFormat});
          operation=navigator.clipboard.write([new ClipboardItem(data)]);
        }else if(navigator.clipboard?.writeText&&range.end-range.start<=smallRange){
          operation=navigator.clipboard.writeText(e.slice(range.start,range.end)+range.suffix);
        }else throw new Error('Asynchronous clipboard write is unavailable');
        operation=operation.then(()=>{
          if(!context.valid())return false;
          return command==='cut'&&range.end>range.deleteStart?this.a.edit(range.deleteStart,range.end,'','cut'):true;
        });
      }
    }catch(error){operation=Promise.reject(error);}
    operation.catch(()=>{});
    return deadline(()=>operation,abort.signal,this.a.options().providerTimeout??8000).catch(error=>{abort.abort();if(error.name!=='AbortError')this.a.report('clipboard',error);return false;}).finally(()=>{if(this.pending===abort)this.pending=null;});
  }
  async plan(command,range,context){
    const e=this.a.api;
    if(range.end-range.start<=smallRange)return planLineEdit(command,range,e.slice(range.start,range.end));
    const worker=new Worker(new URL('./command-worker.js',import.meta.url),{type:'module'});
    let finish,reject,stopped=false;
    const stop=()=>{if(!stopped){stopped=true;worker.terminate();}};
    const result=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
    const cancel=()=>{stop();reject(cancelled());};context.signal.addEventListener('abort',cancel,{once:true});
    worker.onmessage=({data})=>data.error?reject(new Error(data.error)):finish(data.plan);
    worker.onerror=event=>reject(new Error(event.message));
    // Register rejection handling before yielding to document mutations.
    result.catch(()=>{});
    try{
      let lastYield=performance.now();
      for(let start=range.start;start<range.end;start+=4096){
        if(!context.valid())throw cancelled();
        worker.postMessage({type:'chunk',text:e.slice(start,Math.min(range.end,start+4096))});
        if(performance.now()-lastYield>1.5){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
      }
      if(!context.valid())throw cancelled();
      worker.postMessage({type:'finish',command,context:range});return await result;
    }finally{context.signal.removeEventListener('abort',cancel);stop();}
  }
  line(command){
    return this.run(async context=>{
      const e=this.a.api,range={...this.block(context.selection),indentUnit:this.a.options().indentUnit??'    ',newline:this.newline()};
      if(command==='selectLine'){this.release();e.select(range.start,range.end);e.reveal();return true;}
      if(command==='deleteLine'){
        let start=range.start;
        if(range.end===e.documentInfo.chars&&!lineEnding(e.slice(Math.max(start,range.end-2),range.end))&&start>0)start-=scalarCount(lineEnding(e.slice(Math.max(0,start-2),start)));
        return range.end>start&&this.a.edit(start,range.end,'','deleteLine');
      }
      if(command==='insertLineAbove'||command==='insertLineBelow'){
        const above=command==='insertLineAbove',position=above?range.start:range.end;
        if(!above&&range.end===e.documentInfo.chars&&!lineEnding(e.slice(Math.max(range.start,range.end-2),range.end)))return this.a.edit(position,position,range.newline,'newline');
        return this.a.edit(position,position,range.newline,'newline',0);
      }
      if(command==='moveLineUp'){
        if(range.first===0)return false;
        const previous=e.lineRange(range.first-1);range.split=range.start-previous.start;range.start=previous.start;
      }else if(command==='moveLineDown'){
        if(range.last+1>=e.documentInfo.lines)return false;
        range.split=range.end-range.start;range.end=e.lineRange(range.last+1).end;
      }
      const plan=await this.plan(command,range,context);
      if(!context.valid())return false;
      if(plan.unchanged)return false;
      return this.a.edit(plan.start,plan.end,plan.text,command,undefined,plan.selection);
    });
  }
  word(command){
    return this.run(async context=>{
      const e=this.a.api,s=context.selection,forward=command.endsWith('Right'),deleting=command.startsWith('delete'),extend=command.startsWith('select');
      if(deleting&&s.anchor!==s.head)return this.a.edit(Math.min(s.anchor,s.head),Math.max(s.anchor,s.head),'','delete');
      const length=e.documentInfo.chars;let position=s.head;
      // Whitespace and line terminators are separate UAX #29 units.
      for(let units=0;units<2;units++){
        if(forward?position>=length:position<=0)break;
        const range=await e.wordRange(forward?position:position-1,context.signal);
        const next=forward?range.end:range.start;
        if(next===position)break;
        const white=range.end-range.start<=4096&&/^\s+$/u.test(e.slice(range.start,range.end));
        position=next;if(!white)break;
      }
      if(!context.valid())return false;
      if(deleting)return position!==s.head&&this.a.edit(Math.min(position,s.head),Math.max(position,s.head),'','delete');
      this.release();e.select(extend?s.anchor:position,position);e.reveal();return true;
    });
  }
}

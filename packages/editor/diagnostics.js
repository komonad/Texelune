const names=['','错误','警告','信息','提示'];
const colors=['','error','warning','information','hint'];

export class DiagnosticIndex {
  constructor(items=[],length=Infinity){
    this.items=Object.freeze(items.map(item=>{
      if(!Number.isSafeInteger(item.start)||!Number.isSafeInteger(item.end)||item.start<0||item.end<item.start||item.end>length||typeof item.message!=='string'||item.severity!==undefined&&![1,2,3,4].includes(item.severity))throw new TypeError('Invalid diagnostic');
      return Object.freeze({...item,severity:item.severity??1});
    }).sort((a,b)=>a.start-b.start||a.end-b.end||a.severity-b.severity));
    this.size=1;while(this.size<this.items.length)this.size*=2;
    this.ends=new Float64Array(this.size*2);this.severities=new Uint8Array(this.size*2);this.severities.fill(5);
    for(let i=0;i<this.items.length;i++){const item=this.items[i];this.ends[this.size+i]=Math.max(item.start+1,item.end);this.severities[this.size+i]=item.severity;}
    for(let i=this.size-1;i>0;i--){this.ends[i]=Math.max(this.ends[i*2],this.ends[i*2+1]);this.severities[i]=Math.min(this.severities[i*2],this.severities[i*2+1]);}
  }
  search(start,end,limit=20,bestOnly=false){
    const result=[];let best=null;
    const visit=(node,first,last)=>{
      if(first>=this.items.length||this.ends[node]<=start||this.items[first].start>=end||bestOnly&&this.severities[node]>=(best?.severity??5)||!bestOnly&&result.length>=limit)return;
      if(last-first===1){if(bestOnly)best=this.items[first];else result.push(this.items[first]);return;}
      const middle=(first+last)>>>1;visit(node*2,first,middle);visit(node*2+1,middle,last);
    };
    visit(1,0,this.size);return bestOnly?best:result;
  }
  at(offset){return this.search(offset,offset+1);}
  best(start,end){return this.search(start,Math.max(start+1,end),1,true);}
  next(offset,direction=1){
    if(!this.items.length)return null;
    let first=0,last=this.items.length;
    while(first<last){const middle=(first+last)>>>1;if(this.items[middle].start<offset||direction>0&&this.items[middle].start===offset)first=middle+1;else last=middle;}
    return direction<0?(this.items[first-1]??this.items.at(-1)):(this.items[first]??this.items[0]);
  }
}

export class DiagnosticLayer {
  constructor(api,viewport,numbers,summary){
    Object.assign(this,{api,viewport,numbers,summary});this.index=new DiagnosticIndex();
    this.layer=document.createElement('div');this.layer.className='diagnostic-layer';this.layer.setAttribute('aria-hidden','true');viewport.append(this.layer);
    summary.onclick=()=>api.goToDiagnostic();
  }
  get items(){return this.index.items;}
  set(items){
    this.index=new DiagnosticIndex(items,this.api.documentInfo.chars);
    this.hasPoints=this.items.some(item=>item.start===item.end);
    const counts=[0,0,0,0,0];for(const item of this.items)counts[item.severity]++;
    this.summary.textContent=counts.map((count,severity)=>count?`${names[severity]} ${count}`:'').filter(Boolean).join(' · ');
    this.summary.hidden=!this.items.length;this.render();
  }
  render(){
    const {api,index}=this,frame=api.frame,delta=api.scroll-(frame?.scroll??api.scroll),height=this.viewport.clientHeight;
    const boxes=[],gutter=new Map();
    if(frame&&Number(frame.version)===api.version&&index.items.length){
      const add=(x,y,w,h,severity)=>{
        const last=boxes.at(-1);
        if(last&&last.severity===severity&&Math.abs(last.y-y)<.5&&(Math.abs(last.x+last.w-x)<1||Math.abs(x+w-last.x)<1)){const end=Math.max(last.x+last.w,x+w);last.x=Math.min(last.x,x);last.w=end-last.x;}
        else boxes.push({x,y,w:Math.max(w,3),h,severity});
      };
      for(const cell of frame.navigation.cells){
        const [x,y,w,h]=cell.bounds;if(y-delta+h<0||y-delta>height)continue;
        const item=index.best(cell.start,cell.end);if(!item)continue;
        if(item.start!==item.end)add(x,y,w,h,item.severity);
        const line=api.positionAt(cell.start).line+1;gutter.set(line,Math.min(gutter.get(line)??5,item.severity));
      }
      const points=new Set();
      if(this.hasPoints)for(const hit of frame.navigation.hits){
        if(hit.y-delta+hit.h<0||hit.y-delta>height)continue;
        const item=index.best(hit.offset,hit.offset+1);if(!item||item.start!==item.end||points.has(item))continue;points.add(item);
        add(hit.x,hit.y,6,hit.h,item.severity);const line=api.positionAt(item.start).line+1;gutter.set(line,Math.min(gutter.get(line)??5,item.severity));
      }
    }
    this.layer.replaceChildren(...boxes.map(box=>{
      const mark=document.createElement('div');mark.className='diagnostic-mark';mark.dataset.severity=String(box.severity);
      mark.style.setProperty('--diagnostic-color',`var(--texelune-diagnostic-${colors[box.severity]})`);
      Object.assign(mark.style,{left:box.x+'px',top:box.y-delta+box.h-3+'px',width:box.w+'px'});return mark;
    }));
    for(const number of this.numbers.children){
      const severity=gutter.get(Number(number.textContent));number.classList.toggle('has-diagnostic',!!severity);
      if(severity){number.dataset.severity=String(severity);number.style.setProperty('--diagnostic-color',`var(--texelune-diagnostic-${colors[severity]})`);}else delete number.dataset.severity;
    }
  }
  hover(offset){
    const cell=this.api.frame?.navigation.cells.find(cell=>cell.start<=offset&&cell.end>offset);
    const items=cell?this.index.search(cell.start,cell.end):this.index.at(offset);if(!items.length)return null;
    const content=document.createElement('div');content.className='diagnostic-hover';
    for(const item of items){
      const entry=document.createElement('div');entry.className='diagnostic-message';entry.dataset.severity=String(item.severity);
      const label=document.createElement('div');label.className='diagnostic-heading';label.style.color=`var(--texelune-diagnostic-${colors[item.severity]})`;
      label.textContent=[names[item.severity],item.source,item.code].filter(value=>value!==undefined&&value!=='').join(' · ');
      const message=document.createElement('div');message.textContent=item.message;entry.append(label,message);content.append(entry);
    }
    return content;
  }
  destroy(){this.summary.onclick=null;this.layer.remove();}
}

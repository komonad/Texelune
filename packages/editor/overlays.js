export class OverlayLayer {
  constructor(viewport,resolve){
    this.viewport=viewport;this.resolve=resolve;this.items=new Set();
    this.layer=document.createElement('div');this.layer.className='overlay-layer';viewport.append(this.layer);
    this.links=document.createElement('div');this.links.className='definition-ranges';this.layer.append(this.links);
    this.range=null;
  }
  add(options){
    const element=document.createElement('div');element.className='editor-overlay';element.dataset.editorWidget='';
    const item={...options,element};this.items.add(item);this.layer.append(element);
    const update=patch=>{
      Object.assign(item,patch);element.className='editor-overlay '+(item.className??'');
      element.style.pointerEvents=item.interactive===false?'none':'auto';
      if('content'in patch){if(typeof item.content==='string')element.textContent=item.content;else element.replaceChildren(item.content);}
      this.position(item);
    };
    update(options);
    return{element,update,dispose:()=>{this.items.delete(item);element.remove();}};
  }
  position(item){
    const hit=this.resolve(item.anchor),element=item.element;
    element.hidden=!hit;if(!hit)return;
    const width=this.viewport.clientWidth,height=this.viewport.clientHeight;
    element.style.maxWidth=Math.max(0,width-32)+'px';
    element.style.maxHeight=Math.max(0,height-16)+'px';
    const size=element.getBoundingClientRect();
    let y=item.placement==='above'?hit.y-size.height-6:hit.y+hit.h+6;
    if(y+size.height>height-8)y=hit.y-size.height-6;
    element.style.left=Math.max(8,Math.min(width-size.width-24,hit.x))+'px';
    element.style.top=Math.max(8,Math.min(height-size.height-8,y))+'px';
  }
  update(cells,delta=0){
    for(const item of this.items)this.position(item);
    this.links.replaceChildren();
    if(!this.range)return;
    const boxes=[];
    for(const cell of cells){
      if(cell.end<=this.range.start||cell.start>=this.range.end)continue;
      const [x,y,w,h]=cell.bounds,last=boxes.at(-1);
      if(last&&Math.abs(last.y-y)<.5&&Math.abs(last.x+last.w-x)<1)last.w+=w;
      else boxes.push({x,y,w,h});
    }
    for(const {x,y,w,h}of boxes){
      const rect=document.createElement('div');rect.className='definition-range';
      Object.assign(rect.style,{left:x+'px',top:y-delta+'px',width:w+'px',height:h+'px'});this.links.append(rect);
    }
  }
  destroy(){this.items.clear();this.layer.remove();}
}

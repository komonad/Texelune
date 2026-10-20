export class FrameStager {
  constructor(){this.reset();}
  reset(){this.active=null;this.incoming=null;this.frames=new WeakMap();}
  stage(frame,generation){
    const identity=`${generation}:${frame.atlas_epoch}`;
    if(this.incoming?.identity!==identity)this.incoming={identity,patches:[]};
    this.incoming.patches.push(...frame.patches);frame.patches=[];
    this.frames.set(frame,this.incoming);
    return frame.visible_ready;
  }
  take(frame){
    const atlas=this.frames.get(frame);
    if(!atlas||!frame.visible_ready)throw new Error('A complete staged frame is required');
    const reset=this.active!==atlas.identity;this.active=atlas.identity;
    return{reset,patches:atlas.patches.splice(0)};
  }
}

export function sceneScroll(frame,requested){
  if(!frame)return 0;
  const min=Number.isFinite(frame.scroll_min)?Math.min(frame.scroll_min,frame.scroll):frame.scroll;
  const max=Number.isFinite(frame.scroll_max)?Math.max(frame.scroll_max,frame.scroll):frame.scroll;
  return Math.max(min,Math.min(max,requested));
}

export function decodeNavigation(words){
  const floats=new Float32Array(words.buffer,words.byteOffset,words.length),cells=[],hits=[],rows=[];
  let p=4;
  for(let i=0;i<words[1];i++,p+=7)cells.push({start:words[p],end:words[p+1],bounds:Array.from(floats.subarray(p+2,p+6)),rtl:!!words[p+6]});
  for(let i=0;i<words[2];i++,p+=6)hits.push({x:floats[p],y:floats[p+1],h:floats[p+2],offset:words[p+3],cluster:words[p+4],trailing:!!words[p+5]});
  for(let i=0;i<words[3];i++,p+=3)rows.push({y:floats[p],h:floats[p+1],rtl:!!words[p+2]});
  return{cells,hits,rows};
}
export function inspectableFrame(frame){
  let navigation,rects;
  Object.defineProperties(frame,{
    navigation:{get:()=>navigation??=decodeNavigation(frame.packed_navigation)},
    hits:{get:()=>frame.navigation.hits},
    rects:{get:()=>rects??=Array.from({length:frame.quad_count},(_,i)=>({bounds:Array.from(frame.instances.subarray(i*12,i*12+4)),uv:Array.from(frame.instances.subarray(i*12+4,i*12+8)),color:Array.from(frame.instances.subarray(i*12+8,i*12+12))}))}
  });
  return frame;
}

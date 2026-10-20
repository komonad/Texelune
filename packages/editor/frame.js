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

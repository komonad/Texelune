const channel=new MessageChannel(),waiters=[];
channel.port1.onmessage=()=>waiters.shift()?.();
export const yieldTask=()=>new Promise(resolve=>{waiters.push(resolve);channel.port2.postMessage(0);});
export async function prepareDocument(DocumentImport,bytes,onProgress=()=>{},cancelled=()=>false,code=false){
  const job=new DocumentImport(bytes,code);let complete=false,lastProgress=0;
  try{
    while(!complete){
      if(cancelled())throw new DOMException('Import cancelled','AbortError');
      const start=performance.now();
      do{complete=job.step(64*1024);}while(!complete&&performance.now()-start<1.5);
      const now=performance.now();if(complete||now-lastProgress>100){onProgress(job.bytes_done()/bytes);lastProgress=now;}
      if(!complete)await yieldTask();
    }
    return job;
  }catch(error){job.free();throw error;}
}

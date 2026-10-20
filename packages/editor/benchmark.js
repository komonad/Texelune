const channel=new MessageChannel(),queue=[];
channel.port1.onmessage=()=>queue.shift()?.();
export const yieldTask=()=>new Promise(resolve=>{queue.push(resolve);channel.port2.postMessage(0);});

export class BenchmarkRunner {
  constructor({renderer,worker,consume,draw,restore,onState}){Object.assign(this,{renderer,worker,consume,draw,restore,onState});this.active=null;this.serial=0;}
  cancel(){
    const job=this.active;if(!job)return;
    this.active=null;this.worker()?.postMessage({type:'benchmark_cancel',token:job.round?.token});
    job.round?.reject(new DOMException('Benchmark cancelled','AbortError'));
    this.onState({running:false,cancelled:true});
  }
  async handle(message){
    if(!message.type.startsWith('benchmark_'))return false;
    const job=this.active,round=job?.round;
    if(!round||round.token!==message.token)return true;
    if(message.type==='benchmark_frames'){
      try{
        let begin=performance.now();
        for(const frame of message.frames){
          if(this.active!==job)return true;
          const start=performance.now();this.consume(frame);round.mainMs+=performance.now()-start;
          round.workerMs+=frame.worker_ms;round.count++;round.quads=frame.quad_count;
          if(performance.now()-begin>1.5){await yieldTask();begin=performance.now();}
        }
        this.worker().postMessage({type:'benchmark_ack',token:round.token});
      }catch(error){round.reject(error);}
    }else if(message.type==='benchmark_done'){
      const renderer=this.renderer();
      if(!renderer){round.reject(new DOMException('Renderer unavailable','AbortError'));return true;}
      renderer.submitted().then(()=>round.resolve({elapsed:performance.now()-round.start,frames:round.count,workerMs:round.workerMs,mainMs:round.mainMs,quads:round.quads})).catch(round.reject);
    }else if(message.type==='benchmark_error')round.reject(new Error(message.message));
    return true;
  }
  async round(job,frames,index){
    if(this.active!==job)throw new DOMException('Benchmark cancelled','AbortError');
    if(job.mode==='warm')return new Promise((resolve,reject)=>{
      job.round={token:job.id*100+index,start:performance.now(),count:0,workerMs:0,mainMs:0,resolve,reject};
      this.worker().postMessage({type:'benchmark',token:job.round.token,frames});
    });
    const start=performance.now();let begin=start,mainMs=0,quads=0;
    for(let i=0;i<frames;i++){
      if(this.active!==job)throw new DOMException('Benchmark cancelled','AbortError');
      const cpu=performance.now();quads=this.draw();mainMs+=performance.now()-cpu;
      if(performance.now()-begin>1.5){await yieldTask();begin=performance.now();}
    }
    await this.renderer().submitted();
    return{elapsed:performance.now()-start,frames,workerMs:0,mainMs,quads};
  }
  async run(mode='warm'){
    if(!['warm','redraw'].includes(mode))throw new Error('Unknown benchmark mode');
    if(this.active)this.cancel();
    const job={id:++this.serial,mode};this.active=job;this.onState({running:true,mode,progress:0});
    try{
      await this.renderer().submitted();
      const samples=[];
      for(let i=0;i<6;i++){
        const sample=await this.round(job,64,i);if(this.active!==job)throw new DOMException('Benchmark cancelled','AbortError');
        if(i>0)samples.push(sample);
        this.onState({running:true,mode,progress:(i+1)/6});await yieldTask();
      }
      const frames=samples.reduce((n,s)=>n+s.frames,0),elapsed=samples.reduce((n,s)=>n+s.elapsed,0);
      if(frames!==320||!Number.isFinite(elapsed)||elapsed<=0)throw new Error('Incomplete benchmark');
      const report={mode,frames,rounds:samples.length,quads:samples.at(-1).quads,elapsed_ms:elapsed,mean_ms:elapsed/frames,fps:1000*frames/elapsed,worker_ms:samples.reduce((n,s)=>n+s.workerMs,0)/frames,main_ms:samples.reduce((n,s)=>n+s.mainMs,0)/frames,samples};
      this.onState({running:false,report});return report;
    }catch(error){if(error.name!=='AbortError')this.onState({running:false,error:String(error)});throw error;}
    finally{
      if(this.active===job)this.active=null;
      if(this.serial===job.id){this.worker()?.postMessage({type:'benchmark_end'});this.renderer()?.end_benchmark();this.restore();}
    }
  }
}

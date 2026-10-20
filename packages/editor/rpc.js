export class RpcError extends Error {
  constructor(error){super(error.message??'Language server error');this.code=error.code;}
}
export class RpcConnection {
  constructor(send,{timeout=10000,onNotification=()=>{},onRequest=async()=>null}={}){this.send=send;this.timeout=timeout;this.onNotification=onNotification;this.onRequest=onRequest;this.serial=0;this.pending=new Map();this.closed=false;}
  notify(method,params){if(!this.closed)this.send({jsonrpc:'2.0',method,params});}
  request(method,params,{signal,timeout=this.timeout}={}){
    if(this.closed)return Promise.reject(new Error('LSP connection closed'));
    if(signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const cancel=(error)=>{if(!this.pending.has(id))return;this.notify('$/cancelRequest',{id});finish();reject(error);};
      const abort=()=>cancel(new DOMException('Cancelled','AbortError'));
      const timer=setTimeout(()=>cancel(new DOMException(method+' timed out','TimeoutError')),timeout);
      const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);};
      this.pending.set(id,{resolve,reject,finish});signal?.addEventListener('abort',abort,{once:true});
      try{this.send({jsonrpc:'2.0',id,method,params});}catch(error){finish();reject(error);}
    });
  }
  async receive(message){
    if(this.closed)return;
    if(message.method){
      if('id'in message){try{const result=await this.onRequest(message.method,message.params);if(!this.closed)this.send({jsonrpc:'2.0',id:message.id,result});}catch(error){if(!this.closed)this.send({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:error.message}});}}
      else this.onNotification(message.method,message.params);
    }else{
      const pending=this.pending.get(message.id);if(!pending)return;pending.finish();
      if(message.error)pending.reject(new RpcError(message.error));else pending.resolve(message.result);
    }
  }
  close(){if(this.closed)return;this.closed=true;for(const entry of [...this.pending.values()]){entry.finish();entry.reject(new Error('LSP connection closed'));}}
}

export function decodeTokenData(data,legend){
  if(!Array.isArray(data)||data.length%5)throw new TypeError('Invalid semantic token data');
  let line=0,character=0;const result=[];
  for(let i=0;i<data.length;i+=5){
    const [deltaLine,deltaChar,length,type,mask]=data.slice(i,i+5);
    if(![deltaLine,deltaChar,length,type,mask].every(v=>Number.isInteger(v)&&v>=0))throw new TypeError('Invalid semantic token coordinate');
    line+=deltaLine;character=deltaLine?deltaChar:character+deltaChar;
    result.push({line,character,length,type:legend.tokenTypes[type]??'variable',modifiers:legend.tokenModifiers.filter((_,bit)=>bit<32&&(mask&(1<<bit))!==0)});
  }
  return result;
}

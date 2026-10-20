importScripts('./vendor/typescript/typescript.js');
const ready=Promise.all([
  import('./typescript-service.js'),
  fetch('./vendor/typescript/libraries.json',{signal:AbortSignal.timeout(15000)}).then(response=>{if(!response.ok)throw new Error('TypeScript libraries unavailable');return response.json();}),
]).then(([{TypeScriptService},libraries])=>new TypeScriptService(ts,libraries));
const cancelled=new Set(),pending=new Set();let sequence=Promise.resolve();
self.onmessage=({data:message})=>{
  if(message.method==='$/cancelRequest'){if(pending.has(message.params.id))cancelled.add(message.params.id);return;}
  if('id'in message)pending.add(message.id);
  sequence=sequence.then(async()=>{
    try{
      const service=await ready;
      if(cancelled.delete(message.id)){postMessage({jsonrpc:'2.0',id:message.id,error:{code:-32800,message:'Request cancelled'}});return;}
      const result=service.handle(message.method,message.params??{});
      if('id'in message)postMessage({jsonrpc:'2.0',id:message.id,result});
    }catch(error){if('id'in message)postMessage({jsonrpc:'2.0',id:message.id,error:{code:error.code??-32603,message:error.message}});}
    finally{pending.delete(message.id);cancelled.delete(message.id);}
  });
};

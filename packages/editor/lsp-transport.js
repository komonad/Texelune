export async function openTransport(options,onMessage,onClose,onError){
  if(options.workerUrl){
    const worker=new Worker(options.workerUrl,{type:options.workerType??'module'});
    worker.onmessage=event=>onMessage(event.data);
    worker.onerror=event=>{worker.terminate();onError(new Error(event.message||'Language worker failed'));};
    worker.onmessageerror=()=>{worker.terminate();onError(new Error('Invalid language worker message'));};
    return{send:message=>worker.postMessage(message),close:()=>worker.terminate()};
  }
  if(!options.url)throw new TypeError('LSP requires url or workerUrl');
  const socket=new WebSocket(options.url);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.close();reject(new DOMException('LSP connection timed out','TimeoutError'));},options.timeout??10000);
    socket.onopen=()=>{clearTimeout(timer);resolve();};
    socket.onerror=()=>{clearTimeout(timer);reject(new Error('Cannot connect to language server'));};
    socket.onclose=()=>{clearTimeout(timer);reject(new Error('Language server disconnected'));};
  });
  socket.onmessage=event=>{try{onMessage(JSON.parse(event.data));}catch(error){onError(error);}};
  socket.onclose=onClose;
  socket.onerror=()=>onError(new Error('Language server connection failed'));
  return{send:message=>socket.send(JSON.stringify(message)),close:()=>socket.close()};
}

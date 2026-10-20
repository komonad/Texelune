export const scalarLength=text=>[...text].length;

export function indentInsertion(context,strategy='keep'){
  const {before,after,leadingWhitespace,indentUnit}=context;
  if(strategy==='none')return{text:'\n'};
  const open=before.trimEnd().at(-1),close=after.trimStart()[0];
  const pair={'{':'}','[':']','(':')'};
  const expanded=strategy==='brackets'&&open in pair;
  const prefix='\n'+leadingWhitespace+(expanded?indentUnit:'');
  if(expanded&&pair[open]===close)return{text:prefix+'\n'+leadingWhitespace,caretOffset:scalarLength(prefix)};
  return{text:prefix};
}

export function plainContents(contents){
  if(typeof contents==='string')return contents;
  if(Array.isArray(contents))return contents.map(plainContents).join('\n\n');
  return contents?.value??'';
}

export function deadline(task,signal,ms=8000){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
    const finish=(handler,value)=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);handler(value);};
    const cancel=()=>finish(reject,new DOMException('Cancelled','AbortError'));
    const timer=setTimeout(()=>finish(reject,new DOMException('Provider timed out','TimeoutError')),ms);
    signal.addEventListener('abort',cancel,{once:true});
    Promise.resolve().then(()=>{if(signal.aborted)throw new DOMException('Cancelled','AbortError');return task();}).then(value=>finish(resolve,value),error=>finish(reject,error));
  });
}

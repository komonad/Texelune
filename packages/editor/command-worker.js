import {planLineEdit} from './commands.js';
const chunks=[];
self.onmessage=({data:message})=>{
  if(message.type==='chunk')chunks.push(message.text);
  else if(message.type==='finish'){
    try{postMessage({plan:planLineEdit(message.command,message.context,chunks.join(''))});}
    catch(error){postMessage({error:error.message});}
    finally{self.close();}
  }
};

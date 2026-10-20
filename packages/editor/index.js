import {template} from './template.js';
import {mountEditor} from './runtime.js';
export {themes,resolveTheme} from './theme.js';
export {defaultKeybindings,editorCommands} from './commands.js';

export class TexeluneEditorElement extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});}
  async initialize(options={}){
    if(this._mounting)throw new Error('Editor is already initialized');
    this._mounting=true;
    this._controller=new AbortController();
    const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./editor.css',import.meta.url).href;
    const loaded=new Promise((resolve,reject)=>{
      const signal=this._controller.signal;
      const finish=error=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);style.onload=style.onerror=null;if(error)reject(error);else resolve();};
      const cancel=()=>finish(new DOMException('Editor removed','AbortError'));
      const timer=setTimeout(()=>finish(new Error('Editor stylesheet timed out')),10000);
      signal.addEventListener('abort',cancel,{once:true});style.onload=()=>finish();style.onerror=()=>finish(new Error('Editor stylesheet unavailable'));
    });
    const content=document.createElement('template');content.innerHTML=template;
    this.shadowRoot.append(style,content.content.cloneNode(true));
    try{await loaded;if(this._controller.signal.aborted)throw new DOMException('Editor removed','AbortError');this.api=await mountEditor(this.shadowRoot,{...options,signal:this._controller.signal});this.dispatchEvent(new CustomEvent('ready',{detail:this.api}));return this.api;}
    catch(error){this._controller.abort();const alert=document.createElement('p');alert.setAttribute('role','alert');alert.textContent=error.message;this.shadowRoot.replaceChildren(alert);this.dispatchEvent(new CustomEvent('error',{detail:error}));throw error;}
  }
  disconnectedCallback(){this._controller?.abort();this.api?.destroy();}
}
if(!customElements.get('texelune-editor'))customElements.define('texelune-editor',TexeluneEditorElement);

export async function createEditor(container,options={}){
  const element=document.createElement('texelune-editor');container.append(element);
  const api=await element.initialize(options);
  return api;
}

export const defaultKeybindings=Object.freeze({
  'Mod+a':'selectAll','Mod+z':'undo','Mod+Shift+z':'redo','Ctrl+y':'redo',
  'Mod+c':'copy','Mod+x':'cut','Mod+v':'paste','Ctrl+Insert':'copy','Shift+Delete':'cut','Shift+Insert':'paste',
  'Mod+b':'bold','Mod+i':'italic','Mod+u':'underline',
  'Mod+l':'selectLine','Mod+Shift+k':'deleteLine','Alt+Up':'moveLineUp','Alt+Down':'moveLineDown',
  'Alt+Shift+Up':'duplicateLineUp','Alt+Shift+Down':'duplicateLineDown',
  'Tab':'insertTab','Shift+Tab':'outdent','Mod+]':'indent','Mod+[':'outdent',
  'Enter':'insertNewline','Mod+Enter':'insertLineBelow','Mod+Shift+Enter':'insertLineAbove',
  'Mod+Left':'cursorWordLeft','Mod+Right':'cursorWordRight','Mod+Shift+Left':'selectWordLeft','Mod+Shift+Right':'selectWordRight',
  'Mod+Backspace':'deleteWordLeft','Mod+Delete':'deleteWordRight',
  'Left':'cursorLeft','Right':'cursorRight','Up':'cursorUp','Down':'cursorDown',
  'Shift+Left':'selectLeft','Shift+Right':'selectRight','Shift+Up':'selectUp','Shift+Down':'selectDown',
  'Home':'cursorLineStart','End':'cursorLineEnd','Shift+Home':'selectLineStart','Shift+End':'selectLineEnd',
  'Mod+Home':'cursorDocumentStart','Mod+End':'cursorDocumentEnd','Mod+Shift+Home':'selectDocumentStart','Mod+Shift+End':'selectDocumentEnd',
  'Backspace':'deleteLeft','Delete':'deleteRight','Escape':'cancel','F12':'goToDefinition',
  'F8':'nextDiagnostic','Shift+F8':'previousDiagnostic',
  'Mod+Plus':'increaseFontSize','Mod+=':'increaseFontSize','Mod+Shift+Plus':'increaseFontSize','Mod+-':'decreaseFontSize','Mod+0':'resetFontSize',
  'Alt+p':'togglePerformance','Alt+Enter':'toggleFullscreen',
});
export const editorCommands=Object.freeze([...new Set(Object.values(defaultKeybindings))]);
const aliases={arrowleft:'left',arrowright:'right',arrowup:'up',arrowdown:'down',esc:'escape',return:'enter',' ':'space','+':'plus',control:'ctrl',cmd:'meta',command:'meta',option:'alt'};
const keyName=key=>aliases[key.toLowerCase()]??key.toLowerCase();
export function compileKeybindings(overrides={},mac=false){
  const normalize=shortcut=>{
    const parts=shortcut.split('+').map(part=>keyName(part.trim())),key=parts.pop();
    const modifiers=new Set(parts.map(part=>part==='mod'?(mac?'meta':'ctrl'):part));
    if(!key||parts.some(part=>!['mod','ctrl','meta','shift','alt'].includes(part)))throw new TypeError('Invalid shortcut: '+shortcut);
    return['ctrl','meta','alt','shift'].filter(mod=>modifiers.has(mod)).concat(key).join('+');
  };
  const map=new Map();
  for(const [shortcut,command]of [...Object.entries(defaultKeybindings),...Object.entries(overrides)]){
    if(command!==null&&typeof command!=='function'&&!editorCommands.includes(command))throw new TypeError('Unknown editor command: '+command);
    map.set(normalize(shortcut),command);
  }
  return event=>{
    if(event.isComposing||event.getModifierState?.('AltGraph')||['Dead','Process','Unidentified'].includes(event.key))return undefined;
    return map.get([event.ctrlKey?'ctrl':null,event.metaKey?'meta':null,event.altKey?'alt':null,event.shiftKey?'shift':null,keyName(event.key)].filter(Boolean).join('+'));
  };
}
export function scalarCount(text){let count=0;for(const _ of text)count++;return count;}
export const lineEnding=text=>text.match(/(?:\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029])$/u)?.[0]??'';

export function planLineEdit(command,context,text){
  const {start,end,selection,indentUnit='    ',newline='\n',split=0}=context;
  const count=scalarCount(text),local=position=>Math.max(0,Math.min(count,position-start));
  const selected={anchor:local(selection.anchor),head:local(selection.head)};
  if(command==='indent'||command==='outdent'){
    const lines=text.match(/[^\r\n\u000b\u000c\u0085\u2028\u2029]*(?:\r\n|[\r\n\u000b\u000c\u0085\u2028\u2029]|$)/gu)??[''];
    if(lines.length>1&&lines.at(-1)==='')lines.pop();
    let offset=0;const edits=[];
    const result=lines.map(line=>{
      const remove=command==='outdent'?(line.startsWith('\t')?1:(line.match(/^ */)[0].length?Math.min(line.match(/^ */)[0].length,scalarCount(indentUnit)):0)):0;
      const insert=command==='indent'?indentUnit:'';edits.push({offset,remove,insert:scalarCount(insert)});offset+=scalarCount(line);
      return insert+line.slice(remove);
    }).join('');
    const map=position=>{let shift=0;for(const edit of edits){if(position<edit.offset)break;if(position===edit.offset&&selection.anchor!==selection.head&&position===Math.min(selected.anchor,selected.head))break;shift+=edit.insert-Math.min(edit.remove,position-edit.offset);}return start+position+shift;};
    return{start,end,text:result,selection:{anchor:map(selected.anchor),head:map(selected.head)},unchanged:result===text};
  }
  if(command==='duplicateLineUp'||command==='duplicateLineDown'){
    const eol=lineEnding(text),up=command==='duplicateLineUp',insert=up?(eol?text:text+newline):(eol?text:newline+text);
    const position=up?start:end,base=up?start:end+(eol?0:scalarCount(newline));
    return{start:position,end:position,text:insert,selection:{anchor:base+selected.anchor,head:base+selected.head}};
  }
  if(command==='moveLineUp'||command==='moveLineDown'){
    let boundary=0,index=0;for(const char of text){if(boundary===split)break;boundary++;index+=char.length;}
    const first=text.slice(0,index),second=text.slice(index),eol=lineEnding(first),lastEnding=lineEnding(second);
    const result=lastEnding?second+first:second+eol+first.slice(0,first.length-eol.length);
    const up=command==='moveLineUp',base=up?start:start+scalarCount(second)+(lastEnding?0:scalarCount(eol));
    const oldBase=up?split:0,length=up?scalarCount(second):scalarCount(first)-(lastEnding?0:scalarCount(eol));
    const map=position=>base+Math.max(0,Math.min(length,position-oldBase));
    return{start,end,text:result,selection:{anchor:map(selected.anchor),head:map(selected.head)}};
  }
  throw new TypeError('Unsupported line command: '+command);
}

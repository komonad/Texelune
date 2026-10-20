const light={
  name:'Paper',
  colors:{background:'#ffffff',foreground:'#292e3b',caret:'#2959cc',selection:'#b8cff5',gutter:'#f8f9fc',lineNumber:'#9aa2b0',surface:'#f3f5f9',border:'#dce1eb',muted:'#73809a',scrollbar:'#b6c0d1',hintForeground:'#6c7488',hintBackground:'#edf0f7',diagnosticError:'#c44f62',diagnosticWarning:'#b57b22',diagnosticInformation:'#4674bc',diagnosticHint:'#8792a8',bracketBorder:'#6688bd',bracketBackground:'#6688bd18'},
  tokens:{keyword:'#8041ae',string:'#a35424',comment:{foreground:'#7c879b',italic:true},number:'#236bc5',type:'#20638b',struct:'#20638b',enum:'#20638b',interface:'#20638b',function:'#315eb6',method:'#315eb6',macro:'#9c4b89',variable:'#303b50',parameter:'#945427',property:'#945427',namespace:'#6852a7',operator:'#6e7890',lifetime:'#a94c70','variable.readonly':{foreground:'#995222',bold:true},'*.deprecated':{underline:true}},
};
export const themes={
  paper:light,
  dusk:{name:'Dusk',colors:{...light.colors,background:'#202331',foreground:'#d9def0',caret:'#a2baff',selection:'#414f78',gutter:'#1b1e29',lineNumber:'#737e9b',surface:'#292e40',border:'#3b435c',muted:'#a8b2cf',scrollbar:'#657191',hintForeground:'#a2adc9',hintBackground:'#30374e',diagnosticError:'#ee8c9f',diagnosticWarning:'#e1b46f',diagnosticInformation:'#a3bfff',diagnosticHint:'#94a1be',bracketBorder:'#a2baff',bracketBackground:'#a2baff20'},tokens:{...light.tokens,keyword:'#c5a1ff',string:'#edbe8b',comment:{foreground:'#828eac',italic:true},number:'#a4c6ff',type:'#8dd2ee',struct:'#8dd2ee',enum:'#8dd2ee',interface:'#8dd2ee',function:'#acbcff',method:'#acbcff',macro:'#e6a5db',variable:'#d9def0',parameter:'#edc39d',property:'#edc39d',namespace:'#c8b6ef',operator:'#b0bad6','variable.readonly':{foreground:'#edbe8b',bold:true}}},
};
export function rgba(value){
  if(typeof value!=='string'||!/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))throw new TypeError('Colors use #RRGGBB or #RRGGBBAA');
  const hex=value.slice(1);return [0,2,4,6].map((i)=>i<hex.length?parseInt(hex.slice(i,i+2),16)/255:1);
}
export function tokenStyle(theme,type,modifiers=[]){
  const style={};
  const merge=value=>{if(typeof value==='string')style.foreground=rgba(value);else if(value){if(value.foreground)style.foreground=rgba(value.foreground);if(value.background)style.background=rgba(value.background);for(const key of ['bold','italic','underline'])if(key in value)style[key]=!!value[key];}};
  const aliases={builtinType:'type',typeAlias:'type',typeParameter:'type',union:'struct',enumMember:'property',constParameter:'parameter',const:'variable',static:'variable',selfKeyword:'keyword',selfTypeKeyword:'type',boolean:'keyword',character:'string',escapeSequence:'string',formatSpecifier:'string',derive:'macro',attribute:'macro',builtinAttribute:'macro',procMacro:'macro',arithmetic:'operator',comparison:'operator',logical:'operator',bitwise:'operator',negation:'operator'};
  merge(theme.tokens[type]??theme.tokens[aliases[type]]);
  for(const modifier of modifiers){merge(theme.tokens['*.'+modifier]);merge(theme.tokens[type+'.'+modifier]);}
  return style;
}
export function resolveTheme(value='paper'){
  if(typeof value==='string'){if(!themes[value])throw new TypeError('Unknown theme: '+value);value=themes[value];}
  if(!value||typeof value!=='object')throw new TypeError('Invalid theme');
  const result={name:value.name??'Custom',colors:{...light.colors,...value.colors},tokens:{...light.tokens,...value.tokens}};
  for(const color of Object.values(result.colors))rgba(color);
  for(const key of Object.keys(result.tokens))tokenStyle(result,key);
  const c=result.colors;
  result.engine=Object.fromEntries(Object.entries({foreground:c.foreground,background:c.background,caret:c.caret,selection:c.selection,hint_foreground:c.hintForeground,hint_background:c.hintBackground,keyword:typeof result.tokens.keyword==='string'?result.tokens.keyword:result.tokens.keyword.foreground,string:typeof result.tokens.string==='string'?result.tokens.string:result.tokens.string.foreground,comment:typeof result.tokens.comment==='string'?result.tokens.comment:result.tokens.comment.foreground,number:typeof result.tokens.number==='string'?result.tokens.number:result.tokens.number.foreground,type_name:typeof result.tokens.type==='string'?result.tokens.type:result.tokens.type.foreground}).map(([k,v])=>[k,rgba(v??c.foreground)]));
  return result;
}
export function applyThemeCSS(host,theme){for(const [key,value]of Object.entries(theme.colors))host.style.setProperty('--texelune-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);}

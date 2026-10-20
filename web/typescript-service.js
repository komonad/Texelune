export const tokenTypes=['class','enum','interface','namespace','typeParameter','type','parameter','variable','enumMember','property','function','method','keyword','string','comment','number','operator'];
export const tokenModifiers=['declaration','static','async','readonly','defaultLibrary','local'];

export class TypeScriptService {
  constructor(ts,libraries){
    this.ts=ts;this.files=new Map();this.revision=0;this.libraries=new Map(Object.entries(libraries).map(([name,text])=>['/lib/'+name,text]));
    const read=name=>this.files.get(name)?.text??this.libraries.get(name);
    this.service=ts.createLanguageService({
      getCompilationSettings:()=>({target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,strict:true,noEmit:true}),
      getScriptFileNames:()=>[...this.files.keys()],
      getScriptVersion:name=>String(this.files.get(name)?.scriptVersion??0),
      getScriptSnapshot:name=>{const text=read(name);return text===undefined?undefined:ts.ScriptSnapshot.fromString(text);},
      getCurrentDirectory:()=>'/texelune-demo',getDefaultLibFileName:()=>'/lib/lib.es2022.full.d.ts',
      readFile:read,fileExists:name=>read(name)!==undefined,useCaseSensitiveFileNames:()=>true,
      getNewLine:()=>'\n',directoryExists:path=>path==='/lib'||path==='/texelune-demo',
    });
  }
  path(uri){return decodeURIComponent(new URL(uri).pathname);}
  document(uri){const file=this.files.get(this.path(uri));if(!file)throw new Error('Document is not open');return file;}
  update(uri,text,version){
    const lines=[0];for(let i=0;i<text.length;i++){const ch=text.charCodeAt(i);if(ch===13){if(text.charCodeAt(i+1)===10)i++;lines.push(i+1);}else if(ch===10)lines.push(i+1);}
    // Compiler cache versions span document sessions; LSP versions restart on open.
    this.files.set(this.path(uri),{uri,text,version,scriptVersion:++this.revision,lines});
  }
  offset(file,position){return Math.min(file.text.length,(file.lines[position.line]??file.text.length)+position.character);}
  position(file,offset){let low=0,high=file.lines.length;while(low+1<high){const mid=(low+high)>>>1;if(file.lines[mid]<=offset)low=mid;else high=mid;}return{line:low,character:offset-file.lines[low]};}
  range(file,start,length){return{start:this.position(file,start),end:this.position(file,start+length)};}
  tokens(file){
    const {ts}=this,path=this.path(file.uri),spans=[];
    const encoded=this.service.getEncodedSemanticClassifications(path,{start:0,length:file.text.length},ts.SemanticClassificationFormat.TwentyTwenty).spans;
    for(let i=0;i<encoded.length;i+=3)spans.push({start:encoded[i],length:encoded[i+1],type:(encoded[i+2]>>>8)-1,mask:encoded[i+2]&255});
    const c=ts.ClassificationType,lexicalTypes=new Map([[c.keyword,12],[c.stringLiteral,13],[c.regularExpressionLiteral,13],[c.comment,14],[c.numericLiteral,15],[c.bigintLiteral,15],[c.operator,16]]);
    const lexical=this.service.getEncodedSyntacticClassifications(path,{start:0,length:file.text.length}).spans;
    for(let i=0;i<lexical.length;i+=3){const type=lexicalTypes.get(lexical[i+2]);if(type!==undefined)spans.push({start:lexical[i],length:lexical[i+1],type,mask:0});}
    spans.sort((a,b)=>a.start-b.start);
    const data=[];let previousLine=0,previousCharacter=0,end=0;
    for(const span of spans){
      if(span.start<end||span.start>=file.text.length||span.length<=0||span.type<0||span.type>=tokenTypes.length)continue;
      end=Math.min(file.text.length,span.start+span.length);let start=span.start;
      while(start<end){
        const position=this.position(file,start),lineEnd=Math.min(end,file.lines[position.line+1]??file.text.length);
        let contentEnd=lineEnd;while(contentEnd>start&&/[\r\n]/.test(file.text[contentEnd-1]))contentEnd--;
        if(contentEnd>start){data.push(position.line-previousLine,position.line===previousLine?position.character-previousCharacter:position.character,contentEnd-start,span.type,span.mask);previousLine=position.line;previousCharacter=position.character;}
        start=lineEnd;
      }
    }
    return{data};
  }
  handle(method,params){
    const {ts}=this;
    if(method==='initialize')return{serverInfo:{name:'TypeScript Worker',version:ts.version},capabilities:{positionEncoding:'utf-16',textDocumentSync:2,hoverProvider:true,definitionProvider:true,completionProvider:{triggerCharacters:['.']},diagnosticProvider:{identifier:'typescript',interFileDependencies:true,workspaceDiagnostics:false},semanticTokensProvider:{legend:{tokenTypes,tokenModifiers},full:true}}};
    if(method==='initialized'||method==='$/cancelRequest')return null;
    if(method==='shutdown'){this.service.dispose();return null;}
    if(method==='textDocument/didOpen'){const d=params.textDocument;this.update(d.uri,d.text,d.version);return null;}
    if(method==='textDocument/didClose'){this.files.delete(this.path(params.textDocument.uri));return null;}
    if(method==='textDocument/didChange'){
      const {uri,version}=params.textDocument;let file=this.document(uri);
      if(version<=file.version)return null;
      for(const change of params.contentChanges){const start=change.range?this.offset(file,change.range.start):0,end=change.range?this.offset(file,change.range.end):file.text.length;this.update(uri,file.text.slice(0,start)+change.text+file.text.slice(end),version);file=this.document(uri);}
      return null;
    }
    const file=this.document(params.textDocument.uri),path=this.path(file.uri),offset=params.position?this.offset(file,params.position):0;
    if(method==='textDocument/semanticTokens/full')return this.tokens(file);
    if(method==='textDocument/diagnostic'){
      const diagnostics=[...this.service.getSyntacticDiagnostics(path),...this.service.getSemanticDiagnostics(path)];
      return{kind:'full',items:diagnostics.filter(d=>d.start!==undefined).slice(0,200).map(d=>({range:this.range(file,d.start,d.length??0),message:ts.flattenDiagnosticMessageText(d.messageText,'\n'),severity:d.category===ts.DiagnosticCategory.Error?1:2,code:d.code,source:'TypeScript'}))};
    }
    if(method==='textDocument/hover'){
      const info=this.service.getQuickInfoAtPosition(path,offset);if(!info)return null;
      return{contents:{kind:'plaintext',value:ts.displayPartsToString(info.displayParts)+'\n'+ts.displayPartsToString(info.documentation)},range:this.range(file,info.textSpan.start,info.textSpan.length)};
    }
    if(method==='textDocument/definition'){
      const result=this.service.getDefinitionAndBoundSpan(path,offset);if(!result)return [];
      return(result.definitions??[]).flatMap(definition=>{const target=this.files.get(definition.fileName);if(!target)return [];const range=this.range(target,definition.textSpan.start,definition.textSpan.length);return[{targetUri:target.uri,targetRange:range,targetSelectionRange:range,originSelectionRange:this.range(file,result.textSpan.start,result.textSpan.length)}];});
    }
    if(method==='textDocument/completion'){
      const result=this.service.getCompletionsAtPosition(path,offset,{includeCompletionsForModuleExports:false,includeCompletionsWithInsertText:true});
      let start=offset;while(start>0){let previous=start-1;const unit=file.text.charCodeAt(previous);if(unit>=0xdc00&&unit<=0xdfff&&previous>0)previous--;if(!/[\p{ID_Continue}$]/u.test(file.text.slice(previous,start)))break;start=previous;}
      const prefix=file.text.slice(start,offset);
      return{isIncomplete:false,items:(result?.entries??[]).filter(entry=>entry.name.normalize('NFC').toLowerCase().startsWith(prefix.normalize('NFC').toLowerCase())).slice(0,80).map(entry=>{
        const span=entry.replacementSpan??result.optionalReplacementSpan??{start,length:offset-start};
        return{label:entry.name,detail:entry.kind,textEdit:{range:this.range(file,span.start,span.length),newText:entry.insertText??entry.name}};
      })};
    }
    const error=new Error('Unsupported LSP method: '+method);error.code=-32601;throw error;
  }
}

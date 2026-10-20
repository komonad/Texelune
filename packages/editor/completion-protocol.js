export function normalizeCompletions(result,mirror,offset){
  const items=Array.isArray(result)?result:result?.items??[],defaults=result?.itemDefaults??{};
  const before=mirror.slice(Math.max(0,offset-513),offset),after=mirror.slice(offset,Math.min(mirror.length(),offset+513));
  const prefix=[...(before.match(/[\p{ID_Continue}$]+$/u)?.[0]??'')],suffix=[...(after.match(/^[\p{ID_Continue}$]+/u)?.[0]??'')];
  return items.slice(0,200).flatMap(item=>{
    if(typeof item?.label!=='string')return[];
    const edit=item.textEdit,range=edit?.range??edit?.replace??defaults.editRange?.replace??defaults.editRange;
    if(!range&&(prefix.length>512||suffix.length>512))return[];
    const start=range?mirror.offset_at(range.start.line,range.start.character):offset-prefix.length,end=range?mirror.offset_at(range.end.line,range.end.character):offset+suffix.length;
    return[{label:item.label,detail:item.detail??item.labelDetails?.description??'',text:edit?.newText??item.textEditText??item.insertText??item.label,start,end,filterText:item.filterText??item.label,sortText:item.sortText??item.label,preselect:!!item.preselect,kind:item.kind,additionalEdits:!!item.additionalTextEdits?.length,snippet:(item.insertTextFormat??defaults.insertTextFormat)===2}];
  });
}

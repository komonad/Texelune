export function canonicalUri(uri){
  const url=new URL(uri);
  if(url.protocol!=='file:')return url.href;
  const path=decodeURIComponent(url.pathname).replace(/^\/([A-Z]):/,(_,drive)=>'/'+drive.toLowerCase()+':');
  return 'file://'+url.host.toLowerCase()+path;
}
export const sameDocumentUri=(a,b)=>canonicalUri(a)===canonicalUri(b);
export function workspaceRelativeUri(uri,root){
  const prefix=canonicalUri(root).replace(/\/$/,'')+'/';
  const target=canonicalUri(uri);return target.startsWith(prefix)?target.slice(prefix.length):null;
}

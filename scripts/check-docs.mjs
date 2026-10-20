import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  if(['.git','target','node_modules','output','.playwright-cli','pkg'].includes(entry.name))return[];
  const path=join(directory,entry.name);return entry.isDirectory()?files(path):path.endsWith('.md')?[path]:[];
});}
const broken=[];
for(const path of files(root))for(const match of readFileSync(path,'utf8').matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)){
  const target=match[1].replace(/^<|>$/g,'').split('#')[0];
  if(!target||/^[a-z]+:/i.test(target))continue;
  if(!existsSync(resolve(dirname(path),decodeURIComponent(target))))broken.push(`${path}: ${target}`);
}
if(broken.length)throw new Error('Broken documentation links:\n'+broken.join('\n'));
console.log('Documentation links resolve.');

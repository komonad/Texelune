self.onmessage=({data:kind})=>{
  let text;
  if(kind==='large')text=Array.from({length:100000},(_,i)=>`let item_${i} = ${i}; // incremental viewport layout · 第 ${i} 行`).join('\n');
  else if(kind==='long')text='Long paragraph · العربية · עברית · 中文 · 👩‍💻 · '.repeat(10000);
  else text='Extended grapheme stress\n\n'+'a'+'\u0301'.repeat(20000)+'\n\nAfter one very long grapheme.\n👩‍💻 🇺🇳 क्षि é';
  postMessage(text);
};

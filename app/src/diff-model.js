export function parsePatch(patch = '') {
  const hunks=[];let hunk,oldLine=0,newLine=0;
  for(const line of patch.split('\n')) {
    const match=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/.exec(line);
    if(match){oldLine=Number(match[1]);newLine=Number(match[3]);hunk={header:line,oldStart:oldLine,newStart:newLine,rows:[]};hunks.push(hunk);continue;}
    if(!hunk)continue;
    const kind=line[0]==='+'?'add':line[0]==='-'?'del':line[0]===' '?'context':null;
    if(!kind)continue;
    hunk.rows.push({kind,text:line.slice(1),old:kind==='add'?null:oldLine++,new:kind==='del'?null:newLine++});
  }
  return hunks;
}
export function splitRows(rows) {
  const result=[];
  for(let i=0;i<rows.length;) {
    if(rows[i].kind==='context'){result.push({left:rows[i],right:rows[i]});i++;continue;}
    const removed=[],added=[];
    while(i<rows.length && rows[i].kind==='del')removed.push(rows[i++]);
    while(i<rows.length && rows[i].kind==='add')added.push(rows[i++]);
    for(let j=0;j<Math.max(removed.length,added.length);j++)result.push({left:removed[j],right:added[j]});
  }
  return result;
}

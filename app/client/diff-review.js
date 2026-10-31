import {parsePatch,splitRows} from '../src/diff-model.js';
import {createTwoFilesPatch} from 'diff';
import hljs from 'highlight.js/lib/common';
const dataNode=document.getElementById('diff-data');
if(dataNode) {
  const {files,head,base,path}=JSON.parse(dataNode.textContent),root=document.querySelector('.diff-workspace');
  const sourceCache=new Map(),expanded=new Map();
  let layout='unified',hideWhitespace=false,anchor;
  try { if(localStorage.getItem('diff-layout')==='split')layout='split'; } catch {}
  const draftKey=`review-drafts:${root.dataset.reviewKey}`;let drafts=[];
  try{drafts=JSON.parse(sessionStorage.getItem(draftKey)||'[]');if(!Array.isArray(drafts))drafts=[];}catch{}
  const $=selector=>root.querySelector(selector);
  const language=file=>({js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',rb:'ruby',rs:'rust',sh:'bash',yml:'yaml',yaml:'yaml',md:'markdown',json:'json',html:'xml',xml:'xml',css:'css',sql:'sql',go:'go',java:'java',c:'c',h:'c',cpp:'cpp'}[file.split('.').pop()]);
  function codeCell(text,file,kind='') {const td=document.createElement('td');td.className=`line-code ${kind}`;const code=document.createElement('code');const lang=language(file);if(lang&&hljs.getLanguage(lang))code.innerHTML=hljs.highlight(text,{language:lang,ignoreIllegals:true}).value;else code.textContent=text || ' ';td.append(code);return td;}
  function numberCell(number,side,index,kind='') {const td=document.createElement('td');td.className=`line-number ${kind}`;if(number!=null){const button=document.createElement('button');button.type='button';button.textContent=number;button.dataset.line=number;button.dataset.side=side;button.setAttribute('aria-label',`Comment on ${side==='LEFT'?'old':'new'} line ${number}`);td.append(button);}return td;}
  function renderFile(index,patch=files[index].patch) {
    const article=$(`#file-${index}`),table=article.querySelector('.code-diff');table.classList.toggle('split-diff',layout==='split');table.replaceChildren();
    for(const [hunkIndex,hunk] of parsePatch(patch).entries()) {
      const body=document.createElement('tbody'),header=document.createElement('tr'),cell=document.createElement('td');header.className='diff-hunk';cell.colSpan=4;
      const expand=document.createElement('button');expand.type='button';expand.className='expand-diff-context';expand.textContent='↕ Expand context';expand.dataset.hunk=hunkIndex;const title=document.createElement('code');title.textContent=hunk.header;cell.append(expand,title);header.append(cell);body.append(header);
      if(layout==='split')for(const pair of splitRows(hunk.rows)){const tr=document.createElement('tr');tr.className='diff-row';tr.append(numberCell(pair.left?.old,'LEFT',index,pair.left?.kind),codeCell(pair.left?.text||'',files[index].filename,pair.left?.kind),numberCell(pair.right?.new,'RIGHT',index,pair.right?.kind),codeCell(pair.right?.text||'',files[index].filename,pair.right?.kind));tr.id=`diff-${index}-${pair.right?.new!=null?'R':'L'}${pair.right?.new ?? pair.left?.old}`;body.append(tr);}
      else for(const row of hunk.rows){const tr=document.createElement('tr');tr.className=`diff-row ${row.kind}`;tr.id=`diff-${index}-${row.new==null?'L':'R'}${row.new ?? row.old}`;const sign=document.createElement('td');sign.className='diff-sign';sign.textContent=row.kind==='add'?'+':row.kind==='del'?'−':' ';tr.append(numberCell(row.old,'LEFT',index),numberCell(row.new,'RIGHT',index),sign,codeCell(row.text,files[index].filename));body.append(tr);}
      table.append(body);
    }
  }
  async function source(index,side){const id=`${index}:${side}`;if(!sourceCache.has(id)){const url=new URL(`${path}/source`,location.origin);for(const [key,value] of Object.entries({file:files[index].filename,side,head,base}))url.searchParams.set(key,value);sourceCache.set(id,fetch(url).then(async response=>{const value=await response.json();if(!response.ok)throw new Error(value.error||'Unable to load pinned source.');return value.content;}).catch(error=>{sourceCache.delete(id);throw error;}));}return sourceCache.get(id);}
  async function refresh(index,context=expanded.get(index)||3){const article=$(`#file-${index}`),status=article.querySelector('.diff-status');try{status.textContent='Loading pinned text…';const [before,after]=await Promise.all([source(index,'base'),source(index,'head')]);const patch=createTwoFilesPatch(files[index].previous_filename||files[index].filename,files[index].filename,before,after,'','',{context,ignoreWhitespace:hideWhitespace});files[index].displayPatch=patch;renderFile(index,patch);status.textContent=parsePatch(patch).length?'':'No text differences with the current whitespace filter.';}catch(error){status.textContent=error.message;}}
  function renderDrafts(){const holder=$('.pending-review-comments'),count=$('.draft-count');if(!holder)return;holder.replaceChildren();drafts.forEach((draft,index)=>{const node=document.createElement('article');node.className='draft-comment';const title=document.createElement('strong');title.textContent=`${draft.path}:${draft.start_line?draft.start_line+'–':''}${draft.line}`;const text=document.createElement('div');text.dataset.markdown=draft.body;const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remove draft';remove.onclick=()=>{drafts.splice(index,1);renderDrafts();};node.append(title,text,remove);holder.append(node);});count.textContent=String(drafts.length);$('.submit-diff-review [name=comments]').value=JSON.stringify(drafts);try{sessionStorage.setItem(draftKey,JSON.stringify(drafts));}catch{}}
  $('#diff-layout').value=layout;
  $('#diff-layout').onchange=event=>{layout=event.target.value;try{localStorage.setItem('diff-layout',layout);}catch{}files.forEach((file,i)=>renderFile(i,file.displayPatch||file.patch));};
  $('#diff-whitespace').onchange=async event=>{hideWhitespace=event.target.checked;for(let i=0;i<files.length;i++)await refresh(i);};
  $('#diff-wrap').onchange=event=>root.classList.toggle('wrap-diff',event.target.checked);
  $('#file-filter').oninput=event=>{const query=event.target.value.toLowerCase();root.querySelectorAll('[data-file-name]').forEach(node=>{node.hidden=!node.dataset.fileName.toLowerCase().includes(query);});};
  function collapse(article,closed){article.querySelector('.file-body').hidden=closed;const button=article.querySelector('.collapse-file');button.setAttribute('aria-expanded',String(!closed));button.textContent=closed?'›':'⌄';}
  $('.collapse-files').onclick=event=>{const close=event.target.textContent==='Collapse all';root.querySelectorAll('.file-diff').forEach(article=>collapse(article,close));event.target.textContent=close?'Expand all':'Collapse all';};
  root.addEventListener('click',event=>{
    const article=event.target.closest('.file-diff');if(!article)return;const index=Number(article.dataset.fileIndex);
    if(event.target.closest('.collapse-file'))collapse(article,!article.querySelector('.file-body').hidden);
    if(event.target.closest('.expand-diff-context')){expanded.set(index,(expanded.get(index)||3)+20);void refresh(index);}
    if(event.target.closest('.load-full-diff'))void refresh(index);
    const line=event.target.closest('[data-line][data-side]');
    if(line){const form=article.querySelector('.diff-comment-form');if(!form)return;const number=Number(line.dataset.line),side=line.dataset.side;form.elements.line.value=number;form.elements.side.value=side;form.elements.start_line.value='';if(event.shiftKey&&anchor?.index===index&&anchor.side===side){form.elements.start_line.value=Math.min(anchor.line,number);form.elements.line.value=Math.max(anchor.line,number);}else anchor={index,line:number,side};article.querySelector('.inline-comment').open=true;form.elements.body.focus();history.replaceState(null,'',`#diff-${index}-${side==='LEFT'?'L':'R'}${number}`);}
    if(event.target.closest('.stage-review-comment')){const form=article.querySelector('.diff-comment-form');if(!form.reportValidity())return;const draft={path:files[index].filename,line:Number(form.elements.line.value),side:form.elements.side.value,body:form.elements.body.value.trim()};if(form.elements.start_line.value){draft.start_line=Number(form.elements.start_line.value);draft.start_side=draft.side;}drafts.push(draft);form.elements.body.value='';article.querySelector('.inline-comment').open=false;renderDrafts();$('.diff-review-panel').open=true;}
  });
  const viewed=()=>{$('.viewed-progress').textContent=`${root.querySelectorAll('[data-viewed]:checked').length} / ${files.length} viewed`;};
  root.querySelectorAll('[data-viewed]').forEach(input=>input.addEventListener('change',()=>{collapse(input.closest('.file-diff'),input.checked);viewed();}));
  if(new URL(location.href).searchParams.has('reviewed')){drafts=[];try{sessionStorage.removeItem(draftKey);}catch{} history.replaceState(null,'',location.pathname+'?tab=files&saved=1'+location.hash);}
  files.forEach((file,index)=>renderFile(index));viewed();renderDrafts();
}

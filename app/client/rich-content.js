import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github.css';
import {safeScene} from '../src/diagram-data.js';
const markdown=new MarkdownIt({html:false,linkify:true,breaks:false});
window.EXCALIDRAW_ASSET_PATH='/vendor/excalidraw-assets/';
let mermaidPromise, drawingPromise, serial=Promise.resolve(), diagramId=0;
const drawings=()=>drawingPromise ||= import('./drawings.jsx');
const loadMermaid=()=>mermaidPromise ||= import('mermaid').then(({default:mermaid})=>{mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',maxTextSize:50_000,suppressErrorRendering:true,flowchart:{htmlLabels:false},fontFamily:'system-ui'});return mermaid;});
const button=(label,action)=>{const node=document.createElement('button');node.type='button';node.className='secondary';node.textContent=label;node.onclick=action;return node;};
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function cleanSvg(value){
  const fragment=DOMPurify.sanitize(value,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','a'],RETURN_DOM_FRAGMENT:true});
  for(const node of fragment.querySelectorAll('[href],[xlink\\:href]'))for(const attr of ['href','xlink:href']){
    const url=node.getAttribute(attr);if(url && !/^#[\w:.-]+$/.test(url) && !(node.tagName.toLowerCase()==='image' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)))node.removeAttribute(attr);
  }
  const container=document.createElement('div');container.append(fragment);return container.innerHTML;
}

async function diagram(code) {
  if(code.dataset.diagramProcessed)return;
  code.dataset.diagramProcessed='true';
  const source=code.textContent, kind=code.classList.contains('language-mermaid')?'mermaid':'excalidraw';
  const pre=code.closest('pre');if(!pre)return;
  const figure=document.createElement('figure');figure.className='rendered-diagram';figure.dataset.kind=kind;
  const tools=document.createElement('div');tools.className='diagram-tools';
  const canvas=document.createElement('div');canvas.className='diagram-preview';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${kind} diagram`);
  const status=document.createElement('p');status.className='small muted';status.setAttribute('role','status');
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Diagram source';details.append(summary);
  pre.replaceWith(figure);details.append(pre);figure.append(tools,canvas,status,details);
  try {
    if(source.length>1_000_000)throw new Error('Diagram is too large.');
    if(kind==='mermaid') {
      const mermaid=await loadMermaid();
      const {svg}=await mermaid.render(`review-diagram-${++diagramId}`,source);
      canvas.innerHTML=cleanSvg(svg);
      tools.append(button('Download SVG',()=>download(canvas.innerHTML,'diagram.svg','image/svg+xml')),
        button('Generate Excalidraw',async event=>{const target=event.currentTarget;target.disabled=true;status.textContent='Creating editable drawing…';try{const lib=await drawings();const scene=await lib.fromMermaid(source);lib.openDrawing(scene);status.textContent='Drawing generated locally. No AI credits used.';}catch(error){status.textContent=error.message;}finally{target.disabled=false;}}));
    } else {
      const scene=safeScene(JSON.parse(source));const lib=await drawings();
      canvas.innerHTML=cleanSvg((await lib.sceneSvg(scene)).outerHTML);
      tools.append(button('Open drawing',()=>lib.openDrawing(scene)),button('Download .excalidraw',()=>download(JSON.stringify(scene,null,2),'review.excalidraw','application/json')));
    }
  }catch(error){status.textContent=`Diagram could not render: ${error.message}`;details.open=true;}
}
export function enhance(root=document) {
  for(const code of root.querySelectorAll('pre > code.language-mermaid,pre > code.language-excalidraw')) {
    if(code.dataset.diagramQueued)continue;code.dataset.diagramQueued='true';
    serial=serial.then(()=>diagram(code)).catch(()=>{});
  }
}
export function render(value,node) {
  node.classList.add('markdown-body');node.innerHTML=DOMPurify.sanitize(markdown.render(value || ''));
  enhance(node);
}
const composers=new WeakSet();
function enhanceComposer(textarea) {
  if(composers.has(textarea)||textarea.closest('.drawing-dialog'))return;
  composers.add(textarea);
  const tools=document.createElement('div');tools.className='markdown-toolbar';
  const preview=document.createElement('div');preview.className='markdown-body composer-preview';preview.hidden=true;
  const insert=text=>{const value=textarea.value;const next=value.slice(0,textarea.selectionStart)+text+value.slice(textarea.selectionEnd);if(textarea.maxLength>0&&next.length>textarea.maxLength)throw new Error('The drawing is too large for this comment. Download it instead.');textarea.setRangeText(text,textarea.selectionStart,textarea.selectionEnd,'end');textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus();};
  const insertScene=scene=>insert('\n```excalidraw\n'+JSON.stringify(safeScene(scene))+'\n```\n');
  const status=document.createElement('span');status.className='composer-status';status.setAttribute('role','status');
  const write=button('Write',()=>{textarea.hidden=false;preview.hidden=true;textarea.focus();});
  const show=button('Preview',()=>{render(textarea.value,preview);textarea.hidden=true;preview.hidden=false;});
  const draw=button('Draw',async()=>{try{(await drawings()).openDrawing(null,{onInsert:insertScene});}catch(error){status.textContent=error.message;}});
  const file=document.createElement('input');file.type='file';file.accept='.excalidraw,application/json';file.hidden=true;
  file.onchange=async()=>{try{const selected=file.files[0];if(!selected)return;if(selected.size>1_000_000)throw new Error('Import drawings smaller than 1 MB.');insertScene(JSON.parse(await selected.text()));}catch(error){status.textContent=error.message;}finally{file.value='';}};
  tools.append(write,show,draw,button('Import drawing',()=>file.click()),button('Mermaid',()=>insert('\n```mermaid\nflowchart LR\n  A[Input] --> B[Process] --> C[Output]\n```\n')),file,status);
  textarea.before(tools);textarea.after(preview);
}
function initialize(root=document){
  root.querySelectorAll('textarea[name="body"],textarea[data-mentions],textarea#chat-question').forEach(enhanceComposer);
  root.querySelectorAll('[data-markdown]').forEach(node=>{if(node.dataset.renderedMarkdown===node.dataset.markdown)return;node.dataset.renderedMarkdown=node.dataset.markdown;render(node.dataset.markdown,node);});
  enhance(root);
}
window.richContent={render,enhance};initialize();
new MutationObserver(records=>{if(records.some(r=>r.addedNodes.length))initialize();}).observe(document.body,{childList:true,subtree:true});

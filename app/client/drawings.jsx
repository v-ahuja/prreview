import React from 'react';
import {createRoot} from 'react-dom/client';
import {Excalidraw,convertToExcalidrawElements,exportToSvg,restoreElements} from '@excalidraw/excalidraw';
import {parseMermaidToExcalidraw} from '@excalidraw/mermaid-to-excalidraw';
import '@excalidraw/excalidraw/index.css';
import {safeScene} from '../src/diagram-data.js';

export async function fromMermaid(source) {
  if (source.length > 50_000) throw new Error('Keep Mermaid diagrams below 50,000 characters.');
  if (!/^\s*(flowchart|graph)\s/im.test(source)) throw new Error('Excalidraw generation supports Mermaid flowcharts. Other Mermaid diagrams remain available as SVG.');
  const {elements,files} = await parseMermaidToExcalidraw(source,{fontSize:20});
  return safeScene({elements:convertToExcalidrawElements(elements),files});
}
export async function sceneSvg(value) {
  const scene=safeScene(value);
  return exportToSvg({elements:restoreElements(scene.elements,null),files:scene.files,appState:{...scene.appState,exportWithDarkMode:false,exportBackground:true},exportPadding:20,skipInliningFonts:true});
}
export function openDrawing(value, {onInsert}={}) {
  const scene=safeScene(value || {elements:[]});
  const dialog=document.createElement('dialog'); dialog.className='drawing-dialog';
  const header=document.createElement('div');header.className='drawing-header';
  const title=document.createElement('strong');title.textContent='Excalidraw';
  const help=document.createElement('span');help.textContent='Draw locally · Insert as Markdown or download';
  const canvas=document.createElement('div');canvas.className='drawing-canvas';
  const status=document.createElement('p');status.setAttribute('role','status');
  const close=document.createElement('button');close.type='button';close.textContent='Close';
  const download=document.createElement('button');download.type='button';download.textContent='Download .excalidraw';
  const insert=document.createElement('button');insert.type='button';insert.textContent='Insert drawing';insert.disabled=!onInsert;
  header.append(title,help,download,insert,close);dialog.append(header,canvas,status);document.body.append(dialog);dialog.showModal();
  let api;const root=createRoot(canvas);
  root.render(<Excalidraw initialData={{...scene,scrollToContent:true}} excalidrawAPI={value=>{api=value;}} theme="light" UIOptions={{canvasActions:{loadScene:false,saveToActiveFile:false,export:false},tools:{image:false}}} validateEmbeddable={()=>false} onLinkOpen={(_element,event)=>event.preventDefault()} />);
  const current=()=>safeScene({elements:api?.getSceneElements() || scene.elements,files:api?.getFiles() || scene.files,appState:api?.getAppState() || scene.appState});
  download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(current(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='review.excalidraw';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  insert.onclick=()=>{try{onInsert(current());dialog.close();}catch(error){status.textContent=error.message;}};
  close.onclick=()=>dialog.close();
  const onBackdrop=event=>{
    const rect=dialog.getBoundingClientRect();
    return event.target===dialog && (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom);
  };
  let startedOnBackdrop=false;
  dialog.addEventListener('pointerdown',event=>{startedOnBackdrop=onBackdrop(event);});
  dialog.addEventListener('click',event=>{
    // Releasing a drawing gesture outside the canvas must not close the editor.
    if(startedOnBackdrop && onBackdrop(event))dialog.close();
    startedOnBackdrop=false;
  });
  dialog.addEventListener('close',()=>{root.unmount();dialog.remove();},{once:true});
}

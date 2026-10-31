const types = new Set(['rectangle','diamond','ellipse','line','arrow','freedraw','text','image','frame']);
export function safeScene(value) {
  if (!value || !Array.isArray(value.elements) || value.elements.length > 1000) throw new Error('Use an Excalidraw scene with up to 1,000 elements.');
  if (JSON.stringify(value).length > 1_000_000) throw new Error('The drawing must be smaller than 1 MB.');
  const files = {};
  for (const [id, file] of Object.entries(value.files || {})) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(file.dataURL || '')) throw new Error('Drawings can embed PNG, JPEG, or WebP images only.');
    files[id] = {...file,id};
  }
  const elements = value.elements.map(element => {
    if (!types.has(element.type)) throw new Error('Embedded web content is not supported in drawings.');
    for (const key of ['x','y','width','height','angle']) if (element[key] != null && (!Number.isFinite(element[key]) || Math.abs(element[key]) > 1_000_000)) throw new Error('Invalid drawing coordinates.');
    return {...element,link:null,customData:undefined};
  });
  return {type:'excalidraw',version:2,source:'PR Walkthrough',elements,files,appState:{viewBackgroundColor:typeof value.appState?.viewBackgroundColor === 'string' ? value.appState.viewBackgroundColor : '#ffffff'}};
}

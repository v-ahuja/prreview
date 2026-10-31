import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

// Discovery reads the installed CLI's catalog; it never starts inference or
// includes account identity, credentials, or model instructions in the page.
export function modelCatalog(env=process.env) {
  const catalog={codex:[],claude:[],opencode:[]};
  try {
    const cache=JSON.parse(readFileSync(join(env.CODEX_HOME || join(homedir(),'.codex'),'models_cache.json'),'utf8'));
    catalog.codex=(cache.models || []).filter(model=>model.visibility==='list').map(model=>model.slug);
  } catch { /* CLI defaults and configured choices still work without a cache. */ }
  for(const id of (env.WALKTHROUGH_MODELS || '').split(',').map(value=>value.trim()).filter(Boolean)) {
    const match=/^(codex|claude)\/(.+)$/.exec(id);
    if(match)catalog[match[1]].push(match[2]);else catalog.opencode.push(id);
  }
  return catalog;
}

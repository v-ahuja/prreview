export const harnesses = ['codex', 'claude', 'opencode'];

export function modelSelection(input, cfg = {}) {
  const get = key => input instanceof URLSearchParams ? input.get(key) : input?.[key];
  const harness = get('harness') || cfg.runner || 'opencode';
  const model = String(get('model') ?? cfg.model ?? '').trim();
  if (!harnesses.includes(harness)) throw Object.assign(new Error('Choose Codex, Claude Code, or OpenCode.'), {status:400});
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]{0,159}$/.test(model)) throw Object.assign(new Error('Enter a valid model name.'), {status:400});
  if (harness === 'opencode' && !model.includes('/')) throw Object.assign(new Error('OpenCode needs a provider/model name.'), {status:400});
  const runner = harness === 'opencode' ? '' : harness;
  return {harness,runner,model,modelId:runner ? `${runner}/${model || 'default'}` : model};
}

export function generationPreferences(cfg = {}) {
  const harness=cfg.runner || 'opencode', model=cfg.model || '';
  const models={codex:[''],claude:['','fable','opus','sonnet'],opencode:[]};
  const add=(name,value)=>{if(models[name] && typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]{0,159}$/.test(value) && !models[name].includes(value))models[name].push(value);};
  for(const [name,values] of Object.entries(cfg.modelCatalog || {}))if(Array.isArray(values))for(const value of values)add(name,value);
  add(harness,model);
  for(const id of cfg.privateAllowedModels || []) {
    const match=/^(codex|claude)\/(.+)$/.exec(id);
    if(match){if(match[2]!=='default')add(match[1],match[2]);}else add('opencode',id);
  }
  return {harness,model,models,privateModels:[...(cfg.privateAllowedModels || [])]};
}

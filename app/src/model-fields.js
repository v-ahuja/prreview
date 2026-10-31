import {escapeHtml as h} from './secure.js';
import {generationPreferences} from './model-selection.js';

export function modelFields(preferences={}, {harnessLabel='Agent harness',modelLabel='Model',harnessName='harness',harnesses=['codex','claude','opencode']}={}) {
  const current=preferences.harness || 'codex';
  const catalog=preferences.models || generationPreferences({runner:current,model:preferences.model,privateAllowedModels:preferences.privateModels}).models;
  const choices=catalog[current] || [], selected=choices.includes(preferences.model) ? preferences.model : choices[0];
  const names={codex:'Codex CLI',claude:'Claude Code',opencode:'OpenCode'};
  return `<div class="model-fields" data-model-options="${h(JSON.stringify(catalog))}"><label>${h(harnessLabel)}<select name="${h(harnessName)}">${harnesses.map(value=>`<option value="${value}"${value===current?' selected':''}>${names[value]}</option>`).join('')}</select></label><label>${h(modelLabel)}<select name="model"${current==='opencode'?' required':''}>${choices.length?choices.map(value=>`<option value="${h(value)}"${value===selected?' selected':''}>${h(value || 'Harness default')}</option>`).join(''):'<option value="" disabled selected>No models configured</option>'}</select></label></div>`;
}

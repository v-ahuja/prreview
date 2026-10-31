function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`);
  return value;
}

export function parseModelJson(output) {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch { throw new Error('Model did not return valid JSON'); }
}

export function validateWalkthrough(data, diff, changedFiles, { assessments = false } = {}) {
  if (!data || typeof data !== 'object' || !data.anchor || !Array.isArray(data.slices) || !data.slices.length)
    throw new Error('Walkthrough must contain an anchor and slices');
  const files = new Set(changedFiles);
  const covered = new Set();
  const sections = diff.split(/(?=^diff --git )/m).filter(section => section.startsWith('diff --git '));
  const patchFor = file => sections.find(section => section.includes(`\n+++ b/${file}\n`) || section.includes(`\n--- a/${file}\n`) || section.startsWith(`diff --git a/${file} b/${file}\n`));
  const checkExcerpt = (part, label) => {
    for (const key of ['title', 'file', 'excerpt']) required(part[key], `${label}.${key}`);
    if (!files.has(part.file)) throw new Error(`${label} references unchanged file ${part.file}`);
    if (!patchFor(part.file)?.includes(part.excerpt)) throw new Error(`${label} excerpt is not an exact contiguous piece of that file's diff`);
    covered.add(part.file);
  };
  checkExcerpt(data.anchor, 'anchor');
  required(data.anchor.rule, 'anchor.rule');
  required(data.anchor.explanation, 'anchor.explanation');
  if (data.slices.length > 30) throw new Error('Too many slices');
  data.slices.forEach((slice, i) => {
    checkExcerpt(slice, `slices[${i}]`);
    for (const key of ['takeaway', 'explanation'])
      required(slice[key], `slices[${i}].${key}`);
    if (assessments || slice.risk || slice.importance) {
      for (const key of ['risk', 'importance']) {
        if (!['low', 'medium', 'high'].includes(slice[key])) throw new Error(`slices[${i}].${key} must be low, medium, or high`);
        required(slice[`${key}Reason`], `slices[${i}].${key}Reason`);
      }
    }
    if (assessments || slice.beats) {
      if (!Array.isArray(slice.beats) || !slice.beats.length || slice.beats.length > 8) throw new Error(`slices[${i}] needs 1–8 linked paragraphs`);
      for (const beat of slice.beats) {
        required(beat.title, 'beat.title'); required(beat.text, 'beat.text'); required(beat.excerpt, 'beat.excerpt');
        if (!patchFor(slice.file)?.includes(beat.excerpt)) throw new Error(`slices[${i}] paragraph excerpt is not an exact contiguous piece of that file's diff`);
      }
    }
  });
  if (!Array.isArray(data.omittedFiles)) throw new Error('Missing omittedFiles');
  for (const item of data.omittedFiles) {
    required(item.file, 'omittedFiles.file'); required(item.reason, 'omittedFiles.reason');
    if (!files.has(item.file)) throw new Error(`Omitted file not in diff: ${item.file}`);
    covered.add(item.file);
  }
  const missing = changedFiles.filter(file => !covered.has(file));
  if (missing.length) throw new Error(`Unaccounted changed files: ${missing.join(', ')}`);
  return data;
}

export function parseOpenCodeEvents(output) {
  const parts = [];
  const usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let sawUsage = false;
  for (const line of output.split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'error') throw new Error('OpenCode reported a model error');
    if (event.type === 'text' && typeof event.part?.text === 'string') parts.push(event.part.text);
    if (event.type === 'message.part' && event.part?.type === 'text') parts.push(event.part.text);
    if (event.type === 'step_finish' && event.part?.tokens) {
      sawUsage = true;
      const tokens = event.part.tokens;
      usage.input += tokens.input || 0;
      usage.output += tokens.output || 0;
      usage.reasoning += tokens.reasoning || 0;
      usage.cacheRead += tokens.cache?.read || 0;
      usage.cacheWrite += tokens.cache?.write || 0;
    }
  }
  if (!parts.length) throw new Error('OpenCode produced no final text');
  return { text: parts.at(-1), usage: sawUsage ? usage : null };
}

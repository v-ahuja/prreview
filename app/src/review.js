const bad = message => Object.assign(new Error(message), { status: 400 });

export function resolveScope(params, pull, commits = [], lastReview = null) {
  const scope = params.get('scope') || 'full';
  const full = { scope, startSha: '', endSha: '' };
  if (scope === 'full') return full;
  if (scope === 'since') {
    if (!lastReview || !/^[a-f0-9]{40}$/.test(lastReview)) throw bad('Complete a walkthrough first to review changes since your last review.');
    if (lastReview === pull.head.sha) throw bad('There are no new commits since your last review.');
    return { scope, startSha: lastReview, endSha: pull.head.sha };
  }
  if (scope !== 'range') throw bad('Choose a valid review scope.');
  const from = commits.findIndex(c => c.sha === params.get('from'));
  const to = commits.findIndex(c => c.sha === params.get('to'));
  if (from < 0 || to < from) throw bad('Choose a contiguous commit range in chronological order.');
  const startSha = commits[from].parents?.[0]?.sha;
  if (!/^[a-f0-9]{40}$/.test(startSha || '')) throw bad('The first selected commit has no available parent.');
  return { scope, startSha, endSha: commits[to].sha };
}

export function scopeLabel(run) {
  const scope = run.scope || 'full';
  if (scope === 'full') return 'Entire pull request';
  return `${scope === 'since' ? 'Since last review' : 'Selected commits'} · ${(run.startSha || run.start_sha).slice(0, 7)} → ${(run.endSha || run.end_sha).slice(0, 7)}`;
}

export function locateExcerpt(diff, file, excerpt) {
  const patch = diff.split(/(?=^diff --git )/m).find(section => section.includes(`\n+++ b/${file}\n`) || section.includes(`\n--- a/${file}\n`));
  if (!patch) return null;
  const start = patch.indexOf(excerpt);
  if (start < 0) return null;
  let oldLine = 0, newLine = 0, side = 'head';
  for (const line of patch.slice(0, start).split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); }
    else if (line.startsWith('-') && !line.startsWith('---')) oldLine++;
    else if (line.startsWith('+') && !line.startsWith('+++')) newLine++;
    else if (line.startsWith(' ')) { oldLine++; newLine++; }
  }
  if (patch.includes('\n+++ /dev/null\n') || excerpt.split('\n').every(line => line.startsWith('-'))) side = 'base';
  const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(excerpt);
  if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); }
  return { side, line: Math.max(1, side === 'base' ? oldLine : newLine) };
}

// Evidence metadata is supplied by the server, never trusted from model output.
export function enrichWalkthrough(data, evidence) {
  const result = structuredClone(data);
  result.schemaVersion = 2;
  for (const part of [result.anchor, ...result.slices]) {
    part.location = locateExcerpt(evidence.diff, part.file, part.excerpt);
    for (const beat of part.beats || []) beat.location = locateExcerpt(evidence.diff, part.file, beat.excerpt);
  }
  result.evidence = { baseSha: evidence.manifest.mergeBase, headSha: evidence.manifest.headSha,
    files: evidence.changedFiles, commits: evidence.manifest.commits,
    sourceFiles: Object.fromEntries(evidence.changedFiles.map(file => {
      const patch = evidence.diff.split(/(?=^diff --git )/m).find(section => section.includes(`\n+++ b/${file}\n`) || section.includes(`\n--- a/${file}\n`)) || '';
      return [file, { base: /^--- a\/(.+)$/m.exec(patch)?.[1] || null, head: /^\+\+\+ b\/(.+)$/m.exec(patch)?.[1] || null }];
    })) };
  return result;
}

export function chatContext(result, input) {
  const step = Number(input.step);
  if (!Number.isInteger(step) || step < 0 || step > result.slices.length) throw bad('Unknown slice');
  const part = step === 0 ? result.anchor : result.slices[step - 1];
  const question = String(input.question || '').trim();
  if (!question || question.length > 6000) throw bad('Ask a question of up to 6,000 characters.');
  const selection = String(input.selection || '').slice(0, 16000);
  const history = Array.isArray(input.history) ? input.history.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.text).slice(0, 6000) })) : [];
  return { question, selection, slice: part, history, evidence: result.evidence || null };
}

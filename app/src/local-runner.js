import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, prepareEvidence, walkthroughPrompt } from './generate.js';
import { parseModelJson, validateWalkthrough } from './validate.js';
import { enrichWalkthrough } from './review.js';

export const runners = new Set(['claude', 'codex']);

const string = { type: 'string' };
const assessment = { type: 'string', enum: ['low', 'medium', 'high'] };
export const walkthroughSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['anchor', 'slices', 'omittedFiles'],
  properties: {
    anchor: {
      type: 'object', additionalProperties: false,
      required: ['title', 'rule', 'explanation', 'file', 'excerpt'],
      properties: { title: string, rule: string, explanation: string, file: string, excerpt: string }
    },
    slices: {
      type: 'array', minItems: 1, maxItems: 30,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'navLabel', 'takeaway', 'explanation', 'file', 'excerpt', 'next', 'risk', 'riskReason', 'importance', 'importanceReason', 'beats'],
        properties: { title: string, navLabel: string, takeaway: string, explanation: string, file: string, excerpt: string, next: string,
          risk: assessment, riskReason: string, importance: assessment, importanceReason: string,
          beats: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false,
            required: ['title', 'text', 'excerpt'], properties: { title: string, text: string, excerpt: string } } } }
      }
    },
    omittedFiles: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'reason'], properties: { file: string, reason: string }
      }
    }
  }
};

export function runnerEnvironment(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (/^(GH_|GITHUB_|DATABASE_URL$|POSTGRES_|PGPASSWORD$|SESSION_ENCRYPTION_KEY$)/.test(key)) delete clean[key];
  }
  return clean;
}

export async function runLocalModel({ agent, runner, model = '', prompt = walkthroughPrompt, schema: outputSchema = walkthroughSchema, attachments = [], execute = command }) {
  if (!runners.has(runner)) throw new Error('Choose Claude or Codex');
  const schema = join(agent, 'walkthrough-schema.json');
  await writeFile(schema, JSON.stringify(outputSchema));
  const env = runnerEnvironment();
  if (runner === 'claude') {
    const args = ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(outputSchema),
      '--tools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk', '--no-session-persistence'];
    if (model) args.push('--model', model);
    const output = await execute('claude', args, { cwd: agent, env, timeout: 900_000, maxOutput: 8_000_000 });
    const response = JSON.parse(output);
    if (response.is_error || response.subtype && response.subtype !== 'success') throw new Error('Claude did not complete the walkthrough');
    if (!response.structured_output) throw new Error('Claude returned no structured walkthrough');
    return response.structured_output;
  }
  const resultFile = join(agent, 'walkthrough-result.json');
  const args = ['exec', '--sandbox', 'read-only', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--output-schema', schema,
    '--output-last-message', resultFile, '-C', agent];
  if (model) args.push('--model', model);
  for (const file of attachments) args.push('--image', file);
  args.push(prompt);
  await execute('codex', args, { cwd: agent, env, timeout: 900_000, maxOutput: 8_000_000 });
  return parseModelJson(await readFile(resultFile, 'utf8'));
}

export async function generateVerifiedWalkthrough({ agent, runner, model = '', diff, changedFiles, runModel = runLocalModel, assessments = false }) {
  let prompt = walkthroughPrompt;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await runModel({ agent, runner, model, prompt });
    try { return validateWalkthrough(result, diff, changedFiles, { assessments }); }
    catch (error) {
      if (attempt === 2) throw new Error(`Walkthrough still failed validation after 3 attempts: ${error.message}`);
      await writeFile(join(agent, 'previous-result.json'), JSON.stringify(result, null, 2));
      prompt = `${walkthroughPrompt}\n\nA previous attempt is saved in previous-result.json. It failed validation: ${error.message}. Read that file and complete.diff. Correct the invalid field using an exact contiguous excerpt copied from the named file's patch in complete.diff. Check every anchor and slice excerpt against the diff before returning the full corrected JSON. Preserve the explanations and slice order when they are accurate.`;
    }
  }
}

export async function generateLocalWalkthrough(input) {
  const root = await mkdtemp(join(tmpdir(), 'pr-walkthrough-local-'));
  try {
    const evidence = await prepareEvidence({ ...input, root });
    const result = await generateVerifiedWalkthrough({ agent: evidence.agent, runner: input.runner, model: input.model,
      diff: evidence.diff, changedFiles: evidence.changedFiles, assessments: true });
    return enrichWalkthrough(result, evidence);
  } finally { await rm(root, { recursive: true, force: true }); }
}

#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ensureGhLogin } from '../src/local-auth.js';
import { createLocalServer, parsePrUrl } from '../src/local-server.js';
import { runners } from '../src/local-runner.js';

function usage() {
  return `PR Walkthrough (local)

Usage:
  pr-walkthrough open <github-pr-url> [--runner codex|claude] [--model ID] [--no-browser]
  pr-walkthrough serve [--no-browser]

Requires GitHub CLI (gh) and an installed, signed-in Codex or Claude CLI.
The command starts a local server and keeps it running until you press Ctrl+C.`;
}

export function parseArgs(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) return { help: true };
  const command = args[0];
  if (!['open', 'serve'].includes(command)) throw new Error(usage());
  let pr = null; let runner = 'codex'; let model = ''; let browser = true;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--runner') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for --runner');
      runner = args[++i];
    } else if (arg === '--model') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for --model');
      model = args[++i];
    }
    else if (arg === '--no-browser') browser = false;
    else if (!arg.startsWith('-') && !pr && command === 'open') pr = arg;
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  if (command === 'open' && !pr) throw new Error(`Missing PR URL.\n\n${usage()}`);
  if (!runners.has(runner)) throw new Error('Runner must be codex or claude');
  if (!/^[A-Za-z0-9._:/-]{0,100}$/.test(model || '')) throw new Error('Invalid model name');
  return { command, pr: pr ? parsePrUrl(pr) : null, runner, model, browser };
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', error => console.warn(`Could not open the browser: ${error.message}`));
  child.unref();
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) { console.log(usage()); return; }
  await ensureGhLogin();
  const server = createLocalServer();
  const rawPort = process.env.PORT || '0';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = new URL(`http://127.0.0.1:${server.address().port}/`);
  if (options.pr) {
    url.searchParams.set('pr', options.pr.canonical);
    url.searchParams.set('runner', options.runner);
    if (options.model) url.searchParams.set('model', options.model);
  }
  console.log(`PR Walkthrough is running at ${url}`);
  if (options.browser) openBrowser(url.toString());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

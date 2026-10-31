import { spawn } from 'node:child_process';
import { command } from './generate.js';

export async function ghToken(execute = command) {
  try {
    const token = (await execute('gh', ['auth', 'token', '-h', 'github.com'], { timeout: 20_000 })).trim();
    if (!token) throw new Error('GitHub CLI returned no token');
    return token;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('GitHub CLI is required. Install gh, then run gh auth login.');
    throw new Error('GitHub is not signed in. Run gh auth login and try again.');
  }
}

export function interactiveGhLogin() {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['auth', 'login', '-h', 'github.com', '--web'], { stdio: 'inherit' });
    child.on('error', error => reject(error.code === 'ENOENT'
      ? new Error('GitHub CLI is required. Install it from https://cli.github.com/') : error));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('GitHub sign-in was not completed')));
  });
}

export async function ensureGhLogin({ token = ghToken, login = interactiveGhLogin } = {}) {
  try { return await token(); }
  catch {
    await login();
    return token();
  }
}

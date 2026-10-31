import {modelCatalog} from './model-catalog.js';

export function config(env = process.env) {
  const required = ['DATABASE_URL', 'PUBLIC_ORIGIN', 'GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET', 'GITHUB_PRIVATE_KEY_BASE64', 'GITHUB_WEBHOOK_SECRET', 'SESSION_ENCRYPTION_KEY'];
  for (const key of required) if (!env[key]) throw new Error(`Missing ${key}`);
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/') throw new Error('PUBLIC_ORIGIN must be an origin');
  const encryptionKey = Buffer.from(env.SESSION_ENCRYPTION_KEY, 'base64');
  if (encryptionKey.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must be 32 base64-encoded bytes');
  const runner = env.WALKTHROUGH_RUNNER || '';
  if (runner && !['codex', 'claude'].includes(runner)) throw new Error('WALKTHROUGH_RUNNER must be codex or claude');
  const model = env.WALKTHROUGH_MODEL || '';
  return {
    databaseUrl: env.DATABASE_URL,
    origin: origin.origin,
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    appId: env.GITHUB_APP_ID,
    appSlug: env.GITHUB_APP_SLUG,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    privateKey: Buffer.from(env.GITHUB_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    encryptionKey,
    runner,
    model,
    modelCatalog: modelCatalog(env),
    modelId: runner ? `${runner}/${model || 'default'}` : model,
    generationEnabled: (env.GENERATION_ENABLED ?? 'true') === 'true',
    automaticGenerationEnabled: env.AUTOMATIC_GENERATION_ENABLED === 'true',
    publishWalkthroughLinks: env.PUBLISH_WALKTHROUGH_LINKS === 'true',
    allowedLogins: new Set((env.ALLOWED_GITHUB_LOGINS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)),
    privateAllowedModels: new Set((env.PRIVATE_ALLOWED_MODELS || '').split(',').map(x => x.trim()).filter(Boolean))
  };
}

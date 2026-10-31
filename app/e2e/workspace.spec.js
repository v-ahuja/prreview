import { test, expect } from '@playwright/test';
const pr = '/p/example/reading-list/42';

test('inbox filters PRs and opens the diff before an existing walkthrough', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pr-row')).toHaveCount(6);
  await page.locator('.side-link').filter({ hasText: 'Review requested' }).click();
  await expect(page.locator('.pr-row')).toHaveCount(2);
  await page.getByRole('link').filter({ hasText: 'Keep saved articles in sync' }).click();
  await expect(page.locator('.diff-workspace')).toBeVisible();
  await page.locator('.pr-tabs').getByRole('link', {name:/Walkthrough/}).click();
  await expect(page.locator('.walkthrough-step:visible h2')).toHaveText('Local saves now enter a sync queue');
  await page.locator('.step-next').click();
  await expect(page.locator('.walkthrough-step:visible h2')).toHaveText('Queue each saved article');
  await page.reload();
  await expect(page.locator('.walkthrough-step:visible h2')).toHaveText('Queue each saved article');
});

test('linked paragraphs, instant splitting, keyboard navigation and risk focus', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(pr + '?tab=walkthrough');
  await page.locator('[data-target-step="2"]').click();
  await page.locator('.split-slice').click();
  await expect(page.locator('.walkthrough-step:visible .explanation-beat:visible')).toHaveCount(1);
  await expect(page.locator('.linked-diff')).toContainText('const pending');
  await page.locator('.step-next').click();
  await expect(page.locator('.linked-diff')).toContainText('transport.post');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.linked-diff')).toContainText('queue.splice');
  await page.locator('.split-slice').click();
  await expect(page.locator('.walkthrough-step:visible .explanation-beat:visible')).toHaveCount(3);
  await page.locator('[data-target-step="0"]').click();
  await page.getByLabel('Focus on medium & high risk').check();
  await page.locator('.step-next').click();
  await expect(page.locator('.walkthrough-step:visible h2')).toHaveText('Send the pending batch');
  expect(errors).toEqual([]);
});

test('source context and Monaco keep editable per-file scratch models', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.stack || error.message));
  await page.goto(pr + '?tab=walkthrough');
  await page.locator('[data-target-step="2"]').click();
  await page.locator('.expand-context').click();
  await expect(page.locator('.linked-diff')).toContainText('export async function flushQueue');
  await page.locator('.toggle-editor').click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('.editor-error')).toBeEmpty();
  await page.waitForFunction(() => window.monaco?.editor.getModels().some(m=>m.getValue().includes('flushQueue')));
  await page.evaluate(() => { const m = window.monaco.editor.getModels().find(m=>m.getValue().includes('flushQueue')); m.setValue(m.getValue() + '\n// scratch change'); });
  await page.locator('.editor-files').selectOption('src/merge.js');
  await expect(page.locator('.view-lines')).toContainText('mergeArticles');
  await page.locator('.editor-files').selectOption('src/sync.js');
  await expect(page.locator('.view-lines')).toContainText('scratch change');
  await page.locator('.toggle-editor').click();
  await expect(page.locator('.editor-shell')).toBeHidden();
  expect(errors).toEqual([]);
});

test('chat takes selected context and clearly labels demo answers', async ({ page }) => {
  await page.goto(pr + '?tab=walkthrough');
  await page.locator('[data-target-step="2"]').click();
  await page.locator('.linked-diff code').evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); });
  await page.locator('.select-context').click();
  await expect(page.locator('.selection-preview')).toContainText('pending');
  await page.getByLabel('Question about this change').fill('What happens if the request fails?');
  await page.getByRole('button', { name: 'Send ↑' }).click();
  await expect(page.locator('.chat-message.assistant')).toContainText('Demo response');
  await expect(page.locator('.chat-message.assistant')).toContainText('selected text was attached');
});

test('commit ranges and archived reviews stay navigable', async ({ page }) => {
  await page.goto(pr);
  await page.getByText('Generate a walkthrough', { exact: true }).click();
  await page.getByLabel('Review scope').selectOption('range');
  await page.getByLabel('First commit (inclusive)').selectOption('2'.repeat(40));
  await page.getByRole('button', { name: 'Generate once for everyone' }).click();
  await expect(page.locator('.review-version-bar')).toContainText('Selected commits');
  await expect(page.locator('.checkpoint-button')).toHaveCount(3);
  await page.getByText('Review history', { exact: false }).first().click();
  await page.locator('.history-menu a').filter({ hasText: 'Archived' }).first().click();
  await expect(page.locator('.notice')).toContainText('Archived review');
});

test('mentions, review requests, comments and approvals round trip through the PR UI', async ({ page }) => {
  await page.goto(pr + '?tab=conversation');
  await page.getByLabel('Comment', { exact: true }).fill('@sa');
  await expect(page.locator('.mention-menu:visible')).toContainText('@sam');
  await page.getByLabel('Comment', { exact: true }).press('Enter');
  await expect(page.getByLabel('Comment', { exact: true })).toHaveValue('@sam ');
  await page.getByLabel('Comment', { exact: true }).fill('@sam The queue behavior looks clear.');
  await page.getByRole('button', { name: 'Comment on GitHub', exact: true }).click();
  await expect(page.locator('.timeline')).toContainText('@sam The queue behavior looks clear.');
  await page.getByLabel('Request reviewers').fill('jordan');
  await page.getByRole('button', { name: 'Request review', exact: true }).click();
  await expect(page.locator('.pr-metadata')).toContainText('@jordan');
  await page.getByLabel('Review decision').selectOption('APPROVE');
  await page.getByRole('button', { name: 'Submit review' }).click();
  await page.goto(pr + '?tab=conversation');
  await expect(page.locator('.timeline')).toContainText('approved');
});

test('mobile walkthrough and inbox fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto(pr + '?tab=walkthrough');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('.step-next').click();
  await expect(page.locator('.walkthrough-step:visible h2')).toHaveText('Queue each saved article');
});

test('changed-line comments use source line numbers and preserve the review thread', async ({ page }) => {
  await page.goto(pr + '?tab=files');
  const file = page.locator('#file-1');
  await file.locator('[data-line="4"][data-side="RIGHT"]').click();
  await expect(file.locator('[name=line]')).toHaveValue('4');
  await expect(file.locator('[name=side]')).toHaveValue('RIGHT');
  await file.locator('textarea').fill('@sam Is retry idempotent?');
  await file.getByRole('button', { name: 'Comment on GitHub' }).click();
  await expect(page.locator('.timeline')).toContainText('src/sync.js:4');
  await expect(page.locator('.timeline')).toContainText('@sam Is retry idempotent?');
});

test('diff controls expand pinned context, split lines, filter files, and save a ranged review', async ({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pr);
  await expect(page.locator('.pr-tabs [aria-current=page]')).toContainText('Files changed');
  await page.getByLabel('Diff view').selectOption('split');
  await expect(page.locator('#file-0 .code-diff')).toHaveClass(/split-diff/);
  await page.locator('#file-0 .expand-diff-context').first().click();
  await expect(page.locator('#file-0 .diff-status')).toBeEmpty();
  await expect(page.locator('#file-0 .code-diff')).toContainText('scheduleSync');
  await page.getByLabel('Hide whitespace').check();
  await expect(page.locator('#file-2 .diff-status')).toBeEmpty();
  await page.getByLabel('Filter files').fill('sync');
  await expect(page.locator('.file-diff:visible')).toHaveCount(1);
  await page.getByLabel('Filter files').fill('');
  const file=page.locator('#file-1');
  await file.locator('[data-line="3"][data-side="RIGHT"]').click();
  await file.locator('[data-line="4"][data-side="RIGHT"]').click({modifiers:['Shift']});
  await expect(file.locator('[name=start_line]')).toHaveValue('3');
  await file.locator('.diff-comment-form textarea').fill('**Range review**: preserve this batch.');
  await file.getByRole('button',{name:'Add to review',exact:true}).click();
  await expect(page.locator('.draft-comment strong').last()).toHaveText('Range review');
  await page.reload();
  await page.locator('.diff-review-panel>summary').click();
  await expect(page.locator('.draft-count')).toHaveText('1');
  await page.getByRole('button',{name:'Submit review'}).click();
  await expect(page.locator('.draft-count')).toHaveText('0');
  await expect(page.locator('#file-1 .diff-thread').last()).toContainText('preserve this batch.');
  await page.setViewportSize({width:774,height:900});
  const bounds=await page.locator('#file-0 .diff-scroll').evaluate(node=>({available:node.clientWidth,table:node.querySelector('table').getBoundingClientRect().width}));
  expect(bounds.table).toBeLessThanOrEqual(bounds.available+1);
  expect(await page.locator('#file-0 .line-number').first().evaluate(node=>node.getBoundingClientRect().width)).toBeLessThanOrEqual(43);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test('manual generation includes the selected harness and model without requests on page load',async({page})=>{
  const calls=[];page.on('request',request=>{if(request.url().endsWith('/generate'))calls.push(request.postData());});
  await page.goto(pr);expect(calls).toEqual([]);
  await page.getByText('Generate a walkthrough',{exact:true}).click();
  await page.getByLabel('Agent harness').selectOption('claude');
  await page.getByLabel('Model',{exact:true}).fill('sonnet');
  await page.getByRole('button',{name:'Generate once for everyone'}).click();
  expect(calls).toHaveLength(1);
  expect(new URLSearchParams(calls[0]).get('harness')).toBe('claude');
  expect(new URLSearchParams(calls[0]).get('model')).toBe('sonnet');
  await expect(page.locator('.walkthrough')).toBeVisible();
});

test('Markdown previews, Mermaid rendering, and local Excalidraw generation and viewing work',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pr+'?tab=conversation');
  const composer=page.locator('.composer').first();
  await composer.locator('textarea').fill('**Diagram review**\n\n| State | Result |\n|---|---|\n| Ready | Works |\n\n<script>window.reviewUnsafeScript=true</script>\n\n```mermaid\nflowchart LR\n A[Review] --> B[Approve]\n```');
  await composer.getByRole('button',{name:'Preview',exact:true}).click();
  await expect(composer.locator('.composer-preview strong')).toHaveText('Diagram review');
  await expect(composer.locator('.composer-preview table')).toBeVisible();
  await expect(composer.locator('.diagram-preview svg')).toBeVisible();
  expect(await page.evaluate(()=>window.reviewUnsafeScript)).toBeUndefined();
  await composer.getByRole('button',{name:'Generate Excalidraw'}).click();
  await expect(page.locator('.drawing-dialog')).toBeVisible();
  await expect(page.locator('.drawing-dialog .excalidraw')).toBeVisible();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download .excalidraw',exact:true}).click();
  const drawing=await downloadPromise;
  expect(drawing.suggestedFilename()).toBe('review.excalidraw');
  await page.locator('.drawing-header').getByRole('button',{name:'Close',exact:true}).click();
  await composer.getByRole('button',{name:'Write',exact:true}).click();
  await composer.locator('textarea').fill('');
  await composer.locator('input[type=file]').setInputFiles(await drawing.path());
  await expect(composer.locator('textarea')).toHaveValue(/```excalidraw/);
  await composer.getByRole('button',{name:'Preview',exact:true}).click();
  await expect(composer.locator('[data-kind=excalidraw] svg')).toBeVisible();
  await composer.getByRole('button',{name:'Open drawing'}).click();
  await expect(page.locator('.drawing-dialog .excalidraw')).toBeVisible();
  await page.locator('.drawing-header').getByRole('button',{name:'Close',exact:true}).click();
  await composer.getByRole('button',{name:'Write',exact:true}).click();
  await composer.getByRole('button',{name:'Comment on GitHub',exact:true}).click();
  await expect(page.locator('.timeline [data-kind=excalidraw] svg').last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('chat renders Markdown and Mermaid answers with the chosen harness and model',async({page})=>{
  await page.route('**/chat',route=>{
    const input=route.request().postDataJSON();
    expect(input.harness).toBe('claude');expect(input.model).toBe('sonnet');
    return route.fulfill({json:{answer:'**Flow**\n\n```mermaid\nflowchart LR\n A --> B\n```'}});
  });
  await page.goto(pr+'?tab=walkthrough');
  await page.locator('.toggle-chat').click();
  await page.getByLabel('Chat harness').selectOption('claude');
  await page.getByLabel('Chat model').fill('sonnet');
  await page.getByLabel('Question about this change').fill('Draw the flow');
  await page.getByRole('button',{name:'Send ↑'}).click();
  await expect(page.locator('.chat-message.assistant .markdown-body strong')).toHaveText('Flow');
  await expect(page.locator('.chat-message.assistant svg')).toBeVisible();
});

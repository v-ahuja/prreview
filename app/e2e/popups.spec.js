import { test, expect } from '@playwright/test';

const pr = '/p/example/reading-list/42';

for (const viewport of [{ width: 1440, height: 1040 }, { width: 390, height: 844 }]) {
  test(`generation popups dismiss outside and preserve selections at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const tab of ['files', 'walkthrough']) {
      await page.goto(`${pr}?tab=${tab}`);
      const popup = page.locator('.generation-options');
      const trigger = popup.locator('summary');
      await trigger.click();
      await page.getByLabel('Agent harness').selectOption('claude');
      await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('sonnet');
      await page.getByLabel('Review scope').selectOption('range');
      await popup.locator('.scope-form > p').last().click();
      await expect(popup).toHaveAttribute('open', '');

      await page.locator('h1').click();
      await expect(popup).not.toHaveAttribute('open');
      await trigger.click();
      await expect(page.getByLabel('Agent harness')).toHaveValue('claude');
      await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('sonnet');
      await expect(page.getByLabel('Review scope')).toHaveValue('range');
      await page.getByLabel('Review scope').focus();
      await page.keyboard.press('Escape');
      await expect(popup).not.toHaveAttribute('open');
      await expect(trigger).toBeFocused();

      await trigger.click();
      await trigger.click();
      await expect(popup).not.toHaveAttribute('open');
    }
  });
}

test('history and review popups dismiss outside and close when another popup opens', async ({ page }) => {
  await page.goto(`${pr}?tab=walkthrough`);
  const history = page.locator('.versions');
  const generation = page.locator('.generation-options');
  await history.locator('summary').click();
  await expect(history.locator('.history-menu')).toBeVisible();
  await page.locator('h1').click();
  await expect(history).not.toHaveAttribute('open');
  await history.locator('summary').click();
  await generation.locator('summary').click();
  await expect(history).not.toHaveAttribute('open');
  await expect(generation).toHaveAttribute('open', '');
  await history.locator('summary').click();
  await expect(generation).not.toHaveAttribute('open');
  await page.keyboard.press('Escape');
  await expect(history).not.toHaveAttribute('open');

  await page.goto(pr);
  const review = page.locator('.diff-review-panel');
  await review.locator('summary').click();
  await review.locator('textarea').fill('Keep this review draft.');
  await page.locator('h1').click();
  await expect(review).not.toHaveAttribute('open');
  await review.locator('summary').click();
  await expect(review.locator('textarea')).toHaveValue('Keep this review draft.');
  await generation.locator('summary').click();
  await expect(review).not.toHaveAttribute('open');
  await review.locator('summary').click();
  await expect(generation).not.toHaveAttribute('open');
  await review.locator('textarea').focus();
  await page.keyboard.press('Escape');
  await expect(review).not.toHaveAttribute('open');
  await expect(review.locator('summary')).toBeFocused();
});

test('mention suggestions dismiss outside and still support choosing a suggestion', async ({ page }) => {
  await page.goto(`${pr}?tab=conversation`);
  const comment = page.getByLabel('Comment', { exact: true });
  const suggestions = page.locator('.mention-menu:visible');
  await comment.fill('@sa');
  await expect(suggestions).toContainText('@sam');
  await comment.click();
  await expect(suggestions).toBeVisible();
  await page.locator('h1').click();
  await expect(suggestions).toHaveCount(0);
  await expect(comment).toHaveValue('@sa');
  await comment.fill('@sam');
  await suggestions.getByRole('option', { name: '@sam', exact: true }).click();
  await expect(comment).toHaveValue('@sam ');
  await expect(suggestions).toHaveCount(0);
});

test('drawing backdrop dismisses only the dialog and preserves its parent review', async ({ page }) => {
  await page.goto(pr);
  const review = page.locator('.diff-review-panel');
  await review.locator('summary').click();
  await review.locator('textarea').fill('Keep this review draft.');
  await review.getByRole('button', { name: 'Draw', exact: true }).click();
  const dialog = page.locator('.drawing-dialog');
  await expect(dialog.locator('.excalidraw')).toBeVisible();
  await dialog.locator('.drawing-header strong').click();
  await expect(dialog).toBeVisible();
  await expect(review).toHaveAttribute('open', '');

  const header = await dialog.locator('.drawing-header strong').boundingBox();
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(review).toHaveAttribute('open', '');
  await expect(review.locator('textarea')).toHaveValue('Keep this review draft.');

  await review.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(dialog.locator('.excalidraw')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(review).toHaveAttribute('open', '');
  await page.locator('h1').click();
  await expect(review).not.toHaveAttribute('open');
});

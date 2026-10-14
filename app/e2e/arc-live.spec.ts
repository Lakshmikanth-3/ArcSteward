import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// Live site smoke: every Arc page loads and the testnet console reads real chain state.
for (const path of ['/', '/arc', '/testnet', '/infrastructure', '/security']) {
  test(`page ${path} loads without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/Velo402|Arc/);
    expect(errors).toEqual([]);
  });
}

test('testnet console reads the e2e vault from chain', async ({ page }) => {
  const run = JSON.parse(readFileSync('../contracts/arc/deployments/5042002-e2e.json', 'utf8'));
  await page.goto('/testnet');
  await page.getByRole('textbox', { name: 'Vault address' }).fill(run.vault);
  await page.getByRole('textbox', { name: 'Agent EVM address' }).fill(run.agent);
  await page.getByRole('button', { name: 'Refresh on-chain state and history' }).click();
  await expect(page.locator('body')).toContainText(run.owner, { timeout: 45_000, ignoreCase: true });
  await expect(page.locator('body')).toContainText(/Paid/, { timeout: 45_000 });
  await expect(page.locator('body')).toContainText(/Revoked/);
});

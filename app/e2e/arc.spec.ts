import { test, expect } from '@playwright/test';

test('Arc console states missing evidence and disables owner operations while disconnected', async ({ page }) => {
  await page.goto('/arc');
  await expect(page.getByRole('heading', { name: 'Arc Agent Vault' })).toBeVisible();
  await expect(page.getByText('Disconnected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve exact amount and deposit' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Authorize / update' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pay USDC' })).toBeDisabled();
  await expect(page.getByText(/Mainnet readiness requires verified deployment/)).toBeVisible();
  await expect(page.getByText(/No events in the loaded window/)).toBeVisible();
  await page.getByRole('button', { name: 'Connect EVM wallet' }).click();
  await expect(page.getByRole('status')).toContainText('Install an EVM wallet');
});

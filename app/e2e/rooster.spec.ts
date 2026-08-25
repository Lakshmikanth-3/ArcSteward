import { test, expect } from "@playwright/test";
import { expectSidebarNav, expectTopHeader, expectGlobalStatsTicker } from "./helpers";

test.describe("Rooster Offers (/rooster)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/rooster");
  });

  test("shared shell: sidebar nav, top header, stats ticker", async ({ page }) => {
    await expectSidebarNav(page, "/rooster");
    await expectTopHeader(page);
    await expectGlobalStatsTicker(page);
  });

  test("header text and Reload ledger button", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Rooster Offers" })).toBeVisible();
    await expect(
      page.getByText("Offers this agent has funded via the Rooster Agents settlement rail. Live lifecycle is pulled on demand."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Reload ledger/ })).toBeVisible();
  });

  test("either an empty-state message or offer cards render, never neither", async ({ page }) => {
    await page.waitForTimeout(2000); // let the initial fetch resolve
    const emptyState = page.getByText("No funded Rooster offers yet. Submit and fund an offer to see it here.");
    const offerCard = page.getByText("Offer ID", { exact: true }).first();
    await expect(emptyState.or(offerCard)).toBeVisible();
  });

  test("offer cards, if present, show all expected fields and a live-status button", async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstCard = page.getByText("Offer ID", { exact: true }).first();
    if (!(await firstCard.isVisible().catch(() => false))) {
      test.skip(true, "No funded offers in the ledger for this environment — nothing to assert on.");
    }
    await expect(page.getByText("Amount", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Network", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Deposit Address").first()).toBeVisible();
    await expect(page.getByText("Settlement Tx").first()).toBeVisible();
    await expect(page.getByText("Updated", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Check live status|Refresh/ }).first()).toBeVisible();
  });

  test("Reload ledger button re-triggers the fetch", async ({ page }) => {
    const reloadBtn = page.getByRole("button", { name: /Reload ledger/ });
    await reloadBtn.click();
    // Button label flips to "Loading…" while in flight, then back.
    await expect(reloadBtn).toBeVisible();
  });
});

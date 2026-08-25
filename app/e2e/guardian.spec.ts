import { test, expect } from "@playwright/test";
import { expectSidebarNav, expectTopHeader, expectGlobalStatsTicker } from "./helpers";

test.describe("Guardian Alert Feed (/guardian)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/guardian");
  });

  test("shared shell: sidebar nav, top header, stats ticker", async ({ page }) => {
    await expectSidebarNav(page, "/guardian");
    await expectTopHeader(page);
    await expectGlobalStatsTicker(page);
  });

  test("header text", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Guardian Alert Feed" })).toBeVisible();
    await expect(
      page.getByText(/Pre-flight risk engine — 6 risk classes checked before any PTB is signed\./),
    ).toBeVisible();
  });

  test("Run Pre-flight Check form: Action, Amount, Scope, Analyze button", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Run Pre-flight Check" })).toBeVisible();
    await expect(page.getByText("Action", { exact: true })).toBeVisible();
    await expect(page.getByText("Amount (SUI)")).toBeVisible();
    await expect(page.getByText("Scope", { exact: true })).toBeVisible();

    const actionSelect = page.locator("#guardianAction");
    await expect(actionSelect).toBeVisible();
    await expect(actionSelect.locator("option")).toHaveText(["BUY", "SELL"]);

    const scopeSelect = page.locator("#guardianScope");
    await expect(scopeSelect).toBeVisible();
    await expect(scopeSelect.locator("option")).toHaveText([
      "402 Data",
      "DeepBook Spot",
      "DeepBook Margin",
      "DeepBook Predict",
    ]);

    await expect(page.locator("#runGuardianBtn")).toBeVisible();
    await expect(page.locator("#runGuardianBtn")).toContainText("Analyze");
  });

  test("empty state before any check has run", async ({ page }) => {
    await expect(
      page.getByText("No alerts yet. Run a pre-flight check above to see real-time Guardian analysis."),
    ).toBeVisible();
  });

  test("running a pre-flight check produces an alert card", async ({ page }) => {
    await page.locator("#guardianAmount").fill("0.05");
    await page.locator("#runGuardianBtn").click();
    // Analyzing… label shows while in flight, then a risk-level badge appears.
    await expect(page.locator("#runGuardianBtn")).toContainText(/Analyzing…|Analyze/);
    await expect(page.getByText(/score: \d+\/100/)).toBeVisible({ timeout: 15_000 });
  });
});

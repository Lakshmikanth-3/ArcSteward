import { test, expect } from "@playwright/test";
import { expectSidebarNav, expectTopHeader, expectGlobalStatsTicker } from "./helpers";

test.describe("Mission Control (/dashboard)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("shared shell: sidebar nav, top header, stats ticker", async ({ page }) => {
    await expectSidebarNav(page, "/dashboard");
    await expectTopHeader(page);
    await expectGlobalStatsTicker(page);
  });

  test("header text", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Mission Control" })).toBeVisible();
    await expect(
      page.getByText("Live telemetry and active policy metrics for your autonomous wallet."),
    ).toBeVisible();
  });

  test("four top stat cards render with correct labels", async ({ page }) => {
    // Note: getByText's default (non-exact) matching is case-insensitive
    // substring matching -- source labels are title-case ("Spent"),
    // rendered visually uppercase via CSS text-transform only, so `exact`
    // must not be used against the all-caps display text here.
    await expect(page.getByText("Remaining Budget", { exact: true })).toBeVisible();
    await expect(page.getByText("Spent", { exact: true })).toBeVisible();
    await expect(page.getByText("Treasury Balance", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Epochs to Expiry", { exact: true })).toBeVisible();
  });

  test("PolicyCap swarm panel shows a defined state, not a stuck 'Loading Agents...' forever", async ({ page }) => {
    // Regression test for the loading/empty-state bug fixed 2026-08-25:
    // must resolve to either the empty-state message or actual agent cards,
    // never hang indefinitely on the literal "Loading Agents..." string.
    // Uses Playwright's own auto-retrying expect (polls until it passes or
    // times out) rather than a fixed sleep -- /api/policy/status makes real
    // Sui + Supabase network calls, so latency varies with load.
    const emptyState = page.getByText("No agents found. Provision one to see it here.");
    const loadingState = page.getByText("Loading Agents...");
    await expect(emptyState.or(loadingState)).toBeVisible();
    await expect(loadingState).not.toBeVisible({ timeout: 20_000 });
  });

  test("Yield Gauge panel", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Yield Gauge — Scallop Money Market" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sweep to Yield/ })).toBeVisible();
    await expect(page.getByText("SCALLOP APY")).toBeVisible();
    await expect(page.getByText("RUNWAY EXT.")).toBeVisible();
  });

  test("Audit Feed terminal panel", async ({ page }) => {
    await expect(page.getByText("AUDIT FEED — AGENTACTIONEVENT")).toBeVisible();
    await expect(page.getByText(/events$/)).toBeVisible();
  });

  test("Kill Switch button is present and links to /kill-switch", async ({ page }) => {
    const killSwitch = page.locator("header.top-header").getByRole("link", { name: /Kill Switch/i });
    await expect(killSwitch).toBeVisible();
    await expect(killSwitch).toHaveAttribute("href", "/kill-switch");
  });
});

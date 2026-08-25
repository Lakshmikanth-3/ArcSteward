import { test, expect } from "@playwright/test";
import { expectSidebarNav, expectTopHeader, expectGlobalStatsTicker } from "./helpers";

test.describe("Trading Desk (/trading)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/trading");
  });

  test("shared shell: sidebar nav, top header, stats ticker", async ({ page }) => {
    await expectSidebarNav(page, "/trading");
    await expectTopHeader(page);
    await expectGlobalStatsTicker(page);
  });

  test("header text", async ({ page }) => {
    await expect(page.getByText("DeepBook V3 Orders")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trading Desk" })).toBeVisible();
    await expect(page.getByText(/Read-only view of all DeepBook orders/)).toBeVisible();
  });

  test("four volume stat cards", async ({ page }) => {
    await expect(page.getByText("SPOT VOLUME")).toBeVisible();
    await expect(page.getByText("MARGIN VOLUME")).toBeVisible();
    await expect(page.getByText("PREDICT VOLUME")).toBeVisible();
    await expect(page.getByText("TOTAL TRADES")).toBeVisible();
  });

  test("DeepBook V3 Integration panel with Spot/Margin/Predict products", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "DeepBook V3 Integration" })).toBeVisible();
    await expect(page.getByText("@mysten/deepbook-v3")).toBeVisible();
    await expect(page.getByText("Standard limit orders on SUI/USDC pool")).toBeVisible();
    await expect(page.getByText("Leveraged positions via DeepBook Margin primitive")).toBeVisible();
    await expect(page.getByText("Binary / range market positions (DeepBook Predict)")).toBeVisible();
  });

  test("Live Order Log terminal panel", async ({ page }) => {
    await expect(page.getByText("Live Order Log — from AgentActionEvent")).toBeVisible();
    await expect(page.getByText(/orders$/)).toBeVisible();
  });
});

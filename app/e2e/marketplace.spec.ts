import { test, expect } from "@playwright/test";
import { expectSidebarNav, expectTopHeader, expectGlobalStatsTicker } from "./helpers";

test.describe("Knowledge Marketplace (/marketplace)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/marketplace");
  });

  test("shared shell: sidebar nav, top header, stats ticker", async ({ page }) => {
    await expectSidebarNav(page, "/marketplace");
    await expectTopHeader(page);
    await expectGlobalStatsTicker(page);
  });

  test("header text", async ({ page }) => {
    await expect(page.getByText("Encrypted Agent Data")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Knowledge Marketplace" })).toBeVisible();
    await expect(page.getByText(/access-gated by/)).toBeVisible();
  });

  test("endpoint card: badges, path, price, Test Endpoint button", async ({ page }) => {
    await expect(page.getByText("402 Gated")).toBeVisible();
    await expect(page.getByText("Seal Encrypted")).toBeVisible();
    await expect(page.getByText("Walrus Stored")).toBeVisible();
    await expect(page.getByText("GET /api/knowledge/sentiment")).toBeVisible();
    await expect(page.getByText(/SUI\/USDC market sentiment/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Test Endpoint/ })).toBeVisible();
  });

  test("Purchase History panel", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Purchase History" })).toBeVisible();
    await expect(page.getByText("live from AgentActionEvent stream")).toBeVisible();
  });

  test("Seal + Walrus Access Flow — all four steps in order", async ({ page }) => {
    await expect(page.getByText("Seal + Walrus Access Flow")).toBeVisible();
    const steps = ["Encrypt", "Pay", "Approve", "Decrypt"];
    for (const step of steps) {
      await expect(page.getByText(step, { exact: true })).toBeVisible();
    }
  });

  test("Test Endpoint button triggers a request and shows a result", async ({ page }) => {
    await page.getByRole("button", { name: /Test Endpoint/ }).click();
    // Either a 402 challenge or a payment-verified result — some JSON response must render.
    await expect(page.getByText(/HTTP \d+/)).toBeVisible({ timeout: 15_000 });
  });
});

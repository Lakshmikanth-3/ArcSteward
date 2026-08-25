import { test, expect } from "@playwright/test";
import { expectSidebarNav, expectTopHeader, expectGlobalStatsTicker } from "./helpers";

test.describe("Provision Agent (/provision)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/provision");
  });

  test("shared shell: sidebar nav, top header, stats ticker", async ({ page }) => {
    await expectSidebarNav(page, "/provision");
    await expectTopHeader(page);
    await expectGlobalStatsTicker(page);
  });

  test("header text", async ({ page }) => {
    await expect(page.getByText("Agent Configuration")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Provision Agent" })).toBeVisible();
    await expect(page.getByText(/Mint a PolicyCap with a spend ceiling, expiry/)).toBeVisible();
  });

  test("Plain-English Intent Parser panel", async ({ page }) => {
    await expect(page.getByText("Plain-English Intent Parser")).toBeVisible();
    await expect(page.getByText("Guardian pre-flight included")).toBeVisible();
    await expect(
      page.getByText("Describe what you want the agent to do. The intent is parsed, Guardian-checked, and the mandate form is pre-filled."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Parse/ })).toBeVisible();
  });

  test("Agent Name field", async ({ page }) => {
    await expect(page.getByText("Agent Name", { exact: true })).toBeVisible();
    await expect(
      page.getByText("A unique human-readable name for this agent. Must not match any existing agent."),
    ).toBeVisible();
  });

  test("OwnerCap Object ID field", async ({ page }) => {
    await expect(page.getByText("OwnerCap Object ID")).toBeVisible();
  });

  test("PTB Preview panel shows mint_policy call", async ({ page }) => {
    await expect(page.getByText("PTB Preview")).toBeVisible();
    await expect(page.getByText(/mint_policy\(/)).toBeVisible();
  });
});

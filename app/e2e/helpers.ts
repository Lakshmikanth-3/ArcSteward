import { expect, type Page } from "@playwright/test";

/**
 * e2e/helpers.ts
 * Shared structural assertions for elements common to every inner-app page
 * (SidebarLayout.tsx's nav + top header, GlobalStatsTicker.tsx). Kept here
 * once rather than repeated per spec file — matches SidebarLayout's own
 * single source of truth for the nav item list.
 */

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Mission Control" },
  { href: "/provision", label: "Provision" },
  { href: "/marketplace", label: "Knowledge" },
  { href: "/trading", label: "Trading Desk" },
  { href: "/guardian", label: "Guardian" },
  { href: "/rooster", label: "Rooster Offers" },
] as const;

/** Asserts the sidebar nav renders every expected item, and the current page's link is marked active. */
export async function expectSidebarNav(page: Page, activeHref: string) {
  const sidebar = page.locator("nav.sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Velo402")).toBeVisible();

  for (const item of NAV_ITEMS) {
    await expect(sidebar.getByRole("link", { name: item.label })).toBeVisible();
  }

  // Scoped to .sidebar-nav specifically -- the Velo402 logo link at the top
  // of the sidebar also points to /dashboard, so an unscoped selector for
  // a[href="/dashboard"] matches both it and the actual nav item.
  const activeLink = sidebar.locator(".sidebar-nav").locator(`a[href="${activeHref}"]`);
  await expect(activeLink).toHaveClass(/active/);

  // Kill switch link is always present, separate from the main nav list.
  await expect(sidebar.getByRole("link", { name: /Kill Switch/i })).toBeVisible();
}

/** Asserts the top header (network label + kill switch button) renders. */
export async function expectTopHeader(page: Page) {
  const header = page.locator("header.top-header");
  await expect(header).toBeVisible();
  await expect(header.getByText("Sui Testnet")).toBeVisible();
  // exact:true -- "Live" (network-status pill) is a substring of the
  // GlobalStatsTicker's separate "NETWORK LIVE" text, also in this header.
  await expect(header.getByText("Live", { exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: /Kill Switch/i })).toBeVisible();
}

/** Asserts the GlobalStatsTicker's four fields render with their exact labels. */
export async function expectGlobalStatsTicker(page: Page) {
  await expect(page.getByText("NETWORK LIVE")).toBeVisible();
  await expect(page.getByText(/TOTAL AGENTS:/)).toBeVisible();
  await expect(page.getByText(/TOTAL TX:/)).toBeVisible();
  await expect(page.getByText(/VOL:/)).toBeVisible();
  await expect(page.getByText(/LAST ACTION:/)).toBeVisible();
}

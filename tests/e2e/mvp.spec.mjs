import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@test.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Test12345!";
const EMPLOYEE_EMAIL = process.env.E2E_EMPLOYEE_EMAIL || "employee@test.local";
const EMPLOYEE_PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD || "Test12345!";

async function login(page, email, password) {
  await page.goto("/login");
  await page.locator('input[placeholder="Логин"]').fill(email);
  await page.locator('input[placeholder="Пароль"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/warehouse/);
}

test.describe("MVP UI", () => {
  test("ADMIN desktop: menu + sections", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop-only");

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('a[href="/warehouse"]').first()).toBeVisible();
    await expect(page.locator('a[href="/admin"]').first()).toBeVisible();

    await page.goto("/warehouse?section=inventory");
    await expect(page).toHaveURL(/section=inventory/);
    await expect(page.locator(".portal-topbar")).toContainText("Остатки");

    await page.goto("/warehouse?section=items");
    await expect(page).toHaveURL(/section=items/);
    await expect(page.locator(".portal-topbar")).toContainText("Справочник товаров");

    await page.goto("/warehouse?section=movement");
    await expect(page).toHaveURL(/section=movement/);
    await expect(page.locator(".portal-topbar")).toContainText("История движений");

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator(".admin-console__title")).toBeVisible();
  });

  test("EMPLOYEE desktop: no admin access", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop-only");

    await login(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await expect(page.locator('a[href="/warehouse"]').first()).toBeVisible();
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);

    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin$/);
    await expect(page.locator(".admin-console__title")).toHaveCount(0);
  });

  test("Mobile: bottom nav + no zoom + key screens", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile-only");

    await login(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await expect(page.locator("nav.mobile-bottom-nav")).toBeVisible();
    await expect(page.locator('nav.mobile-bottom-nav a[href="/warehouse"]')).toBeVisible();
    await expect(page.locator('nav.mobile-bottom-nav a[href="/news"]')).toBeVisible();

    await page.goto("/warehouse?section=inventory");
    await expect(page).toHaveURL(/section=inventory/);
    await expect(page.locator(".portal-topbar")).toContainText("Остатки");

    const searchInput = page
      .locator('input[placeholder="Введите артикул или часть названия..."]')
      .first();
    await expect(searchInput).toBeVisible();

    const fontSize = await searchInput.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize)
    );
    expect(fontSize).toBeGreaterThanOrEqual(16);

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(hasHorizontalScroll).toBeFalsy();
  });
});

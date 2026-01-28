import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@test.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Test12345!";
const EMPLOYEE_EMAIL = process.env.E2E_EMPLOYEE_EMAIL || "employee@test.local";
const EMPLOYEE_PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD || "Test12345!";

async function login(page, email, password) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/warehouse/);
}

test.describe("MVP UI", () => {
  test("ADMIN desktop: menu + sections", async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name === "mobile", "Desktop-only");
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.getByRole("link", { name: "Склад" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Администрирование" })).toBeVisible();

    await page.getByRole("button", { name: /Остатки/ }).click();
    await expect(page.getByText("Текущие остатки", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Номенклатура/ }).click();
    await expect(page.getByRole("heading", { name: "Номенклатура" })).toBeVisible();

    await page.getByRole("button", { name: /Движение товара/ }).click();
    await expect(page.locator("text=Движение товара").first()).toBeVisible();

    await page.getByRole("button", { name: /Поставщики/ }).click();
    await expect(
      page.locator(".card1c__header", { hasText: "Поставщики" })
    ).toBeVisible();

    await page.getByRole("link", { name: "Администрирование" }).click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator(".admin-console__title")).toBeVisible();
  });

  test("EMPLOYEE desktop: no admin access", async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name === "mobile", "Desktop-only");
    await login(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await expect(page.getByRole("link", { name: "Склад" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Администрирование" })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
  });

  test("Mobile: drawer + no zoom + key screens", async ({ page }, testInfo) => {
    testInfo.skip(testInfo.project.name !== "mobile", "Mobile-only");
    await login(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    const burger = page.getByRole("button", { name: "Открыть меню" });
    await expect(burger).toBeVisible();
    await burger.click();
    await expect(page.getByRole("link", { name: "Склад" })).toBeVisible();
    await page.getByRole("link", { name: "Склад" }).click();

    await page.getByRole("button", { name: /Остатки/ }).click();
    await expect(page.getByText("Текущие остатки", { exact: true })).toBeVisible();

    const searchInput = page.getByPlaceholder("Введите SKU или часть названия...");
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

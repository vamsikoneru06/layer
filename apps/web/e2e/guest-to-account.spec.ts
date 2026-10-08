import { expect, test } from "@playwright/test";
import { nextSignInLink, signInEmailCount } from "./support/mail";

/** Spec §3 journey 2: a guest's design moves to their new account when they sign in with a magic link. */
test("a guest saves to an account by signing in, and the design moves there", async ({ page }) => {
  await page.goto("/templates");
  await page.getByText("Weekend Photo Dump", { exact: true }).click();
  await page.getByRole("button", { name: "Use this template" }).click();
  await expect(page).toHaveURL(/\/edit\/[0-9a-f-]{36}/);
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  await page.getByRole("button", { name: "Save to account" }).click();
  await expect(page).toHaveURL(/\/signin/);

  // A fresh address each run, so the account is new.
  const email = `guest-${Date.now()}@example.test`;
  const seen = signInEmailCount();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.goto(await nextSignInLink(seen));
  await expect(page).toHaveURL(/\/home/);

  // Home moves designs kept in this browser into the account before anything lists them.
  await page.goto("/designs");
  const card = page.getByRole("button", { name: "Open Weekend Photo Dump" });
  await expect(card).toHaveCount(1);
  await expect(page.getByText("You’re not signed in", { exact: false })).toHaveCount(0);

  // It opens from the account now, not from this browser.
  await card.click();
  await expect(page).toHaveURL(/\/edit\/[0-9a-f-]{36}/);
  await expect(page.getByText("Saved in this browser")).toHaveCount(0);
});

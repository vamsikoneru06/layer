import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** Spec §3 journey 1: gallery → template → guest editor → edit → filter → 2× PNG, kept in this browser. */

async function openEditorFromGallery(page: Page) {
  await page.goto("/templates");
  await page.getByLabel("Size").selectOption("ig-post");
  await expect(page).toHaveURL(/format=ig-post/);
  await page.getByText("Editorial Bloom", { exact: true }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Use this template" }).click();
  await expect(page).toHaveURL(/\/edit\/[0-9a-f-]{36}/);
  await expect(page.getByText("Saved in this browser")).toBeVisible();
}

async function selectLayer(page: Page, name: string) {
  await page.getByRole("radio", { name: "Layers" }).click();
  await page.getByText(name, { exact: true }).first().click();
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const png = readFileSync(file);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("a guest edits a template and exports a 2× PNG, and the design survives a reload", async ({ page }) => {
  await openEditorFromGallery(page);

  // Edit the headline in place.
  await selectLayer(page, "Headline");
  await page.keyboard.press("Enter");
  const box = page.getByRole("textbox", { name: "Edit text: Headline" });
  await expect(box).toBeFocused();
  await box.fill("Spring sale this weekend");
  await page.keyboard.press("Control+Enter");
  await expect(box).toBeHidden();

  // Apply the Warm filter to the photo.
  await selectLayer(page, "Arch photo");
  await page.getByRole("radio", { name: "Properties" }).click();
  const warm = page.getByRole("group", { name: "Filter presets" }).getByRole("button", { name: "Warm" });
  await warm.click();
  await expect(warm).toHaveAttribute("aria-pressed", "true");

  // Export at 2×.
  await page.getByRole("button", { name: "Export" }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("radio", { name: /2×/ }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(pngSize(await download.path())).toEqual({ width: 2160, height: 2160 });

  // Autosave keeps the edit in this browser.
  await expect(page.getByText("Saved in this browser")).toBeVisible();
  await page.reload();
  await selectLayer(page, "Headline");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Edit text: Headline" })).toHaveValue("Spring sale this weekend");
  await page.keyboard.press("Escape");
});

// 管理画面のスクリーンショット（サンプルデータ・DB には触れない）
//   npm run dev を起動した状態で: node scripts/screenshot-admin.mjs <保存先フォルダ> [URL]
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";
import { openAdmin, t } from "./mock-admin.mjs";

const out = process.argv[2] ?? "screenshots";
const url = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [name, opts] of [["pc", { viewport: { width: 1366, height: 900 } }], ["mobile", { ...devices["iPhone 13"], defaultBrowserType: undefined }]]) {
  const ctx = await browser.newContext({ ...opts, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(t("15:20")));
  await openAdmin(page, url);
  await page.screenshot({ path: `${out}/${name}-1-timeline.png`, fullPage: true });
  await page.locator('[data-item="4"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-2-edit.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  for (const [tab, file] of [["一覧・CSV", "3-list"], ["部屋", "4-rooms"]]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(600);
    if (tab === "部屋") { await page.getByRole("button", { name: "編集" }).nth(4).click(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${out}/${name}-${file}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(`保存しました: ${out}`);

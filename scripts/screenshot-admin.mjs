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
  // ホールの一般貸出（追加楽器・料金）
  const track = page.locator('[data-track="5"]');
  await track.evaluate((el) => { el.closest("[data-timeline]").scrollLeft = 520; });
  const b = await track.boundingBox();
  await page.mouse.click(b.x + (16 * 60 - 540) * (20 / 15) + 7, b.y + b.height / 2);
  await page.waitForTimeout(400);
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("予約区分").selectOption("rental");
  await dlg.getByRole("checkbox", { name: /グランドピアノ/ }).check();
  await page.waitForTimeout(500);
  await dlg.getByTestId("price").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-5-hall-price.png` });
  // 定期レッスンの確認
  await dlg.getByLabel("予約区分").selectOption("lesson");
  await dlg.getByLabel("利用者名・団体名（必須）").fill("生徒 7");
  await dlg.getByLabel("繰り返し", { exact: true }).selectOption("7");
  await dlg.getByLabel("繰り返しの終了日").fill("2026-12-25");
  await dlg.getByRole("button", { name: "登録する日を確認" }).click();
  await page.waitForTimeout(400);
  await dlg.getByTestId("series-plan").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${name}-6-series.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "空き教室検索", exact: true }).click();
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-7-search.png`, fullPage: true });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "料金・楽器", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-8-prices.png`, fullPage: true });
  for (const [tab, file] of [["ダッシュボード", "9-dashboard"], ["売上", "10-sales"], ["レポート", "11-report"]]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${name}-${file}.png`, fullPage: true });
  }
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: `${out}/${name}-12-report-print.png`, fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "一覧・CSV", exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}-3-list.png`, fullPage: true });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  for (const [sub, file] of [["教室", "4-rooms"], ["営業時間・休業日", "13-hours"], ["変更履歴", "14-history"]]) {
    await page.getByRole("button", { name: sub, exact: true }).click();
    await page.waitForTimeout(600);
    if (sub === "教室") { await page.getByRole("button", { name: "編集" }).nth(4).click(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${out}/${name}-${file}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(`保存しました: ${out}`);

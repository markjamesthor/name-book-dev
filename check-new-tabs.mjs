import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Default state: step 0 (사진 tab) should be active
  await page.screenshot({ path: '/tmp/new-tabs-default.png' });

  // Click 02 페이지 tab
  await page.click('.step-tab[data-step="1"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/new-tabs-page.png' });

  // Click 03 스토리 설정 tab → should open bottom sheet
  await page.click('.step-tab[data-step="2"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/new-tabs-story-sheet.png' });

  // Click 완료 to close
  await page.click('#story-sheet-done');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/new-tabs-after-close.png' });

  await browser.close();
  console.log('Done!');
})();

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
  await page.evaluate(() => localStorage.removeItem('bookPreview_polaroidHintDismissed'));

  // Page 17 (scene 16)
  await page.evaluate(() => {
    const pages = getPages();
    jumpToPage(pages.length - 2);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/polaroid-page17.png' });

  // Page 18 (scene 17)
  await page.evaluate(() => {
    const pages = getPages();
    jumpToPage(pages.length - 1);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/polaroid-page18.png' });

  // Info
  const info = await page.evaluate(() => {
    const pages = getPages();
    return {
      totalPages: pages.length,
      lastPage: pages[pages.length - 1],
      secondLastPage: pages[pages.length - 2],
    };
  });
  console.log('Pages:', JSON.stringify(info, null, 2));

  await browser.close();
  console.log('Done!');
})();

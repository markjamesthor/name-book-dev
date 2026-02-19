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

  // Enter a name first
  await page.fill('#input-firstName', '도현');
  await page.waitForTimeout(500);

  // Go to page tab
  await page.click('.step-tab[data-step="1"]');
  await page.waitForTimeout(500);

  // Screenshot cover page
  await page.screenshot({ path: '/tmp/apple-music-cover.png' });

  // Navigate to story pages via JS
  await page.evaluate(() => jumpToPage(1));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/apple-music-page2.png' });

  await page.evaluate(() => jumpToPage(2));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/apple-music-page3.png' });

  await page.evaluate(() => jumpToPage(3));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/apple-music-page4.png' });

  await page.evaluate(() => jumpToPage(5));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/apple-music-page6.png' });

  await browser.close();
  console.log('Done!');
})();

import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('#input-firstName', '도현');
  await page.waitForTimeout(300);
  await page.click('.step-tab[data-step="1"]');
  await page.waitForTimeout(500);

  // Jump to page 17 to scroll thumbnail strip to end
  await page.evaluate(() => jumpToPage(17));
  await page.waitForTimeout(500);

  const stripRect = await page.evaluate(() => {
    const el = document.getElementById('thumbnail-strip');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  await page.screenshot({
    path: '/tmp/thumbs2-end.png',
    clip: { x: stripRect.x, y: stripRect.y - 5, width: stripRect.w, height: stripRect.h + 10 }
  });

  // Also full screenshot
  await page.screenshot({ path: '/tmp/thumbs2-full.png' });

  await browser.close();
  console.log('Done!');
})();

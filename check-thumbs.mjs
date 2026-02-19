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

  // Full screenshot
  await page.screenshot({ path: '/tmp/thumbs-full.png' });

  // Zoomed: thumbnail strip area
  const stripRect = await page.evaluate(() => {
    const el = document.getElementById('thumbnail-strip');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  await page.screenshot({
    path: '/tmp/thumbs-strip.png',
    clip: { x: stripRect.x, y: stripRect.y - 5, width: stripRect.w, height: stripRect.h + 10 }
  });

  // Scroll to see page 15 thumbnail
  await page.evaluate(() => {
    const strip = document.getElementById('thumbnail-strip');
    strip.scrollLeft = strip.scrollWidth;
  });
  await page.waitForTimeout(300);

  await page.screenshot({
    path: '/tmp/thumbs-strip-end.png',
    clip: { x: stripRect.x, y: stripRect.y - 5, width: stripRect.w, height: stripRect.h + 10 }
  });

  await browser.close();
  console.log('Done!');
})();

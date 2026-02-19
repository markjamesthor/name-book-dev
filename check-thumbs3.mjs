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

  // Manually scroll strip to end
  await page.evaluate(() => {
    const strip = document.getElementById('thumbnail-strip');
    strip.scrollLeft = strip.scrollWidth - strip.clientWidth;
  });
  await page.waitForTimeout(500);

  // Get strip rect including overflow
  const stripInfo = await page.evaluate(() => {
    const el = document.getElementById('thumbnail-strip');
    const r = el.getBoundingClientRect();
    // Also check how many thumb-wraps and last one's position
    const wraps = el.querySelectorAll('.thumb-wrap');
    const lastWrap = wraps[wraps.length - 1];
    const lastR = lastWrap?.getBoundingClientRect();
    return {
      strip: { x: r.x, y: r.y, w: r.width, h: r.height },
      lastThumb: lastR ? { x: lastR.x, y: lastR.y, w: lastR.width, h: lastR.height } : null,
      totalThumbs: wraps.length,
    };
  });

  console.log('Strip info:', JSON.stringify(stripInfo, null, 2));

  await page.screenshot({
    path: '/tmp/thumbs3-end.png',
    clip: { x: stripInfo.strip.x, y: stripInfo.strip.y - 5, width: stripInfo.strip.w, height: stripInfo.strip.h + 10 }
  });

  await browser.close();
  console.log('Done!');
})();

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
  await page.fill('#input-firstName', '도현');
  await page.waitForTimeout(300);
  await page.click('.step-tab[data-step="1"]');
  await page.waitForTimeout(300);

  // Check multiple pages to find text-heavy ones
  for (const idx of [3, 5, 7, 10, 14]) {
    await page.evaluate((i) => jumpToPage(i), idx);
    await page.waitForTimeout(500);

    // Measure slide-img-wrap and text-overlay sizes
    const info = await page.evaluate(() => {
      const slide = document.querySelector('.carousel-slide[data-page-index]');
      if (!slide) return null;
      const visible = Array.from(document.querySelectorAll('.carousel-slide')).find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!visible) return null;

      const imgWrap = visible.querySelector('.slide-img-wrap');
      const textOverlay = visible.querySelector('.page-text-overlay');
      const slideRect = visible.getBoundingClientRect();

      return {
        slideH: slideRect.height,
        imgWrap: imgWrap ? {
          h: imgWrap.getBoundingClientRect().height,
          pct: (imgWrap.getBoundingClientRect().height / slideRect.height * 100).toFixed(1)
        } : null,
        textOverlay: textOverlay ? {
          h: textOverlay.getBoundingClientRect().height,
          scrollH: textOverlay.scrollHeight,
          scrollW: textOverlay.scrollWidth,
          clientW: textOverlay.clientWidth,
          overflowX: getComputedStyle(textOverlay).overflowX,
          overflowY: getComputedStyle(textOverlay).overflowY,
          pct: (textOverlay.getBoundingClientRect().height / slideRect.height * 100).toFixed(1)
        } : null,
      };
    });

    console.log(`Page ${idx}:`, JSON.stringify(info, null, 2));
    await page.screenshot({ path: `/tmp/text-page-${idx}.png` });
  }

  await browser.close();
  console.log('Done!');
})();

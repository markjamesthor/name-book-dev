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

  const totalPages = await page.evaluate(() => getPages().length);

  for (let idx = 1; idx < totalPages; idx++) {
    await page.evaluate((i) => jumpToPage(i), idx);
    await page.waitForTimeout(400);

    const info = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll('.carousel-slide'));
      const visible = slides.find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!visible) return null;

      const imgWrap = visible.querySelector('.slide-img-wrap');
      const bgImg = visible.querySelector('.page-bg-img');
      if (!bgImg) return { type: 'gradient' };

      const wrapRect = imgWrap.getBoundingClientRect();
      const imgRect = bgImg.getBoundingClientRect();
      const ratio = bgImg.naturalWidth / bgImg.naturalHeight;

      return {
        natural: `${bgImg.naturalWidth}x${bgImg.naturalHeight}`,
        ratio: ratio.toFixed(2),
        orientation: ratio > 1.1 ? 'landscape' : ratio < 0.9 ? 'portrait' : 'square',
        wrapW: wrapRect.width,
        wrapH: wrapRect.height,
        imgW: imgRect.width.toFixed(0),
        imgH: imgRect.height.toFixed(0),
        fillsWidth: Math.abs(imgRect.width - wrapRect.width) < 2,
        fillsHeight: Math.abs(imgRect.height - wrapRect.height) < 2,
      };
    });

    console.log(`Page ${idx + 1} (idx ${idx}):`, JSON.stringify(info));
    await page.screenshot({ path: `/tmp/illust-${idx}.png` });
  }

  await browser.close();
  console.log('Done!');
})();

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

  for (const idx of [3, 5, 7, 14]) {
    await page.evaluate((i) => jumpToPage(i), idx);
    await page.waitForTimeout(500);

    const info = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll('.carousel-slide'));
      const visible = slides.find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!visible) return null;

      const imgWrap = visible.querySelector('.slide-img-wrap');
      const textOverlay = visible.querySelector('.page-text-overlay');
      const textScroll = visible.querySelector('.page-text-scroll');
      const storyText = visible.querySelector('.page-story-text');
      const slideRect = visible.getBoundingClientRect();

      return {
        slideH: slideRect.height,
        imgWrapPct: imgWrap ? (imgWrap.getBoundingClientRect().height / slideRect.height * 100).toFixed(1) : null,
        textOverlay: textOverlay ? {
          h: textOverlay.getBoundingClientRect().height,
          overflow: getComputedStyle(textOverlay).overflow,
        } : null,
        textScroll: textScroll ? {
          h: textScroll.getBoundingClientRect().height,
          scrollH: textScroll.scrollHeight,
          clientH: textScroll.clientHeight,
          hasScroll: textScroll.scrollHeight > textScroll.clientHeight,
          overflowY: getComputedStyle(textScroll).overflowY,
        } : null,
        storyTextH: storyText ? storyText.getBoundingClientRect().height : null,
      };
    });

    console.log(`Page ${idx + 1} (index ${idx}):`, JSON.stringify(info, null, 2));
    await page.screenshot({ path: `/tmp/page-fix-${idx}.png` });
  }

  await browser.close();
  console.log('Done!');
})();

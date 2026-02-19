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

      const textScroll = visible.querySelector('.page-text-scroll');
      const storyText = visible.querySelector('.page-story-text');
      if (!textScroll) return null;

      return {
        hasScroll: textScroll.scrollHeight > textScroll.clientHeight,
        scrollH: textScroll.scrollHeight,
        clientH: textScroll.clientHeight,
        textH: storyText ? storyText.getBoundingClientRect().height : 0,
      };
    });

    if (info && info.hasScroll) {
      console.log(`Page ${idx + 1} (index ${idx}): SCROLLABLE — textH=${info.textH} scrollH=${info.scrollH} clientH=${info.clientH}`);
    }
  }

  console.log('Done!');
  await browser.close();
})();

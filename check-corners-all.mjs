import { webkit } from '@playwright/test';

(async () => {
  const browser = await webkit.launch();
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
  await page.waitForTimeout(300);

  for (const idx of [0, 1, 3, 5]) {
    await page.evaluate((i) => jumpToPage(i), idx);
    await page.waitForTimeout(500);

    const cardRect = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll('.carousel-slide'));
      const visible = slides.find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!visible) return null;
      const r = visible.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

    if (cardRect) {
      // Bottom-left
      await page.screenshot({
        path: `/tmp/fix-corners-p${idx}-bl.png`,
        clip: { x: cardRect.x - 3, y: cardRect.y + cardRect.h - 25, width: 30, height: 30 }
      });
      // Bottom-right
      await page.screenshot({
        path: `/tmp/fix-corners-p${idx}-br.png`,
        clip: { x: cardRect.x + cardRect.w - 27, y: cardRect.y + cardRect.h - 25, width: 30, height: 30 }
      });
    }
  }

  await browser.close();
  console.log('Done!');
})();

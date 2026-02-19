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

  // Check pages 0 (cover), 1, 3
  for (const idx of [0, 1, 3]) {
    await page.evaluate((i) => jumpToPage(i), idx);
    await page.waitForTimeout(500);

    const info = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll('.carousel-slide'));
      const visible = slides.find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!visible) return null;
      const r = visible.getBoundingClientRect();
      const children = Array.from(visible.children).map(c => ({
        cls: c.className,
        borderRadius: getComputedStyle(c).borderRadius,
        overflow: getComputedStyle(c).overflow,
      }));
      return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, children };
    });

    console.log(`\nPage ${idx}:`, JSON.stringify(info, null, 2));

    // Bottom-left corner screenshot
    if (info) {
      await page.screenshot({
        path: `/tmp/allcorners-p${idx}-bl.png`,
        clip: { x: info.rect.x - 2, y: info.rect.y + info.rect.h - 30, width: 35, height: 35 }
      });
      await page.screenshot({
        path: `/tmp/allcorners-p${idx}-br.png`,
        clip: { x: info.rect.x + info.rect.w - 33, y: info.rect.y + info.rect.h - 30, width: 35, height: 35 }
      });
    }
  }

  await browser.close();
  console.log('\nDone!');
})();

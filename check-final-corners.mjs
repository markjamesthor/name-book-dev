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

  // Test pages: 0(cover), 3, 5, 10 — using jumpToPage with big gaps to avoid sequential recycling
  for (const idx of [0, 3, 5, 10]) {
    await page.evaluate((i) => jumpToPage(i), idx);
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll('.carousel-slide'));
      const visible = slides.find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!visible) return null;
      const r = visible.getBoundingClientRect();
      const imgWrap = visible.querySelector('.slide-img-wrap');
      const textOverlay = visible.querySelector('.page-text-overlay');
      return {
        isCover: visible.classList.contains('slide-cover'),
        cardRect: { x: r.x, y: r.y, w: r.width, h: r.height },
        imgWrapRect: imgWrap ? (() => { const ir = imgWrap.getBoundingClientRect(); return { x: ir.x, y: ir.y, w: ir.width, h: ir.height }; })() : null,
        textRect: textOverlay ? (() => { const tr = textOverlay.getBoundingClientRect(); return { x: tr.x, y: tr.y, w: tr.width, h: tr.height }; })() : null,
      };
    });

    console.log(`p${idx}: cover=${info?.isCover}`);

    if (info) {
      // Bottom-left corner of card
      await page.screenshot({
        path: `/tmp/final-p${idx}-bl.png`,
        clip: { x: info.cardRect.x - 3, y: info.cardRect.y + info.cardRect.h - 25, width: 30, height: 30 }
      });

      // Junction between image and text (non-cover only)
      if (!info.isCover && info.imgWrapRect && info.textRect) {
        const jY = info.imgWrapRect.y + info.imgWrapRect.h;
        await page.screenshot({
          path: `/tmp/final-p${idx}-junction.png`,
          clip: { x: info.cardRect.x, y: jY - 10, width: info.cardRect.w, height: 20 }
        });
      }
    }
  }

  await browser.close();
  console.log('Done!');
})();

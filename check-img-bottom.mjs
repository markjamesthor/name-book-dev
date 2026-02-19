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

  const totalPages = await page.evaluate(() => getPages().length);

  for (let idx = 0; idx < totalPages; idx++) {
    await page.evaluate((i) => jumpToPage(i), idx);
    await page.waitForTimeout(400);

    const info = await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll('.carousel-slide'));
      const visible = slides.find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!visible) return null;

      const isCover = visible.classList.contains('slide-cover');
      const imgWrap = visible.querySelector('.slide-img-wrap');
      const textOverlay = visible.querySelector('.page-text-overlay');

      return {
        isCover,
        imgWrapRadius: imgWrap ? getComputedStyle(imgWrap).borderRadius : null,
        imgWrapRect: imgWrap ? imgWrap.getBoundingClientRect() : null,
        textRect: textOverlay ? textOverlay.getBoundingClientRect() : null,
      };
    });

    const hasBug = info && !info.isCover && info.imgWrapRadius && info.imgWrapRadius !== '10px 10px 0px 0px';
    const flag = hasBug ? ' ← WRONG RADIUS' : '';
    console.log(`p${idx}: cover=${info?.isCover} imgRadius=${info?.imgWrapRadius}${flag}`);

    // Screenshot the junction between image and text
    if (info && !info.isCover && info.imgWrapRect && info.textRect) {
      const junctionY = info.imgWrapRect.y + info.imgWrapRect.height;
      await page.screenshot({
        path: `/tmp/junction-p${idx}.png`,
        clip: { x: info.imgWrapRect.x, y: junctionY - 15, width: info.imgWrapRect.width, height: 30 }
      });
    }
  }

  await browser.close();
  console.log('\nDone!');
})();

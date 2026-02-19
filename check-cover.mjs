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
  await page.waitForTimeout(500);

  // Cover page (index 0)
  await page.screenshot({ path: '/tmp/cover-check.png' });

  // Check CSS values on cover
  const info = await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const visible = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    if (!visible) return null;

    const bgImg = visible.querySelector('.page-bg-img');
    const imgWrap = visible.querySelector('.slide-img-wrap');
    const cs = bgImg ? getComputedStyle(bgImg) : null;

    return {
      isCover: visible.classList.contains('slide-cover'),
      imgWrapH: imgWrap?.getBoundingClientRect().height,
      slideH: visible.getBoundingClientRect().height,
      bgImg: cs ? {
        objectFit: cs.objectFit,
        objectPosition: cs.objectPosition,
        position: cs.position,
        height: cs.height,
        width: cs.width,
      } : null,
    };
  });

  console.log('Cover info:', JSON.stringify(info, null, 2));
  await browser.close();
  console.log('Done!');
})();

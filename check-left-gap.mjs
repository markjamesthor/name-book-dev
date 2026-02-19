import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  await page.fill('#input-firstName', '도현');
  await page.waitForTimeout(500);
  await page.click('.step-tab[data-step="1"]');
  await page.waitForTimeout(500);

  await page.evaluate(() => jumpToPage(3));
  await page.waitForTimeout(500);

  // Check layout from whichever slide is visible
  const info = await page.evaluate(() => {
    const slides = document.querySelectorAll('.carousel-slide');
    const results = [];
    slides.forEach((slide, i) => {
      const rect = slide.getBoundingClientRect();
      const img = slide.querySelector('.page-bg-img');
      if (rect.left >= -10 && rect.left < 400) { // visible
        const wrap = slide.querySelector('.slide-img-wrap');
        results.push({
          slideIndex: i,
          slideRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          wrap: wrap ? {
            rect: wrap.getBoundingClientRect(),
            padding: getComputedStyle(wrap).padding,
          } : null,
          img: img ? {
            rect: img.getBoundingClientRect(),
            naturalW: img.naturalWidth, naturalH: img.naturalHeight,
            display: getComputedStyle(img).display,
            position: getComputedStyle(img).position,
            objectFit: getComputedStyle(img).objectFit,
            marginLeft: getComputedStyle(img).marginLeft,
          } : null,
        });
      }
    });
    return { currentPageIndex, totalSlides: slides.length, visible: results };
  });
  console.log(JSON.stringify(info, null, 2));

  // Full page screenshot
  await page.screenshot({ path: '/tmp/left-gap-full.png' });

  // Zoom into left edge
  const viewer = await page.$('#page-viewer');
  const box = await viewer.boundingBox();
  await page.screenshot({
    path: '/tmp/left-gap-left-edge.png',
    clip: { x: box.x - 2, y: box.y, width: 40, height: 300 }
  });

  // Zoom into top-left corner
  await page.screenshot({
    path: '/tmp/left-gap-corner.png',
    clip: { x: box.x - 2, y: box.y - 2, width: 80, height: 80 }
  });

  await browser.close();
  console.log('Done!');
})();

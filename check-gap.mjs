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
  await page.waitForTimeout(300);
  await page.click('.step-tab[data-step="1"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => jumpToPage(3));
  await page.waitForTimeout(500);

  // Measure everything
  const info = await page.evaluate(() => {
    const area = document.querySelector('.preview-area');
    const wrap = document.querySelector('.page-viewer-wrap');
    const viewer = document.getElementById('page-viewer');
    const slides = document.querySelectorAll('.carousel-slide');
    const visible = Array.from(slides).find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    return {
      area: { padding: getComputedStyle(area).padding, rect: area.getBoundingClientRect() },
      wrap: { rect: wrap.getBoundingClientRect() },
      viewer: { rect: viewer.getBoundingClientRect(), padding: getComputedStyle(viewer).padding },
      slide: visible ? { rect: visible.getBoundingClientRect(), margin: getComputedStyle(visible).margin } : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));

  // Zoomed screenshot of left edge
  const viewerBox = info.viewer.rect;
  await page.screenshot({
    path: '/tmp/gap-left.png',
    clip: { x: Math.max(0, viewerBox.x - 4), y: viewerBox.y, width: 30, height: 200 }
  });

  await page.screenshot({ path: '/tmp/gap-full.png' });

  await browser.close();
  console.log('Done!');
})();

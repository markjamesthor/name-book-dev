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
  await page.evaluate(() => jumpToPage(3));
  await page.waitForTimeout(500);

  // Full screenshot
  await page.screenshot({ path: '/tmp/rect-full.png' });

  // Zoomed: left edge of card
  const cardRect = await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const visible = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    return visible?.getBoundingClientRect();
  });

  if (cardRect) {
    // Left edge
    await page.screenshot({
      path: '/tmp/rect-left.png',
      clip: { x: 0, y: cardRect.y, width: cardRect.x + 20, height: 300 }
    });
    // Right edge
    await page.screenshot({
      path: '/tmp/rect-right.png',
      clip: { x: cardRect.x + cardRect.width - 20, y: cardRect.y, width: 40, height: 300 }
    });
    // Top edge
    await page.screenshot({
      path: '/tmp/rect-top.png',
      clip: { x: cardRect.x - 10, y: cardRect.y - 10, width: cardRect.width + 20, height: 30 }
    });
    console.log('Card rect:', JSON.stringify(cardRect));
  }

  // Check all elements between body and card for any visual artifacts
  const layers = await page.evaluate(() => {
    const els = [
      { name: 'body', el: document.body },
      { name: '.preview-area', el: document.querySelector('.preview-area') },
      { name: '.page-viewer-wrap', el: document.querySelector('.page-viewer-wrap') },
      { name: '#page-viewer', el: document.getElementById('page-viewer') },
      { name: '.carousel-track', el: document.getElementById('carousel-track') },
    ];
    return els.map(({ name, el }) => {
      if (!el) return { name, missing: true };
      const cs = getComputedStyle(el);
      return {
        name,
        background: cs.backgroundColor,
        border: cs.border,
        outline: cs.outline,
        boxShadow: cs.boxShadow,
        overflow: cs.overflow,
      };
    });
  });
  console.log('\nLayer styles:');
  layers.forEach(l => console.log(`  ${l.name}: bg=${l.background} border=${l.border} outline=${l.outline} shadow=${l.boxShadow} overflow=${l.overflow}`));

  await browser.close();
  console.log('Done!');
})();

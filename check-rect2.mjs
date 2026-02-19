import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
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
  await page.screenshot({ path: '/tmp/rect2-full.png' });

  // Get all relevant element rects and computed styles
  const debug = await page.evaluate(() => {
    const els = [
      { name: 'body', el: document.body },
      { name: '.preview-area', el: document.querySelector('.preview-area') },
      { name: '.page-viewer-wrap', el: document.querySelector('.page-viewer-wrap') },
      { name: '#page-viewer', el: document.getElementById('page-viewer') },
      { name: '.carousel-track', el: document.getElementById('carousel-track') },
    ];

    // Find the visible slide
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const visible = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    if (visible) {
      els.push({ name: '.carousel-slide(visible)', el: visible });
    }

    return els.map(({ name, el }) => {
      if (!el) return { name, missing: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        name,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        background: cs.backgroundColor,
        border: cs.border,
        outline: cs.outline,
        boxShadow: cs.boxShadow,
        overflow: cs.overflow,
        borderRadius: cs.borderRadius,
      };
    });
  });

  console.log('\nElement debug info:');
  debug.forEach(d => {
    if (d.missing) { console.log(`  ${d.name}: MISSING`); return; }
    console.log(`  ${d.name}:`);
    console.log(`    rect: ${JSON.stringify(d.rect)}`);
    console.log(`    bg=${d.background} border=${d.border}`);
    console.log(`    shadow=${d.boxShadow} overflow=${d.overflow}`);
    console.log(`    borderRadius=${d.borderRadius} outline=${d.outline}`);
  });

  // Zoomed screenshot of the area between card and page-viewer edges
  const viewerRect = await page.evaluate(() => {
    const el = document.getElementById('page-viewer');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  // Capture the full preview area with some margin
  const previewRect = await page.evaluate(() => {
    const el = document.querySelector('.preview-area');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  await page.screenshot({
    path: '/tmp/rect2-preview-area.png',
    clip: { x: previewRect.x, y: previewRect.y, width: previewRect.w, height: previewRect.h }
  });

  // Zoomed: top-left corner of page-viewer
  await page.screenshot({
    path: '/tmp/rect2-topleft.png',
    clip: { x: viewerRect.x - 5, y: viewerRect.y - 5, width: 60, height: 60 }
  });

  // Zoomed: top-right corner
  await page.screenshot({
    path: '/tmp/rect2-topright.png',
    clip: { x: viewerRect.x + viewerRect.w - 55, y: viewerRect.y - 5, width: 60, height: 60 }
  });

  await browser.close();
  console.log('\nDone!');
})();

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
  await page.screenshot({ path: '/tmp/corners-full.png' });

  // Get card rect
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

  console.log('Card rect:', JSON.stringify(cardRect));

  if (cardRect) {
    // Top-left corner
    await page.screenshot({
      path: '/tmp/corners-tl.png',
      clip: { x: cardRect.x - 5, y: cardRect.y - 5, width: 40, height: 40 }
    });
    // Top-right corner
    await page.screenshot({
      path: '/tmp/corners-tr.png',
      clip: { x: cardRect.x + cardRect.w - 35, y: cardRect.y - 5, width: 40, height: 40 }
    });
    // Bottom-left corner
    await page.screenshot({
      path: '/tmp/corners-bl.png',
      clip: { x: cardRect.x - 5, y: cardRect.y + cardRect.h - 35, width: 40, height: 40 }
    });
    // Bottom-right corner
    await page.screenshot({
      path: '/tmp/corners-br.png',
      clip: { x: cardRect.x + cardRect.w - 35, y: cardRect.y + cardRect.h - 35, width: 40, height: 40 }
    });
  }

  // Check computed border-radius on the card and its children
  const styles = await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const visible = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    if (!visible) return null;

    const children = Array.from(visible.children);
    const result = [{
      name: '.carousel-slide',
      borderRadius: getComputedStyle(visible).borderRadius,
      overflow: getComputedStyle(visible).overflow,
      rect: visible.getBoundingClientRect(),
    }];

    for (const child of children) {
      const cs = getComputedStyle(child);
      const r = child.getBoundingClientRect();
      result.push({
        name: child.className,
        borderRadius: cs.borderRadius,
        overflow: cs.overflow,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        bg: cs.backgroundColor,
      });
    }
    return result;
  });

  console.log('\nCard structure:');
  styles?.forEach(s => {
    console.log(`  ${s.name}: radius=${s.borderRadius} overflow=${s.overflow} rect=${JSON.stringify(s.rect)} bg=${s.bg || '-'}`);
  });

  await browser.close();
  console.log('\nDone!');
})();

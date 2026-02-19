import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('#input-firstName', '도현');
  await page.waitForTimeout(300);

  // Test each indicator position (0, 1, 2, 3)
  for (let activeIdx = 0; activeIdx < 4; activeIdx++) {
    await page.evaluate((idx) => {
      // Remove previous overlay
      const prev = document.querySelector('.cover-model-overlay');
      if (prev) prev.remove();

      const slides = Array.from(document.querySelectorAll('.carousel-slide'));
      const slide = slides.find(s => {
        const r = s.getBoundingClientRect();
        return r.left >= 0 && r.left < 400;
      });
      if (!slide) return;
      const overlay = document.createElement('div');
      overlay.className = 'cover-model-overlay';
      const options = [0,1,2,3].map(i => {
        const cls = i === idx ? 'model-toggle-option active' : 'model-toggle-option';
        return `<div class="${cls}" data-model="m${i}" data-idx="${i}">${i+1}</div>`;
      }).join('');
      overlay.innerHTML = `
        <div class="model-toggle model-toggle-large">
          <div class="model-toggle-indicator" style="transform:translateX(${idx * 46}px)"></div>
          ${options}
        </div>
        <div class="model-toggle-hint">숫자를 눌러 배경이 가장 잘 지워진 사진을 골라주세요</div>
      `;
      slide.appendChild(overlay);
    }, activeIdx);
    await page.waitForTimeout(200);

    const overlayRect = await page.evaluate(() => {
      const el = document.querySelector('.cover-model-overlay');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

    if (overlayRect) {
      await page.screenshot({
        path: `/tmp/toggle-pos-${activeIdx}.png`,
        clip: { x: overlayRect.x, y: overlayRect.y - 10, width: overlayRect.width, height: overlayRect.height + 20 }
      });
    }
  }

  await browser.close();
  console.log('Done!');
})();

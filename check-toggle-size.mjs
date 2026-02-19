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

  // Inject fake model toggle overlay into cover slide for visual check
  await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const slide = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    if (!slide) return;
    const overlay = document.createElement('div');
    overlay.className = 'cover-model-overlay';
    overlay.innerHTML = `
      <div class="model-toggle model-toggle-large">
        <div class="model-toggle-option active" data-model="portrait">1</div>
        <div class="model-toggle-option" data-model="ben2">2</div>
        <div class="model-toggle-option" data-model="hr-matting">3</div>
        <div class="model-toggle-option model-toggle-loading" data-model="removebg">4</div>
      </div>
      <div class="model-toggle-hint">숫자를 눌러 배경이 가장 잘 지워진 사진을 골라주세요</div>
    `;
    slide.appendChild(overlay);
  });
  await page.waitForTimeout(300);

  await page.screenshot({ path: '/tmp/toggle-size-full.png' });

  // Zoomed on the toggle area
  const overlayRect = await page.evaluate(() => {
    const el = document.querySelector('.cover-model-overlay');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  if (overlayRect) {
    console.log('Overlay rect:', JSON.stringify(overlayRect));
  }

  await browser.close();
  console.log('Done!');
})();

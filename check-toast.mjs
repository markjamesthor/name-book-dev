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

  // Inject toggle with one loading option + simulate toast
  await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const slide = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    if (!slide) return;
    const overlay = document.createElement('div');
    overlay.className = 'cover-model-overlay';
    overlay.style.position = 'relative';
    overlay.innerHTML = `
      <div class="toggle-toast">배경을 지우는 중입니다</div>
      <div class="model-toggle model-toggle-large">
        <div class="model-toggle-indicator" style="transform:translateX(0px)"></div>
        <div class="model-toggle-option active" data-model="portrait" data-idx="0">1</div>
        <div class="model-toggle-option model-toggle-loading" data-model="ben2" data-idx="1">2</div>
        <div class="model-toggle-option" data-model="hr-matting" data-idx="2">3</div>
      </div>
      <div class="model-toggle-hint">숫자를 눌러 배경이 가장 잘 지워진 사진을 골라주세요</div>
    `;
    slide.appendChild(overlay);
  });
  await page.waitForTimeout(300);

  const overlayRect = await page.evaluate(() => {
    const el = document.querySelector('.cover-model-overlay');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 40), width: r.width + 20, height: r.height + 50 };
  });

  if (overlayRect) {
    await page.screenshot({
      path: '/tmp/toggle-toast.png',
      clip: overlayRect
    });
  }

  await page.screenshot({ path: '/tmp/toggle-toast-full.png' });

  await browser.close();
  console.log('Done!');
})();

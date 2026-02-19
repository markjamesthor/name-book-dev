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

  // Inject a fake child photo with nudge + hint into the visible cover slide
  await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const slide = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    if (!slide) return;
    const wrap = slide.querySelector('.slide-img-wrap');
    if (!wrap) return;

    // Add a fake child wrap with nudge animation
    const childDiv = document.createElement('div');
    childDiv.className = 'cover-child-wrap nudge';
    childDiv.style.cssText = 'top:0;left:0;width:100%;height:100%;';
    const img = document.createElement('img');
    img.className = 'cover-child-img';
    img.src = 'NAME/cover_front.png'; // use existing image as placeholder
    img.style.cssText = 'height:70%;bottom:0;left:50%;transform:translateX(-50%)';
    childDiv.appendChild(img);
    wrap.appendChild(childDiv);

    // Add drag hint
    const hint = document.createElement('div');
    hint.className = 'cover-drag-hint';
    hint.textContent = '터치해서 위치를 조정하세요';
    wrap.appendChild(hint);
  });

  // Capture at different moments of the animation
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/nudge-0.png' });

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/nudge-1.png' });

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/nudge-2.png' });

  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/nudge-3.png' });

  await browser.close();
  console.log('Done!');
})();

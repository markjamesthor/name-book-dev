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

  // Inject a child photo with rotation applied
  await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.carousel-slide'));
    const slide = slides.find(s => {
      const r = s.getBoundingClientRect();
      return r.left >= 0 && r.left < 400;
    });
    if (!slide) return;
    const wrap = slide.querySelector('.slide-img-wrap');
    if (!wrap) return;

    // Simulate a rotated child
    const childDiv = document.createElement('div');
    childDiv.className = 'cover-child-wrap';
    childDiv.style.cssText = 'top:0;left:0;width:100%;height:100%;';
    const img = document.createElement('img');
    img.className = 'cover-child-img';
    img.src = 'NAME/cover_front.png';
    img.style.cssText = 'height:70%;bottom:0;left:50%;transform:translateX(-50%) rotate(0deg)';
    childDiv.appendChild(img);
    wrap.appendChild(childDiv);

    // Take screenshot at 0deg
    window._testImg = img;
  });

  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/rotate-0deg.png' });

  // Apply 15deg rotation
  await page.evaluate(() => {
    window._testImg.style.cssText = 'height:70%;bottom:0;left:50%;transform:translateX(-50%) rotate(15deg)';
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/rotate-15deg.png' });

  // Apply -10deg rotation
  await page.evaluate(() => {
    window._testImg.style.cssText = 'height:70%;bottom:0;left:50%;transform:translateX(-50%) rotate(-10deg)';
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/rotate-neg10deg.png' });

  await browser.close();
  console.log('Done!');
})();

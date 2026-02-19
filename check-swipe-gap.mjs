import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
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

  // At rest screenshot
  await page.screenshot({ path: '/tmp/swipe-gap-rest.png' });

  // Simulate mid-swipe by manually moving the track
  await page.evaluate(() => {
    const track = document.getElementById('carousel-track');
    const vw = document.getElementById('page-viewer').clientWidth;
    track.style.transition = 'none';
    // Shift 120px to the left (mid-swipe towards next page)
    track.style.transform = `translateX(-${vw + 120}px)`;
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: '/tmp/swipe-gap-mid.png' });

  // Reset
  await page.evaluate(() => {
    const track = document.getElementById('carousel-track');
    const vw = document.getElementById('page-viewer').clientWidth;
    track.style.transform = `translateX(-${vw}px)`;
  });

  await browser.close();
  console.log('Done!');
})();

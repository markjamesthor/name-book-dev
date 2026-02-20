import { chromium } from '@playwright/test';
import path from 'path';

const TEST_DIR = path.resolve('automation-prototype/test_images');

(async () => {
  // 데스크톱 (375x812)
  const browser = await chromium.launch();
  const ctx1 = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
  });
  const page1 = await ctx1.newPage();
  await page1.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page1.waitForTimeout(2000);
  await page1.evaluate(() => jumpToPage(1));
  await page1.waitForTimeout(2000);

  // 컨테이너 vs 프레임 좌표 확인
  const debug1 = await page1.evaluate(() => {
    const wrap = document.querySelector('.slide-frame .baby-frame-wrap');
    return wrap ? { left: wrap.style.left, top: wrap.style.top, w: wrap.style.width, h: wrap.style.height } : null;
  });
  console.log('Desktop coords:', JSON.stringify(debug1));
  await page1.screenshot({ path: '/tmp/frame-desktop.png' });

  // iPhone SE 비율 (375x667)
  const ctx2 = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 3,
  });
  const page2 = await ctx2.newPage();
  await page2.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(2000);
  await page2.evaluate(() => jumpToPage(1));
  await page2.waitForTimeout(2000);

  const debug2 = await page2.evaluate(() => {
    const wrap = document.querySelector('.slide-frame .baby-frame-wrap');
    return wrap ? { left: wrap.style.left, top: wrap.style.top, w: wrap.style.width, h: wrap.style.height } : null;
  });
  console.log('iPhone SE coords:', JSON.stringify(debug2));
  await page2.screenshot({ path: '/tmp/frame-iphonese.png' });

  // iPhone Pro Max 비율 (430x932)
  const ctx3 = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
  });
  const page3 = await ctx3.newPage();
  await page3.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page3.waitForTimeout(2000);
  await page3.evaluate(() => jumpToPage(1));
  await page3.waitForTimeout(2000);

  const debug3 = await page3.evaluate(() => {
    const wrap = document.querySelector('.slide-frame .baby-frame-wrap');
    return wrap ? { left: wrap.style.left, top: wrap.style.top, w: wrap.style.width, h: wrap.style.height } : null;
  });
  console.log('iPhone Pro Max coords:', JSON.stringify(debug3));
  await page3.screenshot({ path: '/tmp/frame-iphonemax.png' });

  await browser.close();

  console.log('Done!');
})();

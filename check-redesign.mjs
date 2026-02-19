import { chromium } from 'playwright';

const browser = await chromium.launch();

// Mobile (375x812)
const mobile = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
await mobile.goto('http://localhost:8765/book-preview.html', { waitUntil: 'networkidle', timeout: 15000 });
await mobile.waitForTimeout(1000);

// Step 0: 이름
await mobile.screenshot({ path: '/tmp/redesign-mobile-step0.png' });

// Step 1: 페이지
await mobile.click('[data-step="1"]');
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: '/tmp/redesign-mobile-step1.png' });

// Step 2: 사진
await mobile.click('[data-step="2"]');
await mobile.waitForTimeout(300);
await mobile.screenshot({ path: '/tmp/redesign-mobile-step2.png' });

// Navigate to page 3 and back to step 1
await mobile.click('[data-step="1"]');
await mobile.waitForTimeout(300);
// Click a non-cover thumbnail if available
const thumbs = await mobile.$$('.thumb');
if (thumbs.length > 2) {
  await thumbs[2].click();
  await mobile.waitForTimeout(500);
}
await mobile.screenshot({ path: '/tmp/redesign-mobile-page3.png' });

// Desktop (1440x900)
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto('http://localhost:8765/book-preview.html', { waitUntil: 'networkidle', timeout: 15000 });
await desktop.waitForTimeout(1000);
await desktop.screenshot({ path: '/tmp/redesign-desktop.png' });

// Desktop step 1
await desktop.click('[data-step="1"]');
await desktop.waitForTimeout(300);
await desktop.screenshot({ path: '/tmp/redesign-desktop-step1.png' });

console.log('All screenshots saved to /tmp/redesign-*.png');
await browser.close();

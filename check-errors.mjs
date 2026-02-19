import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', err => errors.push('PAGE ERROR: ' + err.message));

await page.goto('http://localhost:8765/book-preview.html', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1500);

// 스텝 전환
for (const step of [1, 2, 0, 1]) {
  await page.click(`[data-step="${step}"]`);
  await page.waitForTimeout(300);
}

// 썸네일 클릭 (페이지 이동)
const thumbs = await page.$$('.thumb');
if (thumbs.length > 3) {
  await thumbs[3].click();
  await page.waitForTimeout(500);
  await thumbs[0].click(); // 커버로 이동
  await page.waitForTimeout(500);
}

if (errors.length === 0) {
  console.log('✅ No JS errors');
} else {
  console.log('❌ JS Errors:');
  errors.forEach(e => console.log('  ', e));
}

await browser.close();

import { chromium } from 'playwright';
import path from 'path';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// API 요청 시간 측정
const apiTimes = {};
page.on('request', req => {
  if (req.url().includes('/remove-bg') || req.url().includes('/smart-crop')) {
    apiTimes[req.url()] = Date.now();
  }
});
page.on('response', resp => {
  const url = resp.url();
  if (apiTimes[url]) {
    const model = new URL(url).searchParams.get('model') || 'smart-crop';
    const elapsed = ((Date.now() - apiTimes[url]) / 1000).toFixed(2);
    console.log(`  ${model}: ${elapsed}s (${resp.status()})`);
    delete apiTimes[url];
  }
});

await page.goto('http://localhost:8080/book-preview.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const fileInput = await page.$('#cover-photo-input');

console.log('\n=== 속도 테스트 (사전 로드 후) ===');
const t0 = Date.now();
await fileInput.setInputFiles(path.resolve('automation-prototype/NAME/IMG_7974.PNG'));
await page.waitForSelector('.cover-child-img', { timeout: 60000 });
const t1 = Date.now();
console.log(`\n총 소요시간 (업로드→첫 결과): ${((t1 - t0) / 1000).toFixed(2)}s`);

// 3개 모델 모두 완료 대기
await page.waitForTimeout(5000);
const t2 = Date.now();
console.log(`총 소요시간 (업로드→전체 완료): ${((t2 - t0) / 1000).toFixed(2)}s`);

await browser.close();

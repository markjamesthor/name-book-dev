import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
await page.goto('http://localhost:8765/book-preview.html', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(1000);

// 각 스텝별 bottom panel & viewer 높이 측정
const heights = {};
for (const step of [0, 1, 2]) {
  await page.click(`[data-step="${step}"]`);
  await page.waitForTimeout(200);
  const bp = await page.$eval('.bottom-panel', el => el.getBoundingClientRect().height);
  const vw = await page.$eval('#page-viewer', el => el.getBoundingClientRect().height);
  heights[`step${step}`] = { bottom: Math.round(bp), viewer: Math.round(vw) };
}

console.log('Layout heights per step:');
for (const [k, v] of Object.entries(heights)) {
  console.log(`  ${k}: bottom=${v.bottom}px, viewer=${v.viewer}px`);
}

const viewerShift12 = Math.abs(heights.step1.viewer - heights.step2.viewer);
console.log(`\nViewer shift Step1↔Step2: ${viewerShift12}px ${viewerShift12 === 0 ? '✅ No shift!' : '⚠️ SHIFT!'}`);

// 각 스텝 스크린샷
for (const step of [0, 1, 2]) {
  await page.click(`[data-step="${step}"]`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `/tmp/layout-step${step}.png` });
}

await browser.close();

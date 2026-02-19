import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => {
    const loading = document.getElementById('loading');
    return loading && loading.style.display === 'none';
}, { timeout: 60000 });

// 자세 판단 영역으로 스크롤
await page.evaluate(() => {
    const el = document.getElementById('posture-result');
    el?.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(300);

const controls = await page.$('#controls');
await controls.screenshot({ path: '/tmp/posture-check.png' });

console.log('Done');
await browser.close();

import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });

await page.goto('http://localhost:8080/bg-remove.html', { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(500);

await page.screenshot({ path: '/tmp/bg-remove-ui.png', fullPage: true });
console.log('Screenshot saved: /tmp/bg-remove-ui.png');

await browser.close();

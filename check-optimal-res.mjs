import { chromium } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const ROOT = '/Users/taehoonjth/Desktop/DEV/monviestory/automation-prototype';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = createServer((req, res) => {
    const filePath = join(ROOT, req.url === '/' ? 'bg-remove.html' : req.url);
    if (!existsSync(filePath)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
});
server.listen(8899);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 400 } });
await page.goto('http://localhost:8899/bg-remove.html');
await page.waitForTimeout(500);

const models = ['portrait', 'hr', 'hr-matting', 'dynamic', 'rmbg2', 'ben2', 'removebg'];
for (const m of models) {
    await page.locator(`label[for="m-${m}"]`).click();
    await page.waitForTimeout(200);
    const val = await page.locator('#res-value').textContent();
    console.log(`${m.padEnd(12)} → ${val}`);
}

await page.screenshot({ path: '/tmp/optimal_res_ui.png' });
console.log('\nScreenshot saved to /tmp/optimal_res_ui.png');
await browser.close();
server.close();

import { chromium } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const ROOT = '/Users/taehoonjth/Desktop/DEV/monviestory/automation-prototype';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.mjs': 'application/javascript' };

const server = createServer((req, res) => {
    const filePath = join(ROOT, req.url === '/' ? 'bg-remove.html' : req.url);
    if (!existsSync(filePath)) { res.writeHead(404); res.end(); return; }
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
});
server.listen(8899);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 900 } });
page.on('console', msg => console.log(`[browser] ${msg.type()}: ${msg.text()}`));

await page.goto('http://localhost:8899/bg-remove.html');
await page.waitForTimeout(1000);

// Upload test image
await page.locator('#file-input').setInputFiles(join(ROOT, 'test_images/IMG_7249.jpg'));

// Wait for first processing (portrait) to complete
await page.waitForFunction(() => document.getElementById('compare-section').classList.contains('visible'), { timeout: 120000 });
console.log('Portrait done. Switching to remove.bg...');
await page.waitForTimeout(500);

// Switch to remove.bg
await page.locator('label[for="m-removebg"]').click();

// Wait for remove.bg processing
await page.waitForTimeout(1000);
await page.waitForFunction(() => {
    const overlay = document.getElementById('loading-overlay');
    return !overlay.classList.contains('visible') &&
           document.getElementById('compare-section').classList.contains('visible');
}, { timeout: 120000 });
await page.waitForTimeout(1000);

await page.screenshot({ path: '/tmp/removebg_ui_result.png', fullPage: true });
console.log('Screenshot saved to /tmp/removebg_ui_result.png');

await browser.close();
server.close();

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
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
page.on('console', msg => console.log(`[browser] ${msg.type()}: ${msg.text()}`));

await page.goto('http://localhost:8899/bg-remove.html');
await page.waitForTimeout(500);

// Upload test image
await page.locator('#file-input').setInputFiles(join(ROOT, 'test_images/IMG_7249.jpg'));

// Wait for portrait processing
await page.waitForFunction(() => document.getElementById('compare-section').classList.contains('visible'), { timeout: 120000 });
console.log('Portrait (none) done');
await page.waitForTimeout(500);

// Switch to Guided Filter
await page.locator('label[for="r-guided"]').click();
await page.waitForTimeout(1000);
await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    return !o.classList.contains('visible') && document.getElementById('compare-section').classList.contains('visible');
}, { timeout: 120000 });
console.log('Guided Filter done');
await page.waitForTimeout(500);

await page.screenshot({ path: '/tmp/refine_ui.png', fullPage: true });
console.log('Screenshot saved');

await browser.close();
server.close();

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

await page.goto('http://localhost:8899/bg-remove.html');
await page.waitForTimeout(500);

// Upload test image
await page.locator('#file-input').setInputFiles(join(ROOT, 'test_images/IMG_7249.jpg'));

// Wait for first processing
await page.waitForFunction(() => document.getElementById('compare-section').classList.contains('visible'), { timeout: 120000 });
await page.waitForTimeout(500);

// Screenshot each refine method
const refines = [
    { id: 'r-none', name: 'none' },
    { id: 'r-guided', name: 'guided' },
    { id: 'r-pymatting', name: 'pymatting' },
    { id: 'r-fg', name: 'fg_estimate' },
];

for (const r of refines) {
    await page.locator(`label[for="${r.id}"]`).click();
    await page.waitForTimeout(500);

    // Wait for processing to finish
    await page.waitForFunction(() => {
        const o = document.getElementById('loading-overlay');
        return !o.classList.contains('visible') && document.getElementById('compare-section').classList.contains('visible');
    }, { timeout: 120000 });
    await page.waitForTimeout(500);

    // Crop just the preview section for comparison
    await page.screenshot({ path: `/tmp/refine_${r.name}.png`, fullPage: true });
    console.log(`${r.name} done`);
}

console.log('\nAll screenshots saved to /tmp/refine_*.png');
await browser.close();
server.close();

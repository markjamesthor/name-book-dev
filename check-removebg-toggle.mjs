import { chromium } from 'playwright';

const PORT = 8080;
const browser = await chromium.launch();

// Desktop
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await desktop.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.waitForTimeout(500);

// top-bar 영역 스크린샷 (removebg 토글 확인)
const topBar = await desktop.$('.top-bar');
await topBar.screenshot({ path: '/tmp/removebg-topbar-desktop.png' });

// 토글 클릭해서 활성화
await desktop.click('#removebg-toggle');
await desktop.waitForTimeout(300);
await topBar.screenshot({ path: '/tmp/removebg-topbar-desktop-active.png' });

// Mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForTimeout(500);

const mTopBar = await mobile.$('.top-bar');
await mTopBar.screenshot({ path: '/tmp/removebg-topbar-mobile.png' });

// 토글 클릭해서 활성화
await mobile.click('#removebg-toggle');
await mobile.waitForTimeout(300);
await mTopBar.screenshot({ path: '/tmp/removebg-topbar-mobile-active.png' });

console.log('Done — screenshots at /tmp/removebg-topbar-*.png');
await browser.close();

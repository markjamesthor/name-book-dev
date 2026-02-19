import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

// HEIC → JPEG 변환 (Playwright Chromium은 HEIC 미지원)
const heicPath = '/Users/taehoonjth/Downloads/IMG_7938.HEIC';
const jpegPath = '/tmp/IMG_7938_test.jpg';
if (!existsSync(jpegPath)) {
  execSync(`sips -s format jpeg "${heicPath}" --out "${jpegPath}"`);
  console.log('HEIC → JPEG 변환 완료');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

// Console log 수집
page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

await page.goto('http://localhost:8080/book-preview.html', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

// Upload JPEG
const fileInput = await page.$('#cover-photo-input');
await fileInput.setInputFiles(jpegPath);
console.log('--- Photo uploaded, waiting... ---');

// Wait for model selection or single result
await page.waitForFunction(() => {
  return window.isSelectingModel === true || (window.coverPhotoURL !== null && !window.isRemovingBg);
}, { timeout: 180000 });
await page.waitForTimeout(1000);

const state1 = await page.evaluate(() => ({
  isSelectingModel,
  hasOptions: !!coverPhotoOptions,
  hasCoverPhoto: !!coverPhotoURL,
  coverCropData: coverCropData ? {
    refY: coverCropData.refY,
    refHeight: coverCropData.refHeight,
  } : null,
}));
console.log('--- State after processing:', JSON.stringify(state1, null, 2));

// Screenshot: model selection
await page.screenshot({ path: '/tmp/pos-debug2-select.png', fullPage: false });

// Select portrait
if (state1.isSelectingModel) {
  await page.click('.model-option[data-model="portrait"]');
  await page.waitForTimeout(1000);
}

// Check position
const posData = await page.evaluate(() => {
  const pos = computeChildPosition();
  return {
    position: pos,
    cropData: coverCropData ? {
      refY: coverCropData.refY,
      refHeight: coverCropData.refHeight,
      serverCropY: coverCropData.serverCropY,
      serverCropHeight: coverCropData.serverCropHeight,
    } : null,
  };
});
console.log('--- Position:', JSON.stringify(posData, null, 2));

// Screenshot: result
await page.screenshot({ path: '/tmp/pos-debug2-result.png', fullPage: false });

// Zoom into cover
const coverWrap = await page.$('.carousel-slide:nth-child(2) .slide-img-wrap');
if (coverWrap) {
  await coverWrap.screenshot({ path: '/tmp/pos-debug2-cover-zoom.png' });
}

await browser.close();
console.log('Done');

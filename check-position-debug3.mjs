import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const heicPath = '/Users/taehoonjth/Downloads/IMG_7938.HEIC';
const jpegPath = '/tmp/IMG_7938_test.jpg';
if (!existsSync(jpegPath)) {
  execSync(`sips -s format jpeg "${heicPath}" --out "${jpegPath}"`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', msg => console.log(`[B] ${msg.text()}`));

await page.goto('http://localhost:8080/book-preview.html', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

// Upload
await page.setInputFiles('#cover-photo-input', jpegPath);
console.log('--- Uploaded ---');

// Wait for processing: coverPhotoURL set OR isSelectingModel true
// Poll with generous timeout — remove-bg can take 15+ seconds
await page.waitForFunction(() => {
  return window.coverPhotoURL !== null || window.isSelectingModel === true;
}, { timeout: 300000, polling: 300 });
console.log('--- First result available ---');

// Extra wait for second model to finish
await page.waitForTimeout(15000);

const state = await page.evaluate(() => ({
  isSelectingModel,
  hasOptions: !!coverPhotoOptions,
  portraitCrop: coverPhotoOptions?.portrait ? { cropY: coverPhotoOptions.portrait.cropY, cropH: coverPhotoOptions.portrait.cropH } : null,
  ben2Crop: coverPhotoOptions?.ben2 ? { cropY: coverPhotoOptions.ben2.cropY, cropH: coverPhotoOptions.ben2.cropH } : null,
  hasCoverPhoto: !!coverPhotoURL,
  coverCropData: coverCropData ? {
    refY: coverCropData.refY,
    refHeight: coverCropData.refHeight,
    serverCropY: coverCropData.serverCropY,
    serverCropHeight: coverCropData.serverCropHeight,
  } : null,
}));
console.log('--- State:', JSON.stringify(state, null, 2));

await page.screenshot({ path: '/tmp/pos3-after-load.png', fullPage: false });

// If selecting, pick portrait
if (state.isSelectingModel) {
  console.log('--- Clicking portrait ---');
  await page.click('.model-option[data-model="portrait"]');
  await page.waitForTimeout(1000);
}

// Final
const final = await page.evaluate(() => {
  const pos = computeChildPosition();
  return {
    position: pos,
    coverCropData: coverCropData ? {
      refY: coverCropData.refY,
      refHeight: coverCropData.refHeight,
      serverCropY: coverCropData.serverCropY,
      serverCropHeight: coverCropData.serverCropHeight,
    } : null,
  };
});
console.log('--- Final:', JSON.stringify(final, null, 2));

await page.screenshot({ path: '/tmp/pos3-final.png', fullPage: false });

const cover = await page.$('.carousel-slide:nth-child(2) .slide-img-wrap');
if (cover) await cover.screenshot({ path: '/tmp/pos3-cover-zoom.png' });

await browser.close();
console.log('Done');

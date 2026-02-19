import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

// Console log 수집
const logs = [];
page.on('console', msg => {
  logs.push(msg.text());
  console.log(`[CONSOLE] ${msg.text()}`);
});

await page.goto('http://localhost:8080/book-preview.html', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

// Upload the photo
const fileInput = await page.$('#cover-photo-input');
await fileInput.setInputFiles('/Users/taehoonjth/Downloads/IMG_7938.HEIC');
console.log('--- Photo uploaded, waiting for processing ---');

// Wait for loading to complete (both models)
await page.waitForFunction(() => {
  return window.isSelectingModel === true || (window.coverPhotoURL !== null && !window.isRemovingBg);
}, { timeout: 120000 });
await page.waitForTimeout(500);

// Screenshot: model selection state
await page.screenshot({ path: '/tmp/position-debug-select.png', fullPage: false });
console.log('--- Model selection UI screenshot taken ---');

// Check state
const state = await page.evaluate(() => ({
  isSelectingModel,
  hasCoverPhotoOptions: !!coverPhotoOptions,
  portraitOpt: coverPhotoOptions?.portrait ? { cropY: coverPhotoOptions.portrait.cropY, cropH: coverPhotoOptions.portrait.cropH } : null,
  ben2Opt: coverPhotoOptions?.ben2 ? { cropY: coverPhotoOptions.ben2.cropY, cropH: coverPhotoOptions.ben2.cropH } : null,
  coverCropData: coverCropData ? { refY: coverCropData.refY, refHeight: coverCropData.refHeight, serverCropY: coverCropData.serverCropY, serverCropHeight: coverCropData.serverCropHeight } : null,
  hasKeypoints: !!coverCropData?.keypoints,
  keypointCount: coverCropData?.keypoints?.length,
}));
console.log('--- State:', JSON.stringify(state, null, 2));

// Select portrait model
await page.evaluate(() => {
  if (isSelectingModel && coverPhotoOptions) {
    selectCoverModel('portrait');
  }
});
await page.waitForTimeout(500);

// Check position computation
const posData = await page.evaluate(() => {
  const pos = computeChildPosition();
  return {
    position: pos,
    coverCropData: coverCropData ? {
      refY: coverCropData.refY,
      refHeight: coverCropData.refHeight,
      serverCropY: coverCropData.serverCropY,
      serverCropHeight: coverCropData.serverCropHeight,
      keypointNames: coverCropData.keypoints?.map(k => `${k.name}:${k.score.toFixed(2)}`),
      eyeKps: coverCropData.keypoints?.filter(k => k.name.includes('eye')).map(k => ({ name: k.name, y: k.y, score: k.score })),
      hipKps: coverCropData.keypoints?.filter(k => k.name.includes('hip') || k.name.includes('knee')).map(k => ({ name: k.name, y: k.y, score: k.score })),
    } : null,
  };
});
console.log('--- Position data:', JSON.stringify(posData, null, 2));

// Screenshot: after selection
await page.screenshot({ path: '/tmp/position-debug-result.png', fullPage: false });
console.log('--- Result screenshot taken ---');

// Zoomed cover view
const coverSlide = await page.$('.carousel-slide:nth-child(2) .slide-img-wrap');
if (coverSlide) {
  await coverSlide.screenshot({ path: '/tmp/position-debug-cover-zoom.png' });
  console.log('--- Cover zoom screenshot taken ---');
}

await browser.close();
console.log('Done');

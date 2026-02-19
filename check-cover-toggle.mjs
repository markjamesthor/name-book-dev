import { chromium } from '@playwright/test';
import path from 'path';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.fill('#input-firstName', '도현');
  await page.waitForTimeout(300);

  // Upload a test photo to trigger cover processing
  // For now, just check the cover without photo first
  await page.screenshot({ path: '/tmp/cover-toggle-before.png' });

  // Simulate having a cover photo by checking if cover-model-overlay appears
  // We need to check the structure when photo is uploaded
  // Let's check with a mock - set coverPhotoURL directly
  await page.evaluate(() => {
    // Check if there's a cover photo already
    const childImg = document.querySelector('.cover-child-img');
    const overlay = document.querySelector('.cover-model-overlay');
    console.log('Child img:', !!childImg);
    console.log('Model overlay:', !!overlay);
  });

  await page.screenshot({ path: '/tmp/cover-toggle-full.png' });

  await browser.close();
  console.log('Done!');
})();

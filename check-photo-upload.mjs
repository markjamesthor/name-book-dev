import { chromium } from '@playwright/test';
import path from 'path';

const TEST_DIR = path.resolve('test_images');
const testImages = [
  'IMG_5990.jpg',
  'IMG_5933.jpg',
  'IMG_9512.jpg',
  'IMG_5602.jpg',
  'IMG_6724.jpg',
  '10.jpg',
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:8765/automation-prototype/book-preview.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // ===== Page 17: Polaroid — Multi Upload =====
  await page.evaluate(() => {
    const pages = getPages();
    jumpToPage(pages.length - 1);
  });
  await page.waitForTimeout(1000);

  const [fc1] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.polaroid-slot[data-slot-key="polaroid_16_0"]'),
  ]);
  await fc1.setFiles(testImages.map(f => path.join(TEST_DIR, f)));
  await page.waitForTimeout(1000);

  await page.screenshot({ path: '/tmp/polaroid-multi-upload.png' });
  console.log('Captured: /tmp/polaroid-multi-upload.png');

  // ===== Drag Test via dispatchEvent =====
  const dragResult = await page.evaluate(() => {
    const slot = document.querySelector('.polaroid-slot[data-slot-key="polaroid_16_0"]');
    if (!slot) return { error: 'slot not found' };
    const container = slot.closest('.polaroid-container');
    const rect = slot.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Simulate mousedown
    slot.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, bubbles: true }));

    // Simulate mousemove (enough to pass threshold)
    for (let i = 1; i <= 15; i++) {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: cx + i * 5, clientY: cy + i * 3, bubbles: true }));
    }

    // Simulate mouseup
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const offset = polaroidOffsets.get('polaroid_16_0');
    return {
      slotLeft: slot.style.left,
      slotTop: slot.style.top,
      offset,
      dragJustEnded: polaroidDragJustEnded,
    };
  });
  console.log('Drag result:', JSON.stringify(dragResult, null, 2));

  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/polaroid-after-drag.png' });
  console.log('Captured: /tmp/polaroid-after-drag.png');

  // ===== Persistence check =====
  await page.evaluate(() => jumpToPage(5));
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const pages = getPages();
    jumpToPage(pages.length - 1);
  });
  await page.waitForTimeout(1000);

  const persistCheck = await page.evaluate(() => {
    const slots = document.querySelectorAll('.polaroid-slot');
    let filled = 0;
    const positions = [];
    slots.forEach(s => {
      if (s.querySelector('.polaroid-card img')) filled++;
      positions.push({ key: s.dataset.slotKey, left: s.style.left, top: s.style.top });
    });
    return { filledSlots: filled, offset0: polaroidOffsets.get('polaroid_16_0'), positions };
  });
  console.log('Persistence:', JSON.stringify(persistCheck, null, 2));

  await page.screenshot({ path: '/tmp/polaroid-persist.png' });
  console.log('Captured: /tmp/polaroid-persist.png');

  await browser.close();
  console.log('Done!');
})();

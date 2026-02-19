import { chromium } from 'playwright';

const PORT = 8080;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${PORT}/book-preview.html`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);

async function goTo(idx) {
  await page.evaluate((i) => { jumpToPage(i); }, idx);
  await page.waitForTimeout(500);
}

// A 버전: 총 페이지 수 확인
const totalA = await page.evaluate(() => getPages().length);
console.log(`A version total pages: ${totalA}`);

// scene 5 (왕궁의 오래된 서재) = index 6
await goTo(6);
await page.screenshot({ path: '/tmp/story-v15-A-scene5-library.png' });

// scene 6 (고대의 마법) = index 7
await goTo(7);
await page.screenshot({ path: '/tmp/story-v15-A-scene6-magic.png' });

// 에필로그 = 마지막 페이지
await goTo(totalA - 1);
await page.screenshot({ path: '/tmp/story-v15-A-epilogue.png' });
const counterA = await page.textContent('#page-counter-bottom');
console.log('A last page:', counterA);

// B 버전으로 전환
await page.evaluate(() => {
  currentVersion = 'B';
  document.querySelectorAll('[data-version]').forEach(b => b.classList.toggle('active', b.dataset.version === 'B'));
  jumpToPage(0);
});
await page.waitForTimeout(500);

const totalB = await page.evaluate(() => getPages().length);
console.log(`B version total pages: ${totalB}`);

// B scene 5 (왕궁의 오래된 서재) = index 6
await goTo(6);
await page.screenshot({ path: '/tmp/story-v15-B-scene5-library.png' });

// B 잃어버린 지팡이 (scene 14) = index 15
await goTo(15);
await page.screenshot({ path: '/tmp/story-v15-B-scene14-wand.png' });

// B 우리의 비밀 (scene 15) = index 16
await goTo(16);
await page.screenshot({ path: '/tmp/story-v15-B-scene15-secret.png' });

// B 에필로그
await goTo(totalB - 1);
await page.screenshot({ path: '/tmp/story-v15-B-epilogue.png' });
const counterB = await page.textContent('#page-counter-bottom');
console.log('B last page:', counterB);

console.log('Done — screenshots at /tmp/story-v15-*.png');
await browser.close();

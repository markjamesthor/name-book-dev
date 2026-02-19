import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });

await page.goto('http://localhost:8080/bg-remove.html', { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(500);

// 스마트 크롭 ON 먼저 체크
await page.locator('#smart-crop-check').check();

// 테스트 이미지 업로드
const fileInput = page.locator('#file-input');
await fileInput.setInputFiles('/Users/taehoonjth/Desktop/DEV/monviestory/automation-prototype/test_images/IMG_5602.jpg');

// 결과 대기
await page.waitForSelector('#compare-section.visible', { timeout: 120000 });
await page.waitForTimeout(500);

// 크롭 카드만 스크린샷
const croppedCard = page.locator('#cropped-card');
await croppedCard.screenshot({ path: '/tmp/smart-crop-card.png' });
console.log('크롭 카드 스크린샷: /tmp/smart-crop-card.png');

await browser.close();

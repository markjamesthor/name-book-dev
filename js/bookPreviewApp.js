/**
 * 노미네 왕국 — Book Preview Engine
 * Config-Driven 동화책 미리보기 (Carousel)
 */

// ========== Korean Language Helpers ==========

function hasBatchim(char) {
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return false;
  return (code - 0xAC00) % 28 !== 0;
}

function nameHasBatchim(name) {
  if (!name || name.length === 0) return false;
  return hasBatchim(name[name.length - 1]);
}

function casualName(firstName) {
  return nameHasBatchim(firstName) ? firstName + '이' : firstName;
}

function decomposeKorean(str) {
  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const letters = [];
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      letters.push(CHO[Math.floor(offset / (21 * 28))], JUNG[Math.floor((offset % (21 * 28)) / 28)]);
      if (offset % 28 !== 0) letters.push(JONG[offset % 28]);
    } else {
      letters.push(ch);
    }
  }
  return letters.join(', ');
}

// ========== Variable Substitution ==========

function substituteVars(text, vars) {
  if (!text) return '';
  return text
    .replace(/\{name\}/g, vars.name)
    .replace(/\{firstName\}/g, vars.firstName)
    .replace(/\{parentNames\}/g, vars.parentNames)
    .replace(/\{nameLetters\}/g, vars.nameLetters);
}

// ========== App State ==========
let config = null;
let currentVersion = 'A';
let currentPageIndex = 0;
let variables = {};
let isAnimating = false;
let coverPhotoURL = null;   // 배경 제거된 사진 blob URL
let isRemovingBg = false;   // 로딩 상태
let coverLoadingText = '';  // 단계별 로딩 텍스트

// ========== DOM ==========
const els = {};

function cacheDom() {
  els.firstNameInput = document.getElementById('input-firstName');
  els.parentNamesInput = document.getElementById('input-parentNames');
  els.mFirstNameInput = document.getElementById('m-input-firstName');
  els.mParentNamesInput = document.getElementById('m-input-parentNames');
  els.versionBtns = document.querySelectorAll('.version-btn');
  els.pageViewer = document.getElementById('page-viewer');
  els.pageTitle = document.getElementById('page-title');
  els.pageCounter = document.getElementById('page-counter');
  els.pageCounterBottom = document.getElementById('page-counter-bottom');
  els.mPageTitle = document.getElementById('m-page-title');
  els.mPageCounter = document.getElementById('m-page-counter');
  els.prevBtn = document.getElementById('btn-prev');
  els.nextBtn = document.getElementById('btn-next');
  els.mPrevBtn = document.getElementById('m-btn-prev');
  els.mNextBtn = document.getElementById('m-btn-next');
  els.thumbnailStrip = document.getElementById('thumbnail-strip');
  els.settingsBtn = document.getElementById('btn-settings');
  els.settingsOverlay = document.getElementById('settings-overlay');
  els.settingsBackdrop = document.getElementById('settings-backdrop');
}

// ========== Config Loading ==========

async function loadConfig() {
  try {
    const resp = await fetch('configs/name.config.json?t=' + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    config = await resp.json();
  } catch (e) {
    if (window.__BOOK_CONFIG) {
      config = window.__BOOK_CONFIG;
    } else {
      console.error('Config load failed:', e);
      els.pageViewer.innerHTML = '<div style="padding:40px;color:#f66;text-align:center;">Config 로드 실패.<br><code>python3 -m http.server 8765</code></div>';
      return;
    }
  }

  const fn = config.defaults.firstName;
  const pn = config.defaults.parentNames;
  els.firstNameInput.value = fn;
  els.parentNamesInput.value = pn;
  els.mFirstNameInput.value = fn;
  els.mParentNamesInput.value = pn;

  updateVariables();
  renderCarousel();
  renderThumbnails();
}

// ========== Variable Update ==========

function updateVariables() {
  const firstName = els.firstNameInput.value.trim() || config.defaults.firstName;
  const parentNames = els.parentNamesInput.value.trim() || config.defaults.parentNames;
  variables = {
    firstName,
    name: casualName(firstName),
    parentNames,
    nameLetters: decomposeKorean(firstName)
  };
}

function syncInputs(source) {
  if (source === 'desktop') {
    els.mFirstNameInput.value = els.firstNameInput.value;
    els.mParentNamesInput.value = els.parentNamesInput.value;
  } else {
    els.firstNameInput.value = els.mFirstNameInput.value;
    els.parentNamesInput.value = els.mParentNamesInput.value;
  }
}

// ========== Carousel ==========

function getPages() {
  const coverPage = {
    scene: '표지',
    title: '앞표지',
    isCover: true,
    bgGradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    textColor: 'white',
    textPosition: 'center'
  };
  return [coverPage, ...config.versions[currentVersion].pages];
}

function buildCoverContent() {
  const title = config.bookMeta.title;
  const subtitle = config.bookMeta.subtitle;

  let photoArea = '';
  if (isRemovingBg) {
    photoArea = `
      <div class="cover-loading">
        <div class="cover-spinner"></div>
        <div class="cover-loading-text">${coverLoadingText || '처리 중...'}</div>
      </div>`;
  } else if (coverPhotoURL) {
    photoArea = `
      <div class="cover-photo-result" id="cover-photo-result">
        <img class="cover-photo-img" src="${coverPhotoURL}" alt="아이 사진" />
        <div class="cover-photo-hint">탭하여 사진 변경</div>
      </div>`;
  } else {
    photoArea = `
      <div class="cover-photo-zone" id="cover-upload-zone">
        <div class="upload-icon">📷</div>
        <div class="upload-text">사진을 선택하세요</div>
      </div>`;
  }

  return `
    <div class="slide-img-wrap">
      <div class="page-bg-gradient" style="background:linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)"></div>
    </div>
    <div class="cover-layout">
      <div class="cover-title">${title}</div>
      <div class="cover-subtitle">${subtitle.replace(/\s/g, '<br>')}</div>
      ${photoArea}
    </div>`;
}

function buildSlideContent(pageIndex) {
  const pages = getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) return '';

  const page = pages[pageIndex];

  // Cover page — special rendering
  if (page.isCover) return buildCoverContent();

  let imgContent = '';
  if (page.illustration && config.illustrations[page.illustration]) {
    const imgPath = config.illustrations[page.illustration];
    imgContent = `<div class="page-bg-blur" style="background-image:url('${imgPath}')"></div>
      <img class="page-bg-img" src="${imgPath}" alt="${page.title}" />`;
  } else if (page.bgGradient) {
    imgContent = `<div class="page-bg-gradient" style="background:${page.bgGradient}"></div>`;
  }

  const text = substituteVars(page.text, variables);
  const textColor = page.textColor || 'white';
  const posClass = `text-pos-${page.textPosition || 'center'}`;

  return `
    <div class="slide-img-wrap">${imgContent}</div>
    <div class="page-text-overlay ${posClass}" style="color:${textColor}">
      <div class="page-story-text">${text.replace(/\n/g, '<br>')}</div>
    </div>`;
}

function renderCarousel() {
  const pages = getPages();
  if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
  if (currentPageIndex < 0) currentPageIndex = 0;

  const viewer = els.pageViewer;
  viewer.innerHTML = '<div class="carousel-track" id="carousel-track"></div>';

  const track = document.getElementById('carousel-track');
  // Create 3 slides: [prev, current, next]
  for (let i = -1; i <= 1; i++) {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    slide.innerHTML = buildSlideContent(currentPageIndex + i);
    track.appendChild(slide);
  }

  // Position to show center slide
  track.style.transition = 'none';
  track.style.transform = 'translateX(-33.333%)';

  updatePageInfo();
  setupCarouselTouch(track);
}

function populateSlides() {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  const slides = track.children;
  for (let i = 0; i < 3; i++) {
    slides[i].innerHTML = buildSlideContent(currentPageIndex + (i - 1));
  }
}

function updatePageInfo() {
  const pages = getPages();
  const page = pages[currentPageIndex];
  const canPrev = currentPageIndex > 0;
  const canNext = currentPageIndex < pages.length - 1;

  const label = page.isCover ? page.title : `${page.scene}. ${page.title}`;
  const counter = `${currentPageIndex + 1} / ${pages.length}`;

  els.pageTitle.textContent = label;
  els.pageCounter.textContent = counter;
  if (els.pageCounterBottom) els.pageCounterBottom.textContent = counter;
  if (els.mPageTitle) els.mPageTitle.textContent = label;
  if (els.mPageCounter) els.mPageCounter.textContent = counter;

  els.prevBtn.disabled = !canPrev;
  els.nextBtn.disabled = !canNext;
  if (els.mPrevBtn) els.mPrevBtn.disabled = !canPrev;
  if (els.mNextBtn) els.mNextBtn.disabled = !canNext;

  // Highlight active thumbnail
  document.querySelectorAll('.thumb').forEach((t, i) => {
    t.classList.toggle('active', i === currentPageIndex);
  });
  const activeThumb = document.querySelector('.thumb.active');
  if (activeThumb) {
    activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

// ========== Carousel Navigation ==========

function goPage(delta) {
  if (isAnimating) return;
  const pages = getPages();
  const next = currentPageIndex + delta;
  if (next < 0 || next >= pages.length) return;

  isAnimating = true;
  const track = document.getElementById('carousel-track');
  if (!track) { isAnimating = false; return; }

  // Animate to target slide
  track.style.transition = 'transform 0.35s ease-out';
  const targetPercent = delta > 0 ? -66.666 : 0;
  track.style.transform = `translateX(${targetPercent}%)`;

  const finalize = () => {
    currentPageIndex = next;
    // Reset without animation
    track.style.transition = 'none';
    populateSlides();
    track.style.transform = 'translateX(-33.333%)';
    // Force reflow
    track.offsetHeight;
    updatePageInfo();
    isAnimating = false;
  };

  track.addEventListener('transitionend', finalize, { once: true });
  // Fallback if transitionend doesn't fire
  setTimeout(() => { if (isAnimating) finalize(); }, 400);
}

function jumpToPage(targetIndex) {
  if (isAnimating || targetIndex === currentPageIndex) return;
  const pages = getPages();
  if (targetIndex < 0 || targetIndex >= pages.length) return;

  // Adjacent page → slide
  const diff = targetIndex - currentPageIndex;
  if (Math.abs(diff) === 1) {
    goPage(diff);
    return;
  }

  // Non-adjacent → crossfade
  isAnimating = true;
  const track = document.getElementById('carousel-track');
  if (!track) { isAnimating = false; return; }

  track.style.transition = 'opacity 0.25s ease-out';
  track.style.opacity = '0';

  setTimeout(() => {
    currentPageIndex = targetIndex;
    track.style.transition = 'none';
    populateSlides();
    track.style.transform = 'translateX(-33.333%)';
    track.offsetHeight;

    track.style.transition = 'opacity 0.25s ease-in';
    track.style.opacity = '1';

    updatePageInfo();
    setTimeout(() => { isAnimating = false; }, 260);
  }, 260);
}

// ========== Carousel Touch ==========

function setupCarouselTouch(track) {
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let deltaX = 0;
  let startTime = 0;

  track.addEventListener('touchstart', (e) => {
    if (isAnimating) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    isDragging = false;
    deltaX = 0;
    track.style.transition = 'none';
  }, { passive: true });

  track.addEventListener('touchmove', (e) => {
    if (isAnimating) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Determine direction on first significant move
    if (!isDragging) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        isDragging = true;
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        return; // vertical scroll, don't interfere
      } else {
        return;
      }
    }

    deltaX = dx;
    const viewerWidth = els.pageViewer.clientWidth;
    const pages = getPages();

    // Rubber band at edges
    let adjustedDx = deltaX;
    if (currentPageIndex === 0 && deltaX > 0) adjustedDx = deltaX * 0.25;
    if (currentPageIndex === pages.length - 1 && deltaX < 0) adjustedDx = deltaX * 0.25;

    const baseOffset = -viewerWidth; // center slide position
    track.style.transform = `translateX(${baseOffset + adjustedDx}px)`;
  }, { passive: true });

  track.addEventListener('touchend', () => {
    if (!isDragging || isAnimating) return;

    const viewerWidth = els.pageViewer.clientWidth;
    const pages = getPages();
    const velocity = Math.abs(deltaX) / (Date.now() - startTime); // px/ms
    const threshold = viewerWidth * 0.2;
    const fastSwipe = velocity > 0.4;

    track.style.transition = 'transform 0.3s ease-out';

    if ((deltaX < -threshold || (fastSwipe && deltaX < -30)) && currentPageIndex < pages.length - 1) {
      // Swipe left → next
      isAnimating = true;
      track.style.transform = `translateX(-${viewerWidth * 2}px)`;

      const finalize = () => {
        currentPageIndex++;
        track.style.transition = 'none';
        populateSlides();
        track.style.transform = 'translateX(-33.333%)';
        track.offsetHeight;
        updatePageInfo();
        isAnimating = false;
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (isAnimating) finalize(); }, 350);

    } else if ((deltaX > threshold || (fastSwipe && deltaX > 30)) && currentPageIndex > 0) {
      // Swipe right → prev
      isAnimating = true;
      track.style.transform = 'translateX(0px)';

      const finalize = () => {
        currentPageIndex--;
        track.style.transition = 'none';
        populateSlides();
        track.style.transform = 'translateX(-33.333%)';
        track.offsetHeight;
        updatePageInfo();
        isAnimating = false;
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (isAnimating) finalize(); }, 350);

    } else {
      // Snap back
      track.style.transform = 'translateX(-33.333%)';
    }
  }, { passive: true });
}

// ========== Thumbnails ==========

function renderThumbnails() {
  const pages = getPages();
  const strip = els.thumbnailStrip;
  strip.innerHTML = '';

  pages.forEach((page, i) => {
    const thumb = document.createElement('div');
    thumb.className = `thumb ${i === currentPageIndex ? 'active' : ''}`;

    if (page.isCover) {
      thumb.innerHTML = `<div class="thumb-gradient" style="background:linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)"></div><div class="thumb-cover">표지</div>`;
    } else if (page.illustration && config.illustrations[page.illustration]) {
      const imgPath = config.illustrations[page.illustration];
      thumb.innerHTML = `<img src="${imgPath}" alt="${page.title}" /><span class="thumb-label">${page.scene}</span>`;
    } else {
      thumb.innerHTML = `<div class="thumb-gradient" style="background:${page.bgGradient || '#333'}"></div><span class="thumb-label">${page.scene}</span>`;
    }

    thumb.addEventListener('click', () => jumpToPage(i));
    strip.appendChild(thumb);
  });
}

// ========== Cover Photo (smart crop + remove.bg) ==========

const SMART_CROP_API = 'http://localhost:5001';

async function smartCropPerson(file) {
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetch(`${SMART_CROP_API}/smart-crop?crop_mode=person&seg_size=512`, {
    method: 'POST',
    body: formData
  });
  if (!resp.ok) return null;
  return await resp.json();
}

function cropImageOnCanvas(file, coords) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = coords.width;
      canvas.height = coords.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, coords.x, coords.y, coords.width, coords.height, 0, 0, coords.width, coords.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('크롭 Blob 생성 실패'));
      }, 'image/jpeg', 0.95);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function handleCoverPhoto(file) {
  if (isRemovingBg) return;
  isRemovingBg = true;
  coverLoadingText = '인물을 감지하는 중...';
  renderCarousel();
  renderThumbnails();

  try {
    // Step 1: 스마트 크롭 — 인물 영역 감지
    let fileToSend = file;
    try {
      const cropResult = await smartCropPerson(file);
      if (cropResult && cropResult.cropped && cropResult.crop) {
        console.log('스마트 크롭 적용:', cropResult.crop);
        const croppedBlob = await cropImageOnCanvas(file, cropResult.crop);
        fileToSend = new File([croppedBlob], file.name, { type: 'image/jpeg' });
      }
    } catch (e) {
      console.warn('스마트 크롭 스킵 (서버 미연결):', e.message);
    }

    // Step 2: remove.bg 배경 제거
    coverLoadingText = '배경을 지우는 중...';
    renderCarousel();

    const formData = new FormData();
    formData.append('image_file', fileToSend);
    formData.append('size', 'auto');

    const resp = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': 'D8B2GQyMvmfbXXfH2mZukPi4' },
      body: formData
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`remove.bg 오류: ${resp.status} ${errText}`);
    }

    const blob = await resp.blob();
    if (coverPhotoURL) URL.revokeObjectURL(coverPhotoURL);
    coverPhotoURL = URL.createObjectURL(blob);
  } catch (e) {
    console.error('배경 제거 실패:', e);
    alert('배경 제거에 실패했습니다.\n' + e.message);
  } finally {
    isRemovingBg = false;
    coverLoadingText = '';
    renderCarousel();
    renderThumbnails();
  }
}

function setupCoverEvents() {
  const fileInput = document.getElementById('cover-photo-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleCoverPhoto(file);
    fileInput.value = ''; // reset so same file can be re-selected
  });

  // Delegate click on cover upload zone / photo result
  document.addEventListener('click', (e) => {
    if (e.target.closest('#cover-upload-zone') || e.target.closest('#cover-photo-result')) {
      fileInput.click();
    }
  });
}

// ========== Event Handlers ==========

function setupEvents() {
  els.firstNameInput.addEventListener('input', () => { syncInputs('desktop'); updateVariables(); renderCarousel(); });
  els.parentNamesInput.addEventListener('input', () => { syncInputs('desktop'); updateVariables(); renderCarousel(); });
  els.mFirstNameInput.addEventListener('input', () => { syncInputs('mobile'); updateVariables(); renderCarousel(); });
  els.mParentNamesInput.addEventListener('input', () => { syncInputs('mobile'); updateVariables(); renderCarousel(); });

  els.versionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.versionBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll(`.version-btn[data-version="${btn.dataset.version}"]`)
        .forEach(b => b.classList.add('active'));
      currentVersion = btn.dataset.version;
      const pages = getPages();
      if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
      renderCarousel();
      renderThumbnails();
    });
  });

  els.prevBtn.addEventListener('click', () => goPage(-1));
  els.nextBtn.addEventListener('click', () => goPage(1));
  if (els.mPrevBtn) els.mPrevBtn.addEventListener('click', () => goPage(-1));
  if (els.mNextBtn) els.mNextBtn.addEventListener('click', () => goPage(1));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') goPage(-1);
    else if (e.key === 'ArrowRight') goPage(1);
  });

  if (els.settingsBtn) {
    els.settingsBtn.addEventListener('click', () => els.settingsOverlay.classList.add('open'));
  }
  if (els.settingsBackdrop) {
    els.settingsBackdrop.addEventListener('click', () => els.settingsOverlay.classList.remove('open'));
  }
}

// ========== Init ==========

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  setupEvents();
  setupCoverEvents();
  loadConfig();
});

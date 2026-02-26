/**
 * 노미네 왕국 — Book Preview Engine
 * Config-Driven 동화책 미리보기 (Carousel)
 * Casetify-style 3-step mobile-first UI
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
let currentStep = 0; // 0=사진, 1=페이지, 2=스토리설정(바텀시트)
let variables = {};
let isAnimating = false;
let coverPhotoURL = null;
let isRemovingBg = false;
let coverLoadingText = '';
let coverErrorText = '';
let coverCropData = null;
let coverPhotoOptions = null;
let selectedModelKey = null;
let coverManualOffsets = {};  // modelKey → { dx, dy, rotation, scale }
// 현재 선택된 모델의 오프셋 접근 헬퍼
function getCoverOffset() {
  if (!selectedModelKey) return { dx: 0, dy: 0, rotation: 0, scale: 1 };
  if (!coverManualOffsets[selectedModelKey]) coverManualOffsets[selectedModelKey] = { dx: 0, dy: 0, rotation: 0, scale: 1 };
  const mo = coverManualOffsets[selectedModelKey];
  if (mo.scale == null) mo.scale = 1;
  return mo;
}
let isEditingCoverPos = false;
let coverCroppedFile = null;

// 특수 페이지 사진 상태 (key: "frame_0" 또는 "album_18_0" → { file, url, img })
const pagePhotos = new Map();

// ========== Epilogue Album State ==========
let albumPhotos = [];       // flat array of Image objects (null = empty)
let albumPhotoURLs = [];    // flat array of object URLs
let albumSelectedSlot = -1; // currently selected slot index (-1 = none)
let albumFrameImages = [];  // preloaded frame Image objects
let albumPendingSlot = -1;
let albumPendingPageUpload = null;
let albumDragState = null;
let albumToastTimer = null;

// Multi-candidate cover photo system
let coverCandidates = [];
let activeCandidateIndex = -1;
let nextCandidateId = 0;
let pendingNudge = false; // trigger nudge after first bg-remove result

// Processing queue — one candidate at a time to avoid overwhelming the server
let processingQueue = [];
let isProcessingQueue = false;
let useRemoveBg = localStorage.getItem('bookPreview_useRemoveBg') !== 'false';

const COVER_PIPELINES = [
  { key: 'crop-ben2', label: '1', steps: [
    { type: 'crop', params: { padding: 10 } },
    { type: 'ben2', params: { maxSize: 1024 } },
  ]},
  { key: 'crop-removebg', label: '2', steps: [
    { type: 'crop', params: { padding: 10 } },
    { type: 'removebg', params: { removebgSize: 'preview' } },
  ]},
  { key: 'sam2-birefnet', label: '3', steps: [
    { type: 'sam2', params: { combine: true } },
    { type: 'birefnet-matting', params: { maxSize: 1024 } },
  ]},
  { key: 'sam2-vitmatte', label: '4', steps: [
    { type: 'sam2', params: { combine: true } },
    { type: 'vitmatte', params: { erode: 10, dilate: 20 } },
  ]},
  { key: 'crop-portrait', label: '5', steps: [
    { type: 'crop', params: { padding: 10 } },
    { type: 'portrait', params: { maxSize: 1024 } },
  ]},
];

// ========== DOM ==========
const els = {};

function cacheDom() {
  els.firstNameInput = document.getElementById('input-firstName');
  els.parentNamesInput = document.getElementById('input-parentNames');
  els.versionBtns = document.querySelectorAll('.version-btn');
  els.pageViewer = document.getElementById('page-viewer');
  els.pageCounter = document.getElementById('page-counter');
  els.thumbnailStrip = document.getElementById('thumbnail-strip');
  els.stepTabs = document.querySelectorAll('.step-tab');
  els.stepContents = document.querySelectorAll('.step-content');
  els.coverControls = document.getElementById('cover-controls');
}

// ========== Step System ==========

function setStep(step) {
  // Step 2 = story sheet overlay (바텀시트)
  if (step === 2) {
    openStorySheet();
    return;
  }
  currentStep = step;
  els.stepTabs.forEach(tab => {
    tab.classList.toggle('active', parseInt(tab.dataset.step) === step);
  });
  els.stepContents.forEach(content => {
    content.classList.toggle('active', content.id === `step-content-${step}`);
  });
  if (step === 0) renderCoverControls();
  if (step === 3) renderPrintControls();
}

function openStorySheet() {
  document.getElementById('story-sheet-backdrop').classList.add('open');
  document.getElementById('story-sheet').classList.add('open');
}

function closeStorySheet() {
  document.getElementById('story-sheet-backdrop').classList.remove('open');
  document.getElementById('story-sheet').classList.remove('open');
}

function onPageChanged() {
  const pages = getPages();
  const page = pages[currentPageIndex];
  if (page && page.isCover) {
    setStep(0);
  } else if (currentStep === 0) {
    setStep(1);
  }
  // Update cover controls visibility based on page type
  renderCoverControls();
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

  updateVariables();
  initAlbumArrays();
  preloadAlbumFrameImages(); // async, no await — loads in background
  renderCarousel();
  renderThumbnails();
  renderCoverControls();
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

// ========== Carousel ==========

function getPages() {
  const coverPage = {
    scene: '커버',
    title: '커버',
    isCover: true,
    illustration: 'cover_bg'
  };
  return [coverPage, ...config.versions[currentVersion].pages];
}

function padImageToRef(blob, cropX, cropY, refW, refH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = refW;
      canvas.height = refH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, cropX, cropY);
      canvas.toBlob(b => {
        URL.revokeObjectURL(blobUrl);
        resolve(URL.createObjectURL(b));
      }, 'image/webp', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('padImageToRef 이미지 로드 실패')); };
    img.src = blobUrl;
  });
}

function computeChildPositionWith(srvCropY, srvCropH) {
  if (!coverCropData || !coverCropData.keypoints) return null;

  const kps = coverCropData.keypoints;
  const refY = coverCropData.refY;
  const refH = coverCropData.refHeight;
  const cropY = srvCropY || 0;
  const cropH = srvCropH || refH;

  const refX = coverCropData.refX || 0;
  const refW = coverCropData.refWidth || 1;

  const findKpY = (name) => {
    const kp = kps.find(k => k.name === name && k.score > 0.3);
    if (!kp) return null;
    const posInSmartCrop = kp.y - refY;
    return (posInSmartCrop - cropY) / cropH;
  };

  const findKpX = (name) => {
    const kp = kps.find(k => k.name === name && k.score > 0.3);
    if (!kp) return null;
    return (kp.x - refX) / refW;
  };

  const eyeL = findKpY('left_eye');
  const eyeR = findKpY('right_eye');
  if (eyeL === null && eyeR === null) return null;
  const eyeY = eyeL !== null && eyeR !== null ? (eyeL + eyeR) / 2 : (eyeL || eyeR);
  const ey = Math.max(0.05, Math.min(0.95, eyeY));

  const eyeLx = findKpX('left_eye');
  const eyeRx = findKpX('right_eye');
  const eyeX = eyeLx !== null && eyeRx !== null ? (eyeLx + eyeRx) / 2
             : (eyeLx || eyeRx || 0.5);

  const hipL = findKpY('left_hip');
  const hipR = findKpY('right_hip');
  const kneeL = findKpY('left_knee');
  const kneeR = findKpY('right_knee');
  let hipY = null;
  if (hipL !== null || hipR !== null) {
    hipY = hipL !== null && hipR !== null ? (hipL + hipR) / 2 : (hipL || hipR);
  } else if (kneeL !== null || kneeR !== null) {
    hipY = kneeL !== null && kneeR !== null ? (kneeL + kneeR) / 2 : (kneeL || kneeR);
  }
  if (hipY === null || hipY - ey < 0.05) return null;

  const h = 50 / (hipY - ey);
  const t = 50 - ey * h;

  const leftOffset = 50 - eyeX * 100;

  console.log(`아이 배치: eye=${ey.toFixed(3)} hip=${hipY.toFixed(3)} eyeX=${eyeX.toFixed(3)} → height=${h.toFixed(1)}% top=${t.toFixed(1)}% leftOff=${leftOffset.toFixed(1)}%`);
  return { height: h, top: t, leftOffset };
}

function computeChildPosition() {
  return computeChildPositionWith(0, coverCropData?.refHeight);
}

// Build cover visual only (no controls — those go to renderCoverControls)
function buildCoverContent() {
  const bgPath = config.illustrations['cover_bg'];
  const coverTitle = `내 이름은 왜 ${variables.firstName}이야?`;
  const titleStyle = getCoverTitleStyle();
  const titleHtml = `<div class="cover-top-title"${titleStyle ? ` style="${titleStyle}"` : ''}><div class="cover-top-title-text">${coverTitle}</div></div>`;

  const frontStyle = getCoverLayoutStyle();
  let imgContent = `<div class="page-bg-blur" style="background-image:url('${bgPath}')"></div>
    <img class="page-bg-img" src="${bgPath}" alt="커버" />
    <div class="cover-front-wrap"${frontStyle ? ` style="${frontStyle}"` : ''}><img class="cover-front-img" src="NAME/cover_front_3.webp" /></div>`;

  // Common blur overlay setup
  const blurTextMap = config.illustrationsBlurText || {};
  const blurTextPath = blurTextMap['cover_bg'] || bgPath;
  const bgVar = blurTextPath ? `--page-bg-url:url('${blurTextPath}');` : '';

  // Child photo displayed
  const selectedOpt = selectedModelKey && coverPhotoOptions && coverPhotoOptions[selectedModelKey];
  if (selectedOpt && coverPhotoURL) {
    const pos = computeChildPosition();
    let childStyle;
    const mo = getCoverOffset();
    const sc = mo.scale != null ? mo.scale : 1;
    if (pos) {
      const tx = (pos.leftOffset - 50) + mo.dx;
      childStyle = `height:${pos.height.toFixed(1)}%;top:${(pos.top + mo.dy).toFixed(1)}%;left:50%;transform:translateX(${tx.toFixed(1)}%) rotate(${mo.rotation}deg) scale(${sc.toFixed(3)})`;
    } else {
      const dx = -50 + mo.dx;
      childStyle = `height:80%;bottom:${(-mo.dy).toFixed(1)}%;left:50%;transform:translateX(${dx.toFixed(1)}%) rotate(${mo.rotation}deg) scale(${sc.toFixed(3)})`;
    }
    const wrapStyle = getCoverLayoutStyle();
    const nudgeClass = pendingNudge ? ' nudge' : '';
    const showDragHint = pendingNudge && !localStorage.getItem('bookPreview_dragHintSeen');
    imgContent += `<div class="cover-child-wrap${nudgeClass}"${wrapStyle ? ` style="${wrapStyle}"` : ''}><img class="cover-child-img" src="${coverPhotoURL}" style="${childStyle}" /></div>`;
    if (pendingNudge) pendingNudge = false;

    // Model toggle in blur overlay
    const activeCandidate = coverCandidates[activeCandidateIndex];
    const failedSet = activeCandidate && activeCandidate.failedModels || new Set();
    let activeIdx = 0;
    const NON_GPU = ['removebg'];
    const isExt = (p) => p.steps.every(s => NON_GPU.includes(s.type) || s.type === 'crop');
    const visiblePipelines = COVER_PIPELINES.filter(p => !(isExt(p) && !useRemoveBg));
    const toggleOpts = visiblePipelines.map((p, idx) => {
      const loaded = !!coverPhotoOptions[p.key];
      const failed = failedSet.has(p.key);
      const active = selectedModelKey === p.key;
      let cls = 'model-toggle-option';
      if (active) { cls += ' active'; activeIdx = idx; }
      if (failed) cls += ' model-toggle-failed';
      else if (!loaded) cls += ' model-toggle-loading';
      return `<div class="${cls}" data-model="${p.key}" data-idx="${idx}">${p.label}</div>`;
    }).join('');
    const indicatorHtml = `<div class="model-toggle-indicator" style="transform:translateX(${activeIdx * 46}px)"></div>`;

    const coverTouchHintDismissed = window._coverTouchHintDismissed;
    const coverTouchHintHtml = coverTouchHintDismissed ? '' :
      `<div class="cover-touch-hint">
        <span>아이를 터치해 위치, 크기, 회전을 조절할 수 있어요</span>
        <button class="cover-touch-hint-close">&times;</button>
      </div>`;

    return `<div class="slide-img-wrap">${imgContent}${titleHtml}</div>
    <div class="page-text-overlay text-pos-center" style="${bgVar}color:white">
      <div class="cover-model-overlay">
        <div class="model-toggle model-toggle-large">${indicatorHtml}${toggleOpts}</div>
        <div class="model-toggle-hint">숫자를 눌러 배경이 가장 잘 지워진 사진을 골라주세요</div>
      </div>
      ${coverTouchHintHtml}
    </div>`;
  }

  // Error state
  if (coverErrorText) {
    return `
      <div class="slide-img-wrap">${imgContent}${titleHtml}</div>
      <div class="page-text-overlay text-pos-center" style="${bgVar}color:white">
        <div class="page-text-scroll">
          <div class="cover-error-text">${coverErrorText}</div>
          <button class="cover-retry-btn" onclick="retryCoverProcessing()">다시 시도</button>
        </div>
      </div>`;
  }

  // Loading state — blur 영역만 유지 (스피너 없음)
  if (isRemovingBg) {
    return `
      <div class="slide-img-wrap">${imgContent}${titleHtml}</div>
      <div class="page-text-overlay text-pos-center" style="${bgVar}color:white">
      </div>`;
  }

  // No photo — intro text
  return `
    <div class="slide-img-wrap">${imgContent}${titleHtml}</div>
    <div class="page-text-overlay text-pos-center" style="${bgVar}color:white">
      <div class="page-text-scroll">
        <div style="font-size:15px;line-height:1.8;text-shadow:0 1px 4px rgba(0,0,0,0.6)">아이 사진을 자유롭게 <b>여러개 선택</b>해 보세요.<br><b>자유롭게 변경</b>할 수 있습니다.</div>
      </div>
    </div>`;
}

// Update candidate list DOM — preserves <img> elements to avoid reload flicker
function updateCandidateList() {
  const container = els.coverControls;
  if (!container) return;

  let listEl = container.querySelector('.candidate-list');

  if (coverCandidates.length === 0) {
    if (listEl) listEl.remove();
    return;
  }

  // Create list if missing
  if (!listEl) {
    listEl = document.createElement('div');
    listEl.className = 'candidate-list';
    listEl.innerHTML = '<button class="candidate-add" id="cover-add-btn">+</button>';
    container.prepend(listEl);
  }

  const existingThumbs = listEl.querySelectorAll('.candidate-thumb');
  const addBtn = listEl.querySelector('.candidate-add');

  // Add new thumbs (only for candidates that don't have a DOM element yet)
  for (let i = existingThumbs.length; i < coverCandidates.length; i++) {
    const c = coverCandidates[i];
    const div = document.createElement('div');
    div.className = 'candidate-thumb';
    div.dataset.candidateIndex = String(i);
    const img = document.createElement('img');
    img.src = c.thumbURL;
    img.alt = '';
    div.appendChild(img);
    listEl.insertBefore(div, addBtn);
  }

  // Update classes + img src on all thumbs
  listEl.querySelectorAll('.candidate-thumb').forEach((el, i) => {
    if (i >= coverCandidates.length) return;
    const c = coverCandidates[i];
    el.classList.toggle('active', i === activeCandidateIndex);
    const showSpinner = c.isProcessing || !c.photoOptions;
    el.classList.toggle('processing', showSpinner);
    // Sync img src if changed (e.g., placeholder → real thumb from server)
    const img = el.querySelector('img');
    if (img && img.src !== c.thumbURL) img.src = c.thumbURL;
    // Spinner
    const spinner = el.querySelector('.candidate-spinner');
    if (showSpinner && !spinner) {
      const s = document.createElement('div');
      s.className = 'candidate-spinner';
      el.appendChild(s);
    } else if (!showSpinner && spinner) {
      spinner.remove();
    }
  });
}

// Render cover controls in bottom panel (step-2)
function renderCoverControls() {
  if (!els.coverControls) return;

  // Preserve candidate list (img elements stay in DOM)
  updateCandidateList();

  // Get or create status container
  let statusEl = els.coverControls.querySelector('.cover-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.className = 'cover-status';
    els.coverControls.appendChild(statusEl);
  }

  const selectedOpt = selectedModelKey && coverPhotoOptions && coverPhotoOptions[selectedModelKey];

  // Photo exists with result — toggle is now inside the card
  if (selectedOpt && coverPhotoURL) {
    statusEl.innerHTML = '';
    return;
  }

  // Loading state — thumbnail spinner handles it now
  if (coverPhotoOptions || isRemovingBg) {
    statusEl.innerHTML = '';
    return;
  }

  // No photo — upload button
  if (coverCandidates.length === 0) {
    statusEl.innerHTML = `
      <button class="cover-upload-btn" id="cover-upload-btn">
        사진 선택하기
      </button>`;
  } else {
    statusEl.innerHTML = '';
  }
}

function buildSlideContent(pageIndex) {
  const pages = getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) return '';

  const page = pages[pageIndex];

  if (page.isCover) return buildCoverContent();
  if (page.pageType === 'frame') return buildFrameContent(pageIndex);
  if (page.pageType === 'cover_photo') return buildCoverPhotoContent(pageIndex);
  if (page.pageType === 'epilogue_album') return buildEpilogueAlbumContent(pageIndex);

  let imgContent = '';
  let imgPath = '';
  let blurBgPath = '';
  let blurTextPath = '';
  if (page.illustration && config.illustrations[page.illustration]) {
    imgPath = config.illustrations[page.illustration];
    const blurMap = config.illustrationsBlur || {};
    const blurTextMap = config.illustrationsBlurText || {};
    blurBgPath = blurMap[page.illustration] || imgPath;
    blurTextPath = blurTextMap[page.illustration] || imgPath;
    imgContent = `<div class="page-bg-blur" style="background-image:url('${blurBgPath}')"></div>
      <img class="page-bg-img" src="${imgPath}" alt="${page.title}" />`;
  } else if (page.bgGradient) {
    imgContent = `<div class="page-bg-gradient" style="background:${page.bgGradient}"></div>`;
  }

  const text = substituteVars(page.text, variables);
  const textColor = page.textColor || 'white';
  const posClass = `text-pos-${page.textPosition || 'center'}`;
  const bgVar = blurTextPath ? `--page-bg-url:url('${blurTextPath}');` : '';

  return `
    <div class="slide-img-wrap">${imgContent}</div>
    <div class="page-text-overlay ${posClass}" style="${bgVar}color:${textColor}">
      <div class="page-text-scroll">
        <div class="page-story-text">${text.replace(/\n/g, '<br>')}</div>
      </div>
    </div>`;
}

// ========== Frame Page (Page 1) — album-style rendering ==========

function buildFrameContent(pageIndex) {
  const pages = getPages();
  const page = pages[pageIndex];
  const scene = page.scene;

  const templates = getAlbumTemplates();
  const tmplIdx = page.albumTemplateIndex != null ? page.albumTemplateIndex : 0;
  const tmpl = templates[tmplIdx];
  if (!tmpl) return '<div class="slide-img-wrap"><div style="color:#f66;padding:40px;text-align:center">프레임 템플릿 없음</div></div>';

  const imgPath = config.illustrations[tmpl.illustration];
  const slotKey = `frame_${scene}`;
  const photo = pagePhotos.get(slotKey);

  let zonesHtml = '';
  tmpl.regions.forEach((region) => {
    let inner;
    if (photo) {
      inner = `<img class="album-photo" src="${photo.url}" draggable="false">`;
    } else {
      inner = `<div class="album-placeholder-icon">
        <svg style="width:32px;height:32px" fill="none" stroke="rgba(255,255,255,0.3)" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.5v15m7.5-7.5h-15"/>
        </svg>
      </div>`;
    }
    const left = (region.x / tmpl.width * 100).toFixed(3);
    const top = (region.y / tmpl.height * 100).toFixed(3);
    const w = (region.w / tmpl.width * 100).toFixed(3);
    const h = (region.h / tmpl.height * 100).toFixed(3);
    zonesHtml += `<div class="album-frame-zone frame-page-zone" data-slot-key="${slotKey}" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%">${inner}</div>`;
  });

  const overlayHtml = imgPath ? `<img class="album-frame-overlay" src="${imgPath}" draggable="false">` : '';

  const frameHintDismissed = window._frameHintDismissed || photo;
  const frameHintHtml = frameHintDismissed ? '' :
    `<div class="frame-page-hint">
      <span>액자를 선택해 아이 사진을 올려주세요</span>
      <button class="frame-page-hint-close">&times;</button>
    </div>`;

  const blurTextMap = config.illustrationsBlurText || {};
  const blurTextPath = blurTextMap[page.illustration] || imgPath;
  const text = substituteVars(page.text, variables);
  const textColor = page.textColor || 'white';
  const posClass = `text-pos-${page.textPosition || 'bottom'}`;
  const bgVar = blurTextPath ? `--page-bg-url:url('${blurTextPath}');` : '';

  return `
    <div class="slide-img-wrap" data-layout="frame" style="aspect-ratio:${tmpl.width}/${tmpl.height}">
      <div class="album-page-container" style="aspect-ratio:${tmpl.width}/${tmpl.height}">
        ${zonesHtml}
        ${overlayHtml}
      </div>
    </div>
    <div class="page-text-overlay ${posClass}" style="${bgVar}color:${textColor}">
      <div class="page-text-scroll">
        <div class="page-story-text">${text.replace(/\n/g, '<br>')}</div>
      </div>
      ${frameHintHtml}
    </div>`;
}

// ========== Frame Overlay Positioning (now handled by album-style CSS) ==========
// No dynamic positioning needed — album-page-container + album-frame-zone handles it

// ========== Cover Photo Page (page 19 — 원본 사진) ==========

// 활성 커버 후보의 원본 사진 URL 캐시
let coverOriginalPhotoURL = null;

function getCoverOriginalURL() {
  if (coverCandidates.length === 0 || activeCandidateIndex < 0) return null;
  const c = coverCandidates[activeCandidateIndex];
  if (!c || !c.originalFile) return null;
  // 캐시된 URL이 없으면 생성
  if (!c._originalURL) {
    c._originalURL = URL.createObjectURL(c.originalFile);
  }
  return c._originalURL;
}

function buildCoverPhotoContent(pageIndex) {
  const pages = getPages();
  const page = pages[pageIndex];
  const templates = getAlbumTemplates();
  const tmplIdx = page.albumTemplateIndex != null ? page.albumTemplateIndex : 0;
  const tmpl = templates[tmplIdx];
  if (!tmpl) return '<div class="slide-img-wrap" data-layout="cover_photo"><div style="color:#f66;padding:40px;text-align:center">프레임 템플릿 없음</div></div>';

  const imgPath = config.illustrations[tmpl.illustration];
  const originalURL = getCoverOriginalURL();

  // 액자 영역에 사진 넣기
  let zonesHtml = '';
  tmpl.regions.forEach((region, ri) => {
    let inner;
    if (originalURL) {
      inner = `<img class="album-photo" src="${originalURL}" draggable="false">`;
    } else {
      inner = `<div class="album-placeholder-icon">
        <svg style="width:32px;height:32px" fill="none" stroke="rgba(255,255,255,0.3)" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.5v15m7.5-7.5h-15"/>
        </svg>
      </div>`;
    }
    const left = (region.x / tmpl.width * 100).toFixed(3);
    const top = (region.y / tmpl.height * 100).toFixed(3);
    const w = (region.w / tmpl.width * 100).toFixed(3);
    const h = (region.h / tmpl.height * 100).toFixed(3);
    zonesHtml += `<div class="album-frame-zone cover-photo-zone" data-page-index="${pageIndex}" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%">${inner}</div>`;
  });

  const overlayHtml = imgPath ? `<img class="album-frame-overlay" src="${imgPath}" draggable="false">` : '';

  return `<div class="slide-img-wrap" data-layout="cover_photo" style="aspect-ratio:${tmpl.width}/${tmpl.height}">
    <div class="album-page-container" style="aspect-ratio:${tmpl.width}/${tmpl.height}">
      ${zonesHtml}
      ${overlayHtml}
    </div>
  </div>`;
}

// ========== Epilogue Album ==========

function getAlbumTemplates() {
  return config.albumFrameTemplates || [];
}

function getAlbumPages() {
  return getPages().filter(p => p.pageType === 'epilogue_album');
}

function getAlbumTotalSlots() {
  const templates = getAlbumTemplates();
  return getAlbumPages().reduce((sum, p) => {
    const tmpl = templates[p.albumTemplateIndex];
    return sum + (tmpl ? tmpl.regions.length : 0);
  }, 0);
}

function getAlbumSlotOffset(pageIndex) {
  const pages = getPages();
  const templates = getAlbumTemplates();
  let offset = 0;
  const albumPages = pages.filter(p => p.pageType === 'epilogue_album');
  for (const ap of albumPages) {
    const apIdx = pages.indexOf(ap);
    if (apIdx >= pageIndex) break;
    const tmpl = templates[ap.albumTemplateIndex];
    if (tmpl) offset += tmpl.regions.length;
  }
  return offset;
}

function initAlbumArrays() {
  const total = getAlbumTotalSlots();
  if (albumPhotos.length !== total) {
    albumPhotos = new Array(total).fill(null);
    albumPhotoURLs = new Array(total).fill(null);
  }
}

async function convertHeicIfNeeded(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.heic') || name.endsWith('.heif')) {
    if (typeof heic2any !== 'undefined') {
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 1.0 });
      return blob;
    }
  }
  return file;
}

async function loadAlbumImageFromFile(file) {
  const converted = await convertHeicIfNeeded(file);
  const url = URL.createObjectURL(converted);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = reject;
    img.src = url;
  });
}

function albumRefreshSlot(slot) {
  const zone = document.querySelector(`.album-frame-zone[data-album-slot="${slot}"]`);
  if (!zone) return;
  if (albumPhotos[slot]) {
    zone.innerHTML = `<img class="album-photo" src="${albumPhotoURLs[slot]}" draggable="false">`;
  } else {
    zone.innerHTML = `<div class="album-placeholder-icon">
      <svg style="width:32px;height:32px" fill="none" stroke="rgba(255,255,255,0.3)" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.5v15m7.5-7.5h-15"/>
      </svg>
    </div>`;
  }
}

function albumShowToast(msg) {
  const old = document.getElementById('album-toast');
  if (old) old.remove();
  clearTimeout(albumToastTimer);
  const el = document.createElement('div');
  el.id = 'album-toast';
  el.style.cssText = 'position:fixed;left:50%;bottom:100px;transform:translateX(-50%);z-index:200;background:rgba(30,30,30,0.95);backdrop-filter:blur(8px);color:#fff;font-size:13px;padding:8px 18px;border-radius:999px;box-shadow:0 2px 12px rgba(0,0,0,0.3);border:1px solid rgba(196,163,90,0.3);animation:toastIn 0.25s ease-out';
  el.textContent = msg;
  document.body.appendChild(el);
  albumToastTimer = setTimeout(() => {
    el.style.animation = 'toastOut 0.25s ease-in forwards';
    setTimeout(() => el.remove(), 250);
  }, 2000);
}

function albumSwapPhotos(a, b) {
  [albumPhotos[a], albumPhotos[b]] = [albumPhotos[b], albumPhotos[a]];
  [albumPhotoURLs[a], albumPhotoURLs[b]] = [albumPhotoURLs[b], albumPhotoURLs[a]];
  albumRefreshSlot(a);
  albumRefreshSlot(b);
}

function albumHandleTap(slot) {
  if (!albumPhotos[slot]) {
    if (albumSelectedSlot !== -1) {
      albumSwapPhotos(albumSelectedSlot, slot);
      const prev = document.querySelector(`.album-frame-zone[data-album-slot="${albumSelectedSlot}"]`);
      if (prev) prev.classList.remove('selected');
      albumSelectedSlot = -1;
    } else {
      albumPendingSlot = slot;
      document.getElementById('album-single-file-input').click();
    }
    return;
  }
  if (albumSelectedSlot === -1) {
    albumSelectedSlot = slot;
    const zone = document.querySelector(`.album-frame-zone[data-album-slot="${slot}"]`);
    if (zone) zone.classList.add('selected');
    albumShowToast('이동할 액자를 선택하세요');
  } else if (albumSelectedSlot === slot) {
    albumSelectedSlot = -1;
    const zone = document.querySelector(`.album-frame-zone[data-album-slot="${slot}"]`);
    if (zone) zone.classList.remove('selected');
  } else {
    albumSwapPhotos(albumSelectedSlot, slot);
    const prev = document.querySelector(`.album-frame-zone[data-album-slot="${albumSelectedSlot}"]`);
    if (prev) prev.classList.remove('selected');
    albumSelectedSlot = -1;
    albumShowToast('사진이 이동했습니다');
  }
}

function albumStartDrag(slot, x, y) {
  albumDragState = { slot };
  const ghost = document.getElementById('album-drag-ghost');
  ghost.querySelector('img').src = albumPhotoURLs[slot];
  ghost.style.display = 'block';
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
  const zone = document.querySelector(`.album-frame-zone[data-album-slot="${slot}"]`);
  if (zone) zone.style.opacity = '0.4';
  document.querySelectorAll('.album-frame-zone').forEach(z => {
    const s = parseInt(z.dataset.albumSlot);
    if (s !== slot) z.classList.add('drop-target');
  });
  if (navigator.vibrate) navigator.vibrate(30);
}

function albumMoveDrag(x, y) {
  const ghost = document.getElementById('album-drag-ghost');
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
}

function albumEndDrag(x, y) {
  const ghost = document.getElementById('album-drag-ghost');
  ghost.style.display = 'none';
  const els2 = document.elementsFromPoint(x, y);
  let targetSlot = null;
  for (const el of els2) {
    if (el.dataset && el.dataset.albumSlot !== undefined) {
      targetSlot = parseInt(el.dataset.albumSlot);
      break;
    }
  }
  if (targetSlot !== null && targetSlot !== albumDragState.slot) {
    albumSwapPhotos(albumDragState.slot, targetSlot);
  }
  const zone = document.querySelector(`.album-frame-zone[data-album-slot="${albumDragState.slot}"]`);
  if (zone) zone.style.opacity = '';
  document.querySelectorAll('.album-frame-zone').forEach(z => z.classList.remove('drop-target'));
  albumDragState = null;
}

function drawCoverFit(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function albumSavePage(pageIndex) {
  const pages = getPages();
  const page = pages[pageIndex];
  const templates = getAlbumTemplates();
  const tmpl = templates[page.albumTemplateIndex];
  if (!tmpl) return;
  const offset = getAlbumSlotOffset(pageIndex);
  const pagePhotosSlice = albumPhotos.slice(offset, offset + tmpl.regions.length);
  if (!pagePhotosSlice.some(p => p !== null)) {
    albumShowToast('저장할 사진이 없습니다');
    return;
  }
  albumShowToast('이미지 생성 중...');
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = tmpl.width * scale;
  canvas.height = tmpl.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmpl.width, tmpl.height);
  for (let i = 0; i < tmpl.regions.length; i++) {
    const photo = albumPhotos[offset + i];
    if (!photo) continue;
    const r = tmpl.regions[i];
    drawCoverFit(ctx, photo, r.x, r.y, r.w, r.h);
  }
  const frameImg = albumFrameImages[page.albumTemplateIndex];
  if (frameImg) ctx.drawImage(frameImg, 0, 0, tmpl.width, tmpl.height);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
  const file = new File([blob], `epilogue_album_page${page.scene}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      albumShowToast('저장 완료');
    } catch (e) {
      if (e.name !== 'AbortError') albumShowToast('저장이 취소되었습니다');
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    albumShowToast('저장 완료');
  }
}

function buildEpilogueAlbumContent(pageIndex) {
  const pages = getPages();
  const page = pages[pageIndex];
  const templates = getAlbumTemplates();
  const tmpl = templates[page.albumTemplateIndex];
  if (!tmpl) return '<div class="slide-img-wrap" data-layout="epilogue_album"><div style="color:#f66;padding:40px;text-align:center">프레임 템플릿 없음</div></div>';

  initAlbumArrays();
  const offset = getAlbumSlotOffset(pageIndex);
  const imgPath = config.illustrations[tmpl.illustration];

  let zonesHtml = '';
  tmpl.regions.forEach((region, ri) => {
    const slot = offset + ri;
    let inner;
    if (albumPhotos[slot]) {
      inner = `<img class="album-photo" src="${albumPhotoURLs[slot]}" draggable="false">`;
    } else {
      inner = `<div class="album-placeholder-icon">
        <svg style="width:32px;height:32px" fill="none" stroke="rgba(255,255,255,0.3)" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.5v15m7.5-7.5h-15"/>
        </svg>
      </div>`;
    }
    const left = (region.x / tmpl.width * 100).toFixed(3);
    const top = (region.y / tmpl.height * 100).toFixed(3);
    const w = (region.w / tmpl.width * 100).toFixed(3);
    const h = (region.h / tmpl.height * 100).toFixed(3);
    zonesHtml += `<div class="album-frame-zone" data-album-slot="${slot}" data-page-index="${pageIndex}" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%">${inner}</div>`;
  });

  const overlayHtml = imgPath ? `<img class="album-frame-overlay" src="${imgPath}" draggable="false">` : '';

  const uploadBtnHtml = tmpl.regions.length > 1 ?
    `<button class="album-page-upload-btn" data-album-page-index="${pageIndex}" data-album-offset="${offset}" data-album-count="${tmpl.regions.length}">이 페이지에 한번에 올리기</button>` : '';

  const saveBtnHtml = '';

  const hintDismissed = window._albumHintDismissed;
  const hintHtml = hintDismissed ? '' :
    `<div class="album-hint">
      <span>사진을 탭하여 선택, 다른 액자를 탭하면 교체</span>
      <button class="album-hint-close">&times;</button>
    </div>`;

  return `<div class="slide-img-wrap" data-layout="epilogue_album" style="aspect-ratio:${tmpl.width}/${tmpl.height}">
    <div class="album-page-container" style="aspect-ratio:${tmpl.width}/${tmpl.height}">
      ${zonesHtml}
      ${overlayHtml}
    </div>
    ${uploadBtnHtml}${saveBtnHtml}${hintHtml}
  </div>`;
}

// ========== Page Photo Upload ==========

function handlePagePhotoUpload(slotKey, file) {
  const url = URL.createObjectURL(file);
  const old = pagePhotos.get(slotKey);
  if (old) URL.revokeObjectURL(old.url);
  pagePhotos.set(slotKey, { file, url });
  renderCarousel();
  renderThumbnails();
}

function triggerPagePhotoInput(slotKey) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  const cleanup = () => input.remove();
  input.addEventListener('change', () => {
    if (input.files.length > 0) handlePagePhotoUpload(slotKey, input.files[0]);
    cleanup();
  });
  input.addEventListener('cancel', cleanup);
  input.click();
}

// ========== Frame Photo Drag (터치로 사진 이동) ==========

// Frame photo drag removed — album-style uses object-fit:cover, no manual positioning needed

async function preloadAlbumFrameImages() {
  const templates = getAlbumTemplates();
  albumFrameImages = [];
  for (const tmpl of templates) {
    const src = config.illustrations[tmpl.illustration];
    if (!src) { albumFrameImages.push(null); continue; }
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = src;
      });
      albumFrameImages.push(img);
    } catch (e) {
      console.warn('Album frame image load failed:', src);
      albumFrameImages.push(null);
    }
  }
}

let coverBgNatSize = null;
let cachedCoverLayout = null;

function getCoverLayoutStyle() {
  if (!cachedCoverLayout) return '';
  const { imgX, imgY, imgW, imgH } = cachedCoverLayout;
  return `left:${imgX}px;top:${imgY}px;width:${imgW}px;height:${imgH}px`;
}

function getCoverTitleStyle() {
  if (!cachedCoverLayout) return '';
  const { imgX, imgY, imgW } = cachedCoverLayout;
  return `top:${imgY}px;left:${imgX}px;width:${imgW}px`;
}

function positionCoverChild() {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  let wrap = null;
  for (const slide of track.children) {
    const w = slide.querySelector('.slide-img-wrap');
    if (w && w.querySelector('.cover-top-title')) { wrap = w; break; }
  }
  if (!wrap) return;
  const bgImg = wrap.querySelector('.page-bg-img');
  if (!bgImg) return;

  if (!coverBgNatSize) {
    if (bgImg.naturalWidth) {
      coverBgNatSize = { w: bgImg.naturalWidth, h: bgImg.naturalHeight };
    } else {
      bgImg.addEventListener('load', () => {
        coverBgNatSize = { w: bgImg.naturalWidth, h: bgImg.naturalHeight };
        positionCoverChild();
      }, { once: true });
      return;
    }
  }

  const contW = wrap.clientWidth;
  const contH = wrap.clientHeight;
  const natW = coverBgNatSize.w;
  const natH = coverBgNatSize.h;
  const fit = getComputedStyle(bgImg).objectFit;

  let imgW, imgH, imgX, imgY;
  if (fit === 'contain') {
    const scale = Math.min(contW / natW, contH / natH);
    imgW = natW * scale;
    imgH = natH * scale;
    imgX = (contW - imgW) / 2;
    imgY = (contH - imgH) / 2;
  } else {
    imgW = contW;
    imgH = contH;
    imgX = 0;
    imgY = 0;
  }

  cachedCoverLayout = { imgX, imgY, imgW, imgH };

  const childWrap = wrap.querySelector('.cover-child-wrap');
  if (childWrap) {
    childWrap.style.left = `${imgX}px`;
    childWrap.style.top = `${imgY}px`;
    childWrap.style.width = `${imgW}px`;
    childWrap.style.height = `${imgH}px`;
  }

  const frontWrap = wrap.querySelector('.cover-front-wrap');
  if (frontWrap) {
    frontWrap.style.left = `${imgX}px`;
    frontWrap.style.top = `${imgY}px`;
    frontWrap.style.width = `${imgW}px`;
    frontWrap.style.height = `${imgH}px`;
  }

  const titleEl = wrap.querySelector('.cover-top-title');
  if (titleEl) {
    titleEl.style.top = `${imgY}px`;
    titleEl.style.left = `${imgX}px`;
    titleEl.style.width = `${imgW}px`;
  }
}

function renderCarousel() {
  // Skip re-render while user is dragging/rotating child photo
  if (isEditingCoverPos) return;
  const pages = getPages();
  if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
  if (currentPageIndex < 0) currentPageIndex = 0;

  const viewer = els.pageViewer;
  viewer.innerHTML = '<div class="carousel-track" id="carousel-track"></div>';

  const track = document.getElementById('carousel-track');
  const vw = viewer.clientWidth;
  const slideGap = 8;
  for (let i = -1; i <= 1; i++) {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    slide.style.width = `${vw - slideGap}px`;
    slide.style.marginLeft = `${slideGap / 2}px`;
    slide.style.marginRight = `${slideGap / 2}px`;
    const pageIdx = currentPageIndex + i;
    slide.dataset.pageIndex = String(pageIdx);
    slide.innerHTML = buildSlideContent(pageIdx);
    track.appendChild(slide);
  }

  track.style.transition = 'none';
  track.style.transform = `translateX(-${vw}px)`;

  updatePageInfo();
  setupCarouselTouch(track);
  positionCoverChild();

  renderCoverControls();
}

function populateSlides() {
  const track = document.getElementById('carousel-track');
  if (!track) return;
  const slides = track.children;
  for (let i = 0; i < 3; i++) {
    const pageIdx = currentPageIndex + (i - 1);
    slides[i].dataset.pageIndex = String(pageIdx);
    slides[i].innerHTML = buildSlideContent(pageIdx);
  }
  positionCoverChild();

}

let pendingNormalize = null;

function normalizeTrackIfNeeded() {
  if (!pendingNormalize) return;
  const { direction } = pendingNormalize;
  pendingNormalize = null;

  const track = document.getElementById('carousel-track');
  if (!track) return;
  const vw = els.pageViewer.clientWidth;

  if (direction > 0) {
    const first = track.firstElementChild;
    track.appendChild(first);
    const newPageIdx = currentPageIndex + 1;
    first.dataset.pageIndex = String(newPageIdx);
    first.innerHTML = buildSlideContent(newPageIdx);
  } else {
    const last = track.lastElementChild;
    track.insertBefore(last, track.firstElementChild);
    const newPageIdx = currentPageIndex - 1;
    last.dataset.pageIndex = String(newPageIdx);
    last.innerHTML = buildSlideContent(newPageIdx);
  }

  track.style.transition = 'none';
  track.style.transform = `translateX(-${vw}px)`;
  track.offsetHeight;
  positionCoverChild();

}

function updatePageInfo() {
  const pages = getPages();
  const counter = currentPageIndex === 0 ? '커버' : `${currentPageIndex} / ${pages.length - 1}`;
  els.pageCounter.textContent = counter;

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
  resetZoom();
  normalizeTrackIfNeeded();

  const pages = getPages();
  const next = currentPageIndex + delta;
  if (next < 0 || next >= pages.length) return;

  isAnimating = true;
  const track = document.getElementById('carousel-track');
  if (!track) { isAnimating = false; return; }

  const vw = els.pageViewer.clientWidth;
  track.style.transition = 'transform 0.35s ease-out';
  track.style.transform = `translateX(-${delta > 0 ? vw * 2 : 0}px)`;

  let finalized = false;
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    currentPageIndex = next;
    pendingNormalize = { direction: delta };
    normalizeTrackIfNeeded();
    updatePageInfo();
    positionCoverChild();
  
    isAnimating = false;
    onPageChanged();
  };

  track.addEventListener('transitionend', finalize, { once: true });
  setTimeout(() => { if (!finalized) finalize(); }, 400);
}

function jumpToPage(targetIndex) {
  if (isAnimating || targetIndex === currentPageIndex) return;
  resetZoom();
  normalizeTrackIfNeeded();
  const pages = getPages();
  if (targetIndex < 0 || targetIndex >= pages.length) return;

  const diff = targetIndex - currentPageIndex;
  if (Math.abs(diff) === 1) {
    goPage(diff);
    return;
  }

  isAnimating = true;
  const track = document.getElementById('carousel-track');
  if (!track) { isAnimating = false; return; }

  track.style.transition = 'opacity 0.25s ease-out';
  track.style.opacity = '0';

  setTimeout(() => {
    currentPageIndex = targetIndex;
    track.style.transition = 'none';
    populateSlides();
    const vw = els.pageViewer.clientWidth;
    track.style.transform = `translateX(-${vw}px)`;
    track.offsetHeight;

    track.style.transition = 'opacity 0.25s ease-in';
    track.style.opacity = '1';

    updatePageInfo();
    setTimeout(() => {
      isAnimating = false;
      onPageChanged();
    }, 260);
  }, 260);
}

// ========== Carousel Touch ==========

let zoomScale = 1;
let zoomPanX = 0;
let zoomPanY = 0;
let isPinching = false;
let pinchStartDist = 0;
let pinchStartScale = 1;
let pinchStartPanX = 0;
let pinchStartPanY = 0;
let pinchMidX = 0;
let pinchMidY = 0;
let zoomEdgeOverflow = 0;

function getFingerDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function getCurrentWrap() {
  const track = document.getElementById('carousel-track');
  if (!track) return null;
  return track.children[1]?.querySelector('.slide-img-wrap');
}

function applyZoom() {
  const wrap = getCurrentWrap();
  if (!wrap) return;
  if (zoomScale <= 1) {
    wrap.style.transform = '';
    zoomScale = 1;
    zoomPanX = 0;
    zoomPanY = 0;
  } else {
    wrap.style.transform = `scale(${zoomScale}) translate(${zoomPanX}px, ${zoomPanY}px)`;
  }
}

function resetZoom() {
  zoomScale = 1;
  zoomPanX = 0;
  zoomPanY = 0;
  const wrap = getCurrentWrap();
  if (wrap) wrap.style.transform = '';
}

function setupCarouselTouch(track) {
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let deltaX = 0;
  let startTime = 0;
  let panStartX = 0;
  let panStartY = 0;
  let cachedViewerWidth = 0; // touchstart에서 캐싱 → touchmove에서 reflow 방지

  // Cover child drag state
  let childDragImg = null;
  let childDragWrap = null;
  let childDragStartX = 0;
  let childDragStartY = 0;
  let childDragStartDx = 0;
  let childDragStartDy = 0;
  let childDragPending = false; // waiting to confirm single-finger drag
  // Child rotation + pinch scale state (two-finger)
  let childRotating = false;
  let childRotStartAngle = 0;
  let childRotStartRotation = 0;
  let childPinchStartDist = 0;
  let childPinchStartScale = 1;

  // Album frame drag state
  let albumDragSlotEl = null;
  let albumDragSlotIdx = -1;
  let albumDragStartX2 = 0;
  let albumDragStartY2 = 0;
  let albumDragPending2 = false;
  let albumIsDragging2 = false;
  let albumDragTimer2 = null;

  track.addEventListener('touchstart', (e) => {
    if (isAnimating) return;

    // If a second finger arrives while child drag is pending → switch to rotation+scale
    if (childDragPending && e.touches.length === 2) {
      childDragPending = false;
      isEditingCoverPos = true;
      childRotating = true;
      const t = e.touches;
      childRotStartAngle = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
      childRotStartRotation = getCoverOffset().rotation;
      childPinchStartDist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      childPinchStartScale = getCoverOffset().scale || 1;
      return;
    }

    // Prepare cover child drag (don't commit yet — wait for move to confirm)
    if (!isPinching && !childDragPending && e.touches.length === 1) {
      const img = e.target.closest('.cover-child-img');
      if (img) {
        e.preventDefault();
        const mo = getCoverOffset();
        childDragImg = img;
        childDragWrap = img.closest('.slide-img-wrap');
        childDragStartX = e.touches[0].clientX;
        childDragStartY = e.touches[0].clientY;
        childDragStartDx = mo.dx;
        childDragStartDy = mo.dy;
        childDragPending = true;
        return;
      }
    }

    // Prepare album frame drag (long press)
    if (!isPinching && !albumDragPending2 && e.touches.length === 1) {
      const zone = e.target.closest('.album-frame-zone');
      if (zone && zone.dataset.albumSlot !== undefined) {
        const slotIdx = parseInt(zone.dataset.albumSlot);
        albumDragSlotEl = zone;
        albumDragSlotIdx = slotIdx;
        albumDragStartX2 = e.touches[0].clientX;
        albumDragStartY2 = e.touches[0].clientY;
        albumDragPending2 = true;
        albumIsDragging2 = false;
        if (albumPhotos[slotIdx]) {
          albumDragTimer2 = setTimeout(() => {
            albumIsDragging2 = true;
            albumStartDrag(slotIdx, albumDragStartX2, albumDragStartY2);
          }, 250);
        }
        return;
      }
    }

    if (isEditingCoverPos) return;

    if (e.touches.length === 2) {
      isPinching = true;
      isDragging = false;
      pinchStartDist = getFingerDist(e.touches);
      pinchStartScale = zoomScale;
      pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      pinchStartPanX = zoomPanX;
      pinchStartPanY = zoomPanY;
      return;
    }

    if (zoomScale > 1) {
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      pinchStartPanX = zoomPanX;
      pinchStartPanY = zoomPanY;
      isDragging = false;
      return;
    }

    normalizeTrackIfNeeded();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    isDragging = false;
    deltaX = 0;
    cachedViewerWidth = els.pageViewer.clientWidth;
    track.style.transition = 'none';
  }, { passive: false });

  track.addEventListener('touchmove', (e) => {
    if (isAnimating || albumIsDragging2) return;

    // Child rotation + pinch scale (two-finger on child photo)
    if (childRotating && childDragImg && e.touches.length === 2) {
      e.preventDefault();
      const mo = getCoverOffset();
      const t = e.touches;
      const angle = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
      mo.rotation = childRotStartRotation + (angle - childRotStartAngle);
      const dist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      if (childPinchStartDist > 0) {
        mo.scale = Math.max(0.5, Math.min(2, childPinchStartScale * (dist / childPinchStartDist)));
      }
      childDragImg.style.transition = 'none';
      applyCoverManualOffset(childDragImg);
      return;
    }

    // Cover child drag: pending → confirm or cancel
    if (childDragPending && childDragImg) {
      if (e.touches.length >= 2) {
        // Second finger arrived → switch to rotation+scale
        childDragPending = false;
        isEditingCoverPos = true;
        childRotating = true;
        const t = e.touches;
        childRotStartAngle = Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
        childRotStartRotation = getCoverOffset().rotation;
        childPinchStartDist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
        childPinchStartScale = getCoverOffset().scale || 1;
        return;
      } else {
        // Single finger move → confirm child drag
        childDragPending = false;
        isEditingCoverPos = true;
        childDragImg.style.transition = 'none';
        // Reset start position to current touch to prevent jump
        const mo = getCoverOffset();
        childDragStartX = e.touches[0].clientX;
        childDragStartY = e.touches[0].clientY;
        childDragStartDx = mo.dx;
        childDragStartDy = mo.dy;
        // Fall through to drag below
      }
    }

    // Cover child drag move
    if (childDragImg && isEditingCoverPos && !isPinching) {
      // Verify DOM elements are still attached
      if (!childDragImg.isConnected || !childDragWrap || !childDragWrap.isConnected) {
        childDragImg = null;
        childDragWrap = null;
        isEditingCoverPos = false;
        return;
      }
      e.preventDefault();
      const mo = getCoverOffset();
      const pt = e.touches[0];
      const wrapRect = childDragWrap.getBoundingClientRect();
      const dx = ((pt.clientX - childDragStartX) / wrapRect.width) * 100;
      const dy = ((pt.clientY - childDragStartY) / wrapRect.height) * 100;
      mo.dx = childDragStartDx + dx;
      mo.dy = childDragStartDy + dy;
      applyCoverManualOffset(childDragImg);
      return;
    }

    // Album frame drag
    if (albumDragPending2 && albumDragSlotEl) {
      const dx = e.touches[0].clientX - albumDragStartX2;
      const dy = e.touches[0].clientY - albumDragStartY2;
      if (!albumIsDragging2 && Math.sqrt(dx*dx + dy*dy) > 10) {
        clearTimeout(albumDragTimer2);
        // Finger moved before long press → cancel drag, let carousel handle
        albumDragPending2 = false;
        albumDragSlotEl = null;
        albumDragSlotIdx = -1;
        // Fall through to normal swipe
      }
      if (albumIsDragging2) {
        e.preventDefault();
        albumMoveDrag(e.touches[0].clientX, e.touches[0].clientY);
        return;
      }
    }

    if (isEditingCoverPos) return;

    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const dist = getFingerDist(e.touches);
      zoomScale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomPanX = pinchStartPanX + (midX - pinchMidX) / zoomScale;
      zoomPanY = pinchStartPanY + (midY - pinchMidY) / zoomScale;
      applyZoom();
      return;
    }

    if (zoomScale > 1 && e.touches.length === 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStartX;
      const dy = e.touches[0].clientY - panStartY;

      const viewerW = els.pageViewer.clientWidth;
      const viewerH = els.pageViewer.clientHeight;
      const maxPanX = viewerW * (zoomScale - 1) / (2 * zoomScale);
      const maxPanY = viewerH * (zoomScale - 1) / (2 * zoomScale);

      const rawPanX = pinchStartPanX + dx / zoomScale;
      const rawPanY = pinchStartPanY + dy / zoomScale;

      zoomPanX = Math.max(-maxPanX, Math.min(maxPanX, rawPanX));
      zoomPanY = Math.max(-maxPanY, Math.min(maxPanY, rawPanY));
      applyZoom();

      if (rawPanX > maxPanX) {
        zoomEdgeOverflow = (rawPanX - maxPanX) * zoomScale;
      } else if (rawPanX < -maxPanX) {
        zoomEdgeOverflow = (rawPanX + maxPanX) * zoomScale;
      } else {
        zoomEdgeOverflow = 0;
      }
      return;
    }

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!isDragging) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        isDragging = true;
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        return;
      } else {
        return;
      }
    }

    deltaX = dx;
    const totalPages = getPages().length;

    let adjustedDx = deltaX;
    if (currentPageIndex === 0 && deltaX > 0) adjustedDx = deltaX * 0.25;
    if (currentPageIndex === totalPages - 1 && deltaX < 0) adjustedDx = deltaX * 0.25;

    const baseOffset = -cachedViewerWidth;
    track.style.transform = `translateX(${baseOffset + adjustedDx}px)`;
  }, { passive: false });

  let lastTapTime = 0;
  track.addEventListener('touchend', (e) => {
    if (albumIsDragging2) return;
    // Child rotation end — if one finger lifts, stop rotating but keep state
    if (childRotating && e.touches.length < 2) {
      childRotating = false;
      if (e.touches.length === 0) {
        if (childDragImg) childDragImg.style.transition = '';
        childDragImg = null;
        childDragWrap = null;
        isEditingCoverPos = false;
        saveGlobalsToActiveCandidate();
        return;
      }
      // One finger remaining — don't start swipe
      return;
    }
    // Cover child drag end (or pending cancelled by lift)
    if (childDragPending || (childDragImg && isEditingCoverPos)) {
      if (childDragImg) childDragImg.style.transition = '';
      childDragPending = false;
      childDragImg = null;
      childDragWrap = null;
      if (isEditingCoverPos) {
        isEditingCoverPos = false;
        saveGlobalsToActiveCandidate();
      }
      return;
    }

    // Album frame drag end
    if (albumDragPending2 || albumIsDragging2) {
      clearTimeout(albumDragTimer2);
      if (albumIsDragging2) {
        albumEndDrag(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      } else {
        // Short tap → handle as tap
        albumHandleTap(albumDragSlotIdx);
      }
      albumDragSlotEl = null;
      albumDragSlotIdx = -1;
      albumDragPending2 = false;
      albumIsDragging2 = false;
      return;
    }

    if (isEditingCoverPos) return;
    if (e.touches.length === 0 && !isPinching && !isDragging && zoomScale > 1) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        resetZoom();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
    }

    if (isPinching) {
      isPinching = false;
      if (zoomScale < 1.05) {
        resetZoom();
        // Prevent remaining finger from triggering swipe with stale startX
        if (e.touches.length > 0) {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          startTime = Date.now();
          isDragging = false;
          deltaX = 0;
        }
      } else if (e.touches.length > 0) {
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        pinchStartPanX = zoomPanX;
        pinchStartPanY = zoomPanY;
      }
      return;
    }
    if (zoomScale > 1) {
      const viewerW = els.pageViewer.clientWidth;
      const pages = getPages();
      const swipeThreshold = viewerW * 0.15;
      if (zoomEdgeOverflow > swipeThreshold && currentPageIndex > 0) {
        resetZoom();
        goPage(-1);
      } else if (zoomEdgeOverflow < -swipeThreshold && currentPageIndex < pages.length - 1) {
        resetZoom();
        goPage(1);
      }
      zoomEdgeOverflow = 0;
      return;
    }

    if (!isDragging || isAnimating) return;

    const vw = cachedViewerWidth;
    const totalPages = getPages().length;
    const velocity = Math.abs(deltaX) / (Date.now() - startTime);
    const threshold = vw * 0.2;
    const fastSwipe = velocity > 0.4;

    track.style.transition = 'transform 0.3s ease-out';

    if ((deltaX < -threshold || (fastSwipe && deltaX < -30)) && currentPageIndex < totalPages - 1) {
      isAnimating = true;
      track.style.transform = `translateX(-${vw * 2}px)`;

      let fin1 = false;
      const finalize = () => {
        if (fin1) return;
        fin1 = true;
        currentPageIndex++;
        pendingNormalize = { direction: 1 };
        normalizeTrackIfNeeded();
        updatePageInfo();
        positionCoverChild();
        isAnimating = false;
        onPageChanged();
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin1) finalize(); }, 350);

    } else if ((deltaX > threshold || (fastSwipe && deltaX > 30)) && currentPageIndex > 0) {
      isAnimating = true;
      track.style.transform = 'translateX(0px)';

      let fin2 = false;
      const finalize = () => {
        if (fin2) return;
        fin2 = true;
        currentPageIndex--;
        pendingNormalize = { direction: -1 };
        normalizeTrackIfNeeded();
        updatePageInfo();
        positionCoverChild();
        isAnimating = false;
        onPageChanged();
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin2) finalize(); }, 350);

    } else {
      track.style.transform = `translateX(-${vw}px)`;
    }
  }, { passive: true });

  // ===== Mouse events for desktop carousel swipe =====
  let mouseDown = false;
  track.addEventListener('mousedown', (e) => {
    if (isAnimating || zoomScale > 1) return;
    mouseDown = true;
    normalizeTrackIfNeeded();
    startX = e.clientX;
    startY = e.clientY;
    startTime = Date.now();
    isDragging = false;
    deltaX = 0;
    cachedViewerWidth = els.pageViewer.clientWidth;
    track.style.transition = 'none';
    e.preventDefault();
  });

  track.addEventListener('mousemove', (e) => {
    if (!mouseDown || isAnimating) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!isDragging) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        isDragging = true;
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        mouseDown = false;
        return;
      } else {
        return;
      }
    }

    deltaX = dx;
    const totalPages = getPages().length;

    let adjustedDx = deltaX;
    if (currentPageIndex === 0 && deltaX > 0) adjustedDx = deltaX * 0.25;
    if (currentPageIndex === totalPages - 1 && deltaX < 0) adjustedDx = deltaX * 0.25;

    const baseOffset = -cachedViewerWidth;
    track.style.transform = `translateX(${baseOffset + adjustedDx}px)`;
  });

  const mouseEndHandler = () => {
    if (!mouseDown) return;
    mouseDown = false;
    if (!isDragging || isAnimating) return;

    const vw = cachedViewerWidth;
    const totalPages = getPages().length;
    const velocity = Math.abs(deltaX) / (Date.now() - startTime);
    const threshold = vw * 0.2;
    const fastSwipe = velocity > 0.4;

    track.style.transition = 'transform 0.3s ease-out';

    if ((deltaX < -threshold || (fastSwipe && deltaX < -30)) && currentPageIndex < totalPages - 1) {
      isAnimating = true;
      track.style.transform = `translateX(-${vw * 2}px)`;

      let fin1 = false;
      const finalize = () => {
        if (fin1) return;
        fin1 = true;
        currentPageIndex++;
        pendingNormalize = { direction: 1 };
        normalizeTrackIfNeeded();
        updatePageInfo();
        positionCoverChild();
        isAnimating = false;
        onPageChanged();
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin1) finalize(); }, 350);

    } else if ((deltaX > threshold || (fastSwipe && deltaX > 30)) && currentPageIndex > 0) {
      isAnimating = true;
      track.style.transform = 'translateX(0px)';

      let fin2 = false;
      const finalize = () => {
        if (fin2) return;
        fin2 = true;
        currentPageIndex--;
        pendingNormalize = { direction: -1 };
        normalizeTrackIfNeeded();
        updatePageInfo();
        positionCoverChild();
        isAnimating = false;
        onPageChanged();
      };
      track.addEventListener('transitionend', finalize, { once: true });
      setTimeout(() => { if (!fin2) finalize(); }, 350);

    } else {
      track.style.transform = `translateX(-${vw}px)`;
    }
  };
  track.addEventListener('mouseup', mouseEndHandler);
  track.addEventListener('mouseleave', mouseEndHandler);
}

// ========== Thumbnails ==========

function renderThumbnails() {
  const pages = getPages();
  const strip = els.thumbnailStrip;
  strip.innerHTML = '';

  pages.forEach((page, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';

    const thumb = document.createElement('div');
    thumb.className = `thumb ${i === currentPageIndex ? 'active' : ''}`;

    if (page.isCover) {
      const coverBg = config.illustrations['cover_bg'];
      thumb.innerHTML = `<img src="${coverBg}" alt="커버" /><div class="thumb-cover">커버</div>`;
    } else if (page.pageType === 'cover_photo') {
      const templates = getAlbumTemplates();
      const tmplIdx = page.albumTemplateIndex != null ? page.albumTemplateIndex : 0;
      const tmpl = templates[tmplIdx];
      const framePath = tmpl ? config.illustrations[tmpl.illustration] : '';
      if (framePath) {
        thumb.innerHTML = `<img src="${framePath}" alt="${page.title}" /><span class="thumb-label">${i}</span>`;
      } else {
        thumb.innerHTML = `<div class="thumb-gradient" style="background:#2a2a2a"></div><span class="thumb-label">${i}</span>`;
      }
    } else if (page.pageType === 'epilogue_album') {
      const templates = getAlbumTemplates();
      const tmpl = templates[page.albumTemplateIndex];
      const framePath = tmpl ? config.illustrations[tmpl.illustration] : '';
      if (framePath) {
        thumb.innerHTML = `<img src="${framePath}" alt="${page.title}" /><span class="thumb-label">${i}</span>`;
      } else {
        thumb.innerHTML = `<div class="thumb-gradient" style="background:#333"></div><span class="thumb-label">${i}</span>`;
      }
    } else if (page.illustration && config.illustrations[page.illustration]) {
      const imgPath = config.illustrations[page.illustration];
      thumb.innerHTML = `<img src="${imgPath}" alt="${page.title}" /><span class="thumb-label">${i}</span>`;
    } else {
      thumb.innerHTML = `<div class="thumb-gradient" style="background:${page.bgGradient || '#333'}"></div><span class="thumb-label">${i}</span>`;
    }

    thumb.addEventListener('click', () => jumpToPage(i));
    wrap.appendChild(thumb);

    // 사용자가 추가한 앨범 페이지 → 삭제 버튼 (thumb-wrap에 붙여서 overflow:hidden 회피)
    if (page._userAdded) {
      const delBtn = document.createElement('button');
      delBtn.className = 'thumb-delete';
      delBtn.innerHTML = '&times;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeAlbumPage(i);
      });
      wrap.appendChild(delBtn);
    }

    // 사진 필요 여부 판단
    let needsPhoto = false;
    if (page.isCover) {
      needsPhoto = !coverPhotoURL;
    } else if (page.pageType === 'cover_photo') {
      needsPhoto = !coverPhotoURL;
    } else if (page.pageType === 'frame') {
      needsPhoto = !pagePhotos.has(`frame_${page.scene}`);
    } else if (page.pageType === 'epilogue_album') {
      const templates = getAlbumTemplates();
      const tmpl = templates[page.albumTemplateIndex];
      if (tmpl) {
        const offset = getAlbumSlotOffset(pages.indexOf(page) >= 0 ? pages.indexOf(page) : i);
        needsPhoto = tmpl.regions.some((_, ri) => !albumPhotos[offset + ri]);
      }
    }
    if (needsPhoto) {
      const label = document.createElement('div');
      label.className = 'thumb-need-photo';
      label.textContent = '사진 필요';
      wrap.appendChild(label);
    }

    strip.appendChild(wrap);
  });

  // 앨범 페이지 추가 버튼 (마지막 썸네일 뒤)
  const addWrap = document.createElement('div');
  addWrap.className = 'thumb-wrap';
  const addBtn = document.createElement('div');
  addBtn.className = 'thumb-add';
  addBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.5v15m7.5-7.5h-15"/></svg>`;
  addBtn.addEventListener('click', () => openAlbumPicker());
  addWrap.appendChild(addBtn);
  strip.appendChild(addWrap);
}

function openAlbumPicker() {
  document.getElementById('album-picker-backdrop').classList.add('open');
}

function closeAlbumPicker() {
  document.getElementById('album-picker-backdrop').classList.remove('open');
}

function removeAlbumPage(pageIndex) {
  const allPages = getPages();
  const page = allPages[pageIndex];
  if (!page || !page._userAdded) return;

  const templates = getAlbumTemplates();
  const tmpl = templates[page.albumTemplateIndex];
  const offset = getAlbumSlotOffset(pageIndex);
  const numSlots = tmpl ? tmpl.regions.length : 0;

  // config에서 페이지 제거 (getPages 배열의 index 0 = 커버이므로 config index = pageIndex - 1)
  const configPages = config.versions[currentVersion].pages;
  const configIdx = pageIndex - 1; // 커버가 index 0
  if (configIdx >= 0 && configIdx < configPages.length) {
    configPages.splice(configIdx, 1);
  }

  // 앨범 사진 배열에서 해당 슬롯 제거
  albumPhotos.splice(offset, numSlots);
  albumPhotoURLs.splice(offset, numSlots);

  // 선택 초기화
  albumSelectedSlot = -1;

  // 현재 페이지가 삭제 대상이면 이전 페이지로
  const newPages = getPages();
  if (currentPageIndex >= newPages.length) {
    currentPageIndex = newPages.length - 1;
  }

  renderCarousel();
  renderThumbnails();
}

function addAlbumPage(templateIndex) {
  const templates = getAlbumTemplates();
  if (templateIndex < 0 || templateIndex >= templates.length) return;

  // 새 scene 번호 = 현재 마지막 scene + 1
  const pages = config.versions[currentVersion].pages;
  const lastScene = pages.length > 0 ? pages[pages.length - 1].scene : 0;
  const newScene = lastScene + 1;

  const newPage = {
    scene: newScene,
    title: `에필로그 ${newScene - 17}`,
    pageType: 'epilogue_album',
    albumTemplateIndex: templateIndex,
    textPosition: 'none',
    text: '',
    _userAdded: true
  };

  pages.push(newPage);

  // 앨범 사진 배열 확장
  const tmpl = templates[templateIndex];
  for (let i = 0; i < tmpl.regions.length; i++) {
    albumPhotos.push(null);
    albumPhotoURLs.push(null);
  }

  renderCarousel();
  renderThumbnails();

  // 새 페이지로 이동
  const allPages = getPages();
  setTimeout(() => jumpToPage(allPages.length - 1), 100);
}

// ========== Face-API.js 초기화 (다중 인물 감지용) ==========

// Face-API.js — PipelineCore 공유 모듈 사용
PipelineCore.loadFaceApi(); // 비동기 초기화 시작
const detectFacesInFile = PipelineCore.detectFacesInFile;

async function segmentChildWithSAM2(file, faces) {
  if (!faces || faces.length < 2) return null;

  // 얼굴 크기순 정렬 (내림차순) — 가장 작은 얼굴이 아이
  const sorted = [...faces].sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height));
  const childFace = sorted[sorted.length - 1];
  const adultFaces = sorted.slice(0, -1);

  const childCenterX = childFace.box.x + childFace.box.width / 2;
  const childCenterY = childFace.box.y + childFace.box.height / 2;
  const negPoints = adultFaces.map(f => [
    f.box.x + f.box.width / 2,
    f.box.y + f.box.height / 2
  ]);

  console.log(`👶 SAM2 요청: 아이 (${childCenterX.toFixed(0)}, ${childCenterY.toFixed(0)}), 어른 ${negPoints.length}명`);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('point_x', childCenterX.toString());
  formData.append('point_y', childCenterY.toString());
  if (negPoints.length > 0) {
    formData.append('neg_points', JSON.stringify(negPoints));
  }

  const resp = await PipelineCore.fetchWithTimeout(`${SMART_CROP_API}/segment-child`, {
    method: 'POST',
    body: formData,
  }, 90000);

  if (!resp.ok) throw new Error(`SAM2 서버 오류: ${resp.status}`);
  return resp;
}

// ========== Cover Photo (smart crop + remove.bg) ==========

const SMART_CROP_API = PipelineCore.API_URL;
const fetchWithTimeout = PipelineCore.fetchWithTimeout;

async function smartCropPerson(file) {
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetchWithTimeout(`${SMART_CROP_API}/smart-crop?crop_mode=person&seg_size=512`, {
    method: 'POST',
    body: formData
  });
  if (!resp.ok) return null;
  return await resp.json();
}

function cropImageOnCanvas(file, coords) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
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
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('이미지 로드 실패')); };
    img.src = blobUrl;
  });
}

// ========== Multi-Candidate Helpers ==========

async function createPhotoThumb(file) {
  // 1) createImageBitmap (HEIC on Safari, all standard formats)
  try {
    const bitmap = await createImageBitmap(file);
    const size = 104;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - s) / 2;
    const sy = (bitmap.height - s) / 2;
    ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (dataUrl.length > 1000) return dataUrl;
  } catch (e) {}

  // 2) Image element fallback
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const size = 104;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2;
        const sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
        URL.revokeObjectURL(blobUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(); };
      img.src = blobUrl;
    });
    if (dataUrl.length > 1000) return dataUrl;
  } catch (e) {}

  // 3) Placeholder (HEIC on Chrome etc.)
  const canvas = document.createElement('canvas');
  canvas.width = 104;
  canvas.height = 104;
  const ctx = canvas.getContext('2d');
  const hash = Array.from(file.name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffffff, 0);
  ctx.fillStyle = `hsl(${hash % 360}, 45%, 75%)`;
  ctx.fillRect(0, 0, 104, 104);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u{1F4F7}', 52, 56);
  return canvas.toDataURL('image/png');
}

function syncCandidateToGlobals(c) {
  coverPhotoURL = c.photoURL;
  coverPhotoOptions = c.photoOptions;
  selectedModelKey = c.selectedModelKey;
  coverManualOffsets = c.manualOffsets || {};
  coverCropData = c.cropData;
  coverCroppedFile = c.croppedFile;
  isRemovingBg = c.isProcessing;
  coverLoadingText = c.loadingText;
  coverErrorText = c.errorText || '';
}

function saveGlobalsToActiveCandidate() {
  if (activeCandidateIndex < 0 || activeCandidateIndex >= coverCandidates.length) return;
  const c = coverCandidates[activeCandidateIndex];
  c.photoURL = coverPhotoURL;
  c.photoOptions = coverPhotoOptions;
  c.selectedModelKey = selectedModelKey;
  c.manualOffsets = coverManualOffsets;
  c.cropData = coverCropData;
  c.croppedFile = coverCroppedFile;
  c.isProcessing = isRemovingBg;
  c.loadingText = coverLoadingText;
}

function switchCandidate(index) {
  if (index === activeCandidateIndex) return;
  if (index < 0 || index >= coverCandidates.length) return;
  saveGlobalsToActiveCandidate();
  activeCandidateIndex = index;
  syncCandidateToGlobals(coverCandidates[index]);
  renderCarousel();
  renderCoverControls();
}

async function processCandidate(candidate) {
  const isActive = () => coverCandidates[activeCandidateIndex] === candidate;
  const syncAndRender = () => {
    if (isActive()) {
      syncCandidateToGlobals(candidate);
      renderCarousel();
    }
    renderCoverControls();
  };

  candidate.isProcessing = true;
  candidate.errorText = '';
  candidate.loadingText = '인물을 감지하는 중...';
  candidate.photoOptions = {};
  candidate.photoURL = null;
  candidate.selectedModelKey = null;
  candidate.failedModels = new Set();
  syncAndRender();

  try {
    // 1. 이미지 로드
    const img = await PipelineCore.blobToImage(candidate.originalFile);

    // 2. 공유 DINO-Base 감지 (1회만 실행)
    const sharedState = {
      originalFile: candidate.originalFile,
      originalImage: img,
      detections: null,
      vitposeResults: null,
      sam2: null,
      fullMaskCanvas: null,
      resultImage: null,
      resultBlob: null,
    };

    await PipelineCore.executePipelineStep('gdino-base', sharedState, {
      params: { prompt: 'person', threshold: 0.50 },
      skipInteraction: true,
    });

    if (!sharedState.detections) throw new Error('인물이 감지되지 않았습니다');

    // 신뢰도 필터링 — 0.80 이상만 사용, 없으면 최고 score 1개 사용
    const MIN_SCORE = 0.50;
    let dinoBoxes = sharedState.detections.dinoBoxes || [];
    const highConf = dinoBoxes.filter(d => d.score >= MIN_SCORE);
    if (highConf.length > 0) {
      dinoBoxes = highConf;
    } else {
      // 최고 confidence 1개만 사용
      dinoBoxes = [...dinoBoxes].sort((a, b) => b.score - a.score).slice(0, 1);
      console.warn(`DINO: 신뢰도 ${MIN_SCORE} 이상 없음. 최고 score ${dinoBoxes[0]?.score?.toFixed(2)} 사용`);
    }
    // 면적 기준 정렬 (작은 순 → 아이가 먼저)
    const sorted = [...dinoBoxes].sort((a, b) => {
      const aA = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
      const bA = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
      return aA - bA;
    });

    // 3. 인물 2명 이상이면 사용자 선택, 1명이면 자동 선택
    let selectedIdx = 0;
    if (sorted.length >= 2) {
      candidate.loadingText = '';
      syncAndRender();
      selectedIdx = await showPersonSelectionModal(img, sorted);
    }

    // 선택한 인물로 detections 재구성
    const childBox = sorted[selectedIdx];
    const dinoBbox = childBox.box;
    sharedState.detections = {
      childFace: {
        cx: (dinoBbox[0] + dinoBbox[2]) / 2,
        cy: (dinoBbox[1] + dinoBbox[3]) / 2,
        x: dinoBbox[0], y: dinoBbox[1],
        width: dinoBbox[2] - dinoBbox[0],
        height: dinoBbox[3] - dinoBbox[1],
      },
      adultFaces: sorted.filter((_, i) => i !== selectedIdx).map(d => ({
        cx: (d.box[0] + d.box[2]) / 2,
        cy: (d.box[1] + d.box[3]) / 2,
        x: d.box[0], y: d.box[1],
        width: d.box[2] - d.box[0],
        height: d.box[3] - d.box[1],
      })),
      dinoBbox,
      dinoBoxes: sorted,
    };

    // 4. 파이프라인 실행 (GPU → 순차, 외부API → 병렬)
    candidate.loadingText = '배경을 지우는 중...';
    syncAndRender();

    const NON_GPU_MODELS = ['removebg'];
    const isNonGpu = (p) => p.steps.every(s => NON_GPU_MODELS.includes(s.type) || s.type === 'crop');
    const activePipelines = COVER_PIPELINES.filter(p => {
      if (isNonGpu(p) && !useRemoveBg) return false;
      return true;
    });
    const gpuPipelines = activePipelines.filter(p => !isNonGpu(p));
    const extPipelines = activePipelines.filter(p => isNonGpu(p));

    async function runSinglePipeline(pipeline) {
      const pipeState = {
        originalFile: sharedState.originalFile,
        originalImage: sharedState.originalImage,
        detections: sharedState.detections ? { ...sharedState.detections } : null,
        vitposeResults: null,
        sam2: null,
        fullMaskCanvas: null,
        resultImage: null,
        resultBlob: null,
      };

      for (const step of pipeline.steps) {
        await PipelineCore.executePipelineStep(step.type, pipeState, {
          params: step.params,
          skipInteraction: true,
          sam2Padding: 30,
        });
      }

      if (!pipeState.resultBlob) throw new Error('결과 없음');

      // Alpha 채널 정리 — 미세한 잔여 alpha 제거
      try { pipeState.resultBlob = await PipelineCore.cleanAlpha(pipeState.resultBlob); } catch (e) { /* 원본 사용 */ }

      const url = URL.createObjectURL(pipeState.resultBlob);
      candidate.photoOptions[pipeline.key] = { url };
      console.log(`[${pipeline.key}] 완료: ${pipeState.resultBlob.size} bytes`);

      if (!candidate._thumbFromResult) {
        try {
          const bm = await createImageBitmap(pipeState.resultBlob);
          const sz = 104, cv = document.createElement('canvas');
          cv.width = sz; cv.height = sz;
          const cx = cv.getContext('2d');
          let srcSize = Math.min(bm.width, bm.height);
          let srcX = (bm.width - srcSize) / 2;
          let srcY = (bm.height - srcSize) / 2;
          cx.fillStyle = '#f0f0f0';
          cx.fillRect(0, 0, sz, sz);
          cx.drawImage(bm, srcX, srcY, srcSize, srcSize, 0, 0, sz, sz);
          bm.close();
          const du = cv.toDataURL('image/jpeg', 0.85);
          if (du.length > 1000) {
            candidate.thumbURL = du;
            candidate._thumbFromResult = true;
          }
        } catch (e) {}
      }

      if (!candidate.selectedModelKey) {
        candidate.photoURL = url;
        candidate.selectedModelKey = pipeline.key;
        candidate.loadingText = '';
        candidate.isProcessing = false;
        if (isActive()) pendingNudge = true;
      }
      syncAndRender();
    }

    // 외부 API 파이프라인은 즉시 병렬 시작
    const extPromises = extPipelines.map(p =>
      runSinglePipeline(p).catch(err => {
        console.warn(`[${p.key}] 파이프라인 실패:`, err.message);
        candidate.failedModels.add(p.key);
        syncAndRender();
      })
    );

    // GPU 파이프라인은 순차 실행
    for (const pipeline of gpuPipelines) {
      try {
        await runSinglePipeline(pipeline);
      } catch (err) {
        console.warn(`[${pipeline.key}] 파이프라인 실패:`, err.message);
        candidate.failedModels.add(pipeline.key);
        syncAndRender();
      }
    }

    // 외부 API 완료 대기
    await Promise.allSettled(extPromises);

    if (Object.keys(candidate.photoOptions).length === 0) {
      candidate.photoOptions = null;
      throw new Error('모든 파이프라인이 실패했습니다.');
    }
  } catch (e) {
    console.error('배경 제거 실패:', e);
    const isTimeout = e.name === 'AbortError';
    candidate.errorText = isTimeout
      ? '서버 응답 시간이 초과되었습니다'
      : e.message || '사진 처리에 실패했습니다';
  } finally {
    candidate.isProcessing = false;
    candidate.loadingText = '';
    syncAndRender();
  }
}

// ========== 인물 선택 모달 ==========

function showPersonSelectionModal(img, sortedDetections) {
  return new Promise((resolve) => {
    const modal = document.getElementById('person-selection-modal');
    const canvas = document.getElementById('person-selection-canvas');
    const btnWrap = document.getElementById('person-selection-buttons');
    if (!modal || !canvas) { resolve(0); return; }

    const ctx = canvas.getContext('2d');

    // 캔버스 크기: 뷰포트에 맞추기
    const maxW = window.innerWidth - 40;
    const maxH = window.innerHeight * 0.55;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);

    // 이미지 그리기
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 감지 박스 + 번호 그리기
    const colors = ['#00e676', '#ff9100', '#448aff', '#ff5252', '#e040fb'];
    sortedDetections.forEach((det, i) => {
      const [x1, y1, x2, y2] = det.box;
      const sx = x1 * scale, sy = y1 * scale;
      const sw = (x2 - x1) * scale, sh = (y2 - y1) * scale;
      const color = colors[i % colors.length];

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(sx, sy, sw, sh);

      // 번호 라벨
      const fontSize = Math.max(18, Math.round(sh * 0.12));
      ctx.font = `bold ${fontSize}px sans-serif`;
      const label = `${i + 1}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(sx, sy - fontSize - 4, tw + 12, fontSize + 6);
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';
      ctx.fillText(label, sx + 6, sy - fontSize - 1);
    });

    // 버튼 생성
    btnWrap.innerHTML = sortedDetections.map((det, i) => {
      const score = det.score != null ? `${(det.score * 100).toFixed(0)}%` : '';
      return `<button class="person-btn" data-idx="${i}" style="border-color:${colors[i % colors.length]}">
        <span style="color:${colors[i % colors.length]};font-weight:700">${i + 1}</span>
        <span>${score}</span>
      </button>`;
    }).join('');

    modal.classList.add('visible');

    function cleanup() {
      modal.classList.remove('visible');
      canvas.removeEventListener('click', onCanvasClick);
      btnWrap.removeEventListener('click', onBtnClick);
    }

    function onCanvasClick(e) {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / scale;
      const cy = (e.clientY - rect.top) / scale;
      for (let i = 0; i < sortedDetections.length; i++) {
        const [x1, y1, x2, y2] = sortedDetections[i].box;
        if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
          cleanup();
          resolve(i);
          return;
        }
      }
    }

    function onBtnClick(e) {
      const btn = e.target.closest('.person-btn');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx);
      cleanup();
      resolve(idx);
    }

    canvas.addEventListener('click', onCanvasClick);
    btnWrap.addEventListener('click', onBtnClick);
  });
}

function enqueueCandidate(candidate) {
  processingQueue.push(candidate);
  if (!isProcessingQueue) runProcessingQueue();
}

async function runProcessingQueue() {
  isProcessingQueue = true;
  while (processingQueue.length > 0) {
    // 1개씩 순차 처리 (GPU 충돌 방지)
    const activeCandidate = coverCandidates[activeCandidateIndex];
    const activeIdx = processingQueue.findIndex(c => c === activeCandidate);
    const next = activeIdx !== -1
      ? processingQueue.splice(activeIdx, 1)[0]
      : processingQueue.shift();
    await processCandidate(next);
  }
  isProcessingQueue = false;
}

async function handleCoverPhotos(files) {
  const fileArr = Array.from(files);
  if (fileArr.length === 0) return;

  if (currentPageIndex !== 0) jumpToPage(0);

  const firstNewIndex = coverCandidates.length;
  // Create all candidates first, then start queue
  const newCandidates = [];
  for (const file of fileArr) {
    const thumbURL = await createPhotoThumb(file);
    const candidate = {
      id: nextCandidateId++,
      thumbURL,
      originalFile: file,
      croppedFile: null,
      cropData: null,
      photoOptions: null,
      selectedModelKey: null,
      photoURL: null,
      manualOffsets: {},
      isProcessing: false,
      loadingText: ''
    };
    coverCandidates.push(candidate);
    newCandidates.push(candidate);
  }

  // Switch to first new candidate
  saveGlobalsToActiveCandidate();
  activeCandidateIndex = firstNewIndex;
  syncCandidateToGlobals(coverCandidates[firstNewIndex]);
  renderCarousel();
  renderCoverControls();

  // Enqueue all at once so the first batch picks up 3
  newCandidates.forEach(c => processingQueue.push(c));
  if (!isProcessingQueue) runProcessingQueue();
}

function retryCoverProcessing() {
  const candidate = coverCandidates[activeCandidateIndex];
  if (!candidate) return;
  candidate.errorText = '';
  candidate.photoOptions = {};
  candidate.photoURL = null;
  candidate.selectedModelKey = null;
  syncCandidateToGlobals(candidate);
  enqueueCandidate(candidate);
}

function showToggleToast(msg) {
  const overlay = document.querySelector('.cover-model-overlay');
  if (!overlay) return;
  const prev = overlay.querySelector('.toggle-toast');
  if (prev) prev.remove();
  const toast = document.createElement('div');
  toast.className = 'toggle-toast';
  toast.textContent = msg;
  overlay.appendChild(toast);
  toast.addEventListener('animationend', () => toast.remove());
}

function selectCoverModel(modelKey) {
  if (!coverPhotoOptions) return;
  const chosen = coverPhotoOptions[modelKey];
  if (!chosen) {
    // Check if failed or still loading
    const c = coverCandidates[activeCandidateIndex];
    if (c && c.failedModels && c.failedModels.has(modelKey)) return;
    showToggleToast('배경을 지우는 중입니다');
    return;
  }

  selectedModelKey = modelKey;
  coverPhotoURL = chosen.url;
  const childImg = document.querySelector('.cover-child-img');
  if (childImg) {
    childImg.src = chosen.url;
    applyCoverManualOffset(childImg);
    const layout = document.querySelector('.cover-layout');
    if (layout) layout.remove();
  } else {
    renderCarousel();
  }
  // Update toggle active state + slide indicator
  document.querySelectorAll('.model-toggle-option').forEach(el => {
    el.classList.toggle('active', el.dataset.model === modelKey);
  });
  const activeOpt = document.querySelector('.model-toggle-large .model-toggle-option.active');
  const indicator = document.querySelector('.model-toggle-indicator');
  if (activeOpt && indicator) {
    const idx = parseInt(activeOpt.dataset.idx) || 0;
    indicator.style.transform = `translateX(${idx * 46}px)`;
  }
  saveGlobalsToActiveCandidate();
  renderCoverControls();
}

function startCoverPositionEdit() {
  isEditingCoverPos = true;

  const childImg = document.querySelector('.cover-child-img');
  if (!childImg) return;

  const wrap = childImg.closest('.slide-img-wrap');
  if (!wrap) return;

  // Replace cover controls with position edit UI
  const controlsEl = els.coverControls;
  const savedControlsHTML = controlsEl ? controlsEl.innerHTML : '';

  if (controlsEl) {
    controlsEl.innerHTML = `
      <div class="cover-pos-hint">드래그하여 위치를 조정하세요</div>
      <div class="cover-pos-buttons">
        <button class="cover-pos-btn cover-pos-done">완료</button>
        <button class="cover-pos-btn cover-pos-reset">초기화</button>
      </div>`;
  }

  let startX, startY, startDx, startDy;
  const onStart = (e) => {
    if (e.target.closest('.cover-pos-btn') || e.target.closest('.model-toggle-option')) return;
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    const mo = getCoverOffset();
    startDx = mo.dx;
    startDy = mo.dy;
    childImg.style.transition = 'none';
  };
  const onMove = (e) => {
    if (startX == null) return;
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    const wrapRect = wrap.getBoundingClientRect();
    const dx = ((pt.clientX - startX) / wrapRect.width) * 100;
    const dy = ((pt.clientY - startY) / wrapRect.height) * 100;
    const mo = getCoverOffset();
    mo.dx = startDx + dx;
    mo.dy = startDy + dy;
    applyCoverManualOffset(childImg);
  };
  const onEnd = () => {
    startX = null;
    childImg.style.transition = '';
  };

  const cleanup = () => {
    wrap.removeEventListener('mousedown', onStart);
    wrap.removeEventListener('touchstart', onStart);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('mouseup', onEnd);
    document.removeEventListener('touchend', onEnd);
    isEditingCoverPos = false;
    saveGlobalsToActiveCandidate();
    if (controlsEl) controlsEl.innerHTML = '';
    renderCoverControls();
  };

  wrap.addEventListener('mousedown', onStart);
  wrap.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);

  const doneBtn = controlsEl.querySelector('.cover-pos-done');
  const resetBtn = controlsEl.querySelector('.cover-pos-reset');
  if (doneBtn) doneBtn.addEventListener('click', cleanup);
  if (resetBtn) resetBtn.addEventListener('click', () => {
    coverManualOffsets[selectedModelKey] = { dx: 0, dy: 0, rotation: 0, scale: 1 };
    applyCoverManualOffset(childImg);
  });
}

function applyCoverManualOffset(childImg) {
  if (!childImg) childImg = document.querySelector('.cover-child-img');
  if (!childImg) return;
  const mo = getCoverOffset();
  const sc = mo.scale != null ? mo.scale : 1;
  const pos = computeChildPosition();
  if (pos) {
    const tx = (pos.leftOffset - 50) + mo.dx;
    childImg.style.cssText = `height:${pos.height.toFixed(1)}%;top:${(pos.top + mo.dy).toFixed(1)}%;left:50%;transform:translateX(${tx.toFixed(1)}%) rotate(${mo.rotation}deg) scale(${sc.toFixed(3)})`;
  } else {
    const dx = -50 + mo.dx;
    childImg.style.cssText = `height:80%;bottom:${(-mo.dy).toFixed(1)}%;left:50%;transform:translateX(${dx.toFixed(1)}%) rotate(${mo.rotation}deg) scale(${sc.toFixed(3)})`;
  }
}

function setupCoverEvents() {
  const fileInput = document.getElementById('cover-photo-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleCoverPhotos(e.target.files);
    fileInput.value = '';
  });

  const removebgToggle = document.getElementById('removebg-toggle');
  if (removebgToggle) {
    if (useRemoveBg) removebgToggle.classList.add('active');
    removebgToggle.addEventListener('click', () => {
      useRemoveBg = !useRemoveBg;
      localStorage.setItem('bookPreview_useRemoveBg', useRemoveBg);
      removebgToggle.classList.toggle('active', useRemoveBg);
    });
  }

  // Delegate clicks for cover controls (in bottom panel + carousel)
  document.addEventListener('click', (e) => {
    // Frame page zone click → trigger file input
    const frameZone = e.target.closest('.frame-page-zone');
    if (frameZone) {
      const slotKey = frameZone.dataset.slotKey;
      if (slotKey) triggerPagePhotoInput(slotKey);
      return;
    }
    // Cover touch hint dismiss
    if (e.target.closest('.cover-touch-hint-close')) {
      window._coverTouchHintDismissed = true;
      const hint = e.target.closest('.cover-touch-hint');
      if (hint) hint.remove();
      return;
    }
    // Frame hint dismiss
    if (e.target.closest('.frame-page-hint-close')) {
      window._frameHintDismissed = true;
      const hint = e.target.closest('.frame-page-hint');
      if (hint) hint.remove();
      return;
    }
    // Album hint dismiss
    if (e.target.closest('.album-hint-close')) {
      window._albumHintDismissed = true;
      const hint = e.target.closest('.album-hint');
      if (hint) hint.remove();
      return;
    }

    // Album page upload button
    const albumUploadBtn = e.target.closest('.album-page-upload-btn');
    if (albumUploadBtn) {
      const offset = parseInt(albumUploadBtn.dataset.albumOffset);
      const count = parseInt(albumUploadBtn.dataset.albumCount);
      albumPendingPageUpload = { offset, count };
      document.getElementById('album-page-file-input').click();
      return;
    }

    // Album save button
    const albumSaveBtn = e.target.closest('.album-save-btn');
    if (albumSaveBtn) {
      const pageIdx = parseInt(albumSaveBtn.dataset.albumSavePage);
      albumSavePage(pageIdx);
      return;
    }

    // Album frame zone click (desktop — touch handled separately)
    const albumZone = e.target.closest('.album-frame-zone');
    if (albumZone && albumZone.dataset.albumSlot !== undefined) {
      // Touch already handled it, skip if within 300ms
      if (albumIsDragging2) return;
      albumHandleTap(parseInt(albumZone.dataset.albumSlot));
      return;
    }

    // Candidate thumbnail click
    const candidateThumb = e.target.closest('.candidate-thumb');
    if (candidateThumb) {
      const idx = parseInt(candidateThumb.dataset.candidateIndex);
      if (!isNaN(idx)) switchCandidate(idx);
      return;
    }
    // Add more photos
    if (e.target.closest('#cover-add-btn')) {
      fileInput.click();
      return;
    }
    const toggleOption = e.target.closest('.model-toggle-option');
    if (toggleOption) {
      const modelKey = toggleOption.dataset.model;
      if (modelKey) selectCoverModel(modelKey);
      return;
    }
    if (e.target.closest('#cover-upload-btn') || e.target.closest('#cover-upload-zone')) {
      fileInput.click();
      return;
    }
    // Clicking cover hint in carousel → switch to photo step
    if (e.target.closest('.cover-hint-text')) {
      setStep(0);
      return;
    }
    // Print request button
    if (e.target.closest('#print-request-btn')) {
      const btn = e.target.closest('#print-request-btn');
      if (!btn.disabled) requestPrint();
      return;
    }
  });

  // Album file input handlers
  document.getElementById('album-single-file-input').addEventListener('change', async (e) => {
    if (e.target.files.length > 0 && albumPendingSlot >= 0) {
      try {
        const { img, url } = await loadAlbumImageFromFile(e.target.files[0]);
        albumPhotos[albumPendingSlot] = img;
        albumPhotoURLs[albumPendingSlot] = url;
        albumRefreshSlot(albumPendingSlot);
        renderThumbnails();
      } catch (err) {
        console.error('Album photo load failed:', err);
      }
      albumPendingSlot = -1;
    }
    e.target.value = '';
  });

  document.getElementById('album-page-file-input').addEventListener('change', async (e) => {
    if (e.target.files.length > 0 && albumPendingPageUpload) {
      const { offset, count } = albumPendingPageUpload;
      const files = Array.from(e.target.files).slice(0, count);
      for (let i = 0; i < files.length && i < count; i++) {
        try {
          const { img, url } = await loadAlbumImageFromFile(files[i]);
          albumPhotos[offset + i] = img;
          albumPhotoURLs[offset + i] = url;
          albumRefreshSlot(offset + i);
        } catch (err) {
          console.error('Album photo load failed:', err);
        }
      }
      renderThumbnails();
      albumPendingPageUpload = null;
    }
    e.target.value = '';
  });

  document.getElementById('album-file-input').addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    initAlbumArrays();
    const total = getAlbumTotalSlots();
    const files = Array.from(e.target.files).slice(0, total);
    let nextEmpty = 0;
    for (const file of files) {
      while (nextEmpty < total && albumPhotos[nextEmpty]) nextEmpty++;
      if (nextEmpty >= total) break;
      try {
        const { img, url } = await loadAlbumImageFromFile(file);
        albumPhotos[nextEmpty] = img;
        albumPhotoURLs[nextEmpty] = url;
        albumRefreshSlot(nextEmpty);
        nextEmpty++;
      } catch (err) {
        console.error('Album photo load failed:', err);
      }
    }
    renderThumbnails();
    e.target.value = '';
  });

  // Click outside album zones to deselect
  document.addEventListener('click', (e) => {
    if (albumSelectedSlot === -1) return;
    if (e.target.closest('.album-frame-zone')) return;
    if (e.target.closest('.album-page-upload-btn')) return;
    const zone = document.querySelector(`.album-frame-zone[data-album-slot="${albumSelectedSlot}"]`);
    if (zone) zone.classList.remove('selected');
    albumSelectedSlot = -1;
  });

  // Album frame picker modal
  document.getElementById('album-picker-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAlbumPicker();
  });
  document.querySelectorAll('.album-picker-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const tmplIdx = parseInt(btn.dataset.albumTemplate);
      closeAlbumPicker();
      addAlbumPage(tmplIdx);
    });
  });
}

// ========== Event Handlers ==========

function setupEvents() {
  els.firstNameInput.addEventListener('input', () => { updateVariables(); renderCarousel(); });
  els.parentNamesInput.addEventListener('input', () => { updateVariables(); renderCarousel(); });

  els.versionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.versionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentVersion = btn.dataset.version;
      const pages = getPages();
      if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
      renderCarousel();
      renderThumbnails();
    });
  });

  // Step bar navigation
  els.stepTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      setStep(parseInt(tab.dataset.step));
    });
  });

  // Story sheet close
  document.getElementById('story-sheet-done').addEventListener('click', closeStorySheet);
  document.getElementById('story-sheet-backdrop').addEventListener('click', closeStorySheet);

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') goPage(-1);
    else if (e.key === 'ArrowRight') goPage(1);
  });
}

// ========== Init ==========

// ========== Guide Bottom Sheet ==========

function simpleMarkdownToHtml(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\* \*(.+?)\*$/gm, '<li><em>$1</em></li>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, (m) => m)
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .split('\n\n')
    .map(block => {
      block = block.trim();
      if (!block || block.startsWith('<h3>') || block.startsWith('<hr') || block.startsWith('<ul>')) return block;
      return `<p>${block}</p>`;
    })
    .join('\n');
}

function initGuideModal() {
  const btn = document.getElementById('guide-btn');
  const modal = document.getElementById('guide-modal');
  const closeBtn = document.getElementById('guide-modal-close');
  const body = document.getElementById('guide-modal-body');
  if (!btn || !modal) return;

  let loaded = false;

  btn.addEventListener('click', () => {
    if (!loaded) {
      fetch('NAME/guide.md')
        .then(r => r.text())
        .then(md => {
          body.innerHTML = simpleMarkdownToHtml(md);
          loaded = true;
        });
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  });
}

// ========== Print Tab (Step 3) ==========

let printRequestState = 'idle'; // idle | loading | success | error

function renderPrintControls() {
  const container = document.getElementById('print-controls');
  if (!container) return;

  // 이미 요청 완료 상태
  if (printRequestState === 'success') {
    container.innerHTML = `
      <div class="print-status">
        <div class="print-status-icon">&#10003;</div>
        <div class="print-status-title">인쇄 요청이 접수되었습니다</div>
        <div class="print-status-desc">담당자가 확인 후 인쇄를 진행합니다.<br>진행 상황은 알림톡으로 안내드릴게요.</div>
      </div>`;
    return;
  }

  if (printRequestState === 'loading') {
    container.innerHTML = `
      <div class="print-status">
        <div class="print-spinner"></div>
        <div class="print-status-desc">인쇄 요청을 전송 중입니다...</div>
      </div>`;
    return;
  }

  // 체크리스트 항목
  const checks = [
    {
      id: 'photo',
      label: '아이 사진 선택 완료',
      passed: !!coverPhotoURL
    },
    {
      id: 'name',
      label: '아이 이름 입력 완료',
      passed: !!(els.firstNameInput && els.firstNameInput.value.trim())
    },
    {
      id: 'version',
      label: '스토리 버전 선택 완료',
      passed: !!currentVersion
    }
  ];

  const allPassed = checks.every(c => c.passed);

  const checklistHtml = checks.map(c => `
    <div class="print-check-item${c.passed ? ' passed' : ''}">
      <div class="print-check-icon">${c.passed ? '&#10003;' : ''}</div>
      <span>${c.label}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="print-checklist">${checklistHtml}</div>
    <button class="print-btn${allPassed ? ' ready' : ''}" id="print-request-btn"
      ${allPassed ? '' : 'disabled'}>
      ${allPassed ? '인쇄 요청하기' : '위 항목을 모두 완료해주세요'}
    </button>`;
}

async function requestPrint() {
  if (printRequestState === 'loading') return;

  const firstName = els.firstNameInput.value.trim();
  const parentNames = els.parentNamesInput.value.trim();

  if (!firstName || !coverPhotoURL) return;

  printRequestState = 'loading';
  renderPrintControls();

  try {
    const body = {
      firstName,
      parentNames,
      version: currentVersion,
      bookId: `book_${Date.now()}`,
      timestamp: new Date().toISOString()
    };

    const resp = await fetchWithTimeout(`${SMART_CROP_API}/request-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    printRequestState = 'success';
  } catch (e) {
    console.error('인쇄 요청 실패:', e);
    printRequestState = 'error';
  }

  renderPrintControls();

  if (printRequestState === 'error') {
    const container = document.getElementById('print-controls');
    if (container) {
      container.innerHTML = `
        <div class="print-status">
          <div class="print-status-icon" style="color:#e74c3c;">!</div>
          <div class="print-status-title">요청 실패</div>
          <div class="print-status-desc">네트워크 오류가 발생했습니다. 다시 시도해주세요.</div>
          <button class="print-btn ready" onclick="printRequestState='idle';renderPrintControls();" style="margin-top:12px;">다시 시도</button>
        </div>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  setupEvents();
  setupCoverEvents();
  initGuideModal();
  loadConfig();
  window.addEventListener('resize', () => {
    const vw = els.pageViewer.clientWidth;
    const track = document.getElementById('carousel-track');
    if (track) {
      const slideGap = 8;
      for (const slide of track.children) slide.style.width = `${vw - slideGap}px`;
      track.style.transition = 'none';
      track.style.transform = `translateX(-${vw}px)`;
    }
    positionCoverChild();
  });
});

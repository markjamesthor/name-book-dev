/**
 * 배경 제거 프로토타입 - 앱 로직
 * 서버: Windows RTX /remove-bg
 */

const API_URL = location.hostname.includes('github.io')
  ? 'https://ai.monviestory.co.kr'
  : 'http://59.10.238.17:5001';

// ========== DOM ==========
const els = {
    uploadArea: document.getElementById('upload-area'),
    fileInput: document.getElementById('file-input'),
    fileName: document.getElementById('file-name'),
    errorMessage: document.getElementById('error-message'),
    resSlider: document.getElementById('resolution-slider'),
    resValue: document.getElementById('res-value'),
    originalPreview: document.getElementById('original-preview'),
    resultCanvas: document.getElementById('result-canvas'),
    compareSection: document.getElementById('compare-section'),
    bgqaBadge: document.getElementById('bgqa-badge'),
    processingInfo: document.getElementById('processing-info'),
    previewSection: document.getElementById('preview-section'),
    previewWhite: document.getElementById('preview-white'),
    previewGray: document.getElementById('preview-gray'),
    previewBlack: document.getElementById('preview-black'),
    downloadSection: document.getElementById('download-section'),
    downloadBtn: document.getElementById('download-btn'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingTime: document.getElementById('loading-time'),
    loadingText: document.querySelector('.loading-text'),
    croppedCard: document.getElementById('cropped-card'),
    croppedCanvas: document.getElementById('cropped-canvas'),
    cropInfo: document.getElementById('crop-info'),
    smartCropCheck: document.getElementById('smart-crop-check'),
};

// ========== State ==========
let selectedFile = null;       // 원본 File 객체
let processedBlob = null;      // 서버 응답 WebP blob (알파 포함)
let resultImage = null;        // 디코딩된 Image 객체
let cropCoords = null;         // 스마트 크롭 좌표 {x, y, width, height}
let croppedBlob = null;        // 크롭된 이미지 Blob

// ========== Upload ==========
els.uploadArea.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

// Drag & Drop
els.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.uploadArea.classList.add('dragover');
});
els.uploadArea.addEventListener('dragleave', () => {
    els.uploadArea.classList.remove('dragover');
});
els.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

async function handleFile(file) {
    hideError();

    // HEIC/HEIF → 서버에서 JPEG 변환
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')
        || file.type === 'image/heic' || file.type === 'image/heif';
    if (isHeic) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            const resp = await fetch(`${API_URL}/convert-heic`, { method: 'POST', body: formData });
            if (!resp.ok) throw new Error('변환 실패');
            const blob = await resp.blob();
            file = new File([blob], file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'), { type: 'image/jpeg' });
        } catch (err) {
            showError('HEIC 변환에 실패했습니다.');
            return;
        }
    }

    if (!file.type.startsWith('image/')) {
        showError('이미지 파일만 업로드할 수 있습니다.');
        return;
    }

    selectedFile = file;
    els.fileName.textContent = file.name;
    els.uploadArea.classList.add('has-file');

    // 원본 미리보기
    const url = URL.createObjectURL(file);
    els.originalPreview.src = url;

    // 이전 결과 초기화 후 자동 실행
    resetResults();
    runRemoveBg();
}

async function convertHeicToJpeg(file) {
    // heic2any 라이브러리 동적 로드
    if (!window.heic2any) {
        await loadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
    }
    const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ========== Resolution Slider ==========
const originalCheck = document.getElementById('original-check');
const resControl = document.getElementById('resolution-control');

els.resSlider.addEventListener('input', () => {
    els.resValue.textContent = els.resSlider.value + 'px';
});

originalCheck.addEventListener('change', () => {
    if (originalCheck.checked) {
        resControl.classList.add('disabled');
    } else {
        resControl.classList.remove('disabled');
    }
});

function getMaxSize() {
    return originalCheck.checked ? 9999 : parseInt(els.resSlider.value);
}

// ========== Model Optimal Resolution ==========
const OPTIMAL_RESOLUTION = {
    'portrait': 1024,
    'hr': 2048,
    'hr-matting': 2048,
    'dynamic': 1024,
    'rmbg2': 1024,
    'ben2': 1024,
    'removebg': 1440,  // API가 자체 처리
};

function applyOptimalResolution(model) {
    if (originalCheck.checked) return;  // 원본 모드면 무시
    const optimal = OPTIMAL_RESOLUTION[model] || 1024;
    els.resSlider.value = optimal;
    els.resValue.textContent = optimal + 'px';
}

// ========== Model Change ==========
// 페이지 로드 시 기본 모델의 최적 해상도 적용
applyOptimalResolution(document.querySelector('input[name="model"]:checked').value);

document.querySelectorAll('input[name="model"]').forEach(radio => {
    radio.addEventListener('change', () => {
        applyOptimalResolution(radio.value);
        if (selectedFile) runRemoveBg();
    });
});

// ========== Refine Change ==========
document.querySelectorAll('input[name="refine"]').forEach(radio => {
    radio.addEventListener('change', () => {
        if (selectedFile) runRemoveBg();
    });
});

// ========== Smart Crop ==========
async function runSmartCrop(file) {
    const segSize = document.querySelector('input[name="seg-size"]:checked').value;
    const cropMode = document.querySelector('input[name="crop-mode"]:checked').value;
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch(`${API_URL}/smart-crop?seg_size=${segSize}&crop_mode=${cropMode}`, { method: 'POST', body: formData });
    if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        throw new Error(err?.detail || `스마트 크롭 오류 (${resp.status})`);
    }
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

// COCO 17 스켈레톤 연결선
const COCO_SKELETON = [
    [0, 1], [0, 2], [1, 3], [2, 4],           // 머리
    [5, 6],                                     // 어깨
    [5, 7], [7, 9], [6, 8], [8, 10],           // 팔
    [5, 11], [6, 12], [11, 12],                 // 몸통
    [11, 13], [13, 15], [12, 14], [14, 16],     // 다리
];

const KP_COLORS = {
    nose: '#FF4444', left_eye: '#FF8800', right_eye: '#FF8800',
    left_ear: '#FFCC00', right_ear: '#FFCC00',
    left_shoulder: '#44FF44', right_shoulder: '#44FF44',
    left_elbow: '#00CCFF', right_elbow: '#00CCFF',
    left_wrist: '#4488FF', right_wrist: '#4488FF',
    left_hip: '#AA44FF', right_hip: '#AA44FF',
    left_knee: '#FF44AA', right_knee: '#FF44AA',
    left_ankle: '#FF4444', right_ankle: '#FF4444',
};

function drawKeypoints(ctx, keypoints, cropCoords, minScore = 0.3) {
    if (!keypoints || !keypoints.length) return;

    const offsetX = cropCoords.x;
    const offsetY = cropCoords.y;

    // 점 크기: 캔버스 크기에 비례 (고해상도에서도 잘 보이도록)
    const r = Math.max(8, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.015);

    // 스켈레톤 선 그리기
    ctx.lineWidth = r * 0.8;
    for (const [i, j] of COCO_SKELETON) {
        const a = keypoints[i], b = keypoints[j];
        if (a.score < minScore || b.score < minScore) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(a.x - offsetX, a.y - offsetY);
        ctx.lineTo(b.x - offsetX, b.y - offsetY);
        ctx.stroke();
    }

    // 키포인트 점 그리기
    for (const kp of keypoints) {
        const x = kp.x - offsetX;
        const y = kp.y - offsetY;
        const color = KP_COLORS[kp.name] || '#FFFFFF';
        const alpha = kp.score < minScore ? 0.2 : 1.0;

        // 점
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 라벨 (score >= minScore인 것만)
        if (kp.score >= minScore) {
            const label = kp.name.replace('left_', 'L_').replace('right_', 'R_');
            ctx.font = `bold ${Math.round(r * 2.5)}px sans-serif`;
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeText(label, x + r + 2, y + r * 0.5);
            ctx.fillText(label, x + r + 2, y + r * 0.5);
        }
        ctx.globalAlpha = 1.0;
    }
}

function drawBboxes(ctx, cropCoords, kpBbox, maskBbox) {
    const ox = cropCoords.x;
    const oy = cropCoords.y;

    ctx.lineWidth = Math.max(3, Math.min(cropCoords.width, cropCoords.height) * 0.005);

    // 키포인트 bbox — 파란색 점선
    if (kpBbox) {
        ctx.strokeStyle = 'rgba(0, 150, 255, 0.8)';
        ctx.setLineDash([12, 6]);
        ctx.strokeRect(kpBbox.x_min - ox, kpBbox.y_min - oy, kpBbox.x_max - kpBbox.x_min, kpBbox.y_max - kpBbox.y_min);
    }

    // 마스크 bbox — 주황색 점선
    if (maskBbox) {
        ctx.strokeStyle = 'rgba(255, 140, 0, 0.8)';
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(maskBbox.x_min - ox, maskBbox.y_min - oy, maskBbox.x_max - maskBbox.x_min, maskBbox.y_max - maskBbox.y_min);
    }

    ctx.setLineDash([]);

    // 범례
    const fontSize = Math.max(14, Math.min(cropCoords.width, cropCoords.height) * 0.02);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const ly = cropCoords.height - fontSize * 2.5;
    if (kpBbox) {
        ctx.fillStyle = 'rgba(0, 150, 255, 0.9)';
        ctx.fillText('— 키포인트 bbox', 10, ly);
    }
    if (maskBbox) {
        ctx.fillStyle = 'rgba(255, 140, 0, 0.9)';
        ctx.fillText('— 마스크 bbox', 10, ly + fontSize * 1.3);
    }
}

function showCroppedPreview(file, coords, keypoints, kpBbox, maskBbox) {
    const img = new Image();
    img.onload = () => {
        const canvas = els.croppedCanvas;
        canvas.width = coords.width;
        canvas.height = coords.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, coords.x, coords.y, coords.width, coords.height, 0, 0, coords.width, coords.height);

        // 키포인트 오버레이
        if (keypoints) {
            drawKeypoints(ctx, keypoints, coords);
        }

        // bbox 오버레이
        drawBboxes(ctx, coords, kpBbox, maskBbox);

        els.cropInfo.textContent = `${coords.width}x${coords.height} (원본 ${img.width}x${img.height}의 ${((coords.width * coords.height) / (img.width * img.height) * 100).toFixed(0)}%)`;
        els.croppedCard.style.display = '';
        els.compareSection.classList.add('three-col');
    };
    img.src = URL.createObjectURL(file);
}

// ========== Run ==========
async function runRemoveBg() {
    if (!selectedFile) return;

    const model = document.querySelector('input[name="model"]:checked').value;
    const refine = document.querySelector('input[name="refine"]:checked').value;
    const maxSize = getMaxSize();
    const useSmartCrop = els.smartCropCheck.checked;

    // UI 상태
    showLoading();
    hideError();
    resetResults();

    const startTime = performance.now();
    let timerInterval = setInterval(() => {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        els.loadingTime.textContent = `${elapsed}초 경과`;
    }, 100);

    try {
        let fileToSend = selectedFile;

        // 스마트 크롭 감지 (항상 실행하여 정보 표시)
        els.loadingText.textContent = '인물 감지 중...';
        const cropResult = await runSmartCrop(selectedFile);

        if (cropResult.crop) {
            cropCoords = cropResult.crop;
            showCroppedPreview(selectedFile, cropCoords, cropResult.keypoints, cropResult.kp_bbox, cropResult.mask_bbox);

            // 스마트 크롭 ON + 실제 크롭 필요할 때만 크롭된 이미지로 배경 제거
            if (useSmartCrop && cropResult.cropped) {
                croppedBlob = await cropImageOnCanvas(selectedFile, cropCoords);
                fileToSend = new File([croppedBlob], selectedFile.name, { type: 'image/jpeg' });
            }
        }

        els.loadingText.textContent = '배경을 제거하고 있습니다...';

        const formData = new FormData();
        formData.append('file', fileToSend);

        const url = `${API_URL}/remove-bg?max_size=${maxSize}&model=${model}&refine=${refine}`;
        const resp = await fetch(url, { method: 'POST', body: formData });

        if (!resp.ok) {
            const err = await resp.json().catch(() => null);
            throw new Error(err?.detail || `서버 오류 (${resp.status})`);
        }

        // 헤더에서 메타데이터 추출
        const headers = {
            originalWidth: resp.headers.get('X-Original-Width'),
            originalHeight: resp.headers.get('X-Original-Height'),
            cropX: resp.headers.get('X-Crop-X'),
            cropY: resp.headers.get('X-Crop-Y'),
            cropWidth: resp.headers.get('X-Crop-Width'),
            cropHeight: resp.headers.get('X-Crop-Height'),
            bgqaScore: parseFloat(resp.headers.get('X-BGQA-Score') || '0'),
            bgqaPassed: resp.headers.get('X-BGQA-Passed') === 'true',
            bgqaIssues: resp.headers.get('X-BGQA-Issues') || '',
            bgqaCaseType: resp.headers.get('X-BGQA-CaseType') || '',
        };

        processedBlob = await resp.blob();
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

        // 이미지 디코딩
        resultImage = await blobToImage(processedBlob);

        // 결과 렌더링
        renderResult(resultImage);
        renderPreviews(resultImage);
        showBgqaBadge(headers);
        showProcessingInfo(model, maxSize, elapsed, headers, refine);

        els.compareSection.classList.add('visible');
        els.previewSection.classList.add('visible');
        els.downloadSection.classList.add('visible');

    } catch (err) {
        showError(err.message);
    } finally {
        clearInterval(timerInterval);
        hideLoading();
    }
}

// ========== Render ==========
function renderResult(img) {
    const canvas = els.resultCanvas;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
}

function renderPreviews(img) {
    const configs = [
        { canvas: els.previewWhite, color: '#ffffff' },
        { canvas: els.previewGray, color: '#808080' },
        { canvas: els.previewBlack, color: '#000000' },
    ];

    for (const { canvas, color } of configs) {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    }
}

function showBgqaBadge(headers) {
    const badge = els.bgqaBadge;
    const score = headers.bgqaScore;
    const passed = headers.bgqaPassed;
    const issues = headers.bgqaIssues;

    let text = `BGQA ${score.toFixed(1)}점`;
    if (passed) {
        text += ' — PASS';
        badge.className = 'bgqa-badge visible pass';
    } else {
        text += ' — FAIL';
        if (issues) text += ` (${issues})`;
        badge.className = 'bgqa-badge visible fail';
    }
    badge.textContent = text;
}

function showProcessingInfo(model, maxSize, elapsed, headers, refine) {
    const info = [];
    info.push(`모델: ${model}`);
    if (refine && refine !== 'none') info.push(`리파인: ${refine}`);
    info.push(`해상도: ${maxSize}px`);
    info.push(`처리시간: ${elapsed}초`);
    if (headers.originalWidth) {
        info.push(`원본: ${headers.originalWidth}x${headers.originalHeight}`);
    }
    if (headers.cropWidth) {
        info.push(`크롭: ${headers.cropWidth}x${headers.cropHeight}`);
    }
    els.processingInfo.textContent = info.join('  |  ');
    els.processingInfo.classList.add('visible');
}

// ========== Download ==========
els.downloadBtn.addEventListener('click', () => {
    if (!resultImage) return;

    // Canvas를 PNG로 변환
    const canvas = document.createElement('canvas');
    canvas.width = resultImage.width;
    canvas.height = resultImage.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(resultImage, 0, 0);

    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const baseName = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, '') : 'result';
        a.download = `${baseName}_nobg.png`;
        a.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
});

// ========== Helpers ==========
function blobToImage(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
    });
}

function showLoading() { els.loadingOverlay.classList.add('visible'); }
function hideLoading() { els.loadingOverlay.classList.remove('visible'); }

function showError(msg) {
    els.errorMessage.textContent = msg;
    els.errorMessage.classList.add('visible');
}

function hideError() {
    els.errorMessage.classList.remove('visible');
}

function resetResults() {
    processedBlob = null;
    resultImage = null;
    cropCoords = null;
    croppedBlob = null;
    els.compareSection.classList.remove('visible');
    els.compareSection.classList.remove('three-col');
    els.croppedCard.style.display = 'none';
    els.previewSection.classList.remove('visible');
    els.downloadSection.classList.remove('visible');
    els.bgqaBadge.classList.remove('visible');
    els.processingInfo.classList.remove('visible');
}

// ========== Smart Crop Toggle ==========
els.smartCropCheck.addEventListener('change', () => {
    if (selectedFile) runRemoveBg();
});

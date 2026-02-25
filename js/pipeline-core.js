/**
 * PipelineCore — 공유 파이프라인 모듈
 * bg-remove.html / book-preview.html 양쪽에서 사용
 */
window.PipelineCore = (function () {
    'use strict';

    // ========== Constants ==========

    const API_URL = location.hostname.includes('github.io')
        ? 'https://ai.monviestory.co.kr'
        : 'http://59.10.238.17:5001';

    const BG_MODELS = [
        'portrait', 'hr', 'hr-matting', 'dynamic',
        'rmbg2', 'ben2', 'removebg', 'matting',
        'hr-matting-alpha', 'dynamic-matting',
    ];

    const DETECT_MODELS = ['dino', 'mmdino', 'gdino-base', 'florence2'];

    const DETECT_MODEL_KEYS = {
        dino: 'gdino',
        mmdino: 'mmdino',
        'gdino-base': 'gdino-base',
        florence2: 'florence2',
    };

    function isBgModel(v) { return BG_MODELS.includes(v); }

    // ========== Utility Functions ==========

    function blobToImage(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
            img.src = url;
        });
    }

    function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...options, signal: controller.signal })
            .finally(() => clearTimeout(timer));
    }

    function extractErrorDetail(errData, fallback) {
        if (!errData) return fallback;
        const d = errData.detail;
        if (typeof d === 'string') return d;
        if (Array.isArray(d)) return d.map(e => e.msg || e.message || JSON.stringify(e)).join(', ');
        if (d && typeof d === 'object') return JSON.stringify(d);
        return fallback;
    }

    // ========== Face-API.js ==========

    const FACE_API_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
    let faceApiReady = false;

    async function loadFaceApi() {
        if (faceApiReady) return true;
        if (typeof faceapi === 'undefined') return false;
        try {
            await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL);
            faceApiReady = true;
            console.log('✅ face-api.js 모델 로드 완료');
            return true;
        } catch (err) {
            console.error('❌ face-api.js 모델 로드 실패:', err);
            return false;
        }
    }

    async function detectFacesInImage(imgElement) {
        if (!faceApiReady) return [];
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 });
        const detections = await faceapi.detectAllFaces(imgElement, options);
        return detections.map(d => ({
            x: d.box.x, y: d.box.y,
            width: d.box.width, height: d.box.height,
            area: d.box.width * d.box.height,
            score: d.score,
            cx: d.box.x + d.box.width / 2,
            cy: d.box.y + d.box.height / 2,
        })).sort((a, b) => b.area - a.area);
    }

    async function detectFacesInFile(file) {
        if (!faceApiReady) return [];
        try {
            const blobUrl = URL.createObjectURL(file);
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = blobUrl;
            });
            URL.revokeObjectURL(blobUrl);
            const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 });
            const detections = await faceapi.detectAllFaces(img, options);
            console.log(`👤 얼굴 감지: ${detections.length}명`);
            return detections;
        } catch (err) {
            console.warn('얼굴 감지 실패:', err);
            return [];
        }
    }

    // ========== Pipeline Step Execution (DOM-free) ==========

    /**
     * executePipelineStep — DOM과 무관한 파이프라인 스텝 실행
     *
     * @param {string} stepType - 스텝 타입 (dino, sam2, ben2, ...)
     * @param {object} state - 파이프라인 상태 (originalFile, originalImage, detections, ...)
     * @param {object} opts
     *   opts.params       — 스텝 파라미터 (필수, DOM 대신 직접 전달)
     *   opts.prompt       — DINO 프롬프트 override
     *   opts.skipInteraction — true면 자동 선택 (기본 false)
     *   opts.dinoSelectedIdx — CPX 캐시된 인덱스
     *   opts.sam2Padding   — SAM2 패딩 % (기본 30)
     *   opts.callbacks     — 선택적 시각화/상태 콜백
     */
    async function executePipelineStep(stepType, state, opts = {}) {
        const p = opts.params || {};
        const cb = opts.callbacks || {};

        // 감지 모델 공통 헬퍼 (gdino, mmdino, gdino-base, florence2)
        async function _executeDetect(urlParams, modelLabel, errorHint, infoPrefix) {
            const formData = new FormData();
            formData.append('file', state.originalFile);

            const _start = performance.now();
            const resp = await fetch(`${API_URL}/detect-child?${urlParams}`, { method: 'POST', body: formData });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => null);
                throw new Error(extractErrorDetail(errData, `${modelLabel} 오류 (${resp.status})`));
            }

            const result = await resp.json();
            const _time = ((performance.now() - _start) / 1000).toFixed(2);
            const boxes = result.detections || [];
            if (boxes.length < 1) throw new Error(`${modelLabel}: ${errorHint}`);

            const sorted = [...boxes].sort((a, b) => {
                const aA = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
                const bA = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
                return aA - bA;
            });

            let selectedIdx;
            if (opts.dinoSelectedIdx != null) {
                selectedIdx = opts.dinoSelectedIdx;
            } else if (sorted.length === 1 || opts.skipInteraction) {
                selectedIdx = 0;
            } else if (cb.onWaitForSelection) {
                selectedIdx = await cb.onWaitForSelection(state.originalImage, sorted);
            } else {
                selectedIdx = 0; // headless 기본값
            }

            const childBox = sorted[selectedIdx];
            cb.drawDinoBoxes?.(cb.canvas, state.originalImage, boxes, childBox);
            const dinoBbox = childBox.box;

            state.detections = {
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
                dinoBoxes: boxes,
            };

            const imgArea = state.originalImage.width * state.originalImage.height;
            const details = sorted.map((d, i) => {
                const w = d.box[2] - d.box[0], h = d.box[3] - d.box[1];
                const pct = (w * h / imgArea * 100).toFixed(1);
                const scoreStr = d.score < 1.0 ? `(${(d.score * 100).toFixed(0)}%)` : '';
                return `${d.label}${scoreStr}: ${pct}%` + (i === selectedIdx ? ' [target]' : '');
            });
            cb.setInfo?.(`${infoPrefix} → ${details.join(' | ')}`);
            return { actualTime: _time };
        }

        switch (stepType) {
            case 'dino':
            case 'mmdino':
            case 'gdino-base': {
                const MODEL_MAP = { dino: ['gdino', 'DINO'], mmdino: ['mmdino', 'MM-DINO'], 'gdino-base': ['gdino-base', 'DINO-Base'] };
                const [modelKey, modelLabel] = MODEL_MAP[stepType];
                const dinoPrompt = opts.prompt || p.prompt || 'person';
                const threshold = p.threshold || 0.25;
                const urlParams = new URLSearchParams({ prompt: dinoPrompt, threshold: threshold.toString(), model: modelKey });
                return await _executeDetect(
                    urlParams, modelLabel,
                    `"${dinoPrompt}"에 해당하는 객체가 감지되지 않았습니다 (TH=${threshold}).`,
                    `${modelLabel} "${dinoPrompt}" (TH${threshold})`
                );
            }

            case 'florence2': {
                const f2Task = p.task || 'od';
                const f2Prompt = p.f2Prompt || 'a child';
                const urlParams = new URLSearchParams({ model: 'florence2', task: f2Task });
                if (f2Task === 'grounding') urlParams.set('prompt', f2Prompt);
                const taskDesc = f2Task === 'grounding' ? `grounding:"${f2Prompt}"` : 'od';
                return await _executeDetect(
                    urlParams, 'Florence-2',
                    `${f2Task === 'grounding' ? `"${f2Prompt}"` : 'person'} 감지되지 않음`,
                    `Florence-2 (${taskDesc})`
                );
            }

            case 'faceapi': {
                const loaded = await loadFaceApi();
                if (!loaded) throw new Error('face-api.js 로드 실패');

                const faces = await detectFacesInImage(state.originalImage);
                if (faces.length < 1) throw new Error('얼굴이 감지되지 않았습니다.');

                const childFace = faces[faces.length - 1];
                const adultFaces = faces.length > 1 ? faces.slice(0, -1) : [];

                state.detections = {
                    childFace,
                    adultFaces,
                    dinoBbox: null,
                };

                cb.drawFaceBoxes?.(cb.canvas, state.originalImage, faces);

                const imgArea = state.originalImage.width * state.originalImage.height;
                const details = faces.map((f, i) => {
                    const pct = (f.area / imgArea * 100).toFixed(1);
                    const role = i === faces.length - 1 ? '아이' : '어른';
                    return `${role}: ${f.width.toFixed(0)}x${f.height.toFixed(0)} (${pct}%)`;
                });
                cb.setInfo?.(details.join(' | '));
                break;
            }

            case 'crop': {
                const detections = state.detections;
                if (!detections) {
                    throw new Error('Crop: 감지 단계가 필요합니다 (DINO 또는 face-api)');
                }

                const padPct = (p.padding != null ? p.padding : 10) / 100;
                let x1, y1, x2, y2;

                if (detections.dinoBbox) {
                    [x1, y1, x2, y2] = detections.dinoBbox;
                } else if (detections.childFace) {
                    const f = detections.childFace;
                    x1 = f.x; y1 = f.y;
                    x2 = f.x + f.width; y2 = f.y + f.height;
                } else {
                    throw new Error('Crop: bbox 정보가 없습니다');
                }

                const bw = x2 - x1, bh = y2 - y1;
                const padW = Math.round(bw * padPct);
                const padH = Math.round(bh * padPct);

                const imgW = state.originalImage.width;
                const imgH = state.originalImage.height;
                const cx = Math.max(0, Math.round(x1) - padW);
                const cy = Math.max(0, Math.round(y1) - padH);
                const cr = Math.min(imgW, Math.round(x2) + padW);
                const cbb = Math.min(imgH, Math.round(y2) + padH);
                const cw = cr - cx, ch = cbb - cy;

                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = cw;
                cropCanvas.height = ch;
                const cropCtx = cropCanvas.getContext('2d');
                cropCtx.drawImage(state.originalImage, cx, cy, cw, ch, 0, 0, cw, ch);

                const cropBlob = await new Promise((res, rej) => {
                    cropCanvas.toBlob(b => b ? res(b) : rej(new Error('크롭 실패')), 'image/jpeg', 0.92);
                });
                const cropImage = await blobToImage(cropBlob);

                state.resultImage = cropImage;
                state.resultBlob = cropBlob;
                state.cropInfo = { x: cx, y: cy, w: cw, h: ch };

                // 시각화 (캔버스가 있을 때만)
                if (cb.canvas) {
                    const ctx = cb.canvas.getContext('2d');
                    cb.canvas.width = imgW;
                    cb.canvas.height = imgH;
                    ctx.drawImage(state.originalImage, 0, 0);
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                    ctx.fillRect(0, 0, imgW, imgH);
                    ctx.drawImage(state.originalImage, cx, cy, cw, ch, cx, cy, cw, ch);
                    ctx.strokeStyle = '#00ff00';
                    ctx.lineWidth = Math.max(2, Math.round(Math.min(imgW, imgH) / 300));
                    ctx.strokeRect(cx, cy, cw, ch);
                }

                cb.setInfo?.(`Crop: ${cw}×${ch} (pad ${p.padding || 10}%) | 원본: ${imgW}×${imgH}`);
                break;
            }

            case 'vitpose': {
                const minScore = p.minScore || 0.3;
                const vpModel = p.vpModel || 'vitpose';

                const allBoxes = [];
                let hasDetections = false;

                if (state.detections) {
                    hasDetections = true;
                    const { childFace, adultFaces, dinoBbox } = state.detections;
                    if (dinoBbox) {
                        allBoxes.push(dinoBbox);
                        for (const af of adultFaces) {
                            allBoxes.push([af.x, af.y, af.x + af.width, af.y + af.height]);
                        }
                    } else {
                        allBoxes.push([childFace.x, childFace.y, childFace.x + childFace.width, childFace.y + childFace.height]);
                        for (const af of adultFaces) {
                            allBoxes.push([af.x, af.y, af.x + af.width, af.y + af.height]);
                        }
                    }
                }

                const formData = new FormData();
                formData.append('file', state.originalFile);

                const poseParams = new URLSearchParams({ model: vpModel });
                if (allBoxes.length > 0) {
                    poseParams.set('boxes', JSON.stringify(allBoxes));
                }
                const resp = await fetch(`${API_URL}/detect-pose?${poseParams}`, { method: 'POST', body: formData });
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `ViTPose 오류 (${resp.status})`));
                }

                const result = await resp.json();

                if (result.persons) {
                    state.vitposeResults = result.persons;
                    cb.drawPoseKeypoints?.(cb.canvas, state.originalImage, result.persons, minScore);

                    const childKpCount = result.persons[0].scores.filter(s => s > minScore).length;
                    const adultKpCounts = result.persons.slice(1).map(pp => pp.scores.filter(s => s > minScore).length);
                    let info = `아이: ${childKpCount}/17`;
                    if (adultKpCounts.length > 0) info += ` | 어른: ${adultKpCounts.join(',')}`;
                    info += ` (${vpModel})`;
                    cb.setInfo?.(info);
                } else if (result.keypoints) {
                    const BLAZE_TO_COCO = { 0:0, 2:1, 5:2, 7:3, 8:4, 11:5, 12:6, 13:7, 14:8, 15:9, 16:10, 23:11, 24:12, 25:13, 26:14, 27:15, 28:16 };
                    const kps = [];
                    const scores = [];
                    for (const [blazeIdx, cocoIdx] of Object.entries(BLAZE_TO_COCO)) {
                        const bp = result.keypoints[parseInt(blazeIdx)];
                        kps.push([bp.x, bp.y]);
                        scores.push(bp.score);
                    }
                    const singlePerson = {
                        keypoints: kps,
                        scores: scores,
                        bbox: [0, 0, result.image_width, result.image_height],
                    };
                    state.vitposeResults = [singlePerson];
                    cb.drawPoseKeypoints?.(cb.canvas, state.originalImage, [singlePerson], minScore);

                    const validCount = scores.filter(s => s > minScore).length;
                    cb.setInfo?.(`${validCount}/17 kps (${vpModel}, 전체 이미지)`);
                }
                break;
            }

            case 'sam2': {
                if (!state.detections && !state.vitposeResults) {
                    throw new Error('SAM2: 감지 단계가 필요합니다 (DINO, face-api, 또는 ViTPose)');
                }

                const childFace = state.detections?.childFace;
                const adultFaces = state.detections?.adultFaces || [];
                const dinoBbox = state.detections?.dinoBbox;
                const vitposeMinScore = p.minScore || 0.3;

                const formData = new FormData();
                formData.append('file', state.originalFile);

                if (state.vitposeResults) {
                    const childPerson = state.vitposeResults[0];
                    const posPoints = childPerson.keypoints
                        .filter((_, i) => childPerson.scores[i] > vitposeMinScore);
                    formData.append('pos_points', JSON.stringify(posPoints));

                    const negPoints = state.vitposeResults.slice(1)
                        .flatMap(pp => pp.keypoints.filter((_, i) => pp.scores[i] > vitposeMinScore));
                    if (negPoints.length > 0) {
                        formData.append('neg_points', JSON.stringify(negPoints));
                    }
                } else if (childFace) {
                    formData.append('point_x', childFace.cx.toString());
                    formData.append('point_y', childFace.cy.toString());
                    if (adultFaces.length > 0) {
                        formData.append('neg_points', JSON.stringify(adultFaces.map(f => [f.cx, f.cy])));
                    }
                }
                if (dinoBbox) {
                    formData.append('box', JSON.stringify(dinoBbox));
                }

                const combine = p.combine != null ? p.combine : true;
                formData.append('combine', combine ? 'true' : 'false');

                const resp = await fetch(`${API_URL}/segment-child`, { method: 'POST', body: formData });
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `SAM2 오류 (${resp.status})`));
                }

                const score = resp.headers.get('X-SAM2-Score') || '?';
                const cropX = parseInt(resp.headers.get('X-Crop-X') || '0');
                const cropY = parseInt(resp.headers.get('X-Crop-Y') || '0');
                const cropW = parseInt(resp.headers.get('X-Crop-Width') || '0');
                const cropH = parseInt(resp.headers.get('X-Crop-Height') || '0');

                const blob = await resp.blob();
                const sam2Image = await blobToImage(blob);

                // Build full-size mask
                const fullMaskCanvas = document.createElement('canvas');
                fullMaskCanvas.width = state.originalImage.width;
                fullMaskCanvas.height = state.originalImage.height;
                const mCtx = fullMaskCanvas.getContext('2d');
                mCtx.clearRect(0, 0, fullMaskCanvas.width, fullMaskCanvas.height);
                mCtx.drawImage(sam2Image, cropX, cropY);
                const imgData = mCtx.getImageData(0, 0, fullMaskCanvas.width, fullMaskCanvas.height);
                const px = imgData.data;
                for (let i = 0; i < px.length; i += 4) {
                    const a = px[i + 3];
                    px[i] = a; px[i + 1] = a; px[i + 2] = a; px[i + 3] = 255;
                }
                mCtx.putImageData(imgData, 0, 0);

                state.sam2 = { image: sam2Image, blob, cropX, cropY, cropW, cropH, score };
                state.fullMaskCanvas = fullMaskCanvas;

                cb.drawMaskOverlay?.(cb.canvas, state.originalImage, sam2Image, cropX, cropY);
                const combineMode = (p.combine != null ? p.combine : true) ? 'combine' : 'box-only';
                cb.setInfo?.(`Score: ${score} | 크롭: ${cropW}x${cropH} | ${combineMode}`);
                break;
            }

            case 'diffmatte':
            case 'mematte':
            case 'vitmatte': {
                const modelLabels = { vitmatte: 'ViTMatte', mematte: 'MEMatte', diffmatte: 'DiffMatte' };
                const modelLabel = modelLabels[stepType] || stepType;

                const isCropped = state.resultImage &&
                    (state.resultImage.width !== state.originalImage.width ||
                     state.resultImage.height !== state.originalImage.height);

                let maskCanvas;
                let sourceFile;

                if (state.fullMaskCanvas) {
                    maskCanvas = state.fullMaskCanvas;
                    sourceFile = state.originalFile;
                } else if (state.resultImage) {
                    const maskW = isCropped ? state.resultImage.width : state.originalImage.width;
                    const maskH = isCropped ? state.resultImage.height : state.originalImage.height;

                    maskCanvas = document.createElement('canvas');
                    maskCanvas.width = maskW;
                    maskCanvas.height = maskH;
                    const mCtx = maskCanvas.getContext('2d');
                    mCtx.drawImage(state.resultImage, 0, 0, maskW, maskH);
                    const imgDataM = mCtx.getImageData(0, 0, maskW, maskH);
                    const pxM = imgDataM.data;
                    for (let i = 0; i < pxM.length; i += 4) {
                        const a = pxM[i + 3];
                        pxM[i] = a; pxM[i + 1] = a; pxM[i + 2] = a; pxM[i + 3] = 255;
                    }
                    mCtx.putImageData(imgDataM, 0, 0);

                    if (isCropped) {
                        const compCanvas = document.createElement('canvas');
                        compCanvas.width = state.resultImage.width;
                        compCanvas.height = state.resultImage.height;
                        const compCtx = compCanvas.getContext('2d');
                        compCtx.fillStyle = '#ffffff';
                        compCtx.fillRect(0, 0, compCanvas.width, compCanvas.height);
                        compCtx.drawImage(state.resultImage, 0, 0);
                        const compBlob = await new Promise((res, rej) => {
                            compCanvas.toBlob(b => b ? res(b) : rej(new Error('합성 실패')), 'image/jpeg', 0.92);
                        });
                        sourceFile = new File([compBlob], 'cropped.jpg', { type: 'image/jpeg' });
                    } else {
                        sourceFile = state.originalFile;
                    }
                } else {
                    throw new Error(`${modelLabel}: 마스크가 필요합니다 (SAM2 또는 이전 결과)`);
                }

                // Trimap visualization
                const vizImage = isCropped ? state.resultImage : state.originalImage;
                cb.drawTrimapVisualization?.(cb.canvas, maskCanvas, vizImage);

                const maskBlob = await new Promise((resolve, reject) => {
                    maskCanvas.toBlob(b => b ? resolve(b) : reject(new Error('마스크 생성 실패')), 'image/png');
                });

                const vitParams = { erode: p.erode || 10, dilate: p.dilate || 20 };
                const formData = new FormData();
                formData.append('file', sourceFile);
                formData.append('mask', new File([maskBlob], 'mask.png', { type: 'image/png' }));

                const endpoints = { vitmatte: '/vitmatte', mematte: '/mematte', diffmatte: '/diffmatte' };
                const endpoint = endpoints[stepType] || '/vitmatte';
                const maxSizeParam = stepType === 'diffmatte' ? '&max_size=1024' : '';
                const vitUrl = `${API_URL}${endpoint}?erode_size=${vitParams.erode}&dilate_size=${vitParams.dilate}${maxSizeParam}`;
                const resp = await fetch(vitUrl, { method: 'POST', body: formData });
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `${modelLabel} 오류 (${resp.status})`));
                }

                const blob = await resp.blob();
                const vitImage = await blobToImage(blob);

                state.resultImage = vitImage;
                state.resultBlob = blob;
                state.fullMaskCanvas = null;

                cb.drawAlphaMatte?.(cb.canvas, vitImage);
                cb.setInfo?.(`${modelLabel} (E${vitParams.erode}/D${vitParams.dilate}) | ${vitImage.width}x${vitImage.height}`);
                break;
            }

            case 'birefnet-matting': {
                let fileToSend;
                const useMask = p.useMask && state.fullMaskCanvas;

                if (state.sam2 && !state.resultImage) {
                    const { cropX, cropY, cropW, cropH } = state.sam2;
                    const padPct = (opts.sam2Padding ?? 30) / 100;
                    const padW = Math.round(cropW * padPct);
                    const padH = Math.round(cropH * padPct);
                    const cX = Math.max(0, cropX - padW);
                    const cY = Math.max(0, cropY - padH);
                    const cR = Math.min(state.originalImage.width, cropX + cropW + padW);
                    const cB = Math.min(state.originalImage.height, cropY + cropH + padH);

                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = cR - cX;
                    cropCanvas.height = cB - cY;
                    const cropCtx = cropCanvas.getContext('2d');
                    cropCtx.drawImage(state.originalImage, cX, cY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);

                    if (useMask) {
                        const fullMaskCtx = state.fullMaskCanvas.getContext('2d');
                        const maskData = fullMaskCtx.getImageData(cX, cY, cropCanvas.width, cropCanvas.height);
                        const cropData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
                        for (let i = 0; i < cropData.data.length; i += 4) {
                            const m = maskData.data[i];
                            const t = m / 255;
                            cropData.data[i]     = cropData.data[i]     * t + 255 * (1 - t);
                            cropData.data[i + 1] = cropData.data[i + 1] * t + 255 * (1 - t);
                            cropData.data[i + 2] = cropData.data[i + 2] * t + 255 * (1 - t);
                        }
                        cropCtx.putImageData(cropData, 0, 0);
                    }

                    const cropBlob = await new Promise((res, rej) => {
                        cropCanvas.toBlob(b => b ? res(b) : rej(new Error('크롭 실패')), 'image/jpeg', 0.85);
                    });
                    fileToSend = new File([cropBlob], 'crop.jpg', { type: 'image/jpeg' });

                } else if (state.resultImage) {
                    const compCanvas = document.createElement('canvas');
                    compCanvas.width = state.resultImage.width;
                    compCanvas.height = state.resultImage.height;
                    const compCtx = compCanvas.getContext('2d');
                    compCtx.fillStyle = '#ffffff';
                    compCtx.fillRect(0, 0, compCanvas.width, compCanvas.height);
                    compCtx.drawImage(state.resultImage, 0, 0);

                    const compBlob = await new Promise((res, rej) => {
                        compCanvas.toBlob(b => b ? res(b) : rej(new Error('합성 실패')), 'image/jpeg', 0.92);
                    });
                    fileToSend = new File([compBlob], 'composite.jpg', { type: 'image/jpeg' });

                } else {
                    fileToSend = state.originalFile;
                }

                const resolution = p.maxSize || 2048;
                const formData = new FormData();
                formData.append('file', fileToSend);

                const url = `${API_URL}/birefnet-matting?resolution=${resolution}`;
                const resp = await fetch(url, { method: 'POST', body: formData });

                if (!resp.ok) {
                    const errData = await resp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `BiRefNet-HR 오류 (${resp.status})`));
                }

                const blob = await resp.blob();
                const brImage = await blobToImage(blob);

                state.resultImage = brImage;
                state.resultBlob = blob;

                cb.drawSAM2Result?.(cb.canvas, brImage);
                cb.setInfo?.(`BiRefNet-HR (${resolution}px)${useMask ? ' +mask' : ''} | ${brImage.width}x${brImage.height}`);
                break;
            }

            default: {
                // BG removal models
                if (!BG_MODELS.includes(stepType)) throw new Error(`알 수 없는 단계: ${stepType}`);

                let fileToSend;

                if (state.sam2 && !state.resultImage) {
                    const { cropX, cropY, cropW, cropH } = state.sam2;
                    const padPct = (opts.sam2Padding ?? 30) / 100;
                    const padW = Math.round(cropW * padPct);
                    const padH = Math.round(cropH * padPct);
                    const cX = Math.max(0, cropX - padW);
                    const cY = Math.max(0, cropY - padH);
                    const cR = Math.min(state.originalImage.width, cropX + cropW + padW);
                    const cB = Math.min(state.originalImage.height, cropY + cropH + padH);

                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = cR - cX;
                    cropCanvas.height = cB - cY;
                    const cropCtx = cropCanvas.getContext('2d');
                    cropCtx.drawImage(state.originalImage, cX, cY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);

                    const cropBlob = await new Promise((res, rej) => {
                        cropCanvas.toBlob(b => b ? res(b) : rej(new Error('크롭 실패')), 'image/jpeg', 0.85);
                    });
                    fileToSend = new File([cropBlob], 'crop.jpg', { type: 'image/jpeg' });

                } else if (!state.sam2 && !state.resultImage && state.detections && state.vitposeResults && state.vitposeResults.length > 0) {
                    const child = state.vitposeResults[0];
                    const validKps = child.keypoints.filter((_, i) => child.scores[i] > 0.3);
                    if (validKps.length > 0) {
                        const xs = validKps.map(k => k[0]);
                        const ys = validKps.map(k => k[1]);
                        const bx = Math.min(...xs), by = Math.min(...ys);
                        const bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
                        const padW = Math.round(bw * 0.3);
                        const padH = Math.round(bh * 0.3);
                        const cX = Math.max(0, Math.round(bx) - padW);
                        const cY = Math.max(0, Math.round(by) - padH);
                        const cR = Math.min(state.originalImage.width, Math.round(bx + bw) + padW);
                        const cB = Math.min(state.originalImage.height, Math.round(by + bh) + padH);

                        const cropCanvas = document.createElement('canvas');
                        cropCanvas.width = cR - cX;
                        cropCanvas.height = cB - cY;
                        const cropCtx = cropCanvas.getContext('2d');
                        cropCtx.drawImage(state.originalImage, cX, cY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);

                        const cropBlob = await new Promise((res, rej) => {
                            cropCanvas.toBlob(b => b ? res(b) : rej(new Error('크롭 실패')), 'image/jpeg', 0.85);
                        });
                        fileToSend = new File([cropBlob], 'crop.jpg', { type: 'image/jpeg' });
                    } else {
                        fileToSend = state.originalFile;
                    }

                } else if (state.resultImage) {
                    const compCanvas = document.createElement('canvas');
                    compCanvas.width = state.resultImage.width;
                    compCanvas.height = state.resultImage.height;
                    const compCtx = compCanvas.getContext('2d');
                    compCtx.fillStyle = '#ffffff';
                    compCtx.fillRect(0, 0, compCanvas.width, compCanvas.height);
                    compCtx.drawImage(state.resultImage, 0, 0);

                    const compBlob = await new Promise((res, rej) => {
                        compCanvas.toBlob(b => b ? res(b) : rej(new Error('합성 실패')), 'image/jpeg', 0.92);
                    });
                    fileToSend = new File([compBlob], 'composite.jpg', { type: 'image/jpeg' });

                } else {
                    fileToSend = state.originalFile;
                }

                const maxSize = p.maxSize || 1024;

                const formData = new FormData();
                formData.append('file', fileToSend);

                let url = `${API_URL}/remove-bg?max_size=${maxSize}&model=${stepType}`;
                if (stepType === 'removebg') {
                    const rbgSize = p.removebgSize || 'preview';
                    url += `&removebg_size=${rbgSize}`;
                }
                const resp = await fetch(url, { method: 'POST', body: formData });

                if (!resp.ok) {
                    const errData = await resp.json().catch(() => null);
                    throw new Error(extractErrorDetail(errData, `${stepType} 오류 (${resp.status})`));
                }

                const blob = await resp.blob();
                const bgImage = await blobToImage(blob);

                state.resultImage = bgImage;
                state.resultBlob = blob;

                cb.drawSAM2Result?.(cb.canvas, bgImage);
                const sizeDesc = (stepType === 'removebg') ? (p.removebgSize || 'preview') : `${maxSize}px`;
                cb.setInfo?.(`${stepType} (${sizeDesc}) | ${bgImage.width}x${bgImage.height}`);
                break;
            }
        }
    }

    // ========== Pipeline Runner ==========

    /**
     * runPipeline — 스텝 배열 순차 실행 러너
     *
     * @param {File} file - 원본 파일
     * @param {Array} steps - [{ type: 'dino', params: {...}, prompt: 'person' }, ...]
     * @param {object} opts
     *   opts.skipInteraction — 전체 파이프라인에 적용 (기본 true)
     *   opts.sam2Padding     — SAM2 패딩 %
     *   opts.onStepStart(index, type) — 스텝 시작 콜백
     *   opts.onStepDone(index, type, seconds) — 스텝 완료 콜백
     *   opts.getCallbacksForStep(index, type) → callbacks 객체
     * @returns {{ resultImage, resultBlob, state }}
     */
    async function runPipeline(file, steps, opts = {}) {
        const img = await blobToImage(file);

        const state = {
            originalFile: file,
            originalImage: img,
            detections: null,
            vitposeResults: null,
            sam2: null,
            fullMaskCanvas: null,
            resultImage: null,
            resultBlob: null,
        };

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            opts.onStepStart?.(i, step.type);

            const stepStart = performance.now();
            const stepCallbacks = opts.getCallbacksForStep?.(i, step.type) || {};

            const stepResult = await executePipelineStep(step.type, state, {
                params: step.params || {},
                prompt: step.prompt,
                skipInteraction: opts.skipInteraction ?? true,
                sam2Padding: opts.sam2Padding,
                callbacks: stepCallbacks,
            });

            const stepTime = stepResult?.actualTime || ((performance.now() - stepStart) / 1000).toFixed(2);
            opts.onStepDone?.(i, step.type, stepTime);
        }

        return {
            resultImage: state.resultImage,
            resultBlob: state.resultBlob,
            state,
        };
    }

    // ========== Alpha Cleanup ==========

    /**
     * PNG alpha 채널 정리 — 배경은 완전 투명, 전경은 완전 불투명으로 강제
     * 배경 제거 모델이 남기는 잔여 alpha와 전경의 불완전 불투명을 정리
     * @param {Blob} blob - PNG blob
     * @param {number} lo - 이 값 이하의 alpha는 0으로 (기본 30)
     * @param {number} hi - 이 값 이상의 alpha는 255로 (기본 220)
     * @returns {Promise<Blob>} 정리된 PNG blob
     */
    async function cleanAlpha(blob, lo = 30, hi = 220) {
        const img = await blobToImage(blob);
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, c.width, c.height);
        const d = id.data;
        for (let i = 3; i < d.length; i += 4) {
            if (d[i] <= lo) d[i] = 0;
            else if (d[i] >= hi) d[i] = 255;
        }
        ctx.putImageData(id, 0, 0);
        return new Promise(resolve => c.toBlob(resolve, 'image/png'));
    }

    // ========== Public API ==========

    return {
        API_URL,
        BG_MODELS,
        DETECT_MODELS,
        DETECT_MODEL_KEYS,
        isBgModel,

        blobToImage,
        fetchWithTimeout,
        extractErrorDetail,

        loadFaceApi,
        detectFacesInImage,
        detectFacesInFile,

        executePipelineStep,
        runPipeline,
        cleanAlpha,
    };
})();

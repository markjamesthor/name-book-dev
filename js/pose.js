/**
 * 몽비 테스트 - 포즈 분석 모듈
 * BlazePose 모델 관리, 키포인트 분석, 렌더링
 * face-api.js로 다중 얼굴 감지
 */

import { CONSTANTS, BODY_PARTS, COCO_BODY_PARTS, VITPOSE_VALID_INDICES } from './utils.js';

// ========== 얼굴 감지 상수 ==========
const FACE_DETECT_INPUT_SIZE = 608;
const FACE_DETECT_SCORE_THRESHOLD = 0.3;
const MAIN_SUBJECT_MIN_AREA_RATIO = 0.02;

// ========== 포즈 감지기 ==========
let poseDetector = null;
let faceApiLoaded = false;
let _initPromise = null;

// face-api.js 모델 로드 (CDN에서)
const FACE_API_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

export async function initFaceApi() {
    if (faceApiLoaded) return;

    try {
        // TinyFaceDetector 모델만 로드 (가장 빠름)
        await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL);
        faceApiLoaded = true;
        console.log('✅ face-api.js 모델 로드 완료');
    } catch (err) {
        console.error('❌ face-api.js 모델 로드 실패:', err);
    }
}

export async function initPoseDetector() {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        await tf.setBackend('webgl');
        const poseModel = poseDetection.SupportedModels.BlazePose;
        poseDetector = await poseDetection.createDetector(poseModel, {
            runtime: 'tfjs',
            modelType: 'heavy',
            enableSmoothing: true
        });

        // face-api.js도 함께 초기화
        await initFaceApi();

        return poseDetector;
    })();

    return _initPromise;
}

export function getPoseDetector() {
    return poseDetector;
}

export async function estimatePoses(image) {
    if (!poseDetector) {
        throw new Error('Pose detector not initialized');
    }
    return await poseDetector.estimatePoses(image);
}

// ========== 범례 생성 ==========
export function createLegend(container, poseModelType = 'blazepose') {
    let html = '';

    if (poseModelType === 'blazepose') {
        // BlazePose: 33개 키포인트 전체 표시
        html += `<div class="legend-header">BlazePose (33개)</div>`;
        for (let i = 0; i <= 32; i++) {
            html += `<div class="legend-item">
                <span class="legend-num">${i}</span>
                <span class="legend-name">${BODY_PARTS[i]}</span>
            </div>`;
        }
    } else {
        // ViTPose/COCO: 17개 키포인트만 표시 (BlazePose 인덱스로 매핑됨)
        html += `<div class="legend-header">ViTPose/COCO (17개)</div>`;
        html += `<div class="legend-note">* 발목이 발 판단 기준</div>`;
        for (const idx of VITPOSE_VALID_INDICES) {
            html += `<div class="legend-item">
                <span class="legend-num">${idx}</span>
                <span class="legend-name">${COCO_BODY_PARTS[idx]}</span>
            </div>`;
        }
    }

    container.innerHTML = html;
}

// ========== 키포인트 렌더링 ==========
export function drawKeypointsWithNumbers(container, pose, processedImg, originalWidth = null, originalHeight = null, cropInfo = null, serverCropInfo = null) {
    // 실제 이미지 크기 사용 (CSS 크기가 아닌 naturalWidth/Height)
    const imgWidth = processedImg.naturalWidth || processedImg.width;
    const imgHeight = processedImg.naturalHeight || processedImg.height;

    console.log('🎯 마커 좌표 계산:', {
        processedSize: `${imgWidth}x${imgHeight}`,
        originalSize: `${originalWidth}x${originalHeight}`,
        serverCropInfo: serverCropInfo,
        clientCropInfo: cropInfo
    });

    pose.keypoints.forEach((kp, index) => {
        if (kp.score < 0.1) return;

        let leftPct, topPct;

        if (serverCropInfo && serverCropInfo.cropWidth > 0) {
            // 서버에서 정확한 크롭 정보를 받은 경우 (가장 정확함)
            // 변환 순서: 원본 좌표 → [클라이언트 크롭] → 리사이즈 → 서버 크롭

            let kpX = kp.x;
            let kpY = kp.y;

            // 1. 클라이언트 스마트 크롭이 적용된 경우, 먼저 오프셋 적용
            let sourceWidth = originalWidth;
            let sourceHeight = originalHeight;

            if (cropInfo) {
                kpX = kpX - cropInfo.cropX;
                kpY = kpY - cropInfo.cropY;

                // 크롭 영역 밖이면 스킵
                if (kpX < 0 || kpY < 0 || kpX > cropInfo.cropW || kpY > cropInfo.cropH) {
                    return;
                }

                // 클라이언트 크롭 후 크기가 서버로 보낸 원본 크기의 기준
                sourceWidth = cropInfo.cropW;
                sourceHeight = cropInfo.cropH;
            }

            // 2. 리사이즈 스케일 적용 (클라이언트 크롭 크기 → 서버 받은 크기)
            const uploadScaleX = serverCropInfo.originalWidth / sourceWidth;
            const uploadScaleY = serverCropInfo.originalHeight / sourceHeight;
            kpX = kpX * uploadScaleX;
            kpY = kpY * uploadScaleY;

            // 3. 서버 크롭 오프셋 적용
            kpX = kpX - serverCropInfo.cropX;
            kpY = kpY - serverCropInfo.cropY;

            // 4. 크롭된 이미지 크기 기준으로 퍼센트 계산
            leftPct = (kpX / serverCropInfo.cropWidth) * 100;
            topPct = (kpY / serverCropInfo.cropHeight) * 100;
        } else if (cropInfo) {
            // 클라이언트 스마트 크롭만 적용된 경우 (서버 크롭 정보 없음)
            const croppedX = kp.x - cropInfo.cropX;
            const croppedY = kp.y - cropInfo.cropY;

            if (croppedX < 0 || croppedY < 0 || croppedX > cropInfo.cropW || croppedY > cropInfo.cropH) {
                return;
            }

            leftPct = (croppedX / cropInfo.cropW) * 100;
            topPct = (croppedY / cropInfo.cropH) * 100;
        } else if (originalWidth && originalHeight) {
            // 크롭 없이 리사이즈만 된 경우: 원본 비율 그대로 사용
            leftPct = (kp.x / originalWidth) * 100;
            topPct = (kp.y / originalHeight) * 100;
        } else {
            // 원본 정보 없음: 처리된 이미지 크기 기준
            leftPct = (kp.x / imgWidth) * 100;
            topPct = (kp.y / imgHeight) * 100;
        }

        const dot = document.createElement('div');
        const colorClass = (kp.score <= CONSTANTS.MIN_CONFIDENCE) ? 'point-red' : 'point-blue';
        dot.className = `pose-point ${colorClass}`;
        dot.style.left = `${leftPct}%`;
        dot.style.top = `${topPct}%`;
        container.appendChild(dot);

        const num = document.createElement('div');
        num.className = 'pose-number';
        num.innerText = index;
        num.style.left = `${leftPct}%`;
        num.style.top = `${topPct}%`;
        container.appendChild(num);
    });
}

// ========== 투명도 체크 ==========
export function checkTransparency(ctx, keypoint) {
    if (!keypoint || keypoint.score <= CONSTANTS.MIN_CONFIDENCE) return true;
    const x = Math.floor(keypoint.x);
    const y = Math.floor(keypoint.y);
    if (x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) return true;
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    return pixel[3] < 20;
}

// ========== 다중 얼굴 감지 (face-api.js) ==========
/**
 * face-api.js를 사용하여 이미지에서 얼굴 감지
 * @param {HTMLImageElement} image - 분석할 이미지
 * @returns {Promise<Array>} 감지된 얼굴 배열
 */
export async function detectFaces(image) {
    if (!faceApiLoaded) {
        console.warn('⚠️ face-api.js 모델이 로드되지 않았습니다');
        return [];
    }

    try {
        const options = new faceapi.TinyFaceDetectorOptions({
            inputSize: FACE_DETECT_INPUT_SIZE,
            scoreThreshold: FACE_DETECT_SCORE_THRESHOLD
        });

        const detections = await faceapi.detectAllFaces(image, options);
        console.log(`👤 얼굴 감지: ${detections.length}명`);

        return detections;
    } catch (err) {
        console.error('❌ 얼굴 감지 오류:', err);
        return [];
    }
}

/**
 * 감지된 얼굴 중 메인 인물 판별
 * 기준: 얼굴 크기가 이미지의 2% 이상이면 메인 인물
 */
export function detectMainSubjects(faces, imageWidth, imageHeight) {
    if (!faces || faces.length === 0) return [];

    const imageArea = imageWidth * imageHeight;
    const mainSubjects = [];

    for (const face of faces) {
        const box = face.box;
        const faceArea = box.width * box.height;
        const areaRatio = faceArea / imageArea;

        // 얼굴 크기가 이미지의 일정 비율 이상이면 메인 인물로 판정
        if (areaRatio >= MAIN_SUBJECT_MIN_AREA_RATIO) {
            mainSubjects.push({
                box: box,
                score: face.score,
                areaRatio: areaRatio
            });
        }
    }

    // 크기순 정렬 (가장 큰 얼굴이 첫 번째)
    mainSubjects.sort((a, b) => b.areaRatio - a.areaRatio);

    return mainSubjects;
}

// ========== 모델별 발 키포인트 인덱스 ==========
/**
 * 포즈 모델에 따라 발 키포인트 인덱스 반환
 * - BlazePose: 33개 키포인트, 발가락(31, 32) 사용
 * - ViTPose/COCO: 17개 키포인트 → BlazePose 매핑, 발목(27, 28) 사용 (발가락 없음)
 */
export function getFootKeypointIndices(poseModelType) {
    if (poseModelType === 'blazepose') {
        return { left: 31, right: 32 }; // 발가락
    } else {
        // vitpose, vitpose-huge: COCO는 발가락이 없어서 발목 사용
        return { left: 27, right: 28 }; // 발목
    }
}

// ========== 사진 분류 ==========
export function classifyPhoto(photoData) {
    if (!photoData.pose) {
        return 'cut';
    }

    const kp = photoData.pose.keypoints;
    const poseModelType = photoData.poseModelType || 'blazepose';
    const footIndices = getFootKeypointIndices(poseModelType);

    const l_foot = kp[footIndices.left];
    const r_foot = kp[footIndices.right];

    const lScore = l_foot?.score || 0;
    const rScore = r_foot?.score || 0;

    // 디버깅: 분류 로직 확인
    const validKeypoints = kp.filter(k => k.score > 0.1).map(k => kp.indexOf(k));
    console.log(`📊 분류 정보:`, {
        poseModelType,
        photoDataHasPoseModelType: !!photoData.poseModelType,
        keypointArrayLength: kp.length,
        footIndices,
        '발목(27,28)': {
            left: kp[27] ? kp[27].score?.toFixed(3) : 'undefined',
            right: kp[28] ? kp[28].score?.toFixed(3) : 'undefined'
        },
        '발가락(31,32)': {
            left: kp[31] ? kp[31].score?.toFixed(3) : 'undefined',
            right: kp[32] ? kp[32].score?.toFixed(3) : 'undefined'
        },
        '사용된 발': { left: lScore.toFixed(3), right: rScore.toFixed(3) },
        threshold: CONSTANTS.MIN_CONFIDENCE,
        '유효한 키포인트 인덱스 (score>0.1)': validKeypoints
    });

    // 원본 이미지로 색상 체크
    const canvas = document.createElement('canvas');
    canvas.width = photoData.processedImg.naturalWidth;
    canvas.height = photoData.processedImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(photoData.processedImg, 0, 0);

    // 관절 마커 위치의 색상 체크 (모델에 따라 적절한 키포인트 사용)
    let keyPointsToCheck;
    if (poseModelType === 'blazepose') {
        // BlazePose: 더 많은 키포인트 체크 가능
        keyPointsToCheck = [
            kp[0], kp[11], kp[12], kp[23], kp[24],
            kp[25], kp[26], kp[27], kp[28], kp[31], kp[32]
        ];
    } else {
        // ViTPose/COCO: 17개 키포인트만 (0-16 → BlazePose 매핑됨)
        // COCO 키포인트: 코(0), 어깨(11,12), 엉덩이(23,24), 무릎(25,26), 발목(27,28)
        keyPointsToCheck = [
            kp[0], kp[11], kp[12], kp[23], kp[24],
            kp[25], kp[26], kp[27], kp[28]
        ];
    }

    let hasInvalidColor = false;
    for (const point of keyPointsToCheck) {
        if (!point || point.score < 0.3) continue;

        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;

        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const r = pixel[0];
        const g = pixel[1];
        const b = pixel[2];

        const isPureWhite = r === 255 && g === 255 && b === 255;
        const isPureBlack = r === 0 && g === 0 && b === 0;

        if (isPureWhite || isPureBlack) {
            hasInvalidColor = true;
            break;
        }
    }

    let result;
    let reason;

    if (hasInvalidColor) {
        result = 'suspicious';
        reason = '관절 위치에 순수 흰색/검은색 감지';
    } else if (lScore < CONSTANTS.MIN_CONFIDENCE || rScore < CONSTANTS.MIN_CONFIDENCE) {
        if (lScore < 0.3 || rScore < 0.3) {
            result = 'cut';
            reason = `발 신뢰도 0.3 미만 (left: ${lScore.toFixed(3)}, right: ${rScore.toFixed(3)})`;
        } else {
            result = 'suspicious';
            reason = `발 신뢰도 0.8 미만 (left: ${lScore.toFixed(3)}, right: ${rScore.toFixed(3)})`;
        }
    } else {
        result = 'good';
        reason = '모든 조건 충족';
    }

    console.log(`📋 분류 결과: ${result} - ${reason}`);
    return result;
}

// ========== 돌 분석 및 배치 ==========
export function analyzeAndPlaceRock(pose, processedImg, scale, kidBaseX, kidBaseY, stageW, stageH, rockWrapper, rockImage, sectionElement, originalWidth = null, originalHeight = null, category = null, poseModelType = 'blazepose', serverCropInfo = null) {
    if (!pose) return null;

    const kp = pose.keypoints;
    const footIndices = getFootKeypointIndices(poseModelType);

    const l_foot = kp[footIndices.left];
    const r_foot = kp[footIndices.right];

    sectionElement.dataset.lScore = l_foot?.score || 0;
    sectionElement.dataset.rScore = r_foot?.score || 0;

    // 투명도 체크용 캔버스
    const cvs = document.createElement('canvas');
    cvs.width = processedImg.naturalWidth;
    cvs.height = processedImg.naturalHeight;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(processedImg, 0, 0);

    // 좌표 변환 함수: 원본 좌표 → 처리된 이미지 좌표
    const transformCoord = (kp) => {
        if (!kp) return null;

        let x = kp.x;
        let y = kp.y;

        if (serverCropInfo && serverCropInfo.cropWidth > 0) {
            // 서버 크롭 정보가 있는 경우: 원본 → 리사이즈 → 서버 크롭
            const uploadScaleX = serverCropInfo.originalWidth / originalWidth;
            const uploadScaleY = serverCropInfo.originalHeight / originalHeight;

            // 1. 리사이즈 스케일 적용
            x = x * uploadScaleX;
            y = y * uploadScaleY;

            // 2. 서버 크롭 오프셋 적용
            x = x - serverCropInfo.cropX;
            y = y - serverCropInfo.cropY;
        } else if (originalWidth && originalHeight) {
            // 서버 크롭 정보 없이 단순 스케일
            const coordScaleX = processedImg.naturalWidth / originalWidth;
            const coordScaleY = processedImg.naturalHeight / originalHeight;
            x = x * coordScaleX;
            y = y * coordScaleY;
        }

        return { ...kp, x, y };
    };

    const scaledLFoot = transformCoord(l_foot);
    const scaledRFoot = transformCoord(r_foot);

    // 디버깅: 투명도 체크 좌표
    console.log(`🪨 돌 배치 분석:`, {
        poseModelType,
        footIndices,
        원본좌표: {
            left: l_foot ? { x: l_foot.x.toFixed(0), y: l_foot.y.toFixed(0) } : null,
            right: r_foot ? { x: r_foot.x.toFixed(0), y: r_foot.y.toFixed(0) } : null
        },
        변환좌표: {
            left: scaledLFoot ? { x: scaledLFoot.x.toFixed(0), y: scaledLFoot.y.toFixed(0) } : null,
            right: scaledRFoot ? { x: scaledRFoot.x.toFixed(0), y: scaledRFoot.y.toFixed(0) } : null
        },
        이미지크기: `${processedImg.naturalWidth}x${processedImg.naturalHeight}`,
        serverCropInfo
    });

    const isLeftCut = checkTransparency(ctx, scaledLFoot);
    const isRightCut = checkTransparency(ctx, scaledRFoot);

    console.log(`🪨 투명도 체크 결과: 왼쪽=${isLeftCut}, 오른쪽=${isRightCut}, category=${category}`);

    // 돌 표시 조건: 발끝이 잘렸거나, suspicious/cut 카테고리
    const shouldShowRock = isLeftCut || isRightCut || category === 'suspicious' || category === 'cut';

    if (shouldShowRock) {
        rockWrapper.style.opacity = '0';

        // 검수용 오버레이 생성
        const overlay = document.createElement('div');
        overlay.className = 'review-overlay';
        overlay.onclick = function() { this.remove(); };
        sectionElement.appendChild(overlay);

        // 발 위치 계산 (변환된 좌표 사용)
        // BlazePose: 발목(27,28), 발뒤꿈치(29,30), 발가락(31,32)
        // ViTPose/COCO: 발목(27,28)만 존재
        let l_pts, r_pts;
        if (poseModelType === 'blazepose') {
            l_pts = [transformCoord(kp[27]), transformCoord(kp[29]), transformCoord(kp[31])];
            r_pts = [transformCoord(kp[28]), transformCoord(kp[30]), transformCoord(kp[32])];
        } else {
            // ViTPose: 발목만 사용
            l_pts = [transformCoord(kp[27])];
            r_pts = [transformCoord(kp[28])];
        }
        let localTargetX, localTargetY;

        const calcAvg = (pts, coord) => {
            const validPts = pts.filter(p => p && p.score > 0.1);
            if (validPts.length === 0) return 0;
            return validPts.reduce((sum, p) => sum + (p[coord] || 0), 0) / validPts.length;
        };

        if (isLeftCut && !isRightCut) {
            localTargetX = calcAvg(l_pts, 'x');
            localTargetY = calcAvg(l_pts, 'y');
        } else if (!isLeftCut && isRightCut) {
            localTargetX = calcAvg(r_pts, 'x');
            localTargetY = calcAvg(r_pts, 'y');
        } else {
            const lx = calcAvg(l_pts, 'x');
            const ly = calcAvg(l_pts, 'y');
            const rx = calcAvg(r_pts, 'x');
            const ry = calcAvg(r_pts, 'y');
            localTargetX = (lx + rx) / 2;
            localTargetY = (ly + ry) / 2;
        }

        const stagePixelX = (localTargetX * scale) + kidBaseX;
        const stagePixelY = (localTargetY * scale) + kidBaseY;

        requestAnimationFrame(() => {
            const rockW = rockImage.offsetWidth;
            const finalPixelLeft = stagePixelX - (rockW / 2);
            const finalPixelTop = stagePixelY + CONSTANTS.FIXED_Y_OFFSET;
            const finalLeftPct = (finalPixelLeft / stageW) * 100;
            const finalTopPct = (finalPixelTop / stageH) * 100;

            rockWrapper.style.left = `${finalLeftPct}%`;
            rockWrapper.style.top = `${finalTopPct}%`;
            rockWrapper.style.opacity = '1';
        });

        return { x: stagePixelX, y: stagePixelY };
    } else {
        rockWrapper.style.display = 'none';
        return null;
    }
}

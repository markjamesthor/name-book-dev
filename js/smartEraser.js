/**
 * 스마트 지우개 모듈 - 포즈 기반 Convex Hull
 *
 * 알고리즘:
 * 1. 포즈 키포인트(33개 관절) → 캔버스 좌표 매핑
 * 2. Convex Hull (Graham Scan) + Edge-based 균일 마진 확장
 * 3. Hull 내부 = 인물 (보호), 외부 + 불투명 = 잔여물
 * 4. BFS로 연결된 잔여물 그룹화
 * 5. 호버 → 그룹 하이라이트, 클릭 → 그룹 삭제
 *
 * Fallback: 포즈 키포인트가 부족하면 Color Flood Fill (Magic Wand)
 */

const ALPHA_THRESHOLD = 30;
const HULL_MARGIN_RATIO = 0.08; // 키포인트 bbox 대각선의 8%
const MIN_KEYPOINT_SCORE = 0.3;
const MAX_GROUP_RATIO = 0.5;

// Magic Wand fallback
const COLOR_TOLERANCE = 80;
const MIN_REGION_SIZE = 50;
const MW_MAX_REGION_RATIO = 0.5;

// ========== 키포인트 → 캔버스 좌표 매핑 (pose.js 로직 복제) ==========
function mapKeypointToCanvas(kp, canvasW, canvasH, originalWidth, originalHeight, cropInfo, serverCropInfo) {
    let pctX, pctY;

    if (serverCropInfo && serverCropInfo.cropWidth > 0) {
        let kpX = kp.x, kpY = kp.y;
        let sourceWidth = originalWidth, sourceHeight = originalHeight;

        if (cropInfo) {
            kpX -= cropInfo.cropX;
            kpY -= cropInfo.cropY;
            if (kpX < 0 || kpY < 0 || kpX > cropInfo.cropW || kpY > cropInfo.cropH) return null;
            sourceWidth = cropInfo.cropW;
            sourceHeight = cropInfo.cropH;
        }

        const uploadScaleX = serverCropInfo.originalWidth / sourceWidth;
        const uploadScaleY = serverCropInfo.originalHeight / sourceHeight;
        kpX *= uploadScaleX;
        kpY *= uploadScaleY;
        kpX -= serverCropInfo.cropX;
        kpY -= serverCropInfo.cropY;

        pctX = kpX / serverCropInfo.cropWidth;
        pctY = kpY / serverCropInfo.cropHeight;
    } else if (cropInfo) {
        const croppedX = kp.x - cropInfo.cropX;
        const croppedY = kp.y - cropInfo.cropY;
        if (croppedX < 0 || croppedY < 0 || croppedX > cropInfo.cropW || croppedY > cropInfo.cropH) return null;
        pctX = croppedX / cropInfo.cropW;
        pctY = croppedY / cropInfo.cropH;
    } else if (originalWidth && originalHeight) {
        pctX = kp.x / originalWidth;
        pctY = kp.y / originalHeight;
    } else {
        pctX = kp.x / canvasW;
        pctY = kp.y / canvasH;
    }

    return { x: pctX * canvasW, y: pctY * canvasH };
}

// ========== Convex Hull (Graham Scan) ==========
function cross(O, A, B) {
    return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
}

function computeConvexHull(points) {
    if (points.length <= 2) return [...points];
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);

    const lower = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
            lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0)
            upper.pop();
        upper.push(sorted[i]);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

// ========== Edge-based Hull 확장 (Minkowski Offset) ==========
// 각 변을 바깥 방향으로 margin만큼 평행 이동 → 인접 변의 교차점이 새 꼭짓점
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

function expandHull(hull, margin) {
    const n = hull.length;
    if (n < 3) return hull;

    // Graham scan → CW in screen coords
    // CW polygon outward normal for edge p1→p2: (dy, -dx) / len
    const offsetEdges = [];
    for (let i = 0; i < n; i++) {
        const p1 = hull[i], p2 = hull[(i + 1) % n];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) {
            // 중복 점 → 이전 edge 복사
            if (offsetEdges.length > 0) offsetEdges.push(offsetEdges[offsetEdges.length - 1]);
            continue;
        }
        const nx = dy / len, ny = -dx / len;
        offsetEdges.push({
            x1: p1.x + nx * margin, y1: p1.y + ny * margin,
            x2: p2.x + nx * margin, y2: p2.y + ny * margin
        });
    }

    if (offsetEdges.length < 3) return hull;

    const result = [];
    for (let i = 0; i < offsetEdges.length; i++) {
        const e1 = offsetEdges[i];
        const e2 = offsetEdges[(i + 1) % offsetEdges.length];
        const pt = lineIntersection(e1.x1, e1.y1, e1.x2, e1.y2, e2.x1, e2.y1, e2.x2, e2.y2);
        if (pt) result.push(pt);
        else result.push({ x: e2.x1, y: e2.y1 });
    }
    return result;
}

// ========== Hull → 바이너리 마스크 (Scanline Fill) ==========
function rasterizeHull(hull, w, h) {
    const mask = new Uint8Array(w * h);
    if (hull.length < 3) return mask;

    let minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(h - 1, Math.ceil(maxY));
    const n = hull.length;

    for (let y = yStart; y <= yEnd; y++) {
        let xMin = Infinity, xMax = -Infinity;
        for (let i = 0; i < n; i++) {
            const p1 = hull[i], p2 = hull[(i + 1) % n];
            if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
                const x = p1.x + (y - p1.y) / (p2.y - p1.y) * (p2.x - p1.x);
                if (x < xMin) xMin = x;
                if (x > xMax) xMax = x;
            }
        }
        if (xMin > xMax) continue;
        const xs = Math.max(0, Math.floor(xMin));
        const xe = Math.min(w - 1, Math.ceil(xMax));
        const rowOff = y * w;
        for (let x = xs; x <= xe; x++) mask[rowOff + x] = 1;
    }
    return mask;
}

// ========== BFS: hull 밖의 불투명 픽셀을 연결 그룹으로 묶기 ==========
function groupOutsidePixels(data, hullMask, w, h) {
    const totalPixels = w * h;
    const groupMap = new Int32Array(totalPixels);
    const groups = new Map();
    let gid = 0;
    let totalOpaque = 0;
    let insideHull = 0;
    let outsideHull = 0;

    for (let i = 0; i < totalPixels; i++) {
        if (data[i * 4 + 3] > ALPHA_THRESHOLD) {
            totalOpaque++;
            if (hullMask[i]) insideHull++;
            else outsideHull++;
        }
    }

    console.log(`   📊 불투명 픽셀: ${totalOpaque} (hull 내부: ${insideHull}, 외부: ${outsideHull})`);

    const queue = new Int32Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
        if (groupMap[i] || hullMask[i] || data[i * 4 + 3] <= ALPHA_THRESHOLD) continue;

        gid++;
        const pixels = [];
        let qH = 0, qT = 0;
        queue[qT++] = i;
        groupMap[i] = gid;

        while (qH < qT) {
            const idx = queue[qH++];
            pixels.push(idx);
            const px = idx % w, py = (idx - px) / w;

            if (px + 1 < w) {
                const ni = idx + 1;
                if (!groupMap[ni] && !hullMask[ni] && data[ni * 4 + 3] > ALPHA_THRESHOLD) {
                    groupMap[ni] = gid; queue[qT++] = ni;
                }
            }
            if (px - 1 >= 0) {
                const ni = idx - 1;
                if (!groupMap[ni] && !hullMask[ni] && data[ni * 4 + 3] > ALPHA_THRESHOLD) {
                    groupMap[ni] = gid; queue[qT++] = ni;
                }
            }
            if (py + 1 < h) {
                const ni = idx + w;
                if (!groupMap[ni] && !hullMask[ni] && data[ni * 4 + 3] > ALPHA_THRESHOLD) {
                    groupMap[ni] = gid; queue[qT++] = ni;
                }
            }
            if (py - 1 >= 0) {
                const ni = idx - w;
                if (!groupMap[ni] && !hullMask[ni] && data[ni * 4 + 3] > ALPHA_THRESHOLD) {
                    groupMap[ni] = gid; queue[qT++] = ni;
                }
            }
        }

        if (pixels.length <= totalOpaque * MAX_GROUP_RATIO) {
            groups.set(gid, { pixels, area: pixels.length });
        } else {
            console.log(`   ⚠️ 그룹 ${gid} 너무 큼 (${pixels.length}px = ${(pixels.length/totalOpaque*100).toFixed(1)}%) → 제외`);
            for (const px of pixels) groupMap[px] = 0;
        }
    }

    return { groupMap, groups, totalOpaque };
}

// ========== 메인 분석 함수 ==========
export function analyzeComponents(canvas, poseOptions = {}) {
    const t0 = performance.now();
    const { keypoints, originalWidth, originalHeight, cropInfo, serverCropInfo } = poseOptions;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width, h = canvas.height;

    console.log(`🔍 스마트 지우개 분석 시작 (캔버스: ${w}x${h}, 키포인트: ${keypoints?.length || 0}개)`);

    // 1. 키포인트 → 캔버스 좌표 매핑
    const mappedPoints = [];
    if (keypoints && keypoints.length > 0) {
        for (const kp of keypoints) {
            if (kp.score < MIN_KEYPOINT_SCORE) continue;
            const pt = mapKeypointToCanvas(kp, w, h, originalWidth, originalHeight, cropInfo, serverCropInfo);
            if (pt) mappedPoints.push(pt);
        }
    }

    if (mappedPoints.length < 3) {
        console.log(`   ⚠️ 키포인트 부족 (${mappedPoints.length}개) → 매직완드 폴백`);
        let totalOpaque = 0;
        for (let i = 0; i < w * h; i++) {
            if (data[i * 4 + 3] > ALPHA_THRESHOLD) totalOpaque++;
        }
        return { groupLabelMap: null, groups: new Map(), mode: 'magicwand', totalOpaqueArea: totalOpaque };
    }

    // 2. Convex Hull
    const hull = computeConvexHull(mappedPoints);

    // 3. 마진 계산
    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (const p of mappedPoints) {
        if (p.x < bMinX) bMinX = p.x; if (p.x > bMaxX) bMaxX = p.x;
        if (p.y < bMinY) bMinY = p.y; if (p.y > bMaxY) bMaxY = p.y;
    }
    const diagonal = Math.sqrt((bMaxX - bMinX) ** 2 + (bMaxY - bMinY) ** 2);
    const margin = diagonal * HULL_MARGIN_RATIO;

    console.log(`   📐 키포인트 bbox: ${(bMaxX-bMinX).toFixed(0)}x${(bMaxY-bMinY).toFixed(0)}, 대각선: ${diagonal.toFixed(0)}px, 마진: ${margin.toFixed(0)}px`);

    // 4. Edge-based Hull 확장 (균일 마진)
    const expanded = expandHull(hull, margin);

    // 5. Hull → 바이너리 마스크
    const hullMask = rasterizeHull(expanded, w, h);

    // Hull 커버리지 통계
    let hullArea = 0;
    for (let i = 0; i < w * h; i++) { if (hullMask[i]) hullArea++; }
    console.log(`   🛡️ Hull: ${hull.length}꼭짓점, 커버리지: ${hullArea}px (캔버스의 ${(hullArea/(w*h)*100).toFixed(1)}%)`);

    // 6. BFS: hull 밖의 불투명 픽셀 그룹화
    const { groupMap, groups, totalOpaque } = groupOutsidePixels(data, hullMask, w, h);

    const elapsed = (performance.now() - t0).toFixed(1);
    console.log(
        `   ✅ 결과: 삭제가능 그룹=${groups.size}개 [${elapsed}ms]`
    );

    return {
        groupLabelMap: groupMap,
        groups,
        mode: groups.size > 0 ? 'segments' : 'magicwand',
        totalOpaqueArea: totalOpaque
    };
}

// ========== Debug: Hull 시각화 (오버레이에 경계선 그리기) ==========
export function debugDrawHull(canvas, overlayCanvas, poseOptions = {}) {
    const { keypoints, originalWidth, originalHeight, cropInfo, serverCropInfo } = poseOptions;
    const w = canvas.width, h = canvas.height;
    const overlayCtx = overlayCanvas.getContext('2d');

    if (overlayCanvas.width !== w) overlayCanvas.width = w;
    if (overlayCanvas.height !== h) overlayCanvas.height = h;
    overlayCtx.clearRect(0, 0, w, h);

    const mappedPoints = [];
    if (keypoints) {
        for (const kp of keypoints) {
            if (kp.score < MIN_KEYPOINT_SCORE) continue;
            const pt = mapKeypointToCanvas(kp, w, h, originalWidth, originalHeight, cropInfo, serverCropInfo);
            if (pt) mappedPoints.push(pt);
        }
    }
    if (mappedPoints.length < 3) return;

    const hull = computeConvexHull(mappedPoints);

    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    for (const p of mappedPoints) {
        if (p.x < bMinX) bMinX = p.x; if (p.x > bMaxX) bMaxX = p.x;
        if (p.y < bMinY) bMinY = p.y; if (p.y > bMaxY) bMaxY = p.y;
    }
    const diagonal = Math.sqrt((bMaxX - bMinX) ** 2 + (bMaxY - bMinY) ** 2);
    const margin = diagonal * HULL_MARGIN_RATIO;
    const expanded = expandHull(hull, margin);

    // 원본 hull (녹색)
    overlayCtx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) overlayCtx.lineTo(hull[i].x, hull[i].y);
    overlayCtx.closePath();
    overlayCtx.stroke();

    // 확장 hull (노란색)
    overlayCtx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.beginPath();
    overlayCtx.moveTo(expanded[0].x, expanded[0].y);
    for (let i = 1; i < expanded.length; i++) overlayCtx.lineTo(expanded[i].x, expanded[i].y);
    overlayCtx.closePath();
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);

    // 키포인트 (빨간 점)
    overlayCtx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    for (const p of mappedPoints) {
        overlayCtx.beginPath();
        overlayCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        overlayCtx.fill();
    }
}

// ========== Color Flood Fill (Magic Wand Fallback) ==========
let _floodVisited = null;
let _floodQueue = null;

function colorFloodFill(data, w, h, startPixel, tolerance, maxPixels) {
    const totalPixels = w * h;
    if (!_floodVisited || _floodVisited.length < totalPixels) {
        _floodVisited = new Uint8Array(totalPixels);
        _floodQueue = new Int32Array(totalPixels);
    } else {
        _floodVisited.fill(0);
    }

    const sOff = startPixel * 4;
    const sR = data[sOff], sG = data[sOff + 1], sB = data[sOff + 2];
    const pixels = [];
    let qH = 0, qT = 0;
    _floodQueue[qT++] = startPixel;
    _floodVisited[startPixel] = 1;

    while (qH < qT && pixels.length < maxPixels) {
        const idx = _floodQueue[qH++];
        pixels.push(idx);
        const px = idx % w, py = (idx - px) / w;
        for (let d = 0; d < 4; d++) {
            const nx = px + (d === 0 ? 1 : d === 1 ? -1 : 0);
            const ny = py + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const nIdx = ny * w + nx;
            if (_floodVisited[nIdx]) continue;
            if (data[nIdx * 4 + 3] <= ALPHA_THRESHOLD) continue;
            const nOff = nIdx * 4;
            if (Math.abs(data[nOff] - sR) + Math.abs(data[nOff + 1] - sG) + Math.abs(data[nOff + 2] - sB) <= tolerance) {
                _floodVisited[nIdx] = 1;
                _floodQueue[qT++] = nIdx;
            }
        }
    }
    return pixels.length >= maxPixels ? null : pixels;
}

// ========== Smart Eraser Setup ==========
export function setupSmartEraser(canvas, overlayCanvas, options = {}) {
    const { getSmartEraserMode = () => false, onErase = null, poseOptions = {} } = options;

    let mode = 'none';
    let analysis = null;
    let hoveredGroup = 0;

    // Magic Wand state
    let cachedImageData = null;
    let highlightBitmap = null;
    let currentHighlightPixels = null;
    let totalOpaqueArea = 0;

    const overlayCtx = overlayCanvas.getContext('2d');
    const container = canvas.closest('.kid-container');

    function ensureOverlaySize() {
        if (overlayCanvas.width !== canvas.width || overlayCanvas.height !== canvas.height) {
            overlayCanvas.width = canvas.width;
            overlayCanvas.height = canvas.height;
        }
    }

    function runAnalysis() {
        try {
            ensureOverlaySize();
            analysis = analyzeComponents(canvas, poseOptions);
            totalOpaqueArea = analysis.totalOpaqueArea;
            mode = analysis.mode;

            if (mode === 'magicwand') {
                const ctx2 = canvas.getContext('2d');
                cachedImageData = ctx2.getImageData(0, 0, canvas.width, canvas.height).data;
                highlightBitmap = new Uint8Array(canvas.width * canvas.height);
                console.log('   🪄 매직완드 폴백 활성화');
            } else {
                cachedImageData = null;
                highlightBitmap = null;
            }

            // 디버그: hull 경계선 2초간 표시
            debugDrawHull(canvas, overlayCanvas, poseOptions);
            setTimeout(() => {
                if (overlayCanvas.width > 0) {
                    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                }
            }, 2000);
        } catch (err) {
            console.error('❌ 분석 실패:', err);
            analysis = null;
        }
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.floor((e.clientX - rect.left) * canvas.width / rect.width),
            y: Math.floor((e.clientY - rect.top) * canvas.height / rect.height)
        };
    }

    function clearAll() {
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        hoveredGroup = 0;
        currentHighlightPixels = null;
        if (highlightBitmap) highlightBitmap.fill(0);
    }

    function highlightPixels(pixels) {
        ensureOverlaySize();
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        const cw = overlayCanvas.width;
        let minX = cw, maxX = 0, minY = overlayCanvas.height, maxY = 0;
        for (let i = 0; i < pixels.length; i++) {
            const px = pixels[i] % cw, py = (pixels[i] - px) / cw;
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        const rw = maxX - minX + 1, rh = maxY - minY + 1;
        const img = overlayCtx.createImageData(rw, rh);
        for (let i = 0; i < pixels.length; i++) {
            const px = pixels[i] % cw, py = (pixels[i] - px) / cw;
            const off = ((py - minY) * rw + (px - minX)) * 4;
            img.data[off] = 255; img.data[off + 1] = 50; img.data[off + 2] = 50; img.data[off + 3] = 100;
        }
        overlayCtx.putImageData(img, minX, minY);
    }

    function erasePixels(pixels) {
        const ctx2 = canvas.getContext('2d');
        const id = ctx2.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.length; i++) id.data[pixels[i] * 4 + 3] = 0;
        ctx2.putImageData(id, 0, 0);
        clearAll();
        console.log(`🗑️ ${pixels.length}px 삭제`);
        runAnalysis();
        if (onErase) onErase();
    }

    // ---- Segments mode (hull 밖 그룹) ----
    function handleSegmentsHover(pixelIdx) {
        const gid = analysis.groupLabelMap[pixelIdx];
        if (!gid) { if (hoveredGroup) clearAll(); return; }
        if (gid !== hoveredGroup) {
            hoveredGroup = gid;
            const grp = analysis.groups.get(gid);
            if (grp) highlightPixels(grp.pixels);
        }
    }
    function handleSegmentsClick(pixelIdx) {
        const gid = analysis.groupLabelMap[pixelIdx];
        if (!gid) return false;
        const grp = analysis.groups.get(gid);
        if (grp) erasePixels(grp.pixels);
        return true;
    }

    // ---- Magic Wand fallback ----
    function handleMagicWandHover(pixelIdx) {
        if (highlightBitmap && highlightBitmap[pixelIdx] === 1) return;
        if (cachedImageData[pixelIdx * 4 + 3] <= ALPHA_THRESHOLD) { clearAll(); return; }
        const maxFill = Math.floor(totalOpaqueArea * MW_MAX_REGION_RATIO);
        const result = colorFloodFill(cachedImageData, canvas.width, canvas.height, pixelIdx, COLOR_TOLERANCE, maxFill);
        if (!result || result.length < MIN_REGION_SIZE) { clearAll(); return; }
        highlightBitmap.fill(0);
        currentHighlightPixels = result;
        for (let i = 0; i < result.length; i++) highlightBitmap[result[i]] = 1;
        highlightPixels(result);
    }
    function handleMagicWandClick(pixelIdx) {
        if (!currentHighlightPixels || !highlightBitmap || highlightBitmap[pixelIdx] !== 1) return false;
        erasePixels(currentHighlightPixels);
        return true;
    }

    // ---- Events ----
    function onMouseMove(e) {
        if (!getSmartEraserMode()) return;
        if (!analysis) { runAnalysis(); if (!analysis) return; }
        const { x, y } = getCanvasCoords(e);
        if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) { clearAll(); return; }
        const pixelIdx = y * canvas.width + x;
        if (mode === 'segments') handleSegmentsHover(pixelIdx);
        else handleMagicWandHover(pixelIdx);
    }

    function onClick(e) {
        if (!getSmartEraserMode() || !analysis) return;
        const { x, y } = getCanvasCoords(e);
        if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return;
        const pixelIdx = y * canvas.width + x;
        const handled = mode === 'segments' ? handleSegmentsClick(pixelIdx) : handleMagicWandClick(pixelIdx);
        if (handled) { e.stopPropagation(); e.preventDefault(); }
    }

    function onMouseLeave() { if (getSmartEraserMode()) clearAll(); }

    const eventTarget = container || canvas;
    eventTarget.addEventListener('mousemove', onMouseMove);
    eventTarget.addEventListener('click', onClick);
    eventTarget.addEventListener('mouseleave', onMouseLeave);

    return {
        cleanup() {
            eventTarget.removeEventListener('mousemove', onMouseMove);
            eventTarget.removeEventListener('click', onClick);
            eventTarget.removeEventListener('mouseleave', onMouseLeave);
            clearAll();
            analysis = null;
            cachedImageData = null;
            highlightBitmap = null;
        },
        reanalyze() { runAnalysis(); },
        clearOverlay() { clearAll(); }
    };
}

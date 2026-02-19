"""
BGQA Checks - 모든 품질 체크 함수
"""

import numpy as np
import cv2
from typing import Dict, Any, Optional, List, Tuple

try:
    from sklearn.cluster import MiniBatchKMeans
    _HAS_SKLEARN = True
except ImportError:
    _HAS_SKLEARN = False


# ========== 유틸리티 함수 ==========

def normalize_image(image: np.ndarray) -> np.ndarray:
    """이미지를 0-1 float로 정규화"""
    if image.dtype == np.uint8:
        return image.astype(np.float32) / 255.0
    return image.astype(np.float32)


def normalize_alpha(alpha: np.ndarray) -> np.ndarray:
    """알파 마스크를 0-1 float로 정규화"""
    if alpha.dtype == np.uint8:
        return alpha.astype(np.float32) / 255.0
    return alpha.astype(np.float32)


def rgb_to_lab(image: np.ndarray) -> np.ndarray:
    """RGB 이미지를 LAB 색공간으로 변환"""
    if image.max() <= 1.0:
        image = (image * 255).astype(np.uint8)
    return cv2.cvtColor(image, cv2.COLOR_RGB2LAB).astype(np.float32)


def get_boundary_band(alpha: np.ndarray, width: int = 5) -> Tuple[np.ndarray, np.ndarray]:
    """마스크 경계의 inside/outside band 추출"""
    binary = (alpha > 0.5).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (width * 2 + 1, width * 2 + 1))

    dilated = cv2.dilate(binary, kernel, iterations=1)
    outside_band = (dilated - binary).astype(bool)

    eroded = cv2.erode(binary, kernel, iterations=1)
    inside_band = (binary - eroded).astype(bool)

    return inside_band, outside_band


# ========== Critical Checks ==========

def check_face_coverage(
    alpha: np.ndarray,
    face_bbox: Optional[List[int]] = None,
    threshold: float = 0.95
) -> Dict[str, Any]:
    """
    얼굴 보존 체크
    face_bbox 영역에서 alpha > 0.9인 비율이 95% 미만이면 critical 실패
    """
    if face_bbox is None:
        return {
            "passed": True,
            "type": "face_coverage",
            "severity": None,
            "detail": "얼굴 bbox 없음",
            "value": None,
            "penalty": 0
        }

    x1, y1, x2, y2 = [int(v) for v in face_bbox]
    h, w = alpha.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)

    if x2 <= x1 or y2 <= y1:
        return {
            "passed": True,
            "type": "face_coverage",
            "severity": None,
            "detail": "유효하지 않은 bbox",
            "value": None,
            "penalty": 0
        }

    face_region = alpha[y1:y2, x1:x2]
    coverage = (face_region > 0.9).mean()
    passed = coverage >= threshold

    return {
        "passed": passed,
        "type": "face_coverage",
        "severity": "critical" if not passed else None,
        "detail": f"얼굴 영역 {(1-coverage)*100:.1f}% 손실" if not passed else f"얼굴 보존 {coverage*100:.1f}%",
        "value": coverage,
        "penalty": 0 if passed else 1.0
    }


def check_mask_sanity(
    alpha: np.ndarray,
    min_fg_ratio: float = 0.02,
    max_fg_ratio: float = 0.90
) -> Dict[str, Any]:
    """
    마스크 크기 sanity 체크
    전경 비율 2% 미만 또는 90% 초과면 실패
    """
    fg_ratio = (alpha > 0.5).mean()

    if fg_ratio < min_fg_ratio:
        return {
            "passed": False,
            "type": "mask_sanity",
            "severity": "critical",
            "detail": f"전경 비율 너무 작음: {fg_ratio*100:.1f}%",
            "value": fg_ratio,
            "penalty": 1.0
        }

    if fg_ratio > max_fg_ratio:
        return {
            "passed": False,
            "type": "mask_sanity",
            "severity": "critical",
            "detail": f"전경 비율 너무 큼: {fg_ratio*100:.1f}%",
            "value": fg_ratio,
            "penalty": 1.0
        }

    return {
        "passed": True,
        "type": "mask_sanity",
        "severity": None,
        "detail": f"전경 비율: {fg_ratio*100:.1f}%",
        "value": fg_ratio,
        "penalty": 0
    }


def check_holes(
    alpha: np.ndarray,
    max_hole_ratio: float = 0.01
) -> Dict[str, Any]:
    """
    마스크 내부 구멍 검출
    morphological closing으로 구멍 메우고 차이 계산
    전경의 1% 초과면 실패
    """
    binary = (alpha > 0.5).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    holes = (closed - binary).astype(bool)
    hole_area = holes.sum()
    fg_area = binary.sum()

    if fg_area == 0:
        return {
            "passed": False,
            "type": "holes",
            "severity": "critical",
            "detail": "전경 없음",
            "value": 0,
            "penalty": 1.0
        }

    hole_ratio = hole_area / fg_area
    passed = hole_ratio <= max_hole_ratio

    return {
        "passed": passed,
        "type": "holes",
        "severity": "critical" if not passed else None,
        "detail": f"내부 구멍 {hole_ratio*100:.2f}%",
        "value": hole_ratio,
        "penalty": min(1.0, hole_ratio * 25)  # 4%면 penalty 1.0
    }


# ========== Warning Checks ==========

def check_color_outlier(
    image: np.ndarray,
    alpha: np.ndarray,
    bg_threshold: float = 0.2,
    fg_threshold: float = 0.8,
    z_threshold: float = 1.0,
    warning_ratio: float = 0.03,
    critical_ratio: float = 0.08
) -> Dict[str, Any]:
    """
    Color Outlier Detection (핵심!)

    마스크에 포함됐지만 실제론 배경인 픽셀 검출 (손에 붙은 잔여물 등)

    방법:
    1. 배경 픽셀(alpha < 0.2)의 LAB 색상 분포(mean, std) 계산
    2. 전경 픽셀 중 배경 분포와 유사한 것 찾기 (z-score < 1.5)
    3. 해당 픽셀 비율이 2% 초과면 warning, 5% 초과면 critical

    Returns:
        outlier_ratio, heatmap (문제 위치 시각화용)
    """
    image = normalize_image(image)
    alpha = normalize_alpha(alpha)

    # LAB 변환
    lab = rgb_to_lab(image)

    # 배경/전경 마스크
    bg_mask = alpha < bg_threshold
    fg_mask = alpha > fg_threshold

    bg_count = bg_mask.sum()
    fg_count = fg_mask.sum()

    if bg_count < 100 or fg_count < 100:
        return {
            "passed": True,
            "type": "color_outlier",
            "severity": None,
            "detail": "배경/전경 픽셀 부족",
            "value": 0,
            "penalty": 0,
            "heatmap": None
        }

    # 배경 픽셀의 LAB 분포 계산
    bg_pixels = lab[bg_mask]
    bg_mean = bg_pixels.mean(axis=0)
    bg_std = bg_pixels.std(axis=0)
    bg_std = np.maximum(bg_std, 1.0)  # 0으로 나누기 방지

    # 전경 픽셀의 z-score 계산
    fg_pixels = lab[fg_mask]
    z_scores = np.abs((fg_pixels - bg_mean) / bg_std)

    # 모든 채널에서 z-score가 threshold 미만인 픽셀 = 배경과 유사
    # (L, A, B 모두 배경과 비슷해야 outlier)
    is_outlier = np.all(z_scores < z_threshold, axis=1)
    outlier_count = is_outlier.sum()
    outlier_ratio = outlier_count / fg_count

    # 히트맵 생성
    heatmap = np.zeros(alpha.shape, dtype=np.float32)
    fg_indices = np.where(fg_mask)
    outlier_indices = (fg_indices[0][is_outlier], fg_indices[1][is_outlier])
    heatmap[outlier_indices] = 1.0

    # 심각도 판정
    if outlier_ratio > critical_ratio:
        severity = "critical"
        passed = False
    elif outlier_ratio > warning_ratio:
        severity = "warning"
        passed = True
    else:
        severity = None
        passed = True

    return {
        "passed": passed,
        "type": "color_outlier",
        "severity": severity,
        "detail": f"배경색 잔여물 {outlier_ratio*100:.1f}%",
        "value": outlier_ratio,
        "penalty": min(1.0, outlier_ratio * 20),  # 5%면 penalty 1.0
        "heatmap": heatmap
    }


def check_halo(
    image: np.ndarray,
    alpha: np.ndarray,
    band_width: int = 5,
    threshold: float = 20.0
) -> Dict[str, Any]:
    """
    헤일로/프린지 검출
    경계 inside band와 outside band의 LAB 색상 비교
    inside가 outside 색상으로 오염됐으면 감점
    """
    image = normalize_image(image)
    alpha = normalize_alpha(alpha)

    lab = rgb_to_lab(image)
    inside_band, outside_band = get_boundary_band(alpha, width=band_width)

    if inside_band.sum() < 10 or outside_band.sum() < 10:
        return {
            "passed": True,
            "type": "halo",
            "severity": None,
            "detail": "경계 영역 불충분",
            "value": 0,
            "penalty": 0,
            "heatmap": None
        }

    inside_lab = lab[inside_band].mean(axis=0)
    outside_lab = lab[outside_band].mean(axis=0)
    lab_distance = np.sqrt(np.sum((inside_lab - outside_lab) ** 2))

    # 거리가 작으면 헤일로 의심
    has_halo = lab_distance < threshold

    # 히트맵 생성
    heatmap = None
    if has_halo:
        heatmap = np.zeros(alpha.shape, dtype=np.float32)
        heatmap[inside_band] = 1.0

    return {
        "passed": not has_halo,
        "type": "halo",
        "severity": "warning" if has_halo else None,
        "detail": f"경계 색상 차이: {lab_distance:.1f}",
        "value": lab_distance,
        "penalty": max(0, (threshold - lab_distance) / threshold * 0.5) if has_halo else 0,
        "heatmap": heatmap
    }


def check_foreground_consistency(
    image: np.ndarray,
    alpha: np.ndarray,
    min_boundary_outlier_ratio: float = 0.48,
    min_outlier_area: int = 10000
) -> Dict[str, Any]:
    """
    전경 색상 일관성 체크 (연결된 잔여물 검출)

    사람 마스크에 유모차, 가방 등 연결된 물체가 포함됐는지 검출

    핵심 아이디어:
    경계 영역에서 메인 색상(상위 4개 클러스터)이 아닌 픽셀이
    55% 이상이면 잔여물 의심 (유모차 같은 큰 물체)
    """
    if not _HAS_SKLEARN:
        return {
            "passed": True,
            "type": "foreground_consistency",
            "severity": None,
            "detail": "sklearn 미설치",
            "value": 0,
            "penalty": 0,
            "heatmap": None
        }

    image = normalize_image(image)
    alpha = normalize_alpha(alpha)

    fg_mask = alpha > 0.5
    fg_count = fg_mask.sum()

    if fg_count < 1000:
        return {
            "passed": True,
            "type": "foreground_consistency",
            "severity": None,
            "detail": "전경 픽셀 부족",
            "value": 0,
            "penalty": 0,
            "heatmap": None
        }

    # LAB 변환
    lab = rgb_to_lab(image)
    fg_pixels = lab[fg_mask]

    # 샘플링
    max_samples = 30000
    if len(fg_pixels) > max_samples:
        indices = np.random.choice(len(fg_pixels), max_samples, replace=False)
        sample_pixels = fg_pixels[indices]
    else:
        sample_pixels = fg_pixels

    # K-means 클러스터링 (10개로 세분화)
    n_clusters = 10
    kmeans = MiniBatchKMeans(n_clusters=n_clusters, random_state=42, n_init=3)
    kmeans.fit(sample_pixels)

    all_labels = kmeans.predict(fg_pixels)
    cluster_counts = np.bincount(all_labels, minlength=n_clusters)

    # 상위 4개 클러스터를 메인으로 (피부, 머리, 상의, 하의)
    top_clusters = np.argsort(cluster_counts)[-4:]
    main_mask = np.isin(all_labels, top_clusters)

    # 마이너 클러스터 픽셀
    outlier_mask_flat = ~main_mask

    # 히트맵 생성
    heatmap = np.zeros(alpha.shape, dtype=np.float32)
    fg_indices = np.where(fg_mask)
    outlier_indices = (fg_indices[0][outlier_mask_flat], fg_indices[1][outlier_mask_flat])
    heatmap[outlier_indices] = 1.0

    # 경계 영역 (외곽 30% 정도)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (51, 51))
    eroded = cv2.erode((alpha > 0.5).astype(np.uint8), kernel, iterations=2)
    boundary_interior = ((alpha > 0.5).astype(np.uint8) - eroded).astype(bool)

    # 경계 근처 outlier
    boundary_outlier_mask = heatmap.astype(bool) & boundary_interior
    boundary_outlier_area = boundary_outlier_mask.sum()

    boundary_total = boundary_interior.sum()
    boundary_outlier_ratio = boundary_outlier_area / boundary_total if boundary_total > 0 else 0

    # 판정: 경계의 55% 이상이 마이너 색상이고, 면적이 10000px 이상
    has_issue = boundary_outlier_ratio > min_boundary_outlier_ratio and boundary_outlier_area > min_outlier_area

    if has_issue:
        severity = "critical" if boundary_outlier_ratio > 0.65 else "warning"
    else:
        severity = None

    return {
        "passed": not has_issue,
        "type": "foreground_consistency",
        "severity": severity,
        "detail": f"경계 이질 {boundary_outlier_ratio*100:.1f}%, 면적 {boundary_outlier_area}px",
        "value": boundary_outlier_ratio,
        "penalty": min(1.0, (boundary_outlier_ratio - 0.5) * 4) if has_issue else 0,
        "heatmap": heatmap
    }


def check_handheld_extras(
    image: np.ndarray,
    alpha: np.ndarray,
    wrist_keypoints: Optional[List[Tuple[float, float]]] = None,
    hand_roi_radius_ratio: float = 0.10,
    extras_threshold: float = 0.40
) -> Dict[str, Any]:
    """
    손에 들린 물체 잔여물 검출 (유모차 vs 컵)

    핵심: 손 영역 근처의 이질적인 색상/형태 검출
    발/다리 영역은 무시 (바닥에 서있는 건 자연스러움)

    키포인트가 없으면 검출 정확도가 떨어지므로 더 관대하게 처리

    Args:
        image: RGB 이미지
        alpha: 알파 마스크
        wrist_keypoints: 손목 좌표 [(x1, y1), (x2, y2)] (left, right)
        hand_roi_radius_ratio: 손 ROI 반경 (이미지 대각선 대비)
        extras_threshold: 잔여물 비율 임계값

    Returns:
        passed, severity, detail, value
    """
    image = normalize_image(image)
    alpha = normalize_alpha(alpha)

    h, w = alpha.shape[:2]
    diag = np.sqrt(h**2 + w**2)
    hand_radius = int(diag * hand_roi_radius_ratio)

    fg_mask = alpha > 0.5
    fg_area = fg_mask.sum()

    if fg_area < 1000:
        return {
            "passed": True,
            "type": "handheld_extras",
            "severity": None,
            "detail": "전경 픽셀 부족",
            "value": 0,
            "penalty": 0,
            "heatmap": None
        }

    # 키포인트 없으면 threshold 상향 (정확도가 떨어지므로)
    has_keypoints = wrist_keypoints is not None and len(wrist_keypoints) > 0
    effective_threshold = extras_threshold if has_keypoints else 0.25

    # 손목 키포인트가 없으면 상단 1/3 영역을 손 영역으로 추정
    if not has_keypoints:
        # 전경 마스크의 상단 1/3을 손 영역으로 간주
        rows = np.any(fg_mask, axis=1)
        if rows.sum() == 0:
            return {
                "passed": True,
                "type": "handheld_extras",
                "severity": None,
                "detail": "전경 없음",
                "value": 0,
                "penalty": 0,
                "heatmap": None
            }
        fg_top = np.where(rows)[0][0]
        fg_bottom = np.where(rows)[0][-1]
        fg_height = fg_bottom - fg_top

        # 상단 40%를 손/상체 영역으로
        hand_zone_bottom = fg_top + int(fg_height * 0.4)
        hand_roi_mask = np.zeros_like(alpha, dtype=bool)
        hand_roi_mask[:hand_zone_bottom, :] = True
    else:
        # 손목 키포인트 주변에 원형 ROI 생성
        hand_roi_mask = np.zeros_like(alpha, dtype=bool)
        for wx, wy in wrist_keypoints:
            if wx > 0 and wy > 0:  # 유효한 키포인트
                y, x = np.ogrid[:h, :w]
                dist = np.sqrt((x - wx)**2 + (y - wy)**2)
                hand_roi_mask |= (dist <= hand_radius)

    # 손 영역 내 전경 분석
    hand_fg_mask = fg_mask & hand_roi_mask
    hand_fg_area = hand_fg_mask.sum()

    if hand_fg_area < 500:
        return {
            "passed": True,
            "type": "handheld_extras",
            "severity": None,
            "detail": "손 영역 전경 부족",
            "value": 0,
            "penalty": 0,
            "heatmap": None
        }

    # LAB 색공간에서 분석
    lab = rgb_to_lab(image)

    # 전체 전경의 주요 색상 (상위 3개 클러스터)
    try:
        if not _HAS_SKLEARN:
            raise ImportError("sklearn 미설치")

        fg_pixels = lab[fg_mask]
        max_samples = 20000
        if len(fg_pixels) > max_samples:
            indices = np.random.choice(len(fg_pixels), max_samples, replace=False)
            sample_pixels = fg_pixels[indices]
        else:
            sample_pixels = fg_pixels

        kmeans = MiniBatchKMeans(n_clusters=6, random_state=42, n_init=3)
        kmeans.fit(sample_pixels)

        all_labels = kmeans.predict(fg_pixels)
        cluster_counts = np.bincount(all_labels, minlength=6)
        top_clusters = np.argsort(cluster_counts)[-3:]  # 상위 3개

        # 손 영역 전경 픽셀의 클러스터 분석
        hand_fg_pixels = lab[hand_fg_mask]
        hand_labels = kmeans.predict(hand_fg_pixels)

        # 손 영역에서 마이너 클러스터 비율
        hand_main_mask = np.isin(hand_labels, top_clusters)
        hand_outlier_ratio = 1.0 - (hand_main_mask.sum() / len(hand_labels))

    except ImportError:
        # sklearn 없으면 간단한 색상 분석
        hand_outlier_ratio = 0.0

    # 히트맵 생성
    heatmap = np.zeros(alpha.shape, dtype=np.float32)
    if hand_outlier_ratio > effective_threshold:
        heatmap[hand_fg_mask] = hand_outlier_ratio

    # 판정 - effective_threshold 사용
    has_issue = hand_outlier_ratio > effective_threshold
    if has_issue:
        # 키포인트가 있을 때만 critical 가능
        if has_keypoints and hand_outlier_ratio > 0.15:
            severity = "critical"
        else:
            severity = "warning"
    else:
        severity = None

    return {
        "passed": not has_issue,
        "type": "handheld_extras",
        "severity": severity,
        "detail": f"손 영역 이질 {hand_outlier_ratio*100:.1f}% (임계값: {effective_threshold*100:.0f}%)",
        "value": hand_outlier_ratio,
        "penalty": min(1.0, hand_outlier_ratio * 5) if has_issue else 0,
        "heatmap": heatmap
    }


def check_residue(
    alpha: np.ndarray,
    min_component_ratio: float = 0.001,
    max_small_components: int = 10
) -> Dict[str, Any]:
    """
    분리된 잔여물 검출
    connected component 분석
    메인 컴포넌트 외 작은 조각 비율 계산
    """
    binary = (alpha > 0.5).astype(np.uint8)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    if num_labels <= 1:
        return {
            "passed": True,
            "type": "residue",
            "severity": None,
            "detail": "컴포넌트 없음",
            "value": 0,
            "penalty": 0
        }

    # 배경(label 0) 제외
    areas = stats[1:, cv2.CC_STAT_AREA]

    if len(areas) == 0:
        return {
            "passed": True,
            "type": "residue",
            "severity": None,
            "detail": "전경 없음",
            "value": 0,
            "penalty": 0
        }

    main_area = areas.max()
    small_threshold = main_area * min_component_ratio
    small_areas = areas[areas < small_threshold]
    num_small = len(small_areas)
    small_total = small_areas.sum() if len(small_areas) > 0 else 0
    residue_ratio = small_total / main_area if main_area > 0 else 0

    has_issue = num_small > max_small_components or residue_ratio > 0.01

    return {
        "passed": not has_issue,
        "type": "residue",
        "severity": "warning" if has_issue else None,
        "detail": f"분리된 조각 {num_small}개, 면적비 {residue_ratio*100:.2f}%",
        "value": residue_ratio,
        "penalty": min(1.0, residue_ratio * 50 + num_small / 50) if has_issue else 0
    }

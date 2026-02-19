"""
BGQA Core - 케이스별 품질 평가 (v2.0)

KID_PERSON / ADULT_PERSON: 얼굴 보존, 헤어라인, handheld extras 필터
TOY_OBJECT: 구조 보존, 구멍 허용, 잔여물 검출
"""

import numpy as np
from typing import Dict, Any, Optional, List, Callable

from .config_parser import (
    CaseType, get_case_config, is_person_case,
    GateConfig, WeightsConfig, ExtrasHandheldConfig
)
from .checks import (
    normalize_image,
    normalize_alpha,
    check_face_coverage,
    check_mask_sanity,
    check_holes,
    check_color_outlier,
    check_halo,
    check_foreground_consistency,
    check_handheld_extras,
    check_residue
)


def detect_case_type(
    image: np.ndarray,
    has_face: bool = False,
    face_bbox: Optional[List[int]] = None,
    is_child: bool = True
) -> CaseType:
    """
    Face API 결과를 기반으로 케이스 타입 결정

    Args:
        image: 원본 이미지
        has_face: 얼굴 감지 여부
        face_bbox: 얼굴 바운딩 박스
        is_child: 아이 여부 (기본값: True - 동화책 프로젝트 특성)

    Returns:
        CaseType: KID_PERSON, ADULT_PERSON, or TOY_OBJECT
    """
    if has_face or face_bbox is not None:
        return CaseType.KID_PERSON if is_child else CaseType.ADULT_PERSON
    else:
        return CaseType.TOY_OBJECT


def evaluate(
    image: np.ndarray,
    alpha: np.ndarray,
    case_type: Optional[CaseType] = None,
    face_bbox: Optional[List[int]] = None,
    has_face: bool = False,
    is_child: bool = True,
    wrist_keypoints: Optional[List[tuple]] = None,
    enable_roundtrip: bool = False,
    segment_fn: Optional[Callable] = None,
    generate_debug_images: bool = False
) -> Dict[str, Any]:
    """
    배경 제거 품질 평가 (v2.0 - 케이스별 평가)

    Args:
        image: 원본 이미지 (H, W, 3), RGB, 0-1 float 또는 0-255 uint8
        alpha: 배경 제거 결과 마스크 (H, W), 0-1
        case_type: 피사체 유형 (None이면 자동 감지)
        face_bbox: 얼굴 bounding box [x1, y1, x2, y2]
        has_face: 얼굴 감지 여부 (face API에서 전달)
        is_child: 아이 여부
        wrist_keypoints: 손목 좌표 [(x1, y1), (x2, y2)] - ViTPose에서 전달
        enable_roundtrip: 라운드트립 검증 활성화
        segment_fn: 라운드트립용 세그멘테이션 함수
        generate_debug_images: 디버그 이미지 생성 여부

    Returns:
        {
            "passed": bool,
            "score": float (0-100),
            "case_type": str,
            "issues": list,
            "hard_fail_reason": str or None,
            "debug_images": dict (optional)
        }
    """
    # 입력 정규화
    image = normalize_image(image)
    alpha = normalize_alpha(alpha)

    # 케이스 타입 결정
    if case_type is None:
        case_type = detect_case_type(image, has_face, face_bbox, is_child)

    # 케이스별 설정 로드
    config = get_case_config(case_type)
    gates = config.gates
    weights = config.weights

    issues = []
    metrics = {}
    hard_fail_reason = None

    # ========== Gate Checks (Hard Fail) ==========

    # G1: 마스크 영역 sanity 체크
    sanity_result = check_mask_sanity(
        alpha,
        min_fg_ratio=gates.area_min,
        max_fg_ratio=gates.area_max
    )
    if not sanity_result["passed"]:
        hard_fail_reason = "G1_AREA"
        issues.append({
            "type": sanity_result["type"],
            "severity": "critical",
            "detail": sanity_result["detail"],
        })

    # G2: 얼굴 보존 체크 (사람 케이스만)
    if is_person_case(case_type) and gates.require_face:
        face_result = check_face_coverage(
            alpha,
            face_bbox,
            threshold=gates.primary_face_coverage_min
        )
        if not face_result["passed"] and face_result["value"] is not None:
            hard_fail_reason = "G2_FACE_COVER"
            issues.append({
                "type": face_result["type"],
                "severity": "critical",
                "detail": face_result["detail"],
            })

    # G3: 마스크 내부 구멍 검출
    holes_result = check_holes(alpha)
    if not holes_result["passed"]:
        # 물체는 구멍 허용
        if is_person_case(case_type):
            if holes_result["value"] > gates.face_holes_area_ratio_max:
                hard_fail_reason = "G3_FACE_HOLES"
        issues.append({
            "type": holes_result["type"],
            "severity": "critical" if is_person_case(case_type) else "warning",
            "detail": holes_result["detail"],
        })
    metrics["holes"] = 1.0 - min(1.0, holes_result["value"] * 10)

    # Hard fail이면 조기 종료
    if hard_fail_reason:
        return {
            "passed": False,
            "score": 5.0,  # cap_score
            "case_type": case_type.value,
            "issues": issues,
            "hard_fail_reason": hard_fail_reason,
            "metrics": metrics
        }

    # ========== Soft Metrics ==========

    # 헤일로/번짐 검출
    halo_result = check_halo(image, alpha)
    if not halo_result["passed"]:
        issues.append({
            "type": halo_result["type"],
            "severity": halo_result["severity"],
            "detail": halo_result["detail"],
        })
    metrics["halo_bleed"] = 1.0 - halo_result.get("penalty", 0)

    # 잔여물 검출 (분리된 조각들)
    residue_result = check_residue(alpha)
    if not residue_result["passed"]:
        # 임계값 초과면 hard fail
        if residue_result["value"] > gates.residue_ratio_max_hard_fail:
            hard_fail_reason = "G4_RESIDUE"
        issues.append({
            "type": residue_result["type"],
            "severity": residue_result["severity"],
            "detail": residue_result["detail"],
        })
    metrics["residue_fragmentation"] = 1.0 - residue_result.get("penalty", 0)

    # Color Outlier (배경색 잔여)
    outlier_result = check_color_outlier(image, alpha)
    if outlier_result["severity"] is not None:
        issues.append({
            "type": outlier_result["type"],
            "severity": outlier_result["severity"],
            "detail": outlier_result["detail"],
        })
    metrics["color_outlier"] = 1.0 - outlier_result.get("penalty", 0)

    # 손에 들린 물체 검출 (사람 케이스만)
    # 핵심: 손 영역만 분석 → 발이 바닥/차에 닿은 건 무시
    if is_person_case(case_type):
        try:
            handheld_result = check_handheld_extras(
                image, alpha,
                wrist_keypoints=wrist_keypoints
            )
            if not handheld_result["passed"]:
                # 키포인트가 있고 손 영역 이질 비율이 50% 이상일 때만 hard fail
                # 키포인트 없으면 정확도가 떨어지므로 hard fail 안 함
                has_keypoints = wrist_keypoints is not None and len(wrist_keypoints) > 0
                if has_keypoints and handheld_result["value"] > 0.50:
                    hard_fail_reason = "G6_HANDHELD_EXTRAS"
                issues.append({
                    "type": handheld_result["type"],
                    "severity": handheld_result["severity"],
                    "detail": handheld_result["detail"],
                })
            metrics["extras_cleanliness"] = 1.0 - handheld_result.get("penalty", 0)
        except Exception as e:
            print(f"⚠️ handheld_extras 체크 실패: {e}")
            metrics["extras_cleanliness"] = 1.0

    # Hard fail 체크
    if hard_fail_reason:
        return {
            "passed": False,
            "score": 5.0,
            "case_type": case_type.value,
            "issues": issues,
            "hard_fail_reason": hard_fail_reason,
            "metrics": metrics
        }

    # ========== 최종 점수 계산 ==========

    # 케이스별 가중치 적용
    score = 100.0

    # 각 메트릭의 점수 계산 (0-1 범위)
    metric_scores = {
        "halo_bleed": metrics.get("halo_bleed", 1.0),
        "residue_fragmentation": metrics.get("residue_fragmentation", 1.0),
        "holes": metrics.get("holes", 1.0),
        "color_outlier": metrics.get("color_outlier", 1.0),
    }

    if is_person_case(case_type):
        metric_scores["extras_cleanliness"] = metrics.get("extras_cleanliness", 1.0)

    # 가중 평균 계산
    total_weight = 0
    weighted_sum = 0

    weight_map = {
        "halo_bleed": weights.halo_bleed,
        "residue_fragmentation": weights.residue_fragmentation,
        "holes": weights.holes if weights.holes > 0 else 0.05,
        "color_outlier": 0.15,  # 고정 가중치
        "extras_cleanliness": 0.10 if is_person_case(case_type) else 0,
    }

    for metric_name, metric_score in metric_scores.items():
        weight = weight_map.get(metric_name, 0)
        if weight > 0:
            weighted_sum += metric_score * weight
            total_weight += weight

    if total_weight > 0:
        normalized_score = weighted_sum / total_weight
        score = normalized_score * 100

    score = max(0.0, min(100.0, score))

    # 이슈가 있으면 passed=True이지만 점수 감점
    passed = hard_fail_reason is None

    result = {
        "passed": passed,
        "score": round(score, 1),
        "case_type": case_type.value,
        "issues": issues,
        "hard_fail_reason": hard_fail_reason,
        "metrics": metrics
    }

    if generate_debug_images:
        result["debug_images"] = _generate_debug_images(image, alpha, issues)

    return result


def _generate_debug_images(
    image: np.ndarray,
    alpha: np.ndarray,
    issues: List[Dict]
) -> Dict[str, np.ndarray]:
    """디버그 이미지 생성"""
    debug = {}

    combined_mask = np.zeros(alpha.shape, dtype=np.float32)
    for issue in issues:
        mask = issue.get("mask")
        if mask is not None and mask.shape == alpha.shape:
            combined_mask = np.maximum(combined_mask, mask)

    if combined_mask.max() > 0:
        debug["issue_heatmap"] = combined_mask

    return debug


def evaluate_quick(
    image: np.ndarray,
    alpha: np.ndarray,
    case_type: Optional[CaseType] = None,
    face_bbox: Optional[List[int]] = None
) -> Dict[str, Any]:
    """
    빠른 평가 (Gate checks만)

    Returns:
        {
            "passed": bool,
            "score": float (0 or 100),
            "case_type": str,
            "issues": list
        }
    """
    alpha = normalize_alpha(alpha)

    if case_type is None:
        case_type = CaseType.KID_PERSON if face_bbox else CaseType.TOY_OBJECT

    config = get_case_config(case_type)
    gates = config.gates

    issues = []
    hard_fail = False

    # 마스크 sanity
    sanity = check_mask_sanity(alpha, gates.area_min, gates.area_max)
    if not sanity["passed"]:
        issues.append({"type": "mask_sanity", "detail": sanity["detail"]})
        hard_fail = True

    # 얼굴 보존 (사람만)
    if is_person_case(case_type) and face_bbox:
        face = check_face_coverage(alpha, face_bbox, gates.primary_face_coverage_min)
        if not face["passed"]:
            issues.append({"type": "face_coverage", "detail": face["detail"]})
            hard_fail = True

    # 구멍 (사람만 critical)
    holes = check_holes(alpha)
    if not holes["passed"] and is_person_case(case_type):
        issues.append({"type": "holes", "detail": holes["detail"]})
        hard_fail = True

    return {
        "passed": not hard_fail,
        "score": 100.0 if not hard_fail else 5.0,
        "case_type": case_type.value,
        "issues": issues
    }

"""
BGQA 유틸리티 함수
"""

import numpy as np
import cv2
from typing import Tuple, Optional


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


def get_boundary_band(alpha: np.ndarray, width: int = 5) -> Tuple[np.ndarray, np.ndarray]:
    """
    마스크 경계의 inside/outside band 추출

    Returns:
        inside_band: 경계 안쪽 영역 마스크
        outside_band: 경계 바깥쪽 영역 마스크
    """
    binary = (alpha > 0.5).astype(np.uint8)

    # dilate로 outside band
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (width * 2 + 1, width * 2 + 1))
    dilated = cv2.dilate(binary, kernel, iterations=1)
    outside_band = (dilated - binary).astype(bool)

    # erode로 inside band
    eroded = cv2.erode(binary, kernel, iterations=1)
    inside_band = (binary - eroded).astype(bool)

    return inside_band, outside_band


def get_mask_boundary(alpha: np.ndarray) -> np.ndarray:
    """마스크의 경계선 추출"""
    binary = (alpha > 0.5).astype(np.uint8) * 255
    edges = cv2.Canny(binary, 100, 200)
    return edges > 0


def rgb_to_lab(image: np.ndarray) -> np.ndarray:
    """RGB 이미지를 LAB 색공간으로 변환"""
    if image.max() <= 1.0:
        image = (image * 255).astype(np.uint8)
    return cv2.cvtColor(image, cv2.COLOR_RGB2LAB)


def get_connected_components(binary_mask: np.ndarray) -> Tuple[int, np.ndarray, np.ndarray]:
    """
    연결 요소 분석

    Returns:
        num_labels: 연결 요소 개수
        labels: 레이블 맵
        stats: 각 컴포넌트의 통계 (x, y, w, h, area)
    """
    binary = (binary_mask > 0.5).astype(np.uint8)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    return num_labels, labels, stats


def create_boundary_overlay(image: np.ndarray, alpha: np.ndarray,
                           issues: list = None) -> np.ndarray:
    """
    경계 시각화 오버레이 생성

    Args:
        image: 원본 이미지 (H, W, 3)
        alpha: 알파 마스크 (H, W)
        issues: 감지된 문제 리스트

    Returns:
        시각화된 이미지
    """
    image = normalize_image(image)
    alpha = normalize_alpha(alpha)

    # 결과 이미지 생성
    overlay = image.copy()

    # 경계선 그리기 (녹색)
    boundary = get_mask_boundary(alpha)
    overlay[boundary] = [0, 1, 0]

    # 문제 영역 표시
    if issues:
        for issue in issues:
            if issue.get("mask") is not None:
                issue_mask = issue["mask"]
                if issue["severity"] == "critical":
                    # 빨간색
                    overlay[issue_mask] = overlay[issue_mask] * 0.5 + np.array([1, 0, 0]) * 0.5
                else:
                    # 노란색
                    overlay[issue_mask] = overlay[issue_mask] * 0.5 + np.array([1, 1, 0]) * 0.5

    return (overlay * 255).astype(np.uint8)


def create_issue_heatmap(alpha: np.ndarray, issues: list) -> np.ndarray:
    """
    문제 영역 히트맵 생성

    Returns:
        히트맵 이미지 (H, W, 3)
    """
    h, w = alpha.shape[:2]
    heatmap = np.zeros((h, w, 3), dtype=np.float32)

    for issue in issues:
        if issue.get("mask") is not None:
            mask = issue["mask"]
            if issue["severity"] == "critical":
                heatmap[mask, 0] = 1.0  # R
            elif issue["severity"] == "warning":
                heatmap[mask, 0] = 1.0  # R
                heatmap[mask, 1] = 0.5  # G (orange)

    return (heatmap * 255).astype(np.uint8)


def iou(mask1: np.ndarray, mask2: np.ndarray) -> float:
    """두 마스크의 IoU 계산"""
    intersection = np.logical_and(mask1, mask2).sum()
    union = np.logical_or(mask1, mask2).sum()
    if union == 0:
        return 0.0
    return intersection / union

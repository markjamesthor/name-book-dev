"""
BGQA Config Parser - YAML 설정 파일 파싱 및 케이스별 설정 관리
"""

import yaml
from pathlib import Path
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from enum import Enum


class CaseType(Enum):
    """피사체 유형"""
    KID_PERSON = "KID_PERSON"
    ADULT_PERSON = "ADULT_PERSON"
    TOY_OBJECT = "TOY_OBJECT"


@dataclass
class GateConfig:
    """Hard fail 게이트 설정"""
    area_min: float = 0.02
    area_max: float = 0.90
    require_face: bool = True
    primary_face_coverage_min: float = 0.995
    secondary_face_coverage_min: float = 0.95
    face_holes_area_ratio_max: float = 0.001
    residue_ratio_max_hard_fail: float = 0.02
    interior_low_alpha_threshold: float = 0.98
    interior_low_alpha_frac_max: float = 0.01
    forbidden_extras_area_ratio_max_hard_fail: float = 0.005


@dataclass
class WeightsConfig:
    """메트릭 가중치"""
    roundtrip: float = 0.35
    region_score: float = 0.18
    halo_bleed: float = 0.12
    thin_structures: float = 0.12
    edges: float = 0.10
    residue_fragmentation: float = 0.08
    alpha_transition: float = 0.05
    holes: float = 0.0


@dataclass
class ExtrasHandheldConfig:
    """Handheld extras filter 설정 (컵 vs 유모차)"""
    enabled: bool = True
    deny_classes: List[str] = field(default_factory=lambda: [
        "stroller", "shopping_cart", "chair", "table",
        "car_seat", "sofa", "bed", "bicycle"
    ])
    allow_classes: List[str] = field(default_factory=lambda: [
        "cup", "paper_cup", "bottle", "toy",
        "book", "phone", "plush", "ball"
    ])
    # Component analysis thresholds
    small_object_max_kid: float = 0.06
    small_object_max_adult: float = 0.04
    large_object_fail: float = 0.20
    outside_ratio_allow_max: float = 0.15
    outside_ratio_fail_min: float = 0.40
    diag_ratio_allow_max: float = 0.55
    diag_ratio_fail_min: float = 0.70
    elongation_allow_max: float = 4.0
    elongation_fail_min: float = 7.0
    hand_overlap_min_allow: float = 0.05


@dataclass
class CaseConfig:
    """케이스별 설정"""
    case_type: CaseType
    description: str
    gates: GateConfig
    weights: WeightsConfig
    extras_handheld: ExtrasHandheldConfig


class BGQAConfig:
    """BGQA 설정 관리자"""

    def __init__(self, config_path: Optional[str] = None):
        if config_path is None:
            config_path = Path(__file__).parent / "config.yaml"

        self.config_path = Path(config_path)
        self.raw_config: Dict[str, Any] = {}
        self.cases: Dict[CaseType, CaseConfig] = {}

        self._load_config()
        self._parse_cases()

    def _load_config(self):
        """YAML 파일 로드"""
        if not self.config_path.exists():
            print(f"⚠️ Config file not found: {self.config_path}")
            self._use_defaults()
            return

        with open(self.config_path, 'r', encoding='utf-8') as f:
            self.raw_config = yaml.safe_load(f)

    def _use_defaults(self):
        """기본값 사용"""
        self.raw_config = {
            "version": "2.0",
            "cases": {
                "KID_PERSON": {"gates": {}, "weights": {}},
                "ADULT_PERSON": {"gates": {}, "weights": {}},
                "TOY_OBJECT": {"gates": {}, "weights": {}},
            }
        }

    def _parse_cases(self):
        """케이스별 설정 파싱"""
        cases_raw = self.raw_config.get("cases", {})
        extras_config = self.raw_config.get("extras_handheld_filter", {})

        for case_name, case_data in cases_raw.items():
            try:
                case_type = CaseType(case_name)
            except ValueError:
                print(f"⚠️ Unknown case type: {case_name}")
                continue

            # Gates 파싱
            gates_raw = case_data.get("gates", {})
            gates = GateConfig(
                area_min=gates_raw.get("area_min", 0.02),
                area_max=gates_raw.get("area_max", 0.90),
                require_face=gates_raw.get("require_face", case_type != CaseType.TOY_OBJECT),
                primary_face_coverage_min=gates_raw.get("primary_face_coverage_min", 0.995),
                secondary_face_coverage_min=gates_raw.get("secondary_face_coverage_min", 0.95),
                face_holes_area_ratio_max=gates_raw.get("face_holes_area_ratio_max", 0.001),
                residue_ratio_max_hard_fail=gates_raw.get("residue_ratio_max_hard_fail", 0.02),
                interior_low_alpha_threshold=gates_raw.get("interior_low_alpha_threshold", 0.98),
                interior_low_alpha_frac_max=gates_raw.get("interior_low_alpha_frac_max", 0.01),
                forbidden_extras_area_ratio_max_hard_fail=gates_raw.get(
                    "forbidden_extras_area_ratio_max_hard_fail", 0.005
                ),
            )

            # Weights 파싱
            weights_raw = case_data.get("weights", {})
            weights = WeightsConfig(
                roundtrip=weights_raw.get("roundtrip", 0.35),
                region_score=weights_raw.get("region_score", 0.18),
                halo_bleed=weights_raw.get("halo_bleed", 0.12),
                thin_structures=weights_raw.get("thin_structures", 0.12),
                edges=weights_raw.get("edges", 0.10),
                residue_fragmentation=weights_raw.get("residue_fragmentation", 0.08),
                alpha_transition=weights_raw.get("alpha_transition", 0.05),
                holes=weights_raw.get("holes", 0.0),
            )

            # Extras handheld 파싱
            component_analysis = extras_config.get("component_analysis", {}).get("features", {})
            extras = ExtrasHandheldConfig(
                enabled=extras_config.get("enabled", True),
                deny_classes=extras_config.get("object_detection", {}).get("deny_classes", []),
                allow_classes=extras_config.get("object_detection", {}).get("allow_classes", []),
                small_object_max_kid=component_analysis.get("area_ratio", {}).get("small_object_max_kid", 0.06),
                small_object_max_adult=component_analysis.get("area_ratio", {}).get("small_object_max_adult", 0.04),
                large_object_fail=component_analysis.get("area_ratio", {}).get("large_object_fail", 0.20),
                outside_ratio_allow_max=component_analysis.get("outside_ratio", {}).get("allow_max", 0.15),
                outside_ratio_fail_min=component_analysis.get("outside_ratio", {}).get("fail_min", 0.40),
                diag_ratio_allow_max=component_analysis.get("diag_ratio", {}).get("allow_max", 0.55),
                diag_ratio_fail_min=component_analysis.get("diag_ratio", {}).get("fail_min", 0.70),
                elongation_allow_max=component_analysis.get("elongation", {}).get("allow_max", 4.0),
                elongation_fail_min=component_analysis.get("elongation", {}).get("fail_min", 7.0),
                hand_overlap_min_allow=component_analysis.get("hand_overlap", {}).get("min_allow", 0.05),
            )

            self.cases[case_type] = CaseConfig(
                case_type=case_type,
                description=case_data.get("description", ""),
                gates=gates,
                weights=weights,
                extras_handheld=extras,
            )

    def get_case_config(self, case_type: CaseType) -> CaseConfig:
        """케이스별 설정 반환"""
        if case_type not in self.cases:
            # 기본값 반환
            return CaseConfig(
                case_type=case_type,
                description="Default config",
                gates=GateConfig(),
                weights=WeightsConfig(),
                extras_handheld=ExtrasHandheldConfig(),
            )
        return self.cases[case_type]

    def get_next_step_thresholds(self) -> Dict[str, int]:
        """다음 단계 결정 임계값"""
        next_step = self.raw_config.get("next_step", {})
        return {
            "ok_min_score": next_step.get("ok_min_score", 85),
            "run_refiner_min_score": next_step.get("run_refiner_min_score", 70),
            "run_fallback_api_min_score": next_step.get("run_fallback_api_min_score", 40),
            "below_fallback_request_new_input": next_step.get("below_fallback_request_new_input", 40),
        }

    def get_reason_string(self, code: str) -> str:
        """실패 사유 문자열"""
        reasons = self.raw_config.get("reason_strings", {})
        return reasons.get(code, f"Unknown reason: {code}")

    @property
    def version(self) -> str:
        return self.raw_config.get("version", "1.0")

    @property
    def is_deterministic(self) -> bool:
        return self.raw_config.get("project", {}).get("deterministic", True)

    @property
    def random_seed(self) -> int:
        return self.raw_config.get("project", {}).get("random_seed", 1337)


# 전역 설정 인스턴스
_config_instance: Optional[BGQAConfig] = None


def get_config() -> BGQAConfig:
    """전역 설정 인스턴스 반환"""
    global _config_instance
    if _config_instance is None:
        _config_instance = BGQAConfig()
    return _config_instance


def reload_config(config_path: Optional[str] = None) -> BGQAConfig:
    """설정 다시 로드"""
    global _config_instance
    _config_instance = BGQAConfig(config_path)
    return _config_instance


# 편의 함수
def get_case_config(case_type: CaseType) -> CaseConfig:
    """케이스별 설정 가져오기"""
    return get_config().get_case_config(case_type)


def is_person_case(case_type: CaseType) -> bool:
    """사람 케이스인지 확인"""
    return case_type in (CaseType.KID_PERSON, CaseType.ADULT_PERSON)


def is_object_case(case_type: CaseType) -> bool:
    """물체 케이스인지 확인"""
    return case_type == CaseType.TOY_OBJECT

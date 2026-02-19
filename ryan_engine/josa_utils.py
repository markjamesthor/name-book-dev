"""
JosaUtils - Korean Particle (조사) Processing Module
====================================================

Ryan Book Automation Engine의 핵심 한글 조사 처리 모듈.
Gigafactory(InDesign)와 Studio(React)의 로직을 Python으로 통합.

References:
- Gigafactory: hasJong() 함수 + (이/) 템플릿 패턴
- Studio: josa npm 패키지 + #{을} 템플릿 패턴
- ryan.html: JOSA_PAIRS 9가지 조사 쌍

Usage:
    from josa_utils import JosaUtils

    josa = JosaUtils()
    print(josa.with_josa("도현", "을를"))  # "도현을"
    print(josa.with_josa("예주", "을를"))  # "예주를"
"""

from typing import Dict, Optional, Tuple
from dataclasses import dataclass


@dataclass
class JosaPair:
    """조사 쌍을 나타내는 데이터 클래스"""
    with_batchim: str      # 받침 있을 때
    without_batchim: str   # 받침 없을 때


class JosaUtils:
    """
    한글 조사 처리 유틸리티 클래스

    9가지 조사 쌍을 지원하며, 의인화 모드(friend/object)에 따른
    사물 호칭 처리 기능 제공.
    """

    # 9가지 조사 쌍 정의 (ryan.html JOSA_PAIRS 기반)
    JOSA_PAIRS: Dict[str, JosaPair] = {
        # 주격 (이/가)
        'subjective': JosaPair('이', '가'),
        'i_ga': JosaPair('이', '가'),
        '이가': JosaPair('이', '가'),
        '가': JosaPair('이', '가'),

        # 목적격 (을/를)
        'objective': JosaPair('을', '를'),
        'eul_reul': JosaPair('을', '를'),
        '을를': JosaPair('을', '를'),
        '를': JosaPair('을', '를'),

        # 주제 (은/는)
        'topic_simple': JosaPair('은', '는'),
        '은는': JosaPair('은', '는'),
        '는': JosaPair('은', '는'),

        # 주격 강조 (이는/는) - "곰이는 사과는"
        'topic': JosaPair('이는', '는'),
        'i_neun': JosaPair('이는', '는'),

        # 목적격 강조 (이를/를) - Ryan책 핵심: "곰이를 좋아해"
        'objective_emphasis': JosaPair('이를', '를'),
        'i_reul': JosaPair('이를', '를'),

        # 소유격 (이의/의)
        'possessive': JosaPair('이의', '의'),
        'i_eui': JosaPair('이의', '의'),

        # 호칭 (아/야)
        'vocative': JosaPair('아', '야'),
        'a_ya': JosaPair('아', '야'),
        '아야': JosaPair('아', '야'),
        '야': JosaPair('아', '야'),

        # 서술격 존댓말 (이에요/예요)
        'copula_polite': JosaPair('이에요', '예요'),
        'ieyo_yeyo': JosaPair('이에요', '예요'),

        # 서술격 반말 (이야/야)
        'copula_casual': JosaPair('이야', '야'),
        'iya_ya': JosaPair('이야', '야'),

        # 공동격 (이네/네) - "곰이네 집"
        'collective': JosaPair('이네', '네'),
        'i_ne': JosaPair('이네', '네'),

        # 연결 (과/와)
        'and': JosaPair('과', '와'),
        '과와': JosaPair('과', '와'),
        '와': JosaPair('과', '와'),

        # 의인화용 접미사 (이/)
        'personify': JosaPair('이', ''),
        '이': JosaPair('이', ''),
    }

    # Gigafactory 스타일 템플릿 패턴 매핑
    TEMPLATE_PATTERNS: Dict[str, str] = {
        '(이/)': 'personify',
        '(이는/는)': 'topic',
        '(이를/를)': 'objective_emphasis',
        '(이의/의)': 'possessive',
        '(이가/가)': 'subjective',
        '(을/를)': 'objective',
        '(은/는)': 'topic_simple',
        '(아/야)': 'vocative',
        '(과/와)': 'and',
        '(이에요/예요)': 'copula_polite',
        '(이야/야)': 'copula_casual',
        '(이네/네)': 'collective',
    }

    # 한글 유니코드 범위
    HANGUL_START = 0xAC00
    HANGUL_END = 0xD7A3
    JONGSEONG_COUNT = 28  # 종성 개수

    def __init__(self):
        pass

    def has_jongseong(self, char: str) -> bool:
        """
        단일 문자의 종성(받침) 여부 확인

        Gigafactory hasJong() 함수 Python 포팅:
        (charCode - 0xAC00) % 28 > 0

        Args:
            char: 단일 한글 문자

        Returns:
            종성이 있으면 True, 없으면 False
        """
        if not char:
            return False

        code = ord(char)

        # 한글 유니코드 범위 확인
        if code < self.HANGUL_START or code > self.HANGUL_END:
            return False

        # 종성 인덱스 계산 (0이면 종성 없음)
        return (code - self.HANGUL_START) % self.JONGSEONG_COUNT != 0

    def has_batchim(self, word: str) -> bool:
        """
        단어의 마지막 글자에 받침이 있는지 확인

        Args:
            word: 한글 단어

        Returns:
            받침이 있으면 True, 없으면 False
        """
        if not word:
            return False

        last_char = word[-1]
        return self.has_jongseong(last_char)

    def get_josa(self, word: str, josa_type: str) -> str:
        """
        단어에 맞는 조사 반환

        Args:
            word: 한글 단어
            josa_type: 조사 타입 (예: 'subjective', '을를', 'vocative')

        Returns:
            적절한 조사 문자열
        """
        pair = self.JOSA_PAIRS.get(josa_type)
        if not pair:
            return ''

        return pair.with_batchim if self.has_batchim(word) else pair.without_batchim

    def with_josa(self, word: str, josa_type: str) -> str:
        """
        단어에 조사를 붙여서 반환

        Args:
            word: 한글 단어
            josa_type: 조사 타입

        Returns:
            단어 + 조사

        Examples:
            >>> josa.with_josa("도현", "을를")
            "도현을"
            >>> josa.with_josa("예주", "을를")
            "예주를"
        """
        return word + self.get_josa(word, josa_type)

    def personify_object(self, name: str) -> str:
        """
        사물 이름을 의인화 형태로 변환 (받침 있으면 -이 추가)

        ryan.html personifyObject() 함수 포팅:
        - 로봇 -> 로봇이
        - 곰 -> 곰이
        - 토끼 -> 토끼 (받침 없으면 그대로)

        Args:
            name: 사물 이름

        Returns:
            의인화된 이름
        """
        if self.has_batchim(name):
            return name + '이'
        return name

    def object_with_josa(self, name: str, josa_type: str, mode: str = 'friend') -> str:
        """
        사물에 조사 붙이기 (의인화 옵션 지원)

        Args:
            name: 사물 이름
            josa_type: 조사 타입
            mode: 'friend' (의인화) 또는 'object' (사물)

        Returns:
            사물 이름 + 조사

        Examples:
            >>> josa.object_with_josa("로봇", "를", "friend")
            "로봇이를"  # 의인화: 로봇 -> 로봇이 -> 로봇이를
            >>> josa.object_with_josa("로봇", "를", "object")
            "로봇을"    # 사물: 로봇 -> 로봇을
        """
        if mode == 'friend':
            # 의인화 모드: 받침 있는 이름은 -이를 붙여서 처리
            personified = self.personify_object(name)
            return self.with_josa(personified, josa_type)
        else:
            # 사물 모드: 그대로 조사 붙이기
            return self.with_josa(name, josa_type)

    def object_vocative(self, name: str, mode: str = 'friend') -> str:
        """
        사물 호칭 (부르는 말) 생성

        Args:
            name: 사물 이름
            mode: 'friend' (의인화) 또는 'object' (사물)

        Returns:
            호칭 형태

        Examples:
            >>> josa.object_vocative("로봇", "friend")
            "로봇아"   # 의인화: 로봇 -> 로봇이 -> 로봇이 + 야 -> 로봇이야? 아니, 로봇아
            >>> josa.object_vocative("토끼", "friend")
            "토끼야"   # 의인화: 토끼 -> 토끼 + 야
            >>> josa.object_vocative("로봇", "object")
            "로봇"     # 사물: 그냥 이름만
        """
        if mode == 'friend':
            # 의인화: 받침 있으면 "로봇아", 없으면 "토끼야"
            return self.with_josa(name, 'vocative')
        else:
            # 사물: 이름만
            return name

    def process_template(self, template: str, name: str) -> str:
        """
        Gigafactory 스타일 템플릿 처리

        템플릿 예시: "${firstName(이/)}" -> "도현" 또는 "예주"
                    "나는 ${toyPetName(을/를)} 좋아해" -> "나는 토끼를 좋아해"

        Args:
            template: 템플릿 변수 패턴 (예: "(이/)", "(을/를)")
            name: 대체할 이름

        Returns:
            처리된 문자열
        """
        josa_type = self.TEMPLATE_PATTERNS.get(template)
        if josa_type:
            return self.with_josa(name, josa_type)
        return name

    def generate_josa_demo(self, name: str) -> Dict:
        """
        조사 데모 생성 (ryan.html generateJosaDemo 포팅)

        프론트엔드에서 실시간 조사 미리보기에 사용

        Args:
            name: 이름

        Returns:
            조사 예시 딕셔너리
        """
        return {
            'name': name,
            'has_batchim': self.has_batchim(name),
            'examples': {
                'subjective': f"{self.with_josa(name, 'subjective')} 좋아!",
                'objective': f"{self.with_josa(name, 'objective')} 좋아해",
                'topic': f"{self.with_josa(name, 'topic')} 뭘 좋아해?",
                'objective_emphasis': f"{self.with_josa(name, 'objective_emphasis')} 좋아해",
                'possessive': f"{self.with_josa(name, 'possessive')} 사진",
                'vocative': f"{self.with_josa(name, 'vocative')}, 안녕!",
                'copula_polite': f"이건 {self.with_josa(name, 'copula_polite')}",
                'copula_casual': f"이건 {self.with_josa(name, 'copula_casual')}",
                'collective': f"{self.with_josa(name, 'collective')} 집",
            }
        }

    def apply_josa_to_text(self, text: str, variables: Dict[str, str]) -> str:
        """
        텍스트 내 변수에 조사 적용

        Gigafactory changeText() + ryanApplyKorFirstName() 패턴 통합

        텍스트 예시: "나는 {name:를} 좋아해" -> "나는 토끼를 좋아해"

        Args:
            text: 템플릿 텍스트
            variables: 변수명 -> 값 매핑

        Returns:
            조사가 적용된 텍스트
        """
        import re

        # {name:josa_type} 패턴 찾기
        pattern = r'\{(\w+):(\w+)\}'

        def replacer(match):
            var_name = match.group(1)
            josa_type = match.group(2)

            value = variables.get(var_name, '')
            if not value:
                return match.group(0)  # 변수 없으면 그대로

            return self.with_josa(value, josa_type)

        return re.sub(pattern, replacer, text)


# 모듈 레벨 편의 함수
_josa = JosaUtils()

def has_batchim(word: str) -> bool:
    """단어의 받침 여부 확인"""
    return _josa.has_batchim(word)

def get_josa(word: str, josa_type: str) -> str:
    """조사 반환"""
    return _josa.get_josa(word, josa_type)

def with_josa(word: str, josa_type: str) -> str:
    """단어 + 조사"""
    return _josa.with_josa(word, josa_type)

def personify_object(name: str) -> str:
    """사물 의인화"""
    return _josa.personify_object(name)

def object_with_josa(name: str, josa_type: str, mode: str = 'friend') -> str:
    """사물 + 조사 (의인화 옵션)"""
    return _josa.object_with_josa(name, josa_type, mode)

def object_vocative(name: str, mode: str = 'friend') -> str:
    """사물 호칭"""
    return _josa.object_vocative(name, mode)

def generate_josa_demo(name: str) -> Dict:
    """조사 데모 생성"""
    return _josa.generate_josa_demo(name)


if __name__ == '__main__':
    # 테스트
    josa = JosaUtils()

    print("=== 받침 테스트 ===")
    print(f"도현 받침: {josa.has_batchim('도현')}")  # True (ㄴ)
    print(f"예주 받침: {josa.has_batchim('예주')}")  # False
    print(f"토끼 받침: {josa.has_batchim('토끼')}")  # False
    print(f"로봇 받침: {josa.has_batchim('로봇')}")  # True (ㅅ)

    print("\n=== 조사 테스트 ===")
    print(f"도현 + 을/를: {josa.with_josa('도현', '을를')}")  # 도현을
    print(f"예주 + 을/를: {josa.with_josa('예주', '을를')}")  # 예주를
    print(f"도현 + 아/야: {josa.with_josa('도현', '야')}")    # 도현아
    print(f"예주 + 아/야: {josa.with_josa('예주', '야')}")    # 예주야

    print("\n=== 의인화 테스트 ===")
    print(f"로봇 friend: {josa.object_vocative('로봇', 'friend')}")  # 로봇아
    print(f"토끼 friend: {josa.object_vocative('토끼', 'friend')}")  # 토끼야
    print(f"로봇 object: {josa.object_vocative('로봇', 'object')}")  # 로봇

    print("\n=== 조사 데모 ===")
    import json
    print(json.dumps(josa.generate_josa_demo('도현'), ensure_ascii=False, indent=2))

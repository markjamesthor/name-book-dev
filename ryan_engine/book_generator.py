"""
BookGenerator - Ryan Book Automation Engine
============================================

ryan.html의 generateStoryBoard()를 Python 클래스로 구현.
Gigafactory/Studio 패턴을 참고하여 확장성 있는 구조로 설계.

Usage:
    from book_generator import BookGenerator

    generator = BookGenerator('themes/theme_ryan.json')
    book_spec = generator.generate(user_data)
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict

from .josa_utils import JosaUtils


@dataclass
class FavoriteObject:
    """좋아하는 사물/캐릭터"""
    name: str
    photo: Optional[str] = None
    photo_no_bg: Optional[str] = None
    emoji: str = "❓"
    josa_mode: str = "friend"  # 'friend' or 'object'


@dataclass
class FamilyMember:
    """가족 구성원"""
    id: str
    relation: str
    emoji: str
    photo: Optional[str] = None
    custom_name: Optional[str] = None  # 호칭 커스텀 (예: "아빠" -> "아빵")


@dataclass
class ChildInfo:
    """아이 정보"""
    first_name: str
    last_name: str = ""
    full_name: str = ""
    gender: str = "boy"  # 'boy' or 'girl'
    birthday: Optional[str] = None
    photo: Optional[str] = None
    photo_no_bg: Optional[str] = None


@dataclass
class UserData:
    """사용자 입력 데이터 (전체)"""
    child: ChildInfo
    objects: List[FavoriteObject] = field(default_factory=list)
    family_members: List[FamilyMember] = field(default_factory=list)


@dataclass
class PageContent:
    """페이지 콘텐츠"""
    text: str = ""
    speech_bubble: Optional[str] = None
    exclamation: Optional[str] = None
    visual: Optional[str] = None
    highlight: bool = False
    is_secret: bool = False
    is_question: bool = False
    is_answer: bool = False


@dataclass
class ImagePlacement:
    """이미지 배치 정보"""
    type: str  # 'child', 'object', 'family', 'emoji'
    path: Optional[str] = None
    emoji: Optional[str] = None
    position: str = "center"
    size: str = "medium"
    name: Optional[str] = None


@dataclass
class PageData:
    """페이지 데이터"""
    page_number: int
    page_type: str
    content: PageContent
    images: List[ImagePlacement] = field(default_factory=list)
    layout: Optional[Dict] = None


@dataclass
class FamilyLayout:
    """가족 레이아웃 정보"""
    type: str
    columns: int
    rows: int
    per_page: int


@dataclass
class BookSpec:
    """최종 책 스펙 (final_book_spec.json 구조)"""
    theme_id: str
    child_name: str
    child_full_name: str
    created_at: str
    pages: List[PageData]
    family_layout: Optional[FamilyLayout]
    metadata: Dict[str, Any] = field(default_factory=dict)


class BookGenerator:
    """
    Ryan Book 자동 생성기

    테마 설정(JSON)을 기반으로 사용자 데이터를 받아
    완전한 책 스펙(final_book_spec.json)을 생성합니다.
    """

    def __init__(self, theme_path: str):
        """
        Args:
            theme_path: 테마 JSON 파일 경로
        """
        self.theme = self._load_theme(theme_path)
        self.josa = JosaUtils()

    def _load_theme(self, theme_path: str) -> Dict:
        """테마 설정 파일 로드"""
        path = Path(theme_path)

        # 절대 경로가 아니면 여러 위치 시도
        if not path.is_absolute():
            # 1. 현재 작업 디렉토리 기준
            cwd_path = Path.cwd() / theme_path
            # 2. 모듈 디렉토리 기준
            module_path = Path(__file__).parent / theme_path
            # 3. 상위 디렉토리 기준 (ryan_engine이 이미 포함된 경로일 경우)
            parent_path = Path(__file__).parent.parent / theme_path

            for candidate in [path, cwd_path, module_path, parent_path]:
                if candidate.exists():
                    path = candidate
                    break

        if not path.exists():
            raise FileNotFoundError(f"테마 파일을 찾을 수 없습니다: {theme_path}")

        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def generate(self, user_data: UserData) -> BookSpec:
        """
        책 스펙 생성

        Args:
            user_data: 사용자 입력 데이터

        Returns:
            완성된 책 스펙 (BookSpec)
        """
        pages = []

        for page_config in self.theme['pageStructure']:
            page_data = self._generate_page(page_config, user_data)
            pages.append(page_data)

        family_layout = self._calculate_family_layout(len(user_data.family_members))

        return BookSpec(
            theme_id=self.theme['themeId'],
            child_name=user_data.child.first_name,
            child_full_name=user_data.child.full_name or f"{user_data.child.last_name}{user_data.child.first_name}",
            created_at=datetime.now().isoformat(),
            pages=pages,
            family_layout=family_layout,
            metadata={
                'theme_name': self.theme['themeName'],
                'version': self.theme.get('version', '1.0.0'),
                'object_count': len(user_data.objects),
                'family_count': len(user_data.family_members),
            }
        )

    def generate_from_dict(self, data: Dict) -> BookSpec:
        """
        딕셔너리에서 책 스펙 생성 (API 호출용)

        Args:
            data: 사용자 데이터 딕셔너리

        Returns:
            완성된 책 스펙
        """
        user_data = self._parse_user_data(data)
        return self.generate(user_data)

    def _parse_user_data(self, data: Dict) -> UserData:
        """딕셔너리를 UserData로 변환"""
        child_data = data.get('child', {})
        child = ChildInfo(
            first_name=child_data.get('firstName', child_data.get('first_name', '아이')),
            last_name=child_data.get('lastName', child_data.get('last_name', '')),
            full_name=child_data.get('fullName', child_data.get('full_name', '')),
            gender=child_data.get('gender', 'boy'),
            birthday=child_data.get('birthday'),
            photo=child_data.get('photo'),
            photo_no_bg=child_data.get('photoNoBg', child_data.get('photo_no_bg')),
        )

        objects = []
        for obj_data in data.get('objects', []):
            objects.append(FavoriteObject(
                name=obj_data.get('name', '물건'),
                photo=obj_data.get('photo'),
                photo_no_bg=obj_data.get('photoNoBg', obj_data.get('photo_no_bg')),
                emoji=obj_data.get('emoji', '❓'),
                josa_mode=obj_data.get('josaMode', obj_data.get('josa_mode', 'friend')),
            ))

        family_members = []
        for fam_data in data.get('familyMembers', data.get('family_members', [])):
            family_members.append(FamilyMember(
                id=fam_data.get('id', ''),
                relation=fam_data.get('relation', '가족'),
                emoji=fam_data.get('emoji', '👤'),
                photo=fam_data.get('photo'),
                custom_name=fam_data.get('customName', fam_data.get('custom_name')),
            ))

        return UserData(child=child, objects=objects, family_members=family_members)

    def _generate_page(self, page_config: Dict, user_data: UserData) -> PageData:
        """단일 페이지 생성"""
        page_type = page_config['type']
        page_number = page_config['page']

        content = PageContent()
        images: List[ImagePlacement] = []
        layout = None

        child_name = user_data.child.first_name
        objects = user_data.objects
        family = user_data.family_members

        # 페이지 타입별 콘텐츠 생성
        if page_type == 'title':
            content = self._generate_title_page(user_data)

        elif page_type == 'intro':
            content, images = self._generate_intro_page(user_data)

        elif page_type == 'chain_question':
            chain_idx = page_config.get('chainIndex', 0)
            content, images = self._generate_chain_question(user_data, chain_idx)

        elif page_type == 'chain_answer':
            chain_idx = page_config.get('chainIndex', 0)
            content, images = self._generate_chain_answer(user_data, chain_idx)

        elif page_type == 'climax_question':
            content, images = self._generate_climax_question(user_data)

        elif page_type == 'climax_heart':
            content = PageContent(
                text=self.theme['textTemplates'].get('climax_heart', '두근두근...'),
                visual='heart'
            )

        elif page_type == 'child_reveal':
            content, images = self._generate_child_reveal(user_data)

        elif page_type == 'all_together':
            content, images = self._generate_all_together(user_data)

        elif page_type == 'family_intro':
            content = self._generate_family_intro(user_data)

        elif page_type in ('family_grid', 'family_grid_2'):
            page_idx = 0 if page_type == 'family_grid' else 1
            content, images, layout = self._generate_family_grid(user_data, page_idx)

        elif page_type in ('child_loves_family', 'child_loves_family_2'):
            content, images = self._generate_child_loves_family(user_data)

        elif page_type == 'who_best':
            content, images = self._generate_who_best(user_data)

        elif page_type == 'secret':
            content = self._generate_secret(user_data)

        elif page_type in ('character_intro', 'character_intro_2'):
            content, images = self._generate_character_intro(user_data)

        elif page_type == 'credits':
            content = self._generate_credits(user_data)

        return PageData(
            page_number=page_number,
            page_type=page_type,
            content=content,
            images=images,
            layout=layout
        )

    # ==========================================
    # 페이지별 콘텐츠 생성 메서드
    # ==========================================

    def _generate_title_page(self, user_data: UserData) -> PageContent:
        """표지 페이지"""
        if user_data.objects:
            obj = user_data.objects[0]
            obj_with_josa = self.josa.object_with_josa(obj.name, '를', obj.josa_mode)
            text = f"나는 {obj_with_josa} 좋아해"
        else:
            text = "나는 이것을 좋아해"

        return PageContent(text=text)

    def _generate_intro_page(self, user_data: UserData) -> tuple:
        """인트로 페이지"""
        child_name = user_data.child.first_name
        question = f"{self.josa.with_josa(child_name, 'vocative')},\n너는 뭘 좋아해?"

        if user_data.objects:
            obj = user_data.objects[0]
            obj_with_josa = self.josa.object_with_josa(obj.name, '를', obj.josa_mode)
            speech = f"나는 {obj_with_josa} 좋아해!"
        else:
            speech = "나는 이것을 좋아해!"

        content = PageContent(text=question, speech_bubble=speech)

        images = []
        photo = user_data.child.photo_no_bg or user_data.child.photo
        if photo:
            images.append(ImagePlacement(type='child', path=photo, position='center'))
        else:
            images.append(ImagePlacement(type='emoji', emoji='👶', position='center'))

        return content, images

    def _generate_chain_question(self, user_data: UserData, chain_idx: int) -> tuple:
        """연쇄 반응 - 질문 페이지"""
        objects = user_data.objects

        if chain_idx < len(objects):
            obj = objects[chain_idx]
            vocative = self.josa.object_vocative(obj.name, obj.josa_mode)
            text = f"{vocative},\n너는 뭘 좋아해?"

            images = []
            photo = obj.photo_no_bg or obj.photo
            if photo:
                images.append(ImagePlacement(type='object', path=photo, name=obj.name))
            else:
                images.append(ImagePlacement(type='emoji', emoji=obj.emoji, name=obj.name))
        else:
            text = "너는 뭘 좋아해?"
            images = []

        content = PageContent(text=text, is_question=True)
        return content, images

    def _generate_chain_answer(self, user_data: UserData, chain_idx: int) -> tuple:
        """연쇄 반응 - 대답 페이지"""
        objects = user_data.objects
        child_name = user_data.child.first_name

        if chain_idx < len(objects):
            answerer = objects[chain_idx]

            # 다음 타겟 결정 (마지막이면 아이)
            is_last = chain_idx >= len(objects) - 1
            if is_last:
                # 마지막 물건 -> 아이
                target_with_josa = self.josa.with_josa(child_name, '를')
            else:
                # 다음 물건
                target = objects[chain_idx + 1]
                target_with_josa = self.josa.object_with_josa(target.name, '를', target.josa_mode)

            text = f"나는 {target_with_josa} 좋아해."

            images = []
            photo = answerer.photo_no_bg or answerer.photo
            if photo:
                images.append(ImagePlacement(type='object', path=photo, name=answerer.name))
            else:
                images.append(ImagePlacement(type='emoji', emoji=answerer.emoji, name=answerer.name))
        else:
            text = "나는 너를 좋아해."
            images = []

        content = PageContent(text=text, is_answer=True)
        return content, images

    def _generate_climax_question(self, user_data: UserData) -> tuple:
        """클라이맥스 질문 페이지"""
        if user_data.objects:
            last_obj = user_data.objects[-1]
            obj_with_josa = self.josa.object_with_josa(last_obj.name, '는', last_obj.josa_mode)
            text = f"그럼 {obj_with_josa}\n뭘 제일 좋아하냐면..."

            images = []
            photo = last_obj.photo_no_bg or last_obj.photo
            if photo:
                images.append(ImagePlacement(type='object', path=photo, name=last_obj.name))
            else:
                images.append(ImagePlacement(type='emoji', emoji=last_obj.emoji))
        else:
            text = "뭘 제일 좋아하냐면..."
            images = []

        content = PageContent(text=text)
        return content, images

    def _generate_child_reveal(self, user_data: UserData) -> tuple:
        """아이 등장 페이지"""
        child_name = user_data.child.first_name
        text = f"바로 {child_name}!"

        images = []
        photo = user_data.child.photo_no_bg or user_data.child.photo
        if photo:
            images.append(ImagePlacement(type='child', path=photo, position='center', size='large'))
        else:
            images.append(ImagePlacement(type='emoji', emoji='👶', position='center', size='large'))

        content = PageContent(text=text, highlight=True)
        return content, images

    def _generate_all_together(self, user_data: UserData) -> tuple:
        """모두 함께 페이지"""
        content = PageContent(text="모두 함께!")

        images = []
        # 아이
        child_photo = user_data.child.photo_no_bg or user_data.child.photo
        if child_photo:
            images.append(ImagePlacement(type='child', path=child_photo))
        # 모든 물건들
        for obj in user_data.objects:
            photo = obj.photo_no_bg or obj.photo
            if photo:
                images.append(ImagePlacement(type='object', path=photo, name=obj.name))
            else:
                images.append(ImagePlacement(type='emoji', emoji=obj.emoji, name=obj.name))

        return content, images

    def _generate_family_intro(self, user_data: UserData) -> PageContent:
        """가족 등장 인트로"""
        child_name = user_data.child.first_name
        text = f"우리도 {self.josa.with_josa(child_name, '를')} 좋아해!"
        return PageContent(text=text, exclamation="잠깐만!")

    def _generate_family_grid(self, user_data: UserData, page_idx: int) -> tuple:
        """가족 그리드 페이지"""
        family = user_data.family_members
        family_layout = self._calculate_family_layout(len(family))

        start_idx = page_idx * family_layout.per_page
        end_idx = min(start_idx + family_layout.per_page, len(family))
        members_for_page = family[start_idx:end_idx]

        content = PageContent(text="")

        images = []
        for member in members_for_page:
            name = member.custom_name or member.relation
            if member.photo:
                images.append(ImagePlacement(type='family', path=member.photo, name=name))
            else:
                images.append(ImagePlacement(type='emoji', emoji=member.emoji, name=name))

        layout = {
            'type': family_layout.type,
            'columns': family_layout.columns,
            'rows': family_layout.rows,
            'members': [
                {'id': m.id, 'relation': m.custom_name or m.relation, 'emoji': m.emoji}
                for m in members_for_page
            ]
        }

        return content, images, layout

    def _generate_child_loves_family(self, user_data: UserData) -> tuple:
        """아이가 가족을 좋아한다는 페이지"""
        family = user_data.family_members

        if family:
            relations = [m.custom_name or m.relation for m in family]
            relations_text = ', '.join(relations)
            # 마지막 가족 구성원 호칭에 맞춰 조사
            last_relation = relations[-1]
            text = f"나도 {relations_text}{self.josa.get_josa(last_relation, '를')} 좋아해!"
        else:
            text = "나도 가족을 좋아해!"

        images = []
        child_photo = user_data.child.photo_no_bg or user_data.child.photo
        if child_photo:
            images.append(ImagePlacement(type='child', path=child_photo))

        content = PageContent(text=text)
        return content, images

    def _generate_who_best(self, user_data: UserData) -> tuple:
        """누가 제일 좋아? 페이지"""
        content = PageContent(text="누가 제일 좋아?")

        images = []
        child_photo = user_data.child.photo_no_bg or user_data.child.photo
        if child_photo:
            images.append(ImagePlacement(type='child', path=child_photo))

        return content, images

    def _generate_secret(self, user_data: UserData) -> PageContent:
        """비밀 페이지"""
        child_name = user_data.child.first_name
        text = f"비밀인데...\n{self.josa.with_josa(child_name, '가')} 제일 좋아하는 건\n바로 너야!"
        return PageContent(text=text, is_secret=True)

    def _generate_character_intro(self, user_data: UserData) -> tuple:
        """등장인물 소개 페이지"""
        content = PageContent(text="등장인물 소개")

        images = []
        for obj in user_data.objects:
            photo = obj.photo_no_bg or obj.photo
            if photo:
                images.append(ImagePlacement(type='object', path=photo, name=obj.name))
            else:
                images.append(ImagePlacement(type='emoji', emoji=obj.emoji, name=obj.name))

        return content, images

    def _generate_credits(self, user_data: UserData) -> PageContent:
        """크레딧 페이지"""
        child_name = user_data.child.first_name
        text = f"{child_name}의 특별한 이야기"
        return PageContent(text=text)

    def _calculate_family_layout(self, member_count: int) -> FamilyLayout:
        """가족 수에 따른 레이아웃 계산"""
        if member_count <= 2:
            return FamilyLayout(type='1x2', columns=2, rows=1, per_page=2)
        elif member_count <= 4:
            return FamilyLayout(type='2x2', columns=2, rows=2, per_page=4)
        elif member_count <= 6:
            return FamilyLayout(type='2x3', columns=3, rows=2, per_page=6)
        else:
            return FamilyLayout(type='3x3', columns=3, rows=3, per_page=9)

    def to_json(self, book_spec: BookSpec, indent: int = 2) -> str:
        """BookSpec을 JSON 문자열로 변환"""
        def convert(obj):
            if isinstance(obj, (PageData, PageContent, ImagePlacement, FamilyLayout, BookSpec)):
                return {k: convert(v) for k, v in asdict(obj).items()}
            elif isinstance(obj, list):
                return [convert(item) for item in obj]
            elif isinstance(obj, dict):
                return {k: convert(v) for k, v in obj.items()}
            return obj

        return json.dumps(convert(book_spec), ensure_ascii=False, indent=indent)

    def save_spec(self, book_spec: BookSpec, output_path: str):
        """BookSpec을 JSON 파일로 저장"""
        json_str = self.to_json(book_spec)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(json_str)


if __name__ == '__main__':
    # 테스트
    import os

    # 테스트 데이터
    test_data = {
        'child': {
            'firstName': '도현',
            'lastName': '김',
            'fullName': '김도현',
            'gender': 'boy',
            'birthday': '2020-01-01',
            'photo': 'ryan_test_images/0_도현.JPG',
        },
        'objects': [
            {'name': '토끼', 'emoji': '🐰', 'josaMode': 'friend', 'photo': 'ryan_test_images/1_토끼.jpeg'},
            {'name': '토마토', 'emoji': '🍅', 'josaMode': 'object', 'photo': 'ryan_test_images/2_토마토.jpeg'},
            {'name': '사과가 쿵', 'emoji': '🍎', 'josaMode': 'object', 'photo': 'ryan_test_images/3_사과가 쿵.jpeg'},
            {'name': '엄마 아이폰', 'emoji': '📱', 'josaMode': 'object', 'photo': 'ryan_test_images/4_엄마 아이폰.jpeg'},
        ],
        'familyMembers': [
            {'id': 'mom', 'relation': '엄마', 'emoji': '👩'},
            {'id': 'dad', 'relation': '아빠', 'emoji': '👨'},
        ],
    }

    # 책 생성
    theme_path = os.path.join(os.path.dirname(__file__), 'themes', 'theme_ryan.json')
    generator = BookGenerator(theme_path)
    book_spec = generator.generate_from_dict(test_data)

    # JSON 출력
    print("=== Generated Book Spec ===")
    print(generator.to_json(book_spec))

    # 일부 페이지 확인
    print("\n=== Page Samples ===")
    for page in book_spec.pages[:5]:
        print(f"Page {page.page_number} ({page.page_type}): {page.content.text[:50]}...")

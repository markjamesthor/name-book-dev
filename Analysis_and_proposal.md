# Studio 프로젝트 분석 및 JSON 기반 아키텍처 제안

## 1. 현재 코드 분석

### 1.1 현재 구조의 장점

현재 코드는 생각보다 **잘 설계되어 있습니다**:

```
src/features/Form/
├── books/           # 책별 폼 (abc, bday, cat, home, ryan)
├── components/      # 공통 컴포넌트 (이미 잘 분리됨)
├── validation/      # 공통 validation (commonFormSchemaBy)
├── types/           # 공통 타입 (CommonFormValues)
└── utils/           # 유틸리티 함수들
```

- `commonFormSchemaBy(bookType)` - 공통 검증 로직 이미 존재
- `PersonalInfoFields` - 공통 개인정보 필드 이미 분리
- `AuthorFields`, `DeliveryGuide`, `ImageExample` - 재사용 컴포넌트 존재
- `imageSchema(bookType)` - 이미지 검증 스키마 공통화

### 1.2 실제 중복 패턴

| 요소 | ABC | BDAY | CAT | HOME | RYAN |
|------|-----|------|-----|------|------|
| PersonalInfoFields | ✅ | ✅ | ✅ | ✅ | ✅ |
| AuthorFields | ✅ | ✅ | ✅ | ✅ | ✅ |
| DeliveryGuide | ✅ | ✅ | ✅ | ✅ | ✅ |
| ImageExample | ✅ | ✅ | ✅ | ✅ | ✅ |
| Letter | ❌ | ✅ | ❌ | ✅ | ❌ |
| SentenceTypeSelect | ❌ | ✅ | ❌ | ✅ | ❌ |

### 1.3 책별 고유 필드

```typescript
// ABC 전용
title_position, cover_color, favourite_thing_images (알파벳 중복 체크)

// BDAY 전용  
birthdate, age_on_content, chinese_zodiac, letter

// CAT 전용
family_member, cat_type, common_traits[], child_traits[]

// HOME 전용
family_type, theme, letter, favourite_thing_images (josa + story 연동)

// RYAN 전용
cover_title, back_cover_image_name, favourite_thing_images, family_images
```

### 1.4 진짜 복잡한 부분 (JSON화 어려움)

1. **HOME의 StorySelect**: 한국어 조사(josa) 동적 생성
2. **ABC의 알파벳 검증**: 같은 알파벳 3개 이상 금지
3. **조건부 UI**: `Collapse` 내 필드 (HOME의 josa 선택 후 story 선택)
4. **필드 간 연동**: favourite_thing_images 내의 story가 서로 중복 불가

---

## 2. 현실적인 JSON 기반 접근법

### 2.1 핵심 원칙

**Gemini 제안의 문제점:**
- 모든 것을 JSON화하려 함 → 복잡한 로직을 JSON으로 표현 불가
- `any` 타입 남발 → TypeScript 사용 의미 상실
- 핵심 구현 생략 → 실제 적용 불가

**현실적 접근:**
- JSON은 **"무엇을"** 정의 (필드 목록, 기본값, 간단한 검증)
- 코드는 **"어떻게"** 구현 (복잡한 검증, 조건부 로직, 비즈니스 로직)

### 2.2 권장하는 JSON 스키마

```typescript
// types/book-config.ts
export type FieldType = 
  | 'text' 
  | 'select' 
  | 'radio' 
  | 'toggle' 
  | 'date'
  | 'textarea'
  | 'image_select'    // 이미지로 보여주는 선택
  | 'color_select'    // 색상 선택
  | 'trait_select'    // 특성 선택 (multi)
  | 'dynamic_array'   // 동적 배열 필드
  | 'custom';         // 커스텀 컴포넌트 필요

export interface FieldConfig {
  id: string;
  type: FieldType;
  label: string;
  
  // 선택적
  required?: boolean;
  defaultValue?: any;
  options?: Array<{ value: string; label: string }>;
  optionsI18nKey?: string;  // i18n에서 옵션 로드
  imageKey?: string;        // 이미지 표시용
  
  // 검증 (간단한 것만)
  validation?: {
    maxLength?: number;
    minLength?: number;
    pattern?: string;
    oneOf?: string[];
  };
  
  // 조건부 렌더링
  showWhen?: {
    field: string;
    value: any;
  };
  
  // 커스텀 컴포넌트가 필요한 경우
  customComponent?: string;  // 컴포넌트 이름
  customProps?: Record<string, any>;
}

export interface StepConfig {
  id: string;
  title?: string;
  titleI18nKey?: string;
  fields: FieldConfig[];
}

export interface BookConfig {
  bookId: BookType;
  title: string;
  titleI18nKey: string;
  steps: StepConfig[];
  
  // 이 책에만 적용되는 커스텀 검증
  customValidation?: string[];  // 검증 함수 이름들
  
  // 이미지 설정
  images: {
    kidImages: ImageConfig[];
    favouriteImages: ImageConfig[];
    familyImages?: ImageConfig[];
  };
}
```

---

## 3. 각 책의 JSON 설정

### 3.1 ABC 책

```json
{
  "bookId": "ABC",
  "titleI18nKey": "book.title.abc",
  "customValidation": ["validateAlphabetDuplication"],
  
  "steps": [
    {
      "id": "basic_info",
      "titleI18nKey": "form.title.basic_info",
      "fields": [
        { "id": "personal_info", "type": "custom", "customComponent": "PersonalInfoFields" }
      ]
    },
    {
      "id": "customization",
      "fields": [
        {
          "id": "title_position",
          "type": "toggle",
          "label": "제목 위치",
          "options": [
            { "value": "left", "label": "왼쪽" },
            { "value": "top", "label": "위" }
          ],
          "defaultValue": "left"
        },
        {
          "id": "cover_color",
          "type": "color_select",
          "label": "표지 색상",
          "optionsI18nKey": "image:form.abc_cover_colors",
          "required": true,
          "validation": { "oneOf": ["pink", "blue", "mint", "papaya"] }
        },
        {
          "id": "favourite_thing_images",
          "type": "dynamic_array",
          "label": "좋아하는 것들",
          "customComponent": "ImageNameFields",
          "customProps": {
            "minItems": 1,
            "maxItems": 10,
            "imageType": "alphabet"
          }
        }
      ]
    },
    {
      "id": "author",
      "fields": [
        { "id": "author_fields", "type": "custom", "customComponent": "AuthorFields" }
      ]
    }
  ],
  
  "images": {
    "kidImages": [
      { "order": 1, "type": "kid", "posture": "torso" }
    ],
    "favouriteImages": {
      "type": "alphabet",
      "defaultCount": 4
    }
  }
}
```

### 3.2 BDAY 책

```json
{
  "bookId": "BDAY",
  "titleI18nKey": "book.title.bday",
  
  "steps": [
    {
      "id": "basic_info",
      "fields": [
        { "id": "personal_info", "type": "custom", "customComponent": "PersonalInfoFields" }
      ]
    },
    {
      "id": "birthday",
      "fields": [
        {
          "id": "birthdate",
          "type": "date",
          "label": "생년월일",
          "required": true,
          "customComponent": "Birthdate"
        },
        {
          "id": "sentence_type",
          "type": "radio",
          "label": "문구 길이",
          "imageKey": "image:form.bday_sentence",
          "options": [
            { "value": "short", "label": "0~6세 추천 글밥" },
            { "value": "long", "label": "7세 이상 추천 글밥" }
          ],
          "defaultValue": "short"
        },
        {
          "id": "chinese_zodiac",
          "type": "select",
          "label": "띠",
          "required": true,
          "options": [
            { "value": "mouse", "label": "쥐" },
            { "value": "cow", "label": "소" },
            { "value": "tiger", "label": "호랑이" },
            { "value": "rabbit", "label": "토끼" },
            { "value": "dragon", "label": "용" },
            { "value": "snake", "label": "뱀" },
            { "value": "horse", "label": "말" },
            { "value": "sheep", "label": "양" },
            { "value": "monkey", "label": "원숭이" },
            { "value": "chicken", "label": "닭" },
            { "value": "dog", "label": "개" },
            { "value": "pig", "label": "돼지" }
          ]
        },
        {
          "id": "letter",
          "type": "textarea",
          "label": "편지 내용",
          "required": true,
          "validation": { "maxLength": 300 },
          "customComponent": "Letter",
          "customProps": { "imageKey": "image:form.bday_letter" }
        }
      ]
    },
    {
      "id": "author",
      "fields": [
        { "id": "author_fields", "type": "custom", "customComponent": "AuthorFields" }
      ]
    }
  ],
  
  "images": {
    "kidImages": [],
    "favouriteImages": []
  }
}
```

### 3.3 CAT 책

```json
{
  "bookId": "CAT",
  "titleI18nKey": "book.title.cat",
  
  "steps": [
    {
      "id": "basic_info",
      "fields": [
        { "id": "personal_info", "type": "custom", "customComponent": "PersonalInfoFields" }
      ]
    },
    {
      "id": "cat_settings",
      "fields": [
        {
          "id": "cat_type",
          "type": "image_select",
          "label": "고양이 종류",
          "required": true,
          "optionsI18nKey": "image:form.cat_types",
          "validation": { "oneOf": ["blue", "red", "white", "black"] }
        },
        {
          "id": "family_member",
          "type": "radio",
          "label": "가족 구성원",
          "required": true,
          "options": [
            { "value": "mom", "label": "엄마" },
            { "value": "dad", "label": "아빠" },
            { "value": "grandpa", "label": "할아버지" },
            { "value": "grandma", "label": "할머니" }
          ]
        },
        {
          "id": "common_traits",
          "type": "trait_select",
          "label": "공통 특성",
          "customComponent": "CommonTraitSelect",
          "customProps": { "count": 3 }
        },
        {
          "id": "child_traits",
          "type": "trait_select",
          "label": "아이 특성",
          "customComponent": "ChildTraitSelect",
          "customProps": { "count": 2 }
        }
      ]
    },
    {
      "id": "author",
      "fields": [
        { "id": "author_fields", "type": "custom", "customComponent": "AuthorFields" }
      ]
    }
  ],
  
  "images": {
    "kidImages": [
      { "order": 1, "type": "kid", "posture": "torso" },
      { "order": 2, "type": "kid", "posture": "full_body" }
    ],
    "favouriteImages": { "type": "favourite", "defaultCount": 3 },
    "familyImages": { "type": "family", "defaultCount": 1 }
  }
}
```

### 3.4 HOME 책 (가장 복잡함)

```json
{
  "bookId": "HOME",
  "titleI18nKey": "book.title.home",
  "customValidation": ["validateJosa", "validateDuplicateNames"],
  
  "steps": [
    {
      "id": "basic_info",
      "fields": [
        { "id": "personal_info", "type": "custom", "customComponent": "PersonalInfoFields" }
      ]
    },
    {
      "id": "family_settings",
      "fields": [
        {
          "id": "family_type",
          "type": "image_select",
          "label": "가족 구성원",
          "required": true,
          "optionsI18nKey": "individual:form.options.home_family_types",
          "imageKey": "image:form.home_family",
          "validation": { "oneOf": ["parents", "single_mother", "single_father", "grandparents"] }
        },
        {
          "id": "theme",
          "type": "radio",
          "label": "테마",
          "required": true,
          "options": [
            { "value": "original", "label": "오리지널" },
            { "value": "xmas", "label": "크리스마스" }
          ],
          "defaultValue": "original"
        },
        {
          "id": "sentence_type",
          "type": "radio",
          "label": "문구 길이",
          "imageKey": "image:form.bday_sentence",
          "options": [
            { "value": "short", "label": "0~6세 추천 글밥" },
            { "value": "long", "label": "7세 이상 추천 글밥" }
          ],
          "defaultValue": "short"
        }
      ]
    },
    {
      "id": "favourites",
      "fields": [
        {
          "id": "first_favourite",
          "type": "custom",
          "customComponent": "FirstFavourite"
        },
        {
          "id": "story_select_1",
          "type": "custom",
          "customComponent": "StorySelect",
          "customProps": { "itemIndex": 1 }
        },
        {
          "id": "story_select_2",
          "type": "custom",
          "customComponent": "StorySelect",
          "customProps": { "itemIndex": 2 }
        },
        {
          "id": "story_select_3",
          "type": "custom",
          "customComponent": "StorySelect",
          "customProps": { "itemIndex": 3 }
        },
        {
          "id": "letter",
          "type": "textarea",
          "label": "편지 내용",
          "required": true,
          "validation": { "maxLength": 300 },
          "customComponent": "Letter",
          "customProps": { "imageKey": "image:form.home_letter" }
        }
      ]
    },
    {
      "id": "author",
      "fields": [
        { "id": "author_fields", "type": "custom", "customComponent": "AuthorFields" }
      ]
    }
  ],
  
  "images": {
    "kidImages": [
      { "order": 1, "posture": "torso" },
      { "order": 2, "posture": "full_body" },
      { "order": 3, "posture": "full_body" }
    ],
    "favouriteImages": { "type": "favourite", "defaultCount": 4 }
  }
}
```

### 3.5 RYAN 책

```json
{
  "bookId": "RYAN",
  "titleI18nKey": "book.title.ryan",
  "customValidation": ["validateDuplicateNames"],
  
  "steps": [
    {
      "id": "basic_info",
      "fields": [
        { "id": "personal_info", "type": "custom", "customComponent": "PersonalInfoFields" }
      ]
    },
    {
      "id": "names",
      "fields": [
        {
          "id": "family_names",
          "type": "custom",
          "customComponent": "FamilyNameFields"
        },
        {
          "id": "favourite_names",
          "type": "custom",
          "customComponent": "FavouriteNameFields"
        },
        {
          "id": "cover_title",
          "type": "text",
          "label": "표지 제목",
          "required": true,
          "customComponent": "CoverTitleField"
        },
        {
          "id": "back_cover_image_name",
          "type": "image_select",
          "label": "뒷표지 이미지",
          "required": true,
          "customComponent": "BackCoverImageSelect"
        }
      ]
    },
    {
      "id": "author",
      "fields": [
        { "id": "author_fields", "type": "custom", "customComponent": "AuthorFields" }
      ]
    }
  ],
  
  "images": {
    "kidImages": [
      { "order": 1, "type": "kid", "posture": "torso" },
      { "order": 2, "type": "kid", "posture": "full_body" }
    ],
    "favouriteImages": { "type": "favourite", "defaultCount": 4 },
    "familyImages": { "type": "family", "defaultCount": 4 }
  }
}
```

---

## 4. 실제 구현 코드

### 4.1 타입 정의 (완전한 타입 안전성)

```typescript
// src/features/Form/config/types.ts
import { BookType, ImageType, PostureType } from 'src/types';

export type FieldType = 
  | 'text' 
  | 'select' 
  | 'radio' 
  | 'toggle' 
  | 'date'
  | 'textarea'
  | 'image_select'
  | 'color_select'
  | 'trait_select'
  | 'dynamic_array'
  | 'custom';

export interface ValidationConfig {
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  oneOf?: string[];
}

export interface FieldConfig {
  id: string;
  type: FieldType;
  label?: string;
  labelI18nKey?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ value: string; label: string }>;
  optionsI18nKey?: string;
  imageKey?: string;
  validation?: ValidationConfig;
  showWhen?: {
    field: string;
    value: unknown;
  };
  customComponent?: string;
  customProps?: Record<string, unknown>;
}

export interface StepConfig {
  id: string;
  title?: string;
  titleI18nKey?: string;
  fields: FieldConfig[];
}

export interface ImageConfig {
  order?: number;
  type: ImageType;
  posture?: PostureType;
  defaultCount?: number;
}

export interface BookConfig {
  bookId: BookType;
  titleI18nKey: string;
  customValidation?: string[];
  steps: StepConfig[];
  images: {
    kidImages: ImageConfig[];
    favouriteImages: ImageConfig | ImageConfig[];
    familyImages?: ImageConfig | ImageConfig[];
  };
}

// 책 타입별 설정 맵
export type BookConfigMap = {
  [K in BookType]?: BookConfig;
};
```

### 4.2 컴포넌트 레지스트리

```typescript
// src/features/Form/config/component-registry.ts
import { lazy, ComponentType } from 'react';

// 공통 컴포넌트
import PersonalInfoFields from '../components/PersonalInfoFields';
import AuthorFields from '../components/AuthorFields';
import Letter from '../components/Letter';

// 책별 커스텀 컴포넌트 - lazy loading
const componentMap: Record<string, ComponentType<any>> = {
  // 공통
  PersonalInfoFields,
  AuthorFields,
  Letter,
  
  // ABC
  CoverColorSelect: lazy(() => import('../books/abc/TextForm/CoverColorSelect')),
  TitlePositionSelect: lazy(() => import('../books/abc/TextForm/TitlePositionSelect')),
  ImageNameFields: lazy(() => import('../books/abc/TextForm/ImageNameFields')),
  
  // BDAY
  Birthdate: lazy(() => import('../books/bday/TextForm/Birthdate')),
  ZodiacSelect: lazy(() => import('../books/bday/TextForm/ZodiacSelect')),
  SentenceTypeSelect: lazy(() => import('../books/bday/TextForm/SentenceTypeSelect')),
  
  // CAT
  CatTypeSelect: lazy(() => import('../books/cat/TextForm/CatTypeSelect')),
  FamilyMemberSelect: lazy(() => import('../books/cat/TextForm/FamilyMemeberSelect')),
  CommonTraitSelect: lazy(() => import('../books/cat/TextForm/CommonTraitSelect')),
  ChildTraitSelect: lazy(() => import('../books/cat/TextForm/ChildTraitSelect')),
  
  // HOME
  FamilyType: lazy(() => import('../books/home/TextForm/FamilyType')),
  ThemeTypeSelect: lazy(() => import('../books/home/TextForm/ThemeTypeSelect')),
  FirstFavourite: lazy(() => import('../books/home/TextForm/FirstFavourite')),
  StorySelect: lazy(() => import('../books/home/TextForm/StorySelect')),
  
  // RYAN
  FamilyNameFields: lazy(() => import('../books/ryan/TextForm/FamilyNameFields')),
  FavouriteNameFields: lazy(() => import('../books/ryan/TextForm/FavouriteNameFields')),
  CoverTitleField: lazy(() => import('../books/ryan/TextForm/CoverTitleField')),
  BackCoverImageSelect: lazy(() => import('../books/ryan/TextForm/BackCoverImageSelect')),
};

export function getComponent(name: string): ComponentType<any> | null {
  return componentMap[name] ?? null;
}

export function registerComponent(name: string, component: ComponentType<any>) {
  componentMap[name] = component;
}
```

### 4.3 검증 함수 레지스트리

```typescript
// src/features/Form/config/validation-registry.ts
import * as Yup from 'yup';
import { BookType, ImageItem } from 'src/types';

type ValidationFactory = (bookType: BookType) => Yup.Schema<any>;

const validationMap: Record<string, ValidationFactory> = {
  // ABC: 알파벳 중복 체크 (같은 알파벳 3개 이상 금지)
  validateAlphabetDuplication: () => 
    Yup.array().of(
      Yup.object().test(
        'alphabet-duplicate',
        '동일한 알파벳을 3개 이상 사용할 수 없어요',
        function (image, context) {
          const { parent } = context;
          const table = new Map<string, number>();
          
          parent.forEach((img: ImageItem) => {
            const alphabet = img.name.slice(0, 1).toUpperCase();
            table.set(alphabet, (table.get(alphabet) || 0) + 1);
          });
          
          for (const count of table.values()) {
            if (count > 2) return false;
          }
          return true;
        }
      )
    ),

  // 중복 이름 체크 (ABC, HOME, RYAN 공통)
  validateDuplicateNames: () =>
    Yup.array().of(
      Yup.object().test(
        'duplicate-check',
        '중복된 이름은 사용할 수 없어요',
        function (image, context) {
          const { parent } = context;
          const names = parent.map((img: ImageItem) => img.name);
          const currentName = (image as ImageItem).name;
          return names.filter((n: string) => n === currentName).length <= 1;
        }
      )
    ),

  // HOME: 조사 검증
  validateJosa: () =>
    Yup.object().shape({
      josa: Yup.string().test(
        'validate-josa',
        '호칭을 선택해주세요',
        function (josaifiedName, context) {
          const { parent } = context;
          if (parent.order === 1) return true; // 첫 번째 아이템은 검증 안함
          
          const name = parent.name;
          if (!josaifiedName) return false;
          if (josaifiedName.includes(name)) return true;
          
          const isSpecificJosa = josaifiedName.slice(-1) === '아';
          if (isSpecificJosa) {
            return name.includes(josaifiedName.slice(0, -1));
          }
          return false;
        }
      ),
    }),
};

export function getValidation(name: string): ValidationFactory | null {
  return validationMap[name] ?? null;
}

export function registerValidation(name: string, factory: ValidationFactory) {
  validationMap[name] = factory;
}
```

### 4.4 폼 렌더러 (핵심 엔진)

```typescript
// src/features/Form/config/FormRenderer.tsx
import React, { Suspense, useMemo } from 'react';
import { Form, Formik, validateYupSchema, yupToFormErrors } from 'formik';
import { Box, CircularProgress } from '@material-ui/core';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import throttle from 'lodash/throttle';
import debounce from 'lodash/debounce';
import * as Yup from 'yup';
import dayjs from 'dayjs';

import { commonFormSchemaBy } from 'src/features/Form/validation';
import { getCurrentBook } from 'src/store/selectors/book';
import { useDispatch, useSelector } from 'src/store';
import { updateUserInput } from 'src/store/slices';
import { FirebaseApi, MainApi } from 'src/api';
import ErrorFocus from '../components/ErrorFocus';
import DeliveryGuide from '../components/DeliveryGuide';
import ImageExample from '../components/ImageExample';
import BarButton from 'src/components/BarButton';
import Page from 'src/components/Page';

import { BookConfig, FieldConfig } from './types';
import { getComponent } from './component-registry';
import { getValidation } from './validation-registry';
import { buildInitialValues } from './utils/build-initial-values';
import { buildValidationSchema } from './utils/build-validation-schema';
import { FieldRenderer } from './FieldRenderer';

interface FormRendererProps {
  config: BookConfig;
}

export function FormRenderer({ config }: FormRendererProps) {
  const history = useHistory();
  const dispatch = useDispatch();
  const book = useSelector(getCurrentBook);
  const { t } = useTranslation('individual');
  
  const { data, type: bookType } = book;

  // 1. 초기값 생성
  const initialValues = useMemo(
    () => buildInitialValues(config, data, t),
    [config, data]
  );

  // 2. 검증 스키마 생성
  const validationSchema = useMemo(
    () => buildValidationSchema(config, bookType),
    [config, bookType]
  );

  // 3. 제출 핸들러
  const handleOnSubmit = useMemo(
    () => throttle(async (values: any) => {
      const update = {
        ...book.data,
        ...values,
        book_id: book.id,
        order_id: book.order_id,
        age: parseInt(values.age),
        full_name: values.last_name + values.first_name,
        images: [
          ...(values.kid_images || []),
          ...(values.favourite_thing_images || []),
          ...(values.family_images || []),
        ],
      };

      dispatch(updateUserInput(update));
      await MainApi.updateForm(update);
      history.push(`/app/studio/preview?id=${book.id}`, { id: book.id });
    }, 1000),
    [book]
  );

  // 4. 자동 저장
  const sendRequestToDB = useMemo(
    () => debounce(async (values: any) => {
      const update = {
        ...book.data,
        ...values,
        book_id: book.id,
        order_id: book.order_id,
        age: parseInt(values.age),
        print_date: dayjs(values.print_date).format('YYYY-MM-DD'),
      };

      dispatch(updateUserInput(update));
      await FirebaseApi.updateForm(update);
    }, 1000),
    []
  );

  // 5. 검증 핸들러
  const handleValidate = async (values: any) => {
    try {
      sendRequestToDB(values);
      await validateYupSchema(values, validationSchema);
      return {};
    } catch (error) {
      return yupToFormErrors(error);
    }
  };

  return (
    <Page title="Edit Text" height="100%">
      <DeliveryGuide />
      <ImageExample
        images={t('image:guide_example', { bookType, returnObjects: true })}
      />

      <Formik
        validate={handleValidate}
        validateOnBlur
        validateOnChange={false}
        initialValues={initialValues}
        onSubmit={handleOnSubmit}
      >
        {({ values, errors, isSubmitting }) => (
          <Form>
            <Suspense fallback={<CircularProgress />}>
              {config.steps.map((step) => (
                <Box key={step.id}>
                  {step.fields.map((field) => (
                    <FieldRenderer
                      key={field.id}
                      config={field}
                      values={values}
                      bookType={bookType}
                    />
                  ))}
                </Box>
              ))}
            </Suspense>

            <Box className="footer">
              <BarButton type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <CircularProgress size={20} />
                ) : (
                  t('form.button.next')
                )}
              </BarButton>
            </Box>
            <ErrorFocus />
          </Form>
        )}
      </Formik>
    </Page>
  );
}
```

### 4.5 필드 렌더러

```typescript
// src/features/Form/config/FieldRenderer.tsx
import React, { Suspense } from 'react';
import { Field } from 'formik';
import { TextField, RadioGroup } from 'formik-material-ui';
import { ToggleButtonGroup } from 'formik-material-ui-lab';
import { FormControlLabel, Radio, CircularProgress } from '@material-ui/core';
import { useTranslation } from 'react-i18next';

import PageSection from 'src/components/PageSection';
import PageSectionTitle from 'src/components/PageSectionTitle';
import { FieldConfig } from './types';
import { getComponent } from './component-registry';
import { BookTypes } from 'src/types';

interface FieldRendererProps {
  config: FieldConfig;
  values: any;
  bookType: BookTypes;
}

export function FieldRenderer({ config, values, bookType }: FieldRendererProps) {
  const { t } = useTranslation('individual');

  // 조건부 렌더링 체크
  if (config.showWhen) {
    const { field, value } = config.showWhen;
    if (values[field] !== value) {
      return null;
    }
  }

  // 커스텀 컴포넌트
  if (config.type === 'custom' && config.customComponent) {
    const Component = getComponent(config.customComponent);
    if (!Component) {
      console.warn(`Component not found: ${config.customComponent}`);
      return null;
    }

    return (
      <Suspense fallback={<CircularProgress size={20} />}>
        <Component
          {...config.customProps}
          bookType={bookType}
          value={values[config.id]}
        />
      </Suspense>
    );
  }

  const label = config.labelI18nKey ? t(config.labelI18nKey) : config.label;

  // 기본 필드 타입들
  switch (config.type) {
    case 'text':
      return (
        <PageSection>
          {label && <PageSectionTitle>{label}</PageSectionTitle>}
          <Field
            name={config.id}
            component={TextField}
            variant="outlined"
            fullWidth
          />
        </PageSection>
      );

    case 'textarea':
      return (
        <PageSection>
          {label && <PageSectionTitle>{label}</PageSectionTitle>}
          <Field
            name={config.id}
            component={TextField}
            variant="outlined"
            multiline
            rows={4}
            fullWidth
          />
        </PageSection>
      );

    case 'select':
      const options = config.optionsI18nKey
        ? t(config.optionsI18nKey, { returnObjects: true }) as Array<{ value: string; label: string }>
        : config.options || [];

      return (
        <PageSection>
          {label && <PageSectionTitle>{label}</PageSectionTitle>}
          <Field
            name={config.id}
            component={TextField}
            variant="outlined"
            select
            SelectProps={{ native: true }}
            fullWidth
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Field>
        </PageSection>
      );

    case 'radio':
      const radioOptions = config.optionsI18nKey
        ? t(config.optionsI18nKey, { returnObjects: true }) as Array<{ value: string; label: string }>
        : config.options || [];

      return (
        <PageSection>
          {label && <PageSectionTitle>{label}</PageSectionTitle>}
          <Field name={config.id} component={RadioGroup}>
            {radioOptions.map((opt) => (
              <FormControlLabel
                key={opt.value}
                value={opt.value}
                control={<Radio color="primary" />}
                label={opt.label}
              />
            ))}
          </Field>
        </PageSection>
      );

    default:
      console.warn(`Unknown field type: ${config.type}`);
      return null;
  }
}
```

### 4.6 유틸리티 함수들

```typescript
// src/features/Form/config/utils/build-initial-values.ts
import dayjs from 'dayjs';
import { TFunction } from 'i18next';
import { BookConfig } from '../types';
import { UserInputData, ImageItem, BookType, ImageType, PostureType } from 'src/types';
import createImageData from 'src/features/Form/utils/createImageData';
import generateDefaultImages from 'src/features/Form/utils/generateDefaultImages';
import getImageBy from 'src/features/Form/utils/getImageBy';

export function buildInitialValues(
  config: BookConfig,
  data: UserInputData,
  t: TFunction
): Record<string, any> {
  const values: Record<string, any> = {
    // 공통 필드
    first_name: data.first_name ?? '',
    last_name: data.last_name ?? '',
    gender: data.gender ?? 'male',
    age: data.age?.toString() ?? '1',
    author: data.author ?? '',
    print_date: dayjs(data.print_date).isValid()
      ? data.print_date
      : t('form.placeholder.today', { date: new Date() }),
  };

  // 각 필드의 기본값 설정
  config.steps.forEach((step) => {
    step.fields.forEach((field) => {
      if (field.defaultValue !== undefined && values[field.id] === undefined) {
        values[field.id] = field.defaultValue;
      }
    });
  });

  // 이미지 초기값
  const bookType = config.bookId;
  
  // Kid images
  if (config.images.kidImages.length > 0) {
    const defaultKidImages = config.images.kidImages.map((img) =>
      createImageData({
        order: img.order || 1,
        type: img.type || ImageType.kid,
        book_type: bookType,
        posture: img.posture,
      })
    );
    values.kid_images = getImageBy(ImageType.kid, data.images, defaultKidImages);
  }

  // Favourite images
  const favConfig = config.images.favouriteImages;
  if (favConfig) {
    const defaultCount = Array.isArray(favConfig) 
      ? favConfig.length 
      : (favConfig as any).defaultCount || 4;
    const favType = Array.isArray(favConfig) 
      ? favConfig[0]?.type 
      : (favConfig as any).type || ImageType.favourite;
    
    const defaultFavImages = generateDefaultImages(defaultCount, {
      type: favType,
      book_type: bookType,
    });
    values.favourite_thing_images = getImageBy(favType, data.images, defaultFavImages);
  }

  // Family images (optional)
  if (config.images.familyImages) {
    const famConfig = config.images.familyImages;
    const defaultCount = Array.isArray(famConfig) 
      ? famConfig.length 
      : (famConfig as any).defaultCount || 1;
    
    const defaultFamImages = generateDefaultImages(defaultCount, {
      type: ImageType.family,
      book_type: bookType,
    });
    values.family_images = getImageBy(ImageType.family, data.images, defaultFamImages);
  } else {
    values.family_images = [];
  }

  // 책별 특수 필드 초기값
  switch (bookType) {
    case BookType.ABC:
      values.title_position = data.title_position ?? 'left';
      values.cover_color = data.cover_color ?? 'pink';
      break;
    case BookType.BDAY:
      values.sentence_type = data.sentence_type ?? 'short';
      values.birthdate = data.birthdate ?? t('form.placeholder.today', { date: new Date() });
      values.age_on_content = data.age_on_content?.toString() ?? '1';
      values.chinese_zodiac = data.chinese_zodiac ?? 'mouse';
      values.letter = data.letter ?? t('form.default_value.bday_letter');
      break;
    case BookType.CAT:
      values.cat_type = data.cat_type ?? 'red';
      values.family_member = data.family_member ?? 'mom';
      values.common_traits = data.common_traits ?? ['', '', ''];
      values.child_traits = data.child_traits ?? ['', ''];
      break;
    case BookType.HOME:
      values.sentence_type = data.sentence_type ?? 'short';
      values.letter = data.letter ?? t('form.default_value.home_letter');
      values.theme = data.theme ?? 'original';
      values.family_type = data.family_type ?? 'parents';
      break;
    case BookType.RYAN:
      values.cover_title = data.cover_title ?? '';
      values.back_cover_image_name = data.back_cover_image_name ?? '';
      break;
  }

  return values;
}
```

```typescript
// src/features/Form/config/utils/build-validation-schema.ts
import * as Yup from 'yup';
import { BookConfig } from '../types';
import { BookTypes } from 'src/types';
import { commonFormSchemaBy, imageSchema } from 'src/features/Form/validation';
import { getValidation } from '../validation-registry';

export function buildValidationSchema(
  config: BookConfig,
  bookType: BookTypes
): Yup.Schema<any> {
  // 기본 스키마
  let schema = commonFormSchemaBy(bookType);

  // 각 필드의 간단한 검증 추가
  const shape: Record<string, Yup.Schema<any>> = {};

  config.steps.forEach((step) => {
    step.fields.forEach((field) => {
      if (field.validation) {
        let fieldSchema = Yup.string();

        if (field.required) {
          fieldSchema = fieldSchema.required(`${field.label}은(는) 필수입니다.`);
        }
        if (field.validation.maxLength) {
          fieldSchema = fieldSchema.max(
            field.validation.maxLength,
            `최대 ${field.validation.maxLength}자까지 입력 가능합니다.`
          );
        }
        if (field.validation.oneOf) {
          fieldSchema = fieldSchema.oneOf(field.validation.oneOf);
        }

        shape[field.id] = fieldSchema;
      }
    });
  });

  // 커스텀 검증 추가
  if (config.customValidation) {
    config.customValidation.forEach((validationName) => {
      const validationFactory = getValidation(validationName);
      if (validationFactory) {
        // 커스텀 검증을 적절한 필드에 적용
        // (실제 구현 시 필드 이름과 매핑 필요)
      }
    });
  }

  return schema.shape(shape);
}
```

---

## 5. 사용 예시

### 5.1 설정 파일 로드

```typescript
// src/features/Form/config/index.ts
import { BookType } from 'src/types';
import { BookConfig, BookConfigMap } from './types';

// JSON 파일들을 import
import abcConfig from './books/abc.json';
import bdayConfig from './books/bday.json';
import catConfig from './books/cat.json';
import homeConfig from './books/home.json';
import ryanConfig from './books/ryan.json';

export const bookConfigs: BookConfigMap = {
  [BookType.ABC]: abcConfig as BookConfig,
  [BookType.BDAY]: bdayConfig as BookConfig,
  [BookType.CAT]: catConfig as BookConfig,
  [BookType.HOME]: homeConfig as BookConfig,
  [BookType.RYAN]: ryanConfig as BookConfig,
};

export function getBookConfig(bookType: BookType): BookConfig | null {
  return bookConfigs[bookType] ?? null;
}
```

### 5.2 실제 사용

```typescript
// src/features/Form/TextFormPage.tsx
import React from 'react';
import { useSelector } from 'react-redux';
import { Redirect } from 'react-router-dom';

import { getCurrentBook } from 'src/store/selectors/book';
import { getBookConfig } from './config';
import { FormRenderer } from './config/FormRenderer';

export function TextFormPage() {
  const book = useSelector(getCurrentBook);
  
  if (!book) {
    return <Redirect to="/app/studio/home/individual" />;
  }

  const config = getBookConfig(book.type);
  
  if (!config) {
    return <div>지원하지 않는 책 타입입니다: {book.type}</div>;
  }

  return <FormRenderer config={config} />;
}
```

---

## 6. 마이그레이션 전략

### 6.1 점진적 접근 (권장)

**Phase 1: 인프라 구축 (1주)**
- [ ] 타입 정의 파일 생성
- [ ] 컴포넌트 레지스트리 구현
- [ ] 검증 레지스트리 구현
- [ ] 기본 FieldRenderer 구현

**Phase 2: 가장 간단한 책부터 시작 (1주)**
- [ ] BDAY 책 JSON 설정 작성
- [ ] BDAY 책 FormRenderer로 전환
- [ ] 테스트 및 버그 수정

**Phase 3: 복잡한 책으로 확장 (2주)**
- [ ] ABC 책 (알파벳 중복 체크)
- [ ] CAT 책 (특성 선택)
- [ ] HOME 책 (조사 처리) - 가장 복잡
- [ ] RYAN 책

**Phase 4: 기존 코드 정리 (1주)**
- [ ] 기존 TextForm 컴포넌트 삭제
- [ ] 라우팅 통합
- [ ] 문서화

### 6.2 병렬 실행 전략

마이그레이션 중에는 두 시스템을 병렬로 운영:

```typescript
// src/features/Form/index.tsx
const FormRoutes: Routes = [
  // 새로운 통합 라우트
  {
    exact: true,
    path: '/text/:bookType',
    component: lazy(() => import('./TextFormPage')),
  },
  
  // 기존 라우트 (점진적으로 제거)
  {
    exact: true,
    path: '/text/abc-legacy',
    component: lazy(() => import('./books/abc/TextForm')),
  },
  // ...
];
```

---

## 7. Gemini 제안과의 비교

| 항목 | Gemini 제안 | 이 제안 |
|------|------------|--------|
| 타입 안전성 | `any` 남발 | 완전한 TypeScript 타입 |
| 복잡한 로직 | `// ...` 생략 | 구체적 구현 제공 |
| 커스텀 컴포넌트 | 미고려 | `custom` 타입 + 레지스트리 |
| 검증 로직 | 단순화 | 레지스트리 패턴으로 확장 가능 |
| 마이그레이션 | 한번에 전환 | 점진적 전환 |
| 기존 코드 재사용 | 전면 재작성 | 기존 컴포넌트 재사용 |

---

## 8. 결론

### 이 접근법의 핵심 원칙

1. **JSON은 "무엇을" 선언** - 필드 목록, 기본값, 간단한 검증
2. **코드는 "어떻게" 구현** - 복잡한 검증, 조건부 로직, 비즈니스 로직
3. **기존 컴포넌트 재사용** - 이미 잘 작동하는 컴포넌트는 그대로 사용
4. **점진적 마이그레이션** - 한 번에 모든 것을 바꾸지 않음

### 실제 코드 삭제 가능한 부분

- 각 책의 `TextForm/index.tsx` 내 중복 코드:
  - Formik 설정 (약 50줄)
  - handleOnSubmit (약 15줄)
  - sendRequestToDB (약 15줄)
  - handleError (약 10줄)
  
- 예상 삭제 코드량: **각 책당 약 100줄** = 총 **약 500줄**

### 남겨야 할 부분

- 각 책의 커스텀 컴포넌트 (CoverColorSelect, StorySelect 등)
- 복잡한 검증 로직 (알파벳 중복, 조사 검증)
- 비즈니스 로직이 포함된 UI 컴포넌트

이 접근법은 Gemini의 "이상적인" 제안보다 **현실적이고, 점진적이며, 실제로 작동**합니다.
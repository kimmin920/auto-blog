아래 입력의 posts를 분석해 output.schema에 맞는 JSON만 출력하라.

[입력]
{{INPUT_JSON}}

[추출해야 할 내용(예시)]
- writing_rules.length_policy: 글 길이(문자수) 성향을 추정하여 target/min/max를 제시
- writing_rules.sentence_style: 문장 길이, 문단 길이(1~2문장 등), 이모지/특수기호/질문/감탄 사용 빈도
- writing_rules.sentence_style.ending_style_summary: 말끝/종결어미 전반 요약(예: 해요체 중심 + 간헐적 반말)
- writing_rules.sentence_style.honorific_mix: 존댓말/반말/한다체 혼용 양상과 대략 비율
- writing_rules.sentence_style.casual_suffix_patterns: "~함/~옴/~삼" 같은 축약 종결 패턴 목록
- writing_rules.sentence_style.ending_switch_context: 어떤 문맥에서 말투가 바뀌는지 규칙
- writing_rules.formatting: 줄바꿈 밀도, 소제목 사용 습관, 볼드/인용 스타일
- writing_rules.structure: 글의 전개 방식, CTA(댓글/이웃/질문 등) 스타일
- lexicon: 자주 쓰는 표현/톤 키워드/피해야 할 표현
- lexicon 필수 키(없으면 빈 배열): frequent_phrases, favorite_phrases, tone_keywords, avoid_phrases, portable_style_signals, domain_locked_tokens
- lexicon.portable_style_signals: 주제가 바뀌어도 유지되는 스타일 신호(말투/마커/리듬)
- lexicon.domain_locked_tokens: 특정 주제/산업에 묶인 단어(브랜드명, 제품명, 스펙 용어 등)
- banned_phrases: 기계적인 상투어구 등
- signature_rules:
  - parenthetical_aside: 괄호 속 짧은 개인 코멘트 습관(min_count + examples)
  - relief_phrase: 해소형 표현(candidates + exact_count + placement_hint)
  - recommend_phrase: 추천/권유 짧은 표현(candidates + exact_count + placement_hint)
- style_examples.user_samples: 실제 발췌(30~120자) + 왜 중요한지
  - 최소 8개, 최대 12개
  - 가능하면 source_url별 최소 3개 이상 분산
  - 도입/감정/정보/질문/팁/목록/CTA 유형이 고르게 포함되도록 추출
  - JSON 조각({, }, :)이나 "undefined"/빈 문자열은 금지
  - why_it_matters는 "문체 이유"로 작성하고 특정 브랜드/상품 설명으로 쓰지 말 것
- confidence: overall + signals + limitations

반드시 JSON만 출력하라.

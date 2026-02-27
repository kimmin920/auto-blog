아래 입력 JSON을 바탕으로 output.schema에 맞는 JSON만 출력하라.
(입력의 정보만 활용, 없는 사실은 placeholders 사용)

[입력]
{{INPUT_JSON}}

[작성 규칙 추가]
- plan/outlines를 새로 만들지 말고, must_include_sections 내용을 서사 흐름 안에 자연스럽게 모두 포함하라.
- inputs.structured_info의 내용을 우선 사용해 글의 디테일을 채워라.
- inputs.imagesMeta 길이가 n이면 markdown에 [사진 1]..[사진 n]을 반드시 삽입하라.
- 각 [사진 N] anchor는 markdown에 정확히 1회만 등장해야 하며, 범위를 벗어난 anchor는 금지한다.
- image_plan도 n개를 생성하고 각 항목의 slot/anchor를 1:1로 맞춰라.
- imagesMeta의 subject/highlight/feeling을 바탕으로 이미지를 자연스럽게 언급하라.
- n=0이면 markdown에서 [사진 N] anchor를 모두 제거하고 image_plan은 []로 반환하라.
- hashtags는 8~15개, 모두 #으로 시작, 공백 없이.
- title_suggestions는 5개를 생성하라.
- 제목은 SEO(키워드 자연 반영) + 사용자 스타일(말투/톤) 기준으로 추천하라.
- title_suggestions는 markdown 본문과 중복 문장 나열이 아니라 실제 블로그 제목 후보로 작성하라.
- 입력에 없는 사실(영업시간/세부 시설/가격/주변 평가 등)을 임의로 단정하지 마라.
- content_options.writing_preference를 따라 서사 문단 비중을 높여라(문단 70%+, 리스트 30%-).
- 템플릿성 라벨("한줄 요약", "총평(짧게)")은 사용하지 마라.
- style_examples의 고유명사/도메인 단어를 그대로 가져오지 말고 현재 주제(맛집/외식)에 맞는 단어로 작성하라.
- style_guide.signature_rules가 존재하면 min_count/exact_count/placement_hint를 반드시 지켜라.
- anchor([사진 N])는 일반 서술 문단 끝에만 1회 배치하고, 목록/TIP/헤더/괄호/해시태그 영역에는 넣지 마라.

반드시 JSON만 출력하라.

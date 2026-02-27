import { enforceMinimumUserSamples } from "../src/skills/inferStyleGuide.js";

describe("enforceMinimumUserSamples", () => {
  it("expands sparse samples to at least 8 with source diversity when possible", () => {
    const seedSamples = [
      {
        source_url: "https://blog/a",
        excerpt: "와 진짜 기대 없이 갔는데 첫입부터 너무 만족스러웠어요!",
        why_it_matters: "감탄형 도입으로 후기 톤을 만든다.",
      },
      {
        source_url: "https://blog/b",
        excerpt: "위치가 좋아서 이동 동선이 아주 편하다는 점이 장점이었습니다.",
        why_it_matters: "정보형 설명 문장을 보여준다.",
      },
      {
        source_url: "https://blog/c",
        excerpt: "혹시 비슷한 메뉴 추천 있으면 댓글로 알려주세요 :)",
        why_it_matters: "질문형 CTA 패턴을 보여준다.",
      },
    ];

    const posts = [
      {
        source_url: "https://blog/a",
        content_text:
          "와 진짜 기대 없이 갔는데 첫입부터 너무 만족스러웠어요! 메뉴가 나오자마자 향이 확 올라와서 사진부터 찍게 되더라고요.\n\n1. 기본 반찬 구성도 깔끔하고 리필 속도가 빨랐습니다.\n\n주차는 근처 공용주차장을 이용했고, 대기 시간은 10분 정도였어요.\n\n다음에는 다른 메뉴도 도전해볼 생각입니다. 비슷한 곳 아시면 댓글로 공유 부탁드려요!",
      },
      {
        source_url: "https://blog/b",
        content_text:
          "위치가 좋아서 이동 동선이 아주 편하다는 점이 장점이었습니다. 입구가 넓어서 유모차 이동도 수월했어요.\n\n2. 대표 메뉴는 국물 맛이 깊고 끝맛이 깔끔해서 재방문 생각이 났습니다.\n\nTIP: 피크타임 직전 방문하면 대기 시간이 줄어듭니다. 사진 포인트는 창가 테이블 쪽 조명이 좋았어요.",
      },
      {
        source_url: "https://blog/c",
        content_text:
          "처음엔 사람이 많아 보였는데 회전이 빨라서 생각보다 금방 앉았습니다. 서비스 응대가 친절해서 식사 내내 편했어요.\n\n3. 사이드 메뉴 조합은 메인과 함께 주문하면 만족도가 높았습니다.\n\n정리하면 맛, 응대, 접근성 모두 괜찮았고 다음에도 갈 의사가 있어요. 여러분은 어떤 조합이 제일 좋았나요?",
      },
    ];

    const out = enforceMinimumUserSamples({ samples: seedSamples, posts });
    expect(out.length).toBeGreaterThanOrEqual(8);
    expect(out.length).toBeLessThanOrEqual(12);

    const bySource = out.reduce((acc, item) => {
      const key = item.source_url;
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());

    expect((bySource.get("https://blog/a") || 0)).toBeGreaterThanOrEqual(3);
    expect((bySource.get("https://blog/b") || 0)).toBeGreaterThanOrEqual(3);
    expect((bySource.get("https://blog/c") || 0)).toBeGreaterThanOrEqual(3);
  });
});

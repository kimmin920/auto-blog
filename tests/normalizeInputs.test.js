import { normalizeInputs } from "../src/skills/normalizeInputs.js";

describe("normalizeInputs", () => {
  it("handles undefined keywords/imagesMeta and partial structuredInfo", () => {
    const out = normalizeInputs({
      blogType: "info",
      keywords: undefined,
      title: "테스트",
      structuredInfo: { visit_context: { who_with: "친구" } },
      imagesMeta: undefined,
    });

    expect(out.keywords).toEqual([]);
    expect(out.imagesMeta).toEqual([]);
    expect(out.structuredInfo.visit_context.who_with).toBe("친구");
    expect(out.structuredInfo.location_info).toBeUndefined();
  });

  it("maps mediaMeta-like inputs to photo-only imagesMeta", () => {
    const out = normalizeInputs({
      blogType: "review",
      keywords: "안성맛집,평택맛집",
      title: "테스트",
      structuredInfo: {},
      imagesMeta: [
        {
          slot: "PHOTO_1",
          type: "image",
          description: "외관",
          highlights: ["간판", "주차장"],
          mood: "cozy",
        },
        {
          slot: "VIDEO_1",
          type: "video",
          description: "전골 끓는 영상",
        },
      ],
    });

    expect(out.imagesMeta).toHaveLength(1);
    expect(out.imagesMeta[0].slot).toBe("PHOTO_1");
    expect(out.imagesMeta[0].subject).toBe("외관");
    expect(out.imagesMeta[0].highlight).toContain("간판");
    expect(out.imagesMeta[0].feeling).toBe("cozy");
  });
});

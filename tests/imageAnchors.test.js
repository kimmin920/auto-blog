import { validateOutput } from "../src/skills/validateOutput.js";

describe("image anchor and plan validation", () => {
  it("passes when 2 images have 2 anchors and 2 image_plan entries", () => {
    const json = {
      markdown: "도입입니다. [사진 1] 본문입니다. [사진 2] 마무리입니다.",
      hashtags: ["#테스트"],
      image_plan: [
        {
          slot: "PHOTO_1",
          anchor: "[사진 1]",
          subject: "외관",
          suggested_caption: "외관 컷이 깔끔해요 ✨",
          placement_hint: "location_access",
        },
        {
          slot: "PHOTO_2",
          anchor: "[사진 2]",
          subject: "메인메뉴",
          suggested_caption: "메인 메뉴가 먹음직! 😋",
          placement_hint: "main_menu",
        },
      ],
    };

    const out = validateOutput({
      json,
      styleGuide: {},
      constraints: {
        minChars: 1,
        maxChars: 2000,
        includeTipBox: false,
        imagesMeta: [
          { slot: "PHOTO_1", subject: "외관" },
          { slot: "PHOTO_2", subject: "메인메뉴" },
        ],
      },
    });

    expect(out.qualityChecks.image_anchors_ok).toBe(true);
    expect(out.qualityChecks.image_plan_ok).toBe(true);
    expect(out.output.image_plan).toHaveLength(2);
  });

  it("fails when an anchor is duplicated or out of expected range", () => {
    const json = {
      markdown: "도입 [사진 1] 본문 [사진 1] 마무리 [사진 3]",
      image_plan: [{ slot: "PHOTO_1", anchor: "[사진 1]" }],
    };

    const out = validateOutput({
      json,
      styleGuide: {},
      constraints: {
        minChars: 1,
        maxChars: 2000,
        includeTipBox: false,
        imagesMeta: [{ slot: "PHOTO_1", subject: "외관" }],
      },
    });

    expect(out.qualityChecks.image_anchors_ok).toBe(false);
    expect(out.issues.join(" ")).toContain("duplicate anchor");
    expect(out.issues.join(" ")).toContain("unexpected anchor index");
  });

  it("fails when anchor format is malformed", () => {
    const json = {
      markdown: "도입 [사진1] 본문",
      image_plan: [{ slot: "PHOTO_1", anchor: "[사진 1]" }],
    };

    const out = validateOutput({
      json,
      styleGuide: {},
      constraints: {
        minChars: 1,
        maxChars: 2000,
        includeTipBox: false,
        imagesMeta: [{ slot: "PHOTO_1", subject: "외관" }],
      },
    });

    expect(out.qualityChecks.image_anchors_ok).toBe(false);
    expect(out.issues.join(" ")).toContain("anchor format must be [사진 N] with a single space");
  });
});

import {
    normalizeStyleExamples,
    normalizeOutline,
    normalizeStructuredInfo,
    normalizeImagesMeta,
} from "../src/services/utils.js";

describe("normalized utilities test", () => {
    it("normalizes array of strings in user_samples", () => {
        const input = {
            user_samples: [
                "This is a string sample.",
                "This is another string sample."
            ]
        };
        const res = normalizeStyleExamples(input);
        expect(res.must_mimic).toBe(true);
        expect(res.user_samples[0]).toEqual({
            source_url: 'sample_0',
            excerpt: "This is a string sample.",
            why_it_matters: "문체 샘플"
        });
    });

    it("normalizes a string array instead of an object", () => {
        const input = [
            "sample string 1", "sample string 2"
        ];
        const res = normalizeStyleExamples(input);
        expect(res.must_mimic).toBe(true);
        expect(res.user_samples[0].excerpt).toBe("sample string 1");
    });

    it("normalizes outline string", () => {
        const input = "This is a simple outline string.";
        const res = normalizeOutline(input);
        expect(res[0].bullets[0]).toBe("This is a simple outline string.");
    });

    it("normalizes outline valid json string object", () => {
        const input = '{"outline_sections": [{"id": "intro", "intent": "start", "bullets": ["b1"]}]}';
        const res = normalizeOutline(input);
        expect(res[0].id).toBe("intro");
        expect(res[0].intent).toBe("start");
        expect(res[0].bullets[0]).toBe("b1");
    });

    it("normalizes outline valid json string array", () => {
        const input = '[{"id": "intro", "intent": "start", "bullets": ["b1"]}]';
        const res = normalizeOutline(input);
        expect(res[0].id).toBe("intro");
        expect(res[0].intent).toBe("start");
        expect(res[0].bullets[0]).toBe("b1");
    });

    it("normalizes plain array", () => {
        const input = ["string test item", { id: "b", intent: "z", bullets: ["k"] }];
        const res = normalizeOutline(input);
        expect(res[0].id).toBe("section_0");
        expect(res[0].bullets[0]).toBe("string test item");
        expect(res[1].id).toBe("b");
        expect(res[1].bullets[0]).toBe("k");
    });

    it("recovers user_samples from string fragments", () => {
        const input = {
            user_samples: [
                '{"source_url":"https://a.com/post1",',
                '"excerpt":"짧은 호흡으로 문장을 끊어 쓰는 편이에요.",',
                '"why_it_matters":"짧은 문장 리듬이 드러남"}'
            ]
        };
        const res = normalizeStyleExamples(input);
        expect(res.user_samples.length).toBe(1);
        expect(res.user_samples[0].source_url).toBe("https://a.com/post1");
        expect(res.user_samples[0].excerpt).toContain("짧은 호흡");
        expect(res.user_samples[0].why_it_matters).toContain("리듬");
    });

    it("filters empty excerpts and keeps valid object samples", () => {
        const input = {
            user_samples: [
                { source_url: "https://a.com/1", excerpt: "", why_it_matters: "x" },
                { source_url: "https://a.com/2", excerpt: "유효한 샘플", why_it_matters: "" }
            ]
        };
        const res = normalizeStyleExamples(input);
        expect(res.user_samples.length).toBe(1);
        expect(res.user_samples[0].source_url).toBe("https://a.com/2");
        expect(res.user_samples[0].excerpt).toBe("유효한 샘플");
        expect(res.user_samples[0].why_it_matters).toBe("문체 샘플");
    });

    it("fills outline bullets with fallback text when bullets are missing", () => {
        const input = [{ id: "s1", intent: "outline_text", outline_text: "아웃라인 텍스트" }];
        const res = normalizeOutline(input);
        expect(res[0].id).toBe("s1");
        expect(res[0].bullets[0]).toBe("아웃라인 텍스트");
    });

    it("normalizes structuredInfo with legacy outline fallback", () => {
        const res = normalizeStructuredInfo(
            { visit_context: { who_with: "친구", when: "주말" } },
            "레거시 개요 텍스트"
        );
        expect(res.visit_context.who_with).toBe("친구");
        expect(res.visit_context.when).toBe("주말");
        expect(res.extra_notes).toBe("레거시 개요 텍스트");
    });

    it("normalizes imagesMeta and falls back from legacy imagesData", () => {
        const res = normalizeImagesMeta([], [{ caption: "외관\n햇살 좋음" }]);
        expect(res.length).toBe(1);
        expect(res[0].slot).toBe("PHOTO_1");
        expect(res[0].subject).toContain("외관");
    });
});

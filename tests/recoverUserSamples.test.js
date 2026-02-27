import { recoverUserSamples } from "../src/utils/recoverUserSamples.js";

describe("recoverUserSamples", () => {
  it("recovers a fragmented json object array", () => {
    const input = [
      '{"source_url":"https://a.com/p1",',
      '"excerpt":"짧은 호흡으로 문장을 끊어 써요.",',
      '"why_it_matters":"짧은 호흡의 리듬이 분명함"}',
    ];

    const out = recoverUserSamples(input);
    expect(out).toHaveLength(1);
    expect(out[0].source_url).toBe("https://a.com/p1");
    expect(out[0].excerpt).toContain("짧은 호흡");
    expect(out[0].why_it_matters).toContain("리듬");
  });
});

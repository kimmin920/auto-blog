import dotenv from "dotenv";
dotenv.config();

import { enhanceStyleProfileWithLLM } from "./src/services/styleProfileEnhancer.js";

const pages = [
  {
    url: "https://blog.naver.com/test/123",
    title: "테스트 포스팅",
    text: "안녕하세요! 오늘은 너무 기분이 좋네요. 여러분도 행복한 하루 보내세요~ ㅎㅎ 항상 맛집을 찾아다니는 저라서, 이번에도 강남역 맛집에 다녀왔습니다! 기대 이상이었어요."
  }
];

enhanceStyleProfileWithLLM({ pages, llmProvider: "gemini", userId: "test-user" })
  .then(res => console.log(JSON.stringify(res, null, 2)))
  .catch(err => console.error(err));

import "./src/utils/loadEnv.js";
import { createHmac } from "node:crypto";

async function run() {
  const keyword = "하기스 기저귀"; // With space
  const CUSTOMER_ID = process.env.NAVER_SEARCHAD_CUSTOMER_ID;
  const ACCESS_LICENSE = process.env.NAVER_SEARCHAD_ACCESS_LICENSE;
  const SECRET_KEY = process.env.NAVER_SEARCHAD_SECRET_KEY;
  
  try {
    const method = "GET";
    const route = "/keywordstool";
    const timestamp = Date.now().toString();
    const signature = createHmac("sha256", SECRET_KEY).update(`${timestamp}.${method}.${route}`).digest("base64");

    const adRes = await fetch(`https://api.naver.com${route}?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`, {
      method,
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": ACCESS_LICENSE,
        "X-Customer": CUSTOMER_ID,
        "X-Signature": signature
      }
    });
    const adText = await adRes.text();
    console.log("Status:", adRes.status);
    const json = JSON.parse(adText);
    console.log("Returned List Length:", json.keywordList ? json.keywordList.length : 0);
    console.log("List Head:", json.keywordList ? json.keywordList.slice(0, 3) : null);
  } catch (err) {
    console.error("Error occurred:", err);
  }
}
run();

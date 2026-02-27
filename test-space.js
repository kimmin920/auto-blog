import "./src/utils/loadEnv.js";
import { createHmac } from "node:crypto";

async function run() {
  const keyword = "기저귀 추천";
  const CUSTOMER_ID = process.env.NAVER_SEARCHAD_CUSTOMER_ID;
  const ACCESS_LICENSE = process.env.NAVER_SEARCHAD_ACCESS_LICENSE;
  const SECRET_KEY = process.env.NAVER_SEARCHAD_SECRET_KEY;
  
  try {
    const method = "GET";
    const route = "/keywordstool";
    const timestamp = Date.now().toString();
    const signature = createHmac("sha256", SECRET_KEY).update(`${timestamp}.${method}.${route}`).digest("base64");

    const hintFiltered = keyword.replace(/\s+/g, '');
    const adRes = await fetch(`https://api.naver.com${route}?hintKeywords=${encodeURIComponent(hintFiltered)}&showDetail=1`, {
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
    console.log("Response:", adText.substring(0, 100));

  } catch (err) {
    console.error("Error occurred:", err);
  }
}
run();

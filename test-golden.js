import "./src/utils/loadEnv.js";
import { createHmac } from "node:crypto";

async function run() {
  const keyword = "기저귀";
  const CUSTOMER_ID = process.env.NAVER_SEARCHAD_CUSTOMER_ID;
  const ACCESS_LICENSE = process.env.NAVER_SEARCHAD_ACCESS_LICENSE;
  const SECRET_KEY = process.env.NAVER_SEARCHAD_SECRET_KEY;
  
  const SEARCH_CLIENT_ID = process.env.NAVER_BUSINESS_API_ID;
  const SEARCH_CLIENT_SECRET = process.env.NAVER_BUSINESS_API_SECRET;

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
    const adJson = adText ? JSON.parse(adText) : {};
    if (!adRes.ok) throw new Error(adJson.message || "Failed to fetch related keywords");
    
    const rawKeywords = adJson.keywordList || [];
    const topKeywords = rawKeywords
      .map(k => {
        const pc = k.monthlyPcQcCnt === "< 10" ? 10 : Number(k.monthlyPcQcCnt);
        const mobile = k.monthlyMobileQcCnt === "< 10" ? 10 : Number(k.monthlyMobileQcCnt);
        return { keyword: k.relKeyword, volume: pc + mobile };
      })
      .sort((a,b) => b.volume - a.volume)
      .slice(0, 15);

    const fetchDocCount = async (kwItem) => {
      const searchRes = await fetch(`https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(kwItem.keyword)}&display=1`, {
        headers: {
          "X-Naver-Client-Id": SEARCH_CLIENT_ID,
          "X-Naver-Client-Secret": SEARCH_CLIENT_SECRET
        }
      });
      const searchJson = await searchRes.json();
      if (!searchRes.ok) {
        if (searchJson.errorCode) throw searchJson;
        return { ...kwItem, docCount: 0, ratio: 999 };
      }
      const total = searchJson.total || 0;
      return {
        ...kwItem,
        docCount: total,
        ratio: kwItem.volume > 0 ? (total / kwItem.volume) : 999
      };
    };

    const processedList = await Promise.all(topKeywords.map(fetchDocCount));
    console.log("Success", processedList.length);
  } catch (err) {
    console.error("Error occurred:", err);
  }
}
run();

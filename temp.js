  
    /** ---------------------------------------
     *  1) markdown -> naver HTML 변환 함수
     * -------------------------------------- */
    function markdownToNaver(markdown) {
      const { cleaned, title, tags } = extractFrontMatter(markdown);

      let pre = convertHugoFigureShortcode(cleaned);

      marked.setOptions({
        gfm: true,
        breaks: true,
      });

      const rawHtml = marked.parse(pre);
      const finalHtml = postprocessForNaver(rawHtml);

      return { html: finalHtml, title, tags };
    }

    /** ---------------------------------------
     *  2) Naver 미리보기 함수
     * -------------------------------------- */
    function renderNaverPreview(container, naverHtml) {
      if (!container) throw new Error("container가 필요합니다.");

      const baseStyle = `
    <style>
      .naver-preview {
        font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
          "Noto Sans KR", "Segoe UI", Roboto, Arial, sans-serif;
        line-height: 1.65;
        font-size: 15px;
        color: #222;
      }
      .naver-preview h1,.naver-preview h2,.naver-preview h3 {
        line-height: 1.25;
        margin: 18px 0 10px;
        font-weight: 700;
      }
      .naver-preview p { margin: 10px 0; }
      .naver-preview ul, .naver-preview ol { margin: 10px 0 10px 22px; }
      .naver-preview blockquote {
        margin: 12px 0;
        padding: 10px 12px;
        border-left: 3px solid #ddd;
        background: #fafafa;
      }
      .naver-preview table {
        border-collapse: collapse;
        width: 100%;
        margin: 12px 0;
      }
      .naver-preview td, .naver-preview th {
        border: 1px solid #e5e5e5;
        padding: 8px 10px;
        vertical-align: top;
      }
      .naver-preview img {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 10px 0;
      }
      .naver-preview .figure-caption {
        font-size: 13px;
        color: #666;
        margin-top: 6px;
      }
      .naver-preview .code-block {
        margin: 12px 0;
        padding: 12px 14px;
        border: 1px solid #eee;
        background: #0b0f14;
        color: #e6edf3;
        border-radius: 10px;
        overflow-x: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 13px;
        line-height: 1.55;
        white-space: pre;
      }
      .naver-preview a { color: inherit; text-decoration: underline; }
      .naver-preview hr { border: 0; border-top: 1px solid #eee; margin: 18px 0; }
    </style>
  `;

      container.innerHTML = `${baseStyle}<div class="naver-preview">${naverHtml}</div>`;
    }

    function extractFrontMatter(md) {
      const fm = md.match(/^---\s*[\r\n]+([\s\S]*?)\s*[\r\n]+---\s*[\r\n]+/);
      if (!fm) return { cleaned: md, title: undefined, tags: undefined };

      const block = fm[1] || "";
      const titleMatch = block.match(/^\s*title\s*:\s*["']?(.+?)["']?\s*$/m);
      const title = titleMatch ? titleMatch[1].trim() : undefined;

      let tags;
      const tagsMatch = block.match(/^\s*tags\s*:\s*\[(.*?)\]\s*$/m);
      if (tagsMatch) {
        tags = tagsMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
          .join(" ");
      }

      const cleaned = md.replace(fm[0], "");
      return { cleaned, title, tags };
    }

    function convertHugoFigureShortcode(md) {
      return md.replace(/{{<\s*figure\s+([^>]+?)\s*>}}/g, (_, attrs) => {
        const getAttr = (name) => {
          const m = attrs.match(new RegExp(`${name}\\s*=\\s*"(.*?)"`));
          return m ? m[1] : "";
        };
        const src = getAttr("src");
        const alt = getAttr("alt") || getAttr("title") || "";
        const caption = getAttr("caption") || "";

        if (!src) return "";
        const capHtml = caption
          ? `<div class="figure-caption">${escapeHtml(caption)}</div>`
          : "";
        return `<div class="figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(
          alt
        )}" />${capHtml}</div>`;
      });
    }

    function postprocessForNaver(html) {
      const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
      const root = doc.querySelector("#root");

      root.querySelectorAll("p").forEach((p) => {
        if (p.textContent.trim() === "" && p.children.length === 0) {
          p.innerHTML = "&nbsp;";
        }
      });

      root.querySelectorAll("td p, th p").forEach((p) => {
        const parent = p.parentElement;
        while (p.firstChild) parent.insertBefore(p.firstChild, p);
        parent.removeChild(p);
      });

      root.querySelectorAll("p").forEach((p) => {
        const imgs = Array.from(p.querySelectorAll("img"));
        if (imgs.length === 1 && p.textContent.trim() === "" && p.children.length === 1) {
          const div = doc.createElement("div");
          div.appendChild(imgs[0]);
          p.replaceWith(div);
        }
      });

      root.querySelectorAll("pre > code").forEach((codeEl) => {
        if (typeof hljs !== 'undefined') hljs.highlightElement(codeEl);
        inlineStyleHljsSpans(codeEl);
        const pre = codeEl.parentElement;
        const wrapper = doc.createElement("div");
        wrapper.className = "code-block";
        wrapper.innerHTML = codeEl.innerHTML;
        pre.replaceWith(wrapper);
      });

      return root.innerHTML;
    }

    function inlineStyleHljsSpans(scopeEl) {
      const map = {
        "hljs-comment": "color:#8b949e;",
        "hljs-quote": "color:#8b949e;",
        "hljs-keyword": "color:#ff7b72;font-weight:600;",
        "hljs-selector-tag": "color:#ff7b72;",
        "hljs-literal": "color:#79c0ff;",
        "hljs-number": "color:#79c0ff;",
        "hljs-string": "color:#a5d6ff;",
        "hljs-title": "color:#d2a8ff;font-weight:600;",
        "hljs-section": "color:#d2a8ff;font-weight:600;",
        "hljs-name": "color:#d2a8ff;",
        "hljs-type": "color:#ffa657;",
        "hljs-attr": "color:#ffa657;",
        "hljs-attribute": "color:#ffa657;",
        "hljs-built_in": "color:#ffa657;",
        "hljs-params": "color:#c9d1d9;",
        "hljs-variable": "color:#c9d1d9;",
        "hljs-symbol": "color:#79c0ff;",
        "hljs-bullet": "color:#79c0ff;",
        "hljs-meta": "color:#8b949e;",
        "hljs-emphasis": "font-style:italic;",
        "hljs-strong": "font-weight:700;",
      };

      scopeEl.querySelectorAll("span").forEach((span) => {
        const cls = span.className || "";
        const hit = cls
          .split(/\s+/)
          .map((c) => map[c])
          .filter(Boolean)
          .join("");
        if (hit) {
          span.setAttribute("style", (span.getAttribute("style") || "") + hit);
          span.removeAttribute("class");
        }
      });

      scopeEl.removeAttribute("class");
    }

    function escapeHtml(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    // --- UI Navigation ---
    let currentStep = 1;

    function goToStep(step) {
      document.querySelectorAll('.step-item').forEach((el, index) => {
        if (index + 1 === step) el.classList.add('active');
        else el.classList.remove('active');

        if (index + 1 < step) el.classList.add('completed');
        else el.classList.remove('completed');
      });

      document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
      document.getElementById('step' + step).classList.add('active');
      currentStep = step;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- Media Upload (EXIF simulation via Date lastModified) ---
    let mediaFiles = [];

    function handleImageUpload(e) {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      files.forEach(f => {
        // file.lastModified gives the exact timestamp when photo was modified/taken locally.
        mediaFiles.push({ file: f, time: f.lastModified });
      });

      // Sort chronologically (Time-line)
      mediaFiles.sort((a, b) => a.time - b.time);

      const listEl = document.getElementById('mediaPreviewList');
      listEl.innerHTML = '';
      document.getElementById('aiCaptionWrapper').style.display = files.length ? 'block' : 'none';

      mediaFiles.forEach((m, idx) => {
        const url = URL.createObjectURL(m.file);
        const dateObj = new Date(m.time);
        conStr = `${dateObj.getHours()}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

        listEl.innerHTML += `
          <div class="media-item" style="display:flex; flex-direction:column; padding-bottom:8px;">
  <div style="position:relative;">
    <span style="position:absolute; top:4px; left:4px; background:rgba(0,0,0,0.7); color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; z-index:10;">순서 ${idx + 1}</span>
    <img src="${url}" />
    <div class="media-meta" style="border:none; border-bottom:1px solid #e5e7eb;">⏱️ ${dateObj.getMonth() + 1}/${dateObj.getDate()} ${timeStr}</div>
  </div>
  <textarea id="caption-${idx}" rows="2" style="font-size:12px; margin:8px 8px 0; padding:6px; border:1px solid #d1d5db; border-radius:6px; resize:none;" placeholder="간략한 사진 설명 (또는 위 AI 버튼 클릭)"></textarea>
</div>
          </div>
        `;
      });
    }

    // --- Search Golden Keywords (Modal & Cached) ---
    let goldenCache = {}; // { "keyword_page": data }
    let currentGoldenKeyword = "";
    let currentGoldenPage = 1;

    function openGoldenModal() {
      document.getElementById('goldenModal').classList.add('active');
    }

    function selectKeyword(kw) {
      const input = document.getElementById('targetKeywords');
      let currentVal = input.value.trim();
      
      if (!currentVal) {
        input.value = kw;
      } else {
        const parts = currentVal.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.includes(kw)) {
          if (parts.length >= 3) parts.pop(); // Keep max 3
          parts.push(kw);
          input.value = parts.join(', ');
        }
      }
      document.getElementById('goldenModal').classList.remove('active');
    }

    function renderGoldenBadge(ratio) {
      if (ratio < 1) return '<span class="badge badge-honey">🍯 초특급 꿀</span>';
      if (ratio < 5) return '<span class="badge badge-good">👍 좋음</span>';
      if (ratio < 20) return '<span class="badge" style="background:#f3f4f6; color:#4b5563;">보통</span>';
      return '<span class="badge badge-saturated">🔥 포화</span>';
    }

    async function searchGolden(page = 1) {
      const kwInput = document.getElementById('goldenSearchInput').value.trim();
      if (!kwInput) return;
      
      currentGoldenKeyword = kwInput;
      currentGoldenPage = page;
      const cacheKey = kwInput + "_" + page;

      const exactContainer = document.getElementById('goldenExactContainer');
      const resultList = document.getElementById('goldenResultList');
      const pagination = document.getElementById('goldenPagination');

      resultList.innerHTML = '<div style="text-align:center; padding: 40px; color:var(--muted);">분석중... ⏳ (최대 30초 소요될 수 있습니다)</div>';
      exactContainer.innerHTML = '';
      pagination.style.display = 'none';

      let data = goldenCache[cacheKey];

      if (!data) {
        try {
          const res = await fetch(`/api/naver-golden-keyword?keyword=${encodeURIComponent(kwInput)}&page=${page}`);
          const json = await res.json();
          if (!json.ok) throw new Error(json.message);
          data = json;
          goldenCache[cacheKey] = data; // Cache
        } catch (err) {
          resultList.innerHTML = `<div style="text-align:center; padding: 40px; color:#991b1b;">통신 실패: ${err.message}</div>`;
          return;
        }
      }

      // Render Exact Match if exists (usually page 1 only is enough, but we can show it)
      if (data.exactData) {
        const e = data.exactData;
        exactContainer.innerHTML = `
          <div class="golden-exact-box">
            <div style="font-size:12px; font-weight:bold; color:var(--muted); margin-bottom:4px;">🎯 내 검색어 분석 결과</div>
            <div class="golden-item-header" style="margin-bottom:8px;">
              <span class="golden-item-title" onclick="selectKeyword('${e.keyword}')">${e.keyword}</span>
              <span class="badge badge-exact">검색어</span>
            </div>
            <div class="golden-item-stats">
              <span class="golden-stat">📱 MO ${e.mobile.toLocaleString()}</span>
              <span class="golden-stat">💻 PC ${e.pc.toLocaleString()}</span>
              <span class="golden-stat">🔥 경쟁 ${e.comp}</span>
            </div>
          </div>
        `;
      }

      // Render List
      if (!data.dataList || data.dataList.length === 0) {
        resultList.innerHTML = '<div style="text-align:center; padding: 40px; color:var(--muted);">연관 키워드가 없습니다.</div>';
        return;
      }

      let html = '';
      data.dataList.forEach(item => {
        html += `
          <div class="golden-item">
            <div class="golden-item-header">
              <span class="golden-item-title" onclick="selectKeyword('${item.keyword}')">${item.keyword}</span>
              ${renderGoldenBadge(item.ratio)}
            </div>
            <div class="golden-item-stats" style="justify-content:space-between;">
              <div style="display:flex; gap:12px;">
                <span class="golden-stat">🔍 검색 ${item.volume.toLocaleString()}</span>
                <span class="golden-stat">📝 문서 ${item.docCount.toLocaleString()}</span>
              </div>
              <div>포화도: ${item.ratio === 999 ? '측정불가' : item.ratio.toFixed(2) + '배'}</div>
            </div>
          </div>
        `;
      });
      resultList.innerHTML = html;

      // Render Pagination
      const totalPage = data.totalPage || 1;
      let pageHtml = `<button class="golden-page-btn" ${page === 1 ? 'disabled' : ''} onclick="searchGolden(${page - 1})">이전</button>`;
      
      const maxPagesToShow = 5;
      let startPage = Math.max(1, page - 2);
      let endPage = Math.min(totalPage, startPage + maxPagesToShow - 1);
      if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
      }

      for (let i = startPage; i <= endPage; i++) {
        pageHtml += `<button class="golden-page-btn ${i === page ? 'active' : ''}" onclick="searchGolden(${i})">${i}</button>`;
      }
      pageHtml += `<button class="golden-page-btn" ${page === totalPage ? 'disabled' : ''} onclick="searchGolden(${page + 1})">다음</button>`;
      
      pagination.innerHTML = pageHtml;
      pagination.style.display = 'flex';
      resultList.scrollTop = 0;
    }

    // --- Generation APIs ---

    async function analyzeAllImages() {
      const btn = document.getElementById('btnAiCaption');
      btn.innerText = "⏳ 사진 정보 분석 중... (최대 30초)";
      btn.disabled = true;

      for (let i = 0; i < mediaFiles.length; i++) {
        const m = mediaFiles[i];
        const formData = new FormData();
        formData.append("imageFile", m.file);
        formData.append("llmProvider", "gemini");

        try {
          const res = await fetch('/api/analyze-image-mvp', {
            method: 'POST',
            body: formData
          });
          const json = await res.json();
          if (json.ok && json.text) {
            const ta = document.getElementById('caption-' + i);
            if (ta) ta.value = json.text.substring(0, 100) + (json.text.length > 100 ? '...' : '');
          }
        } catch (e) { console.error(e); }
      }

      btn.innerText = "✅ AI 캡션 추출 완료!";
      setTimeout(() => { btn.innerText = "🪄 AI 사진 정보 자동추출 (재성공)"; btn.disabled = false; }, 3000);
    }


    let step3Prompt = null;
    let step4Prompt = null;

    function showPrompt(step) {
      const promptData = step === 3 ? step3Prompt : step4Prompt;
      if (!promptData) return;
      document.getElementById('promptModalBody').innerText = JSON.stringify(promptData, null, 2);
      document.getElementById('promptModal').classList.add('active');
    }

    function copyForNaver() {
      const htmlContent = window.__lastNaverHtml || document.getElementById('naverPreview').innerHTML;

      const listener = function (ev) {
        ev.preventDefault();
        ev.clipboardData.setData('text/html', htmlContent);
        ev.clipboardData.setData('text/plain', document.getElementById('naverPreview').innerText);
      };
      document.addEventListener('copy', listener);
      document.execCommand('copy');
      document.removeEventListener('copy', listener);

      alert('네이버 블로그용(서식 포함 HTML) 복사가 완료되었습니다! 네이버 블로그 스마트에디터에 그대로 [붙여넣기] 허세요.');
    }

    let appState = { outline: "", titles: [] };

    async function startOutlineGeneration() {
      goToStep(3);
      document.getElementById('step3Loader').style.display = 'block';
      document.getElementById('step3Content').style.display = 'none';

      const blogType = document.querySelector('input[name="blogType"]:checked').value;
      const keywords = document.getElementById('targetKeywords').value;
      const memo = document.getElementById('briefMemo').value;

      const imagesData = mediaFiles.map((m, idx) => {
        const ta = document.getElementById('caption-' + idx);
        return {
          idx: idx + 1,
          caption: ta ? ta.value : ''
        };
      });
      appState.imagesData = imagesData;
      const promptData = { blogType, keywords, memo, imagesData, llmProvider: "gemini" };

      try {
        const res = await fetch('/api/generate-outline-mvp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(promptData)
        });
        const json = await res.json();

        if (!json.ok) throw new Error(json.message);

        appState.titles = json.titles || ["기본 제목 1", "기본 제목 2"];
        step3Prompt = json.prompt;
        document.getElementById('btnPromptStep3').style.display = 'block';
        appState.outline = typeof json.outline === "string" ? json.outline : JSON.stringify(json.outline, null, 2);

        const optsHtml = appState.titles.map((t, idx) => `
          <label class="radio-card"><input type="radio" name="selectedTitle" value="${idx}" ${idx === 0 ? 'checked' : ''}> ${t}</label>
        `).join('');

        document.getElementById('titleOptions').innerHTML = optsHtml;
        document.getElementById('outlineText').value = appState.outline;

        document.getElementById('step3Loader').style.display = 'none';
        document.getElementById('step3Content').style.display = 'block';
      } catch (err) {
        document.getElementById('step3Loader').innerHTML = '❌ 오류: ' + err.message;
        document.getElementById('step3Loader').className = 'status-box error';
      }
    }

    async function startFinalGeneration() {
      goToStep(4);
      document.getElementById('step4Loader').style.display = 'block';
      document.getElementById('step4Result').style.display = 'none';

      const blogType = document.querySelector('input[name="blogType"]:checked').value;
      const keywords = document.getElementById('targetKeywords').value;
      const titleIdx = document.querySelector('input[name="selectedTitle"]:checked')?.value || 0;
      const finalTitle = appState.titles[titleIdx];
      const finalOutline = document.getElementById('outlineText').value;

      const optNegative = document.getElementById('optNegative').checked;
      const optHashtag = document.getElementById('optHashtag').checked;
      const optStyle = document.getElementById('optStyle').checked;

      const payload = {
        imagesData: appState.imagesData,
        blogType, keywords, title: finalTitle, outline: finalOutline,
        options: { optNegative, optHashtag, optStyle },
        llmProvider: "gemini"
      };

      try {
        const res = await fetch('/api/generate-final-mvp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.message);

        step4Prompt = json.prompt;
        document.getElementById('btnPromptStep4').style.display = 'block';

        // Markdown -> Naver Preview
        const mdText = "# " + finalTitle + "\n\n" + json.markdown;
        const naverRes = markdownToNaver(mdText);
        window.__lastNaverHtml = naverRes.html;
        renderNaverPreview(document.getElementById('naverPreview'), naverRes.html);
        document.getElementById('finalMarkdown').value = `# ${finalTitle}\n\n${json.markdown}`;
        document.getElementById('finalHashtags').innerText = json.hashtags.join(' ');

        document.getElementById('step4Loader').style.display = 'none';
        document.getElementById('step4Result').style.display = 'block';
      } catch (err) {
        document.getElementById('step4Loader').innerHTML = '❌ 오류: ' + err.message;
        document.getElementById('step4Loader').className = 'status-box error';
      }
    }
  

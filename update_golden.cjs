const fs = require('fs');
let code = fs.readFileSync('src/views/index.html', 'utf8');

// 1. Remove old inline golden keyword tool
const oldToolRegex = /<button type="button" class="btn btn-outline"[^>]+?onclick="document\.getElementById\('keyword-tool'\)\.style\.display='block'"[^>]*?>🔍 연관 황금키워드 찾아보기<\/button>\s*<\/div>\s*<!-- 황금키워드 툴 \(인라인 모달처럼\) -->\s*<div id="keyword-tool"[\s\S]*?<\/div>\s*<div class="form-group">/;

code = code.replace(oldToolRegex, `<button type="button" class="btn btn-outline" style="margin-top:8px; width:100%; font-size:13px;" onclick="openGoldenModal()">🔍 연관 황금키워드 찾아보기</button>
      </div>

      <div class="form-group">`);

// 2. Add style for tags & new modal
const modalCss = `
    .badge {
      display: inline-block;
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-honey { background: #dcfce7; color: #166534; }
    .badge-good { background: #dbeafe; color: #1e40af; }
    .badge-saturated { background: #fee2e2; color: #991b1b; }
    .badge-exact { background: #fef9c3; color: #854d0e; border: 1px solid #fef08a;}

    .golden-item {
      display: flex;
      flex-direction: column;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      gap: 6px;
    }
    .golden-item:hover {
      background: #f8fafc;
    }
    .golden-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .golden-item-title {
      font-weight: 600;
      font-size: 14px;
      color: #111827;
      cursor: pointer;
    }
    .golden-item-title:hover {
      text-decoration: underline;
      color: var(--brand);
    }
    .golden-item-stats {
      display: flex;
      gap: 12px;
      font-size: 12px;
      color: var(--muted);
    }
    .golden-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .golden-pagination {
      display: flex;
      justify-content: center;
      gap: 8px;
      padding: 15px 0;
    }
    .golden-page-btn {
      padding: 6px 12px;
      border: 1px solid var(--line);
      background: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .golden-page-btn.active {
      background: var(--brand);
      color: white;
      border-color: var(--brand);
    }
    .golden-page-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .golden-exact-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
      margin-top: 15px;
      margin-bottom: 20px;
    }
    .golden-exact-box .golden-item-title { font-size: 16px; color: var(--brand); }
`;

if (!code.includes('.badge-honey')) {
    code = code.replace('</style>', modalCss + '\n  </style>');
}

// Add the Golden Keyword Modal HTML
const goldenModalHtml = `
    <!-- Golden Keyword Modal -->
    <div class="modal-overlay" id="goldenModal">
      <div class="modal-content" style="max-height: 90vh;">
        <div class="modal-header">
          <h3>🔍 네이버 황금키워드 탐색기</h3>
          <button class="modal-close" onclick="document.getElementById('goldenModal').classList.remove('active')">&times;</button>
        </div>
        <div class="modal-body" style="padding: 15px; background: white; flex:1; display:flex; flex-direction:column; overflow:hidden;">
          <div style="display:flex; gap:8px;">
            <input type="text" id="goldenSearchInput" placeholder="핵심 키워드 검색 (예: 기저귀)" style="flex:1;" onkeypress="if(event.key === 'Enter') searchGolden(1)">
            <button type="button" class="btn" style="padding:10px 16px; white-space:nowrap;" onclick="searchGolden(1)">검색</button>
          </div>
          
          <div id="goldenExactContainer"></div>
          
          <div style="flex:1; overflow-y:auto; margin-top:10px;" id="goldenResultList">
            <!-- Items injected here -->
            <div style="text-align:center; padding: 40px 20px; color: var(--muted); font-size:14px;">
              키워드를 검색하면 연관 키워드들의 경쟁도(포화도)를 분석해 보여줍니다.<br>
               (모바일 및 PC 검색량, 총 문서 수 파악)
            </div>
          </div>
          
          <div id="goldenPagination" class="golden-pagination" style="display:none;">
            <!-- Pagination injected here -->
          </div>
        </div>
      </div>
    </div>
`;
if (!code.includes('id="goldenModal"')) {
    code = code.replace('</main>', '</main>\n' + goldenModalHtml);
}

// 3. Replace Old fetchGolden logic with new caching and modal logic
const oldSearchScriptRegex = /\/\/ --- Search Golden Keywords Embedded ---[\s\S]*?\/\/ --- Generation APIs ---/;

const newGoldenLogic = `// --- Search Golden Keywords (Modal & Cached) ---
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
          const res = await fetch(\`/api/naver-golden-keyword?keyword=\${encodeURIComponent(kwInput)}&page=\${page}\`);
          const json = await res.json();
          if (!json.ok) throw new Error(json.message);
          data = json;
          goldenCache[cacheKey] = data; // Cache
        } catch (err) {
          resultList.innerHTML = \`<div style="text-align:center; padding: 40px; color:#991b1b;">통신 실패: \${err.message}</div>\`;
          return;
        }
      }

      // Render Exact Match if exists (usually page 1 only is enough, but we can show it)
      if (data.exactData) {
        const e = data.exactData;
        exactContainer.innerHTML = \`
          <div class="golden-exact-box">
            <div style="font-size:12px; font-weight:bold; color:var(--muted); margin-bottom:4px;">🎯 내 검색어 분석 결과</div>
            <div class="golden-item-header" style="margin-bottom:8px;">
              <span class="golden-item-title" onclick="selectKeyword('\${e.keyword}')">\${e.keyword}</span>
              <span class="badge badge-exact">검색어</span>
            </div>
            <div class="golden-item-stats">
              <span class="golden-stat">📱 MO \${e.mobile.toLocaleString()}</span>
              <span class="golden-stat">💻 PC \${e.pc.toLocaleString()}</span>
              <span class="golden-stat">🔥 경쟁 \${e.comp}</span>
            </div>
          </div>
        \`;
      }

      // Render List
      if (!data.dataList || data.dataList.length === 0) {
        resultList.innerHTML = '<div style="text-align:center; padding: 40px; color:var(--muted);">연관 키워드가 없습니다.</div>';
        return;
      }

      let html = '';
      data.dataList.forEach(item => {
        html += \`
          <div class="golden-item">
            <div class="golden-item-header">
              <span class="golden-item-title" onclick="selectKeyword('\${item.keyword}')">\${item.keyword}</span>
              \${renderGoldenBadge(item.ratio)}
            </div>
            <div class="golden-item-stats" style="justify-content:space-between;">
              <div style="display:flex; gap:12px;">
                <span class="golden-stat">🔍 검색 \${item.volume.toLocaleString()}</span>
                <span class="golden-stat">📝 문서 \${item.docCount.toLocaleString()}</span>
              </div>
              <div>포화도: \${item.ratio === 999 ? '측정불가' : item.ratio.toFixed(2) + '배'}</div>
            </div>
          </div>
        \`;
      });
      resultList.innerHTML = html;

      // Render Pagination
      const totalPage = data.totalPage || 1;
      let pageHtml = \`<button class="golden-page-btn" \${page === 1 ? 'disabled' : ''} onclick="searchGolden(\${page - 1})">이전</button>\`;
      
      const maxPagesToShow = 5;
      let startPage = Math.max(1, page - 2);
      let endPage = Math.min(totalPage, startPage + maxPagesToShow - 1);
      if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
      }

      for (let i = startPage; i <= endPage; i++) {
        pageHtml += \`<button class="golden-page-btn \${i === page ? 'active' : ''}" onclick="searchGolden(\${i})">\${i}</button>\`;
      }
      pageHtml += \`<button class="golden-page-btn" \${page === totalPage ? 'disabled' : ''} onclick="searchGolden(\${page + 1})">다음</button>\`;
      
      pagination.innerHTML = pageHtml;
      pagination.style.display = 'flex';
      resultList.scrollTop = 0;
    }

    // --- Generation APIs ---`;

code = code.replace(oldSearchScriptRegex, newGoldenLogic);

fs.writeFileSync('src/views/index.html', code);

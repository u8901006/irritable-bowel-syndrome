#!/usr/bin/env node
// generate_report.js — Analyze IBS papers with Zhipu GLM-5-Turbo and generate HTML report
// Usage: node scripts/generate_report.js --input papers.json --output docs/ibs-2026-05-12.html

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const API_BASE = process.env.ZHIPU_API_BASE || 'https://open.bigmodel.cn/api/coding/paas/v4';
const MODEL_CHAIN = ['glm-5-turbo', 'glm-4.7', 'glm-4.7-flash'];
const MAX_TOKENS = 50000;
const REQUEST_TIMEOUT = 480000;

const SYSTEM_PROMPT = `你是腸躁症（IBS）研究領域的專業醫學文獻分析師，同時也是一位科學傳播者。你的任務是：

1. 從提供的 PubMed 文獻中，挑選出最重要的 TOP 5-8 篇論文
2. 對每篇論文進行：
   - 繁體中文標題翻譯
   - 一句話重點摘要
   - PICO 分析（Population/Intervention/Comparison/Outcome）
   - 臨床實用性評估（high/mid/low）
   - 主題標籤分類
3. 提供每日趨勢總結
4. 主題分布分析
5. 關鍵詞提取

重要規則：
- 所有輸出必須是嚴格的 JSON 格式
- 不要使用 markdown code block 包裹
- 繁體中文輸出
- 臨床實用性評估要務實，不是每篇都是 high`;

function buildUserPrompt(papers) {
  const paperTexts = papers
    .map(
      (p, i) => `
[${i + 1}] PMID: ${p.pmid}
Title: ${p.title}
Journal: ${p.journal}
Date: ${p.date}
Abstract: ${p.abstract || 'No abstract available'}
Keywords: ${(p.keywords || []).join(', ')}
URL: ${p.url}`
    )
    .join('\n---\n');

  return `以下是今天從 PubMed 抓取的 ${papers.length} 篇 IBS（腸躁症）相關最新文獻。請分析並以嚴格 JSON 格式回覆。

${paperTexts}

請以以下 JSON schema 回覆（不要加 markdown code block）：
{
  "daily_summary": "今日趨勢一段話總結（繁中，100-200字）",
  "top_picks": [
    {
      "rank": 1,
      "pmid": "12345678",
      "title_en": "Original English Title",
      "title_zh": "繁體中文標題",
      "one_liner": "一句話重點摘要",
      "pico": {
        "population": "研究對象",
        "intervention": "介入措施",
        "comparison": "對照組",
        "outcome": "主要結果"
      },
      "clinical_utility": "high|mid|low",
      "clinical_utility_reason": "臨床實用性理由",
      "topic_tags": ["gut-brain axis", "probiotics", "CBT"],
      "journal": "Journal Name",
      "date": "2026-05-12",
      "url": "https://pubmed.ncbi.nlm.nih.gov/12345678/"
    }
  ],
  "other_papers": [
    {
      "pmid": "12345679",
      "title_en": "Title",
      "title_zh": "中文標題",
      "one_liner": "一句話摘要",
      "journal": "Journal",
      "topic_tags": ["tag1", "tag2"],
      "clinical_utility": "mid",
      "url": "https://pubmed.ncbi.nlm.nih.gov/12345679/"
    }
  ],
  "topic_distribution": {
    "Gut-Brain Axis": 3,
    "Microbiome": 5,
    "Diet / Nutrition": 2,
    "Psychological Treatment": 4,
    "Exercise / Lifestyle": 1,
    "Pharmacotherapy": 3,
    "Clinical Guidelines": 1,
    "Pediatric IBS": 1,
    "Pain / Sensitization": 2,
    "Sleep / Stress": 1
  },
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "summarized_pmids": ["12345678", "12345679"]
}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: 'papers.json', output: '', apiKey: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) opts.input = args[++i];
    else if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
    else if (args[i] === '--api-key' && args[i + 1]) opts.apiKey = args[++i];
  }
  return opts;
}

async function callZhipuAPI(apiKey, userPrompt, modelIndex = 0) {
  if (modelIndex >= MODEL_CHAIN.length) {
    throw new Error('All models in fallback chain exhausted');
  }

  const model = MODEL_CHAIN[modelIndex];
  console.log(`  Calling model: ${model} (attempt ${modelIndex + 1}/${MODEL_CHAIN.length})`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: MAX_TOKENS,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 429) {
        const waitTime = 60000 * attempt;
        console.log(`  Rate limited (429), waiting ${waitTime / 1000}s (attempt ${attempt})...`);
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`  API error ${response.status}: ${errText.substring(0, 200)}`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 5000 * attempt));
          continue;
        }
        throw new Error(`API ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content || '';
      if (!content) throw new Error('Empty response content');

      content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

      try {
        return JSON.parse(content);
      } catch (parseErr) {
        console.log(`  JSON parse failed, attempting repair...`);
        const repaired = repairJSON(content);
        return JSON.parse(repaired);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.error(`  Request timed out after ${REQUEST_TIMEOUT / 1000}s`);
        if (attempt < 3) continue;
      }
      console.error(`  Attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }

  console.log(`  Model ${model} failed all retries, trying next fallback...`);
  return callZhipuAPI(apiKey, userPrompt, modelIndex + 1);
}

function repairJSON(str) {
  let s = str;
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/([{,]\s*)("(?:[^"\\]|\\.)*")\s*:\s*/g, '$1$2:');

  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    s = s.substring(firstBrace, lastBrace + 1);
  }

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (s[i] === '\\') {
      escaped = true;
      continue;
    }
    if (s[i] === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (s[i] === '{' || s[i] === '[') depth++;
      if (s[i] === '}' || s[i] === ']') {
        depth--;
        if (depth < 0) {
          s = s.substring(0, i) + s.substring(i + 1);
          i--;
          depth = 0;
        }
      }
    }
  }

  while (depth > 0) {
    s += '}';
    depth--;
  }

  return s;
}

function utilityColor(level) {
  switch (level) {
    case 'high': return '#5a7a3a';
    case 'mid': return '#9f7a2e';
    default: return '#8a7a6a';
  }
}

function utilityLabel(level) {
  switch (level) {
    case 'high': return '高實用';
    case 'mid': return '中實用';
    default: return '低實用';
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getWeekday(dateStr) {
  const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  try {
    const d = new Date(dateStr);
    return days[d.getDay()];
  } catch {
    return '';
  }
}

function formatDateChinese(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
}

function generateHTML(analysis, date) {
  const weekday = getWeekday(date);
  const dateZh = formatDateChinese(date);

  const topPicksHTML = (analysis.top_picks || [])
    .map(
      (p, i) => `
    <article class="paper-card top-pick" style="animation-delay:${0.1 + i * 0.06}s">
      <div class="paper-header">
        <span class="rank-badge">#${p.rank || i + 1}</span>
        <span class="journal-badge">${escapeHtml(p.journal)}</span>
        <span class="utility-badge" style="background:${utilityColor(p.clinical_utility)}">${utilityLabel(p.clinical_utility)}</span>
      </div>
      <h3 class="paper-title-zh">${escapeHtml(p.title_zh)}</h3>
      <p class="paper-title-en">${escapeHtml(p.title_en)}</p>
      <p class="one-liner">${escapeHtml(p.one_liner)}</p>
      ${p.pico ? `
      <div class="pico-grid">
        <div class="pico-item"><span class="pico-label">P</span><span class="pico-text">${escapeHtml(p.pico.population)}</span></div>
        <div class="pico-item"><span class="pico-label">I</span><span class="pico-text">${escapeHtml(p.pico.intervention)}</span></div>
        <div class="pico-item"><span class="pico-label">C</span><span class="pico-text">${escapeHtml(p.pico.comparison)}</span></div>
        <div class="pico-item"><span class="pico-label">O</span><span class="pico-text">${escapeHtml(p.pico.outcome)}</span></div>
      </div>` : ''}
      ${p.clinical_utility_reason ? `<p class="utility-reason"><strong>臨床意義：</strong>${escapeHtml(p.clinical_utility_reason)}</p>` : ''}
      <div class="paper-tags">${(p.topic_tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      <a class="paper-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">查看 PubMed 原文 →</a>
    </article>`
    )
    .join('\n');

  const otherPapersHTML = (analysis.other_papers || [])
    .map(
      (p) => `
    <article class="paper-card other-paper">
      <div class="paper-header">
        <span class="journal-badge">${escapeHtml(p.journal)}</span>
        <span class="utility-badge" style="background:${utilityColor(p.clinical_utility)}">${utilityLabel(p.clinical_utility)}</span>
      </div>
      <h4 class="paper-title-zh">${escapeHtml(p.title_zh)}</h4>
      <p class="paper-title-en">${escapeHtml(p.title_en)}</p>
      <p class="one-liner">${escapeHtml(p.one_liner)}</p>
      <div class="paper-tags">${(p.topic_tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      <a class="paper-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">查看 PubMed 原文 →</a>
    </article>`
    )
    .join('\n');

  const topicDistribution = analysis.topic_distribution || {};
  const topicEntries = Object.entries(topicDistribution).sort((a, b) => b[1] - a[1]);
  const maxTopicCount = topicEntries.length > 0 ? topicEntries[0][1] : 1;
  const topicsHTML = topicEntries
    .map(
      ([name, count]) => `
    <div class="topic-row">
      <span class="topic-name">${escapeHtml(name)}</span>
      <div class="topic-bar-container">
        <div class="topic-bar" style="width:${Math.round((count / maxTopicCount) * 100)}%"></div>
      </div>
      <span class="topic-count">${count}</span>
    </div>`
    )
    .join('\n');

  const keywordsHTML = (analysis.keywords || [])
    .map((kw) => `<span class="keyword-chip">${escapeHtml(kw)}</span>`)
    .join(' ');

  const topCount = (analysis.top_picks || []).length;
  const otherCount = (analysis.other_papers || []).length;
  const totalCount = topCount + otherCount;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>IBS 文獻日報 · ${dateZh}（${weekday}）</title>
<meta name="description" content="腸躁症（IBS）每日研究文獻自動摘要報告 - ${dateZh}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f6f1e8;
    --surface: #fffaf2;
    --line: #d8c5ab;
    --text: #2b2118;
    --muted: #766453;
    --accent: #8c4f2b;
    --accent-soft: #ead2bf;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%);
    color: var(--text);
    font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif;
    min-height: 100vh;
    line-height: 1.7;
  }
  .container { max-width: 720px; margin: 0 auto; padding: 60px 24px 40px; }
  .header { text-align: center; margin-bottom: 40px; animation: fadeDown 0.6s ease; }
  .logo { font-size: 52px; margin-bottom: 12px; }
  h1 { font-size: 26px; color: var(--text); margin-bottom: 4px; font-weight: 700; }
  .date-line { color: var(--accent); font-size: 15px; font-weight: 500; }
  .report-meta { display: flex; justify-content: center; gap: 16px; color: var(--muted); font-size: 13px; margin-top: 12px; }

  .section { margin-bottom: 48px; animation: fadeUp 0.6s ease both; }
  .section-title {
    font-size: 18px; font-weight: 700; color: var(--accent);
    padding-bottom: 10px; margin-bottom: 20px;
    border-bottom: 2px solid var(--accent);
    display: flex; align-items: center; gap: 8px;
  }

  .summary-card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 16px; padding: 24px; margin-bottom: 32px;
    box-shadow: 0 2px 12px rgba(61,36,15,0.06);
    animation: fadeUp 0.6s ease both;
  }
  .summary-card p { font-size: 15px; line-height: 1.8; }

  .paper-card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 24px; padding: 24px; margin-bottom: 20px;
    box-shadow: 0 2px 12px rgba(61,36,15,0.06);
    animation: fadeUp 0.6s ease both;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .paper-card:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(61,36,15,0.1); }
  .top-pick { border-left: 4px solid var(--accent); }
  .other-paper { border-left: 4px solid var(--line); }

  .paper-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .rank-badge {
    background: var(--accent); color: #fff; font-size: 13px; font-weight: 700;
    padding: 2px 10px; border-radius: 20px;
  }
  .journal-badge {
    background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 500;
    padding: 2px 10px; border-radius: 20px;
  }
  .utility-badge {
    color: #fff; font-size: 11px; font-weight: 600;
    padding: 2px 10px; border-radius: 20px;
  }

  .paper-title-zh { font-size: 17px; font-weight: 600; color: var(--text); margin-bottom: 4px; line-height: 1.5; }
  .paper-title-en { font-size: 13px; color: var(--muted); margin-bottom: 10px; font-style: italic; line-height: 1.4; }
  .one-liner { font-size: 14px; line-height: 1.7; margin-bottom: 14px; }

  .pico-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
  .pico-item { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }
  .pico-label {
    background: var(--accent); color: #fff; font-weight: 700;
    min-width: 24px; height: 24px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 12px;
    flex-shrink: 0;
  }
  .pico-text { line-height: 1.5; }

  .utility-reason { font-size: 13px; color: var(--muted); margin-bottom: 12px; padding: 8px 12px; background: rgba(140,79,43,0.05); border-radius: 8px; }

  .paper-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .tag {
    background: rgba(140,79,43,0.08); color: var(--accent); font-size: 12px;
    padding: 2px 10px; border-radius: 12px; font-weight: 500;
  }

  .paper-link {
    display: inline-block; color: var(--accent); font-size: 13px;
    text-decoration: none; font-weight: 500;
    transition: color 0.2s;
  }
  .paper-link:hover { color: var(--text); }

  .topic-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .topic-name { min-width: 140px; font-size: 13px; text-align: right; color: var(--muted); }
  .topic-bar-container { flex: 1; height: 20px; background: rgba(140,79,43,0.08); border-radius: 10px; overflow: hidden; }
  .topic-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #c47a4a); border-radius: 10px; transition: width 0.6s ease; }
  .topic-count { min-width: 24px; font-size: 13px; font-weight: 600; color: var(--accent); }

  .keywords-section { text-align: center; }
  .keyword-chip {
    display: inline-block; background: var(--accent); color: #fff;
    font-size: 13px; padding: 4px 14px; border-radius: 20px;
    margin: 4px; font-weight: 500;
  }

  .footer {
    margin-top: 56px; padding-top: 24px;
    border-top: 1px solid var(--line); text-align: center;
  }
  .footer-links { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .footer-link {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--accent); text-decoration: none; font-size: 14px; font-weight: 500;
    padding: 8px 16px; background: var(--surface); border: 1px solid var(--line);
    border-radius: 24px; transition: all 0.2s;
  }
  .footer-link:hover { background: var(--accent-soft); border-color: var(--accent); }
  .footer-text { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .footer-text a { color: var(--muted); text-decoration: none; }
  .footer-text a:hover { color: var(--accent); }

  @keyframes fadeDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

  @media (max-width: 600px) {
    .container { padding: 40px 16px 24px; }
    .pico-grid { grid-template-columns: 1fr; }
    .topic-name { min-width: 100px; font-size: 12px; }
    .footer-links { flex-direction: column; align-items: center; }
  }
</style>
</head>
<body>
<div class="container">
  <header class="header">
    <div class="logo">🫁</div>
    <h1>IBS 文獻日報</h1>
    <p class="date-line">${dateZh}（${weekday}）</p>
    <div class="report-meta">
      <span>📊 ${totalCount} 篇文獻</span>
      <span>⭐ TOP ${topCount} 篇精選</span>
    </div>
  </header>

  <section class="section">
    <div class="section-title">📋 每日趨勢總結</div>
    <div class="summary-card">
      <p>${escapeHtml(analysis.daily_summary || '今日暫無文獻更新。')}</p>
    </div>
  </section>

  ${(analysis.top_papers || analysis.top_picks || []).length > 0 ? `
  <section class="section">
    <div class="section-title">⭐ TOP 精選論文</div>
    ${topPicksHTML}
  </section>` : ''}

  ${otherPapersHTML ? `
  <section class="section">
    <div class="section-title">📚 其他相關文獻</div>
    ${otherPapersHTML}
  </section>` : ''}

  ${topicEntries.length > 0 ? `
  <section class="section">
    <div class="section-title">📊 主題分布</div>
    ${topicsHTML}
  </section>` : ''}

  ${keywordsHTML ? `
  <section class="section keywords-section">
    <div class="section-title" style="justify-content:center">🏷️ 今日關鍵詞</div>
    ${keywordsHTML}
  </section>` : ''}

  <footer class="footer">
    <div class="footer-links">
      <a class="footer-link" href="https://www.leepsyclinic.com/" target="_blank" rel="noopener">🏥 李政洋身心診所</a>
      <a class="footer-link" href="https://blog.leepsyclinic.com/" target="_blank" rel="noopener">📬 訂閱電子報</a>
      <a class="footer-link" href="https://buymeacoffee.com/CYlee" target="_blank" rel="noopener">☕ Buy Me a Coffee</a>
    </div>
    <p class="footer-text">Powered by PubMed + Zhipu AI · <a href="https://github.com/u8901006/irritable-bowel-syndrome">GitHub</a></p>
  </footer>
</div>
</body>
</html>`;
}

function saveSummarizedPMIDs(date, pmids) {
  const filepath = 'summarized_history.json';
  let history = {};
  if (existsSync(filepath)) {
    try {
      history = JSON.parse(readFileSync(filepath, 'utf-8'));
    } catch {
      history = {};
    }
  }
  history[date] = pmids;
  writeFileSync(filepath, JSON.stringify(history, null, 2), 'utf-8');
}

async function main() {
  const opts = parseArgs();
  const apiKey = opts.apiKey || process.env.ZHIPU_API_KEY || '';
  if (!apiKey) {
    console.error('Error: ZHIPU_API_KEY not set');
    process.exit(1);
  }

  if (!opts.output) {
    console.error('Error: --output is required');
    process.exit(1);
  }

  let papersData = { count: 0, papers: [] };
  try {
    papersData = JSON.parse(readFileSync(opts.input, 'utf-8'));
  } catch {
    console.error('Warning: Could not read input file, generating empty report');
  }

  const date = papersData.date || new Date().toISOString().split('T')[0];
  const papers = papersData.papers || [];
  console.log(`Processing ${papers.length} papers for ${date}`);

  let analysis;
  if (papers.length === 0) {
    console.log('No papers to analyze, generating empty report');
    analysis = {
      daily_summary: '今日未找到符合條件的新文獻。可能是週末或假日，PubMed 未更新。請明天再查看。',
      top_picks: [],
      other_papers: [],
      topic_distribution: {},
      keywords: ['IBS', '腸躁症', 'gut-brain axis'],
      summarized_pmids: [],
    };
  } else {
    const userPrompt = buildUserPrompt(papers);
    analysis = await callZhipuAPI(apiKey, userPrompt);

    if (!analysis.top_picks) analysis.top_picks = analysis.top_papers || [];
    if (!analysis.other_papers) analysis.other_papers = [];
    if (!analysis.topic_distribution) analysis.topic_distribution = {};
    if (!analysis.keywords) analysis.keywords = [];
    if (!analysis.summarized_pmids) {
      analysis.summarized_pmids = [
        ...(analysis.top_picks || []).map((p) => p.pmid),
        ...(analysis.other_papers || []).map((p) => p.pmid),
      ];
    }
  }

  const html = generateHTML(analysis, date);

  const outDir = dirname(opts.output);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(opts.output, html, 'utf-8');
  console.log(`Report saved: ${opts.output}`);

  saveSummarizedPMIDs(date, analysis.summarized_pmids || []);
  console.log(`Saved ${analysis.summarized_pmids?.length || 0} PMIDs to history`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

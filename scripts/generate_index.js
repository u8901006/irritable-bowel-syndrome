#!/usr/bin/env node
// generate_index.js — Generate index.html listing all IBS daily reports
// Usage: node scripts/generate_index.js

import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = 'docs';
const MAX_SHOW = 60;

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
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
}

function main() {
  let files = [];
  try {
    files = readdirSync(DOCS_DIR)
      .filter((f) => f.startsWith('ibs-') && f.endsWith('.html') && f !== 'index.html')
      .map((f) => {
        const dateStr = f.replace('ibs-', '').replace('.html', '');
        return { filename: f, date: dateStr };
      })
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_SHOW);
  } catch {
    files = [];
  }

  const count = files.length;

  const listItems = files
    .map(
      (f) =>
        `<li><a href="${f.filename}">📅 ${formatDateChinese(f.date)}（${getWeekday(f.date)}）</a></li>`
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IBS 腸躁症文獻日報</title>
<meta name="description" content="腸躁症（IBS）每日研究文獻自動摘要報告 - Irritable Bowel Syndrome Daily Research Digest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; }
  .container { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 80px 24px; }
  .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
  h1 { text-align: center; font-size: 24px; color: var(--text); margin-bottom: 8px; }
  .subtitle { text-align: center; color: var(--accent); font-size: 14px; margin-bottom: 48px; }
  .count { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 32px; }
  ul { list-style: none; }
  li { margin-bottom: 8px; }
  a { color: var(--text); text-decoration: none; display: block; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; transition: all 0.2s; font-size: 15px; }
  a:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  .footer { margin-top: 56px; text-align: center; }
  .footer-links { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .footer-link {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 500;
    padding: 6px 14px; background: var(--surface); border: 1px solid var(--line);
    border-radius: 20px; transition: all 0.2s;
  }
  .footer-link:hover { background: var(--accent-soft); border-color: var(--accent); }
  .footer-text { font-size: 12px; color: var(--muted); }
  .footer-text a { display: inline; padding: 0; background: none; border: none; color: var(--muted); }
  .footer-text a:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <div class="logo">🫁</div>
  <h1>IBS 腸躁症文獻日報</h1>
  <p class="subtitle">Irritable Bowel Syndrome Daily Research Digest · 每日自動更新</p>
  <p class="count">共 ${count} 期日報</p>
  <ul>
${listItems}
  </ul>
  <div class="footer">
    <div class="footer-links">
      <a class="footer-link" href="https://www.leepsyclinic.com/" target="_blank" rel="noopener">🏥 李政洋身心診所</a>
      <a class="footer-link" href="https://blog.leepsyclinic.com/" target="_blank" rel="noopener">📬 訂閱電子報</a>
      <a class="footer-link" href="https://buymeacoffee.com/CYlee" target="_blank" rel="noopener">☕ Buy Me a Coffee</a>
    </div>
    <p class="footer-text">Powered by PubMed + Zhipu AI · <a href="https://github.com/u8901006/irritable-bowel-syndrome">GitHub</a></p>
  </div>
</div>
</body>
</html>`;

  writeFileSync(join(DOCS_DIR, 'index.html'), html, 'utf-8');
  console.log(`Index generated: ${count} reports listed`);
}

main();

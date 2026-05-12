#!/usr/bin/env node
// fetch_papers.js — Fetch recent IBS literature from PubMed E-Utilities API
// Usage: node scripts/fetch_papers.js --days 7 --max-papers 40 --output papers.json

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const IBS_JOURNALS = [
  'Gastroenterology',
  'Gut',
  'American Journal of Gastroenterology',
  'Clinical Gastroenterology and Hepatology',
  'Neurogastroenterology and Motility',
  'Journal of Neurogastroenterology and Motility',
  'Alimentary Pharmacology and Therapeutics',
  'Digestive Diseases and Sciences',
  'Lancet Gastroenterology and Hepatology',
  'BMJ',
  'BMJ Open',
  'Pain',
  'Journal of Pain',
  'Brain Behavior and Immunity',
  'Psychoneuroendocrinology',
  'Psychosomatic Medicine',
  'Journal of Psychosomatic Research',
  'Behaviour Research and Therapy',
  'Journal of Affective Disorders',
  'American Journal of Clinical Nutrition',
  'Clinical Nutrition',
  'Nutrients',
  'Gut Microbes',
  'Microbiome',
  'British Journal of Sports Medicine',
  'Medicine and Science in Sports and Exercise',
  'Sports Medicine',
  'Journal of Pediatric Gastroenterology and Nutrition',
  'Cochrane Database of Systematic Reviews',
  'PLOS ONE',
  'Frontiers in Neuroscience',
  'Frontiers in Pain Research',
  'BMC Gastroenterology',
];

const SEARCH_QUERIES = [
  '("Irritable Bowel Syndrome"[Mesh] OR "irritable bowel syndrome"[tiab] OR IBS[tiab]) AND ("gut-brain axis"[tiab] OR "brain-gut axis"[tiab] OR "disorder of gut-brain interaction"[tiab] OR DGBI[tiab] OR "visceral hypersensitivity"[tiab])',
  '("Irritable Bowel Syndrome"[Mesh] OR IBS[tiab]) AND ("low FODMAP"[tiab] OR FODMAP[tiab] OR probiotics[tiab] OR microbiome[tiab] OR microbiota[tiab])',
  '("Irritable Bowel Syndrome"[Mesh] OR IBS[tiab]) AND (anxiety[tiab] OR depression[tiab] OR CBT[tiab] OR "gut-directed hypnotherapy"[tiab] OR mindfulness[tiab] OR catastrophizing[tiab])',
  '("Irritable Bowel Syndrome"[Mesh] OR IBS[tiab]) AND (exercise[tiab] OR "physical activity"[tiab] OR yoga[tiab] OR sleep[tiab])',
  '("Irritable Bowel Syndrome"[Mesh] OR IBS[tiab]) AND ("randomized controlled trial"[pt] OR "systematic review"[pt] OR "meta-analysis"[pt])',
  '("Irritable Bowel Syndrome"[Mesh] OR IBS[tiab]) AND ("visceral pain"[tiab] OR "central sensitization"[tiab] OR fMRI[tiab] OR neuroimaging[tiab])',
  '("Irritable Bowel Syndrome"[Mesh] OR IBS[tiab]) AND (trauma[tiab] OR PTSD[tiab] OR "adverse childhood experiences"[tiab] OR "early life stress"[tiab])',
  '("Irritable Bowel Syndrome"[Mesh] OR IBS[tiab]) AND (pediatric[tiab] OR paediatric[tiab] OR child[tiab] OR adolescent[tiab])',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: 7, maxPapers: 40, output: 'papers.json', summarizedFile: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) opts.days = parseInt(args[++i], 10);
    else if (args[i] === '--max-papers' && args[i + 1]) opts.maxPapers = parseInt(args[++i], 10);
    else if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
    else if (args[i] === '--summarized' && args[i + 1]) opts.summarizedFile = args[++i];
  }
  return opts;
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'IBSResearchBot/1.0 (mailto:research@leepsyclinic.com)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchXML(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'IBSResearchBot/1.0 (mailto:research@leepsyclinic.com)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function buildDateFilter(days) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const fmt = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return `"${fmt(start)}"[Date - Publication] : "${fmt(end)}"[Date - Publication]`;
}

function buildJournalFilter() {
  return IBS_JOURNALS.map((j) => `"${j}"[Journal]`).join(' OR ');
}

function loadSummarizedPMIDs(filepath) {
  if (!filepath || !existsSync(filepath)) return new Set();
  try {
    const data = JSON.parse(readFileSync(filepath, 'utf-8'));
    if (data.summarized_pmids && Array.isArray(data.summarized_pmids)) {
      return new Set(data.summarized_pmids);
    }
    if (data.papers && Array.isArray(data.papers)) {
      return new Set(data.papers.map((p) => p.pmid));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

function parsePapersFromXML(xmlText) {
  const papers = [];
  const articles = xmlText.split('<PubmedArticle>').slice(1);

  for (const article of articles) {
    try {
      const getTag = (tag) => {
        const m = article.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
      };

      const pmid = getTag('PMID');
      const title = getTag('ArticleTitle');
      if (!pmid || !title) continue;

      const abstractMatch = article.match(/<Abstract>([\s\S]*?)<\/Abstract>/);
      let abstract = '';
      if (abstractMatch) {
        const texts = abstractMatch[1].match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g);
        if (texts) {
          abstract = texts
            .map((t) => {
              const label = t.match(/Label="([^"]+)"/);
              const text = t.replace(/<[^>]+>/g, '').trim();
              return label ? `${label[1]}: ${text}` : text;
            })
            .join(' ');
        }
      }

      const journalMatch = article.match(/<Title>([\\s\\S]*?)<\/Title>/);
      const journal = journalMatch ? journalMatch[1].trim() : '';

      const dateMatch = article.match(/<PubDate>([\s\S]*?)<\/PubDate>/);
      let date = '';
      if (dateMatch) {
        const y = dateMatch[1].match(/<Year>(\d+)<\/Year>/);
        const m = dateMatch[1].match(/<Month>(\d+)<\/Month>/);
        const d = dateMatch[1].match(/<Day>(\d+)<\/Day>/);
        if (y) date = y[1] + (m ? `-${m[1].padStart(2, '0')}` : '') + (d ? `-${d[1].padStart(2, '0')}` : '');
      }

      const keywords = [];
      const kwMatches = article.matchAll(/<Keyword>([\s\S]*?)<\/Keyword>/g);
      for (const km of kwMatches) {
        const kw = km[1].trim();
        if (kw) keywords.push(kw);
      }

      papers.push({
        pmid,
        title,
        journal,
        date,
        abstract: abstract.substring(0, 3000),
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        keywords: keywords.slice(0, 10),
      });
    } catch {
      continue;
    }
  }
  return papers;
}

async function searchAndFetch(query, dateFilter, maxResults) {
  const searchUrl = new URL(`${EUTILS_BASE}/esearch.fcgi`);
  searchUrl.searchParams.set('db', 'pubmed');
  searchUrl.searchParams.set('term', `${query} AND ${dateFilter} AND humans[MeSH Terms]`);
  searchUrl.searchParams.set('retmax', String(maxResults));
  searchUrl.searchParams.set('retmode', 'json');
  searchUrl.searchParams.set('sort', 'date');

  console.log(`  Searching: ${query.substring(0, 80)}...`);
  const searchData = await fetchJSON(searchUrl.toString());
  const idList = searchData?.esearchresult?.idlist || [];
  if (idList.length === 0) return [];

  const fetchUrl = new URL(`${EUTILS_BASE}/efetch.fcgi`);
  fetchUrl.searchParams.set('db', 'pubmed');
  fetchUrl.searchParams.set('id', idList.join(','));
  fetchUrl.searchParams.set('rettype', 'xml');
  fetchUrl.searchParams.set('retmode', 'xml');

  const xmlText = await fetchXML(fetchUrl.toString());
  return parsePapersFromXML(xmlText);
}

async function main() {
  const opts = parseArgs();
  console.log(`Fetching IBS papers: last ${opts.days} days, max ${opts.maxPapers}`);

  const dateFilter = buildDateFilter(opts.days);
  const summarizedPMIDs = loadSummarizedPMIDs(opts.summarizedFile);
  console.log(`Already summarized PMIDs: ${summarizedPMIDs.size}`);

  const allPapers = new Map();

  for (const query of SEARCH_QUERIES) {
    try {
      const papers = await searchAndFetch(query, dateFilter, 50);
      for (const p of papers) {
        if (!allPapers.has(p.pmid) && !summarizedPMIDs.has(p.pmid)) {
          allPapers.set(p.pmid, p);
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  Query failed: ${err.message}`);
    }
  }

  const papers = Array.from(allPapers.values())
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, opts.maxPapers);

  const result = {
    date: new Date().toISOString().split('T')[0],
    count: papers.length,
    papers,
  };

  writeFileSync(opts.output, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Saved ${papers.length} papers to ${opts.output}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

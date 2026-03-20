#!/usr/bin/env node
/**
 * enrich-covers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads your Goodreads CSV export, fetches cover images for every book, and
 * writes a covers.json file. Commit both files to GitHub — the web app reads
 * covers.json directly instead of making live API calls.
 *
 * Usage:
 *   node enrich-covers.js
 *   node enrich-covers.js --csv my_export.csv
 *   node enrich-covers.js --force   (re-fetch all, ignoring existing covers)
 *
 * Requirements:
 *   Node.js 18+ (uses built-in fetch)
 *   No npm install needed.
 *
 * Cover sources tried in order:
 *   1. Open Library  — great for classics, literary fiction, international
 *   2. Google Books  — good for newer/popular titles
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const CSV_FILE    = process.argv.includes('--csv')
  ? process.argv[process.argv.indexOf('--csv') + 1]
  : 'goodreads_library_export.csv';

const COVERS_FILE = 'covers.json';
const FORCE       = process.argv.includes('--force');
const DELAY_MS    = 300;   // polite delay between API calls (ms)
const MAX_RETRIES = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg)  { process.stdout.write(msg + '\n'); }
function info(msg) { process.stdout.write('  ' + msg + '\n'); }

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'myshelf-cover-enricher/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      return res;
    } catch (e) {
      if (i === retries) return null;
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV appears empty');

  const parseRow = line => {
    const r = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { r.push(cur); cur = ''; }
      else cur += c;
    }
    r.push(cur); return r;
  };

  const headers = parseRow(lines[0]).map(h => h.trim().toLowerCase().replace(/"/g, ''));
  const idx = {
    id:     headers.findIndex(h => h === 'book id'),
    title:  headers.findIndex(h => h.includes('title')),
    author: headers.findIndex(h => h.includes('author') && !h.includes('additional')),
    isbn13: headers.findIndex(h => h === 'isbn13'),
    isbn:   headers.findIndex(h => h === 'isbn'),
  };

  const books = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    if (cols.length < 3) continue;
    const g = j => (j >= 0 && cols[j]) ? cols[j].trim().replace(/^=?"?|"?$/g, '') : '';

    const title  = g(idx.title);
    const author = g(idx.author);
    if (!title) continue;

    // Prefer ISBN-13, fall back to ISBN-10
    const isbn = g(idx.isbn13).replace(/[^0-9X]/gi, '') ||
                 g(idx.isbn).replace(/[^0-9X]/gi, '');

    books.push({ id: g(idx.id) || `row_${i}`, title, author, isbn });
  }
  return books;
}

// ── Cover fetchers ────────────────────────────────────────────────────────────

/**
 * Open Library: if we have an ISBN, just test whether the cover exists.
 * Their cover URL is deterministic — no API call needed, just a HEAD request.
 */
async function fetchOpenLibraryCover(book) {
  if (!book.isbn) return null;

  // Try ISBN-13 first, then ISBN-10 if available
  const isbns = [book.isbn];
  if (book.isbn.length === 13 && book.isbn.startsWith('978')) {
    // Derive ISBN-10 from ISBN-13
    const core = book.isbn.slice(3, 12);
    const check = (11 - (core.split('').reduce((s,d,i) => s + parseInt(d) * (10 - i), 0) % 11)) % 11;
    isbns.push(core + (check === 10 ? 'X' : check));
  }

  for (const isbn of isbns) {
    const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    const res = await fetchWithRetry(url);
    // Open Library returns a 1×1 gif for missing covers
    if (res && res.ok && parseInt(res.headers.get('content-length') || '9999') > 1000) {
      return url;
    }
    await sleep(100);
  }

  return null;
}

/**
 * Open Library Search: fallback for books without ISBN.
 * Searches by title+author and gets a cover key.
 */
async function fetchOpenLibrarySearch(book) {
  const q = encodeURIComponent(`${book.title} ${book.author}`);
  const url = `https://openlibrary.org/search.json?q=${q}&fields=key,cover_i&limit=1`;
  const res = await fetchWithRetry(url);
  if (!res || !res.ok) return null;

  try {
    const data = await res.json();
    const doc = data?.docs?.[0];
    if (doc?.cover_i) {
      return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
    }
  } catch(e) {}
  return null;
}

/**
 * Google Books: search by ISBN first, then title+author.
 */
async function fetchGoogleBooksCover(book) {
  const queries = book.isbn
    ? [`isbn:${book.isbn}`, `intitle:${book.title} inauthor:${book.author}`]
    : [`intitle:${book.title} inauthor:${book.author}`];

  for (const q of queries) {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1&fields=items(volumeInfo(imageLinks))`;
    const res = await fetchWithRetry(url);
    if (!res || !res.ok) continue;

    try {
      const data = await res.json();
      const links = data?.items?.[0]?.volumeInfo?.imageLinks;
      if (links) {
        // Prefer large cover, fall back to thumbnail, force HTTPS and bump zoom
        const cover = (links.large || links.medium || links.thumbnail || links.smallThumbnail)
          .replace('http:', 'https:')
          .replace('zoom=1', 'zoom=3')
          .replace('&edge=curl', '');
        return cover;
      }
    } catch(e) {}
    await sleep(DELAY_MS);
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('\n📚 myshelf cover enricher\n' + '─'.repeat(50));

  // Load CSV
  const csvPath = path.resolve(__dirname, CSV_FILE);
  if (!fs.existsSync(csvPath)) {
    log(`\n❌  CSV not found: ${csvPath}`);
    log(`    Make sure "${CSV_FILE}" is in the same folder as this script.\n`);
    process.exit(1);
  }

  const books = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  log(`📖  Found ${books.length} books in CSV`);

  // Load existing covers
  const coversPath = path.resolve(__dirname, COVERS_FILE);
  let covers = {};
  if (fs.existsSync(coversPath) && !FORCE) {
    covers = JSON.parse(fs.readFileSync(coversPath, 'utf8'));
    const existing = Object.keys(covers).filter(k => covers[k]).length;
    log(`🗂️   Loaded ${existing} existing covers from ${COVERS_FILE}`);
  } else if (FORCE) {
    log(`⚡  --force flag: re-fetching all covers`);
  }

  // Find books that need covers
  const todo = books.filter(b => !covers[b.id] || covers[b.id] === null);
  log(`🔍  ${todo.length} books need covers\n`);

  if (todo.length === 0) {
    log('✅  Nothing to do! All books already have covers.\n');
    return;
  }

  let found = 0, notFound = 0;

  for (let i = 0; i < todo.length; i++) {
    const book = todo[i];
    const progress = `[${String(i + 1).padStart(String(todo.length).length)}/${todo.length}]`;
    process.stdout.write(`${progress} ${book.title.slice(0, 50).padEnd(50)} `);

    let cover = null;

    // 1. Open Library by ISBN (fastest, no search)
    if (!cover && book.isbn) {
      cover = await fetchOpenLibraryCover(book);
      if (cover) process.stdout.write('→ OpenLib (ISBN) ');
      await sleep(DELAY_MS);
    }

    // 2. Open Library by search
    if (!cover) {
      cover = await fetchOpenLibrarySearch(book);
      if (cover) process.stdout.write('→ OpenLib (search) ');
      await sleep(DELAY_MS);
    }

    // 3. Google Books
    if (!cover) {
      cover = await fetchGoogleBooksCover(book);
      if (cover) process.stdout.write('→ Google Books ');
      await sleep(DELAY_MS);
    }

    if (cover) {
      covers[book.id] = cover;
      found++;
      process.stdout.write('✓\n');
    } else {
      covers[book.id] = null;
      notFound++;
      process.stdout.write('✗ not found\n');
    }

    // Save incrementally every 10 books
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(coversPath, JSON.stringify(covers, null, 2));
    }
  }

  // Final save
  fs.writeFileSync(coversPath, JSON.stringify(covers, null, 2));

  const total = Object.keys(covers).filter(k => covers[k]).length;
  log('\n' + '─'.repeat(50));
  log(`✅  Done!`);
  log(`   Found:     ${found} new covers`);
  log(`   Not found: ${notFound} books`);
  log(`   Total:     ${total}/${books.length} books have covers`);
  log(`   Saved to:  ${COVERS_FILE}`);
  log('\n📌  Next steps:');
  log('   1. Commit covers.json to your GitHub repo');
  log('   2. Update GITHUB_COVERS_URL in index.html');
  log('   3. Open your app — all covers will load instantly!\n');
}

main().catch(err => {
  log(`\n❌  Error: ${err.message}\n`);
  process.exit(1);
});

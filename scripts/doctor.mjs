#!/usr/bin/env node

import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const results = [];
const contents = [];
const categories = ['front matter', 'URL', '.html migration', 'images', 'internal links', 'SEO', 'sitemap'];

function report(severity, category, file, message, value = null) {
  results.push({ severity, category, file, message, value });
}

function stripComment(value) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote === '"') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

function scalar(source, lineNumber) {
  const value = stripComment(source.trim());
  if (!value) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new Error(`line ${lineNumber}: malformed inline array`);
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const values = [];
    let start = 0; let quote = null; let escaped = false;
    for (let i = 0; i <= inner.length; i += 1) {
      const char = inner[i];
      if (escaped) { escaped = false; continue; }
      if (char === '\\' && quote === '"') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === ',' || i === inner.length) {
        const item = inner.slice(start, i).trim();
        if (!item) throw new Error(`line ${lineNumber}: empty inline array item`);
        if (item.startsWith('[') || item.startsWith('{')) throw new Error(`line ${lineNumber}: nested inline values are unsupported`);
        values.push(scalar(item, lineNumber)); start = i + 1;
      }
    }
    return values;
  }
  if (value[0] === '"' || value[0] === "'") {
    const quote = value[0];
    if (value.at(-1) !== quote) throw new Error(`line ${lineNumber}: unterminated quoted string`);
    if (quote === '"') {
      try { return JSON.parse(value); } catch { throw new Error(`line ${lineNumber}: invalid quoted string`); }
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[\[{>|&*!]/.test(value) || /^[-+]?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`line ${lineNumber}: unsupported YAML value`);
  }
  return value;
}

function parseFrontMatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') throw new Error('front matter opening delimiter is missing');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('front matter closing delimiter is missing');
  const data = {};
  for (let i = 1; i < end; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const top = raw.match(/^([A-Za-z_][\w-]*):(?:\s*(.*))?$/);
    if (!top) throw new Error(`line ${i + 1}: unsupported YAML structure`);
    const [, key, rest = ''] = top;
    if (Object.hasOwn(data, key)) throw new Error(`line ${i + 1}: duplicate key ${key}`);
    if (rest.trim()) { data[key] = scalar(rest, i + 1); continue; }
    if (key !== 'photos') throw new Error(`line ${i + 1}: unsupported block value for ${key}`);
    const photos = [];
    while (i + 1 < end) {
      if (!lines[i + 1].trim() || lines[i + 1].trimStart().startsWith('#')) { i += 1; continue; }
      if (!/^\s+/.test(lines[i + 1])) break;
      i += 1;
      const item = lines[i].match(/^\s{2}-\s+src:\s*(.*)$/);
      if (!item) throw new Error(`line ${i + 1}: photos only supports "- src:" entries`);
      const photo = { src: scalar(item[1], i + 1) };
      if (i + 1 < end && /^\s{4}caption:/.test(lines[i + 1])) {
        i += 1;
        photo.caption = scalar(lines[i].replace(/^\s{4}caption:\s*/, ''), i + 1);
      }
      if (i + 1 < end && /^\s+/.test(lines[i + 1]) && !/^\s{2}-\s+src:/.test(lines[i + 1])) {
        throw new Error(`line ${i + 2}: photos only supports src and caption`);
      }
      photos.push(photo);
    }
    data.photos = photos;
  }
  return { frontMatter: data, body: lines.slice(end + 1).join('\n') };
}

async function markdownFiles(directory, collection) {
  const dir = path.join(root, directory);
  const entries = await readdir(dir, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isFile() && /\.md$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {
    const file = path.join(dir, entry.name);
    const text = await readFile(file, 'utf8');
    const content = { path: relative(file), file, collection, slug: entry.name.replace(/\.md$/i, ''), frontMatter: {}, body: '', parseError: null };
    try { Object.assign(content, parseFrontMatter(text)); } catch (error) { content.parseError = error.message; report('FAIL', 'front matter', content.path, error.message, null); }
    return content;
  }));
}

function validateFrontMatter(content) {
  if (content.parseError) return;
  const fm = content.frontMatter;
  const required = content.collection === 'note'
    ? ['title', 'description', 'date', 'last_modified_at', 'permalink', 'image', 'image_alt', 'tags']
    : ['title', 'description', 'date', 'last_modified_at', 'date_display', 'permalink', 'image', 'image_alt', 'photos'];
  for (const key of required) {
    if (!Object.hasOwn(fm, key) || fm[key] === '') report('FAIL', 'front matter', content.path, `required field "${key}" is missing`, key);
  }
  for (const key of ['title', 'description', 'date', 'last_modified_at', 'date_display', 'permalink', 'image', 'image_alt']) {
    if (Object.hasOwn(fm, key) && typeof fm[key] !== 'string') report('FAIL', 'front matter', content.path, `"${key}" must be a string`, fm[key]);
  }
  if (Object.hasOwn(fm, 'tags') && (!Array.isArray(fm.tags) || fm.tags.some((tag) => typeof tag !== 'string'))) report('FAIL', 'front matter', content.path, '"tags" must be an inline array of strings', fm.tags);
  for (const key of ['noindex', 'sitemap']) if (Object.hasOwn(fm, key) && typeof fm[key] !== 'boolean') report('FAIL', 'front matter', content.path, `"${key}" must be boolean`, fm[key]);
  if (Object.hasOwn(fm, 'photos')) {
    if (!Array.isArray(fm.photos) || fm.photos.some((photo) => typeof photo.src !== 'string' || typeof photo.caption !== 'string')) report('FAIL', 'front matter', content.path, 'each photo must have string src and caption fields', fm.photos);
  }
}

function diagnoseUrls() {
  const byRoute = new Map();
  for (const content of contents) {
    if (content.parseError) continue;
    const route = content.frontMatter.permalink;
    const expected = `/${content.collection === 'note' ? 'notes' : 'memory'}/${content.slug}/`;
    if (typeof route !== 'string') continue;
    if (!route.startsWith('/') || !route.endsWith('/')) report('FAIL', 'URL', content.path, 'permalink must have leading and trailing slashes', route);
    if (/\.html(?:\/)?$/i.test(route)) report('FAIL', 'URL', content.path, 'normal content permalink must not contain .html', route);
    if (route !== expected) report('FAIL', 'URL', content.path, 'permalink does not match its collection and filename slug', { expected, actual: route });
    const peers = byRoute.get(route) ?? []; peers.push(content); byRoute.set(route, peers);
  }
  for (const [route, peers] of byRoute) if (peers.length > 1) for (const peer of peers) report('FAIL', 'URL', peer.path, 'duplicate permalink', route);
  for (let i = 0; i < contents.length; i += 1) for (let j = i + 1; j < contents.length; j += 1) {
    const a = contents[i].frontMatter.permalink; const b = contents[j].frontMatter.permalink;
    if (typeof a === 'string' && typeof b === 'string' && a !== b && a.toLowerCase() === b.toLowerCase()) report('WARN', 'URL', contents[j].path, `route differs only by case from ${contents[i].path}`, b);
  }
}

function references(text) {
  const found = [];
  for (const match of text.matchAll(/!?\[[^\]]*\]\(/g)) {
    const start = match.index + match[0].length;
    const angle = text[start] === '<';
    let index = start + (angle ? 1 : 0);
    let depth = 0;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (character === '\\') { index += 1; continue; }
      if (angle && character === '>') break;
      if (!angle && character === '(') { depth += 1; continue; }
      if (!angle && character === ')') {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if (!angle && depth === 0 && /\s/.test(character)) break;
    }
    const reference = text.slice(start + (angle ? 1 : 0), index);
    if (reference) found.push(reference.replace(/\\([()])/g, '$1'));
  }
  for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) found.push(match[1]);
  return found;
}

function isLocal(value) { return typeof value === 'string' && value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\{\{)/i.test(value); }
function cleanReference(value) { try { return decodeURIComponent(value.split(/[?#]/, 1)[0]); } catch { return value.split(/[?#]/, 1)[0]; } }
function imagePath(value, content) {
  const clean = cleanReference(value);
  if (clean.startsWith('/images/')) return path.join(root, clean.slice(1));
  if (clean.startsWith('../images/')) return path.join(root, clean.slice(3));
  if (clean.startsWith('images/')) return path.join(root, clean);
  return path.resolve(path.dirname(content.file), clean);
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function diagnoseMigrationAndImages() {
  for (const content of contents) {
    const fmText = JSON.stringify(content.frontMatter);
    for (const match of `${fmText}\n${content.body}`.matchAll(/\/(?:notes|memory)\/[^\s"'<>)]*\.html(?:[?#][^\s"'<>)]*)?/gi)) report('FAIL', '.html migration', content.path, 'legacy .html content URL remains', match[0]);
    const candidates = [];
    if (typeof content.frontMatter.image === 'string') candidates.push({ value: content.frontMatter.image, source: 'image' });
    for (const photo of content.frontMatter.photos ?? []) candidates.push({ value: photo.src, source: 'photo' });
    for (const value of references(content.body)) if (/\.(?:avif|gif|jpe?g|png|svg|webp|m4v|mov|mp4|webm)(?:[?#]|$)/i.test(value)) candidates.push({ value, source: 'body' });
    const seen = new Map();
    for (const candidate of candidates) {
      if (!isLocal(candidate.value)) continue;
      const normalized = imagePath(candidate.value, content);
      if (!await exists(normalized)) report('FAIL', 'images', content.path, 'local image does not exist', candidate.value);
      const key = `${candidate.source}:${normalized}`;
      if (seen.has(key)) report('WARN', 'images', content.path, 'duplicate image reference in the same content', candidate.value);
      seen.set(key, true);
    }
  }
}

async function staticRoutes() {
  const routes = new Set(['/']);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('_') || entry.name === 'legacy-memory' || entry.name === 'scripts') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.html?$/.test(entry.name)) {
        const rel = relative(file); routes.add(rel.endsWith('/index.html') ? `/${rel.slice(0, -10)}` : `/${rel}`);
        const text = await readFile(file, 'utf8');
        const match = text.match(/^---[\s\S]*?^permalink:\s*["']?([^\s"']+)/m); if (match) routes.add(match[1]);
      }
    }
  }
  await walk(root); return routes;
}

async function diagnoseInternalLinks() {
  const known = await staticRoutes();
  for (const content of contents) if (!content.parseError && typeof content.frontMatter.permalink === 'string') known.add(content.frontMatter.permalink);
  for (const content of contents) for (const raw of references(content.body)) {
    if (!isLocal(raw) || !raw.startsWith('/')) continue;
    let value = cleanReference(raw); if (value === '/tecirc') value = '/'; else if (value.startsWith('/tecirc/')) value = value.slice('/tecirc'.length);
    if (!/^\/(?:notes|memory|images)\//.test(value)) continue;
    const valid = value.startsWith('/images/') ? await exists(path.join(root, value.slice(1))) : known.has(value);
    if (!valid) report('FAIL', 'internal links', content.path, 'internal link target does not exist', raw);
  }
}

async function contains(file, checks, category) {
  const full = path.join(root, file);
  let text;
  try { text = await readFile(full, 'utf8'); } catch { report('FAIL', category, file, 'required file does not exist', file); return; }
  for (const [label, pattern] of checks) if (!pattern.test(text)) report('FAIL', category, file, `required ${label} structure is missing`, label);
}

async function diagnoseTemplates() {
  await contains('_includes/seo.html', [
    ['canonical', /rel=["']canonical["'][^>]*seo_url/], ['og:title', /property=["']og:title["']/], ['og:url', /property=["']og:url["']/], ['og:image', /property=["']og:image["']/],
    ['Twitter Card', /name=["']twitter:card["']/], ['sitemap link', /rel=["']sitemap["'][^>]*sitemap\.xml/]
  ], 'SEO');
  for (const file of ['_layouts/note.html', '_layouts/memory.html']) await contains(file, [['seo.html include', /\{%\s*include\s+seo\.html\s*%\}/]], 'SEO');
  await contains('sitemap.xml', [
    ['site.notes', /site\.notes/], ['site.memories', /site\.memories/],
    ['note noindex/sitemap exclusion', /unless\s+note\.noindex\s+or\s+note\.sitemap\s*==\s*false/],
    ['memory noindex/sitemap exclusion', /unless\s+memory\.noindex\s+or\s+memory\.sitemap\s*==\s*false/]
  ], 'sitemap');
}

function output(json) {
  const warnings = results.filter((item) => item.severity === 'WARN');
  const errors = results.filter((item) => item.severity === 'FAIL');
  const payload = { status: errors.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS', notes: contents.filter((c) => c.collection === 'note').length, memories: contents.filter((c) => c.collection === 'memory').length, contents: contents.length, warnings, errors };
  if (json) { process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`); return payload; }
  console.log('Tecirc Doctor');
  for (const category of categories) {
    const items = results.filter((item) => item.category === category);
    const status = items.some((i) => i.severity === 'FAIL') ? 'FAIL' : items.some((i) => i.severity === 'WARN') ? 'WARN' : 'PASS';
    console.log(`\n[${status}] ${category} (${items.length ? `${items.filter((i) => i.severity === 'FAIL').length} fail, ${items.filter((i) => i.severity === 'WARN').length} warn` : 'no issues'})`);
    for (const item of items) console.log(`  ${item.severity} ${item.file}: ${item.message}${item.value === null ? '' : ` — ${JSON.stringify(item.value)}`}`);
  }
  console.log(`\nContents: ${payload.contents} (${payload.notes} notes, ${payload.memories} memories)`);
  console.log(`Results: ${errors.length} FAIL, ${warnings.length} WARN`);
  console.log(`Health: ${payload.status}`);
  return payload;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const invalid = args.filter((arg) => arg !== '--json');
  if (invalid.length) {
    const error = { severity: 'FAIL', category: 'CLI', file: 'scripts/doctor.mjs', message: 'unknown command-line argument', value: invalid[0] };
    if (json) process.stdout.write(`${JSON.stringify({ status: 'FAIL', notes: 0, memories: 0, contents: 0, warnings: [], errors: [error] }, null, 2)}\n`);
    else console.error(`FAIL CLI: ${error.message} — ${error.value}`);
    process.exitCode = 1; return;
  }
  contents.push(...await markdownFiles('_notes', 'note'), ...await markdownFiles('_memories', 'memory'));
  for (const content of contents) validateFrontMatter(content);
  diagnoseUrls();
  await diagnoseMigrationAndImages();
  await diagnoseInternalLinks();
  await diagnoseTemplates();
  const payload = output(json);
  process.exitCode = payload.errors.length ? 1 : 0;
}

try { await main(); } catch (error) {
  const json = process.argv.slice(2).includes('--json');
  const problem = { severity: 'FAIL', category: 'runtime', file: 'scripts/doctor.mjs', message: error instanceof Error ? error.message : String(error), value: null };
  if (json) process.stdout.write(`${JSON.stringify({ status: 'FAIL', notes: 0, memories: 0, contents: 0, warnings: [], errors: [problem] }, null, 2)}\n`);
  else console.error(`FAIL runtime: ${problem.message}`);
  process.exitCode = 1;
}

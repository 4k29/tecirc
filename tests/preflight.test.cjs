const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const Preflight = require('../editor/preflight.js');

function note(overrides = {}, paths = []) {
  const data = Object.assign({
    title: 'Title', slug: 'new-note', date: '2026-09-30', description: 'Description',
    image: '/images/ogp/new-note.png', imageAlt: 'Alt', tags: [], body: 'Body'
  }, overrides);
  return Preflight.note({ data, permalink: `/notes/${data.slug}/`, repositoryPaths: async () => paths });
}

function memory(overrides = {}, paths = []) {
  const record = {
    metadata: Object.assign({ title: 'Place', slug: 'new-memory', date: '2026-09-30', dateDisplay: '2026.09.30', description: 'Description' }, overrides.metadata),
    photos: overrides.photos || [{ caption: 'Photo', blob: new Blob(['photo'], { type: 'image/webp' }) }]
  };
  return Preflight.memory({
    record,
    permalink: `/memory/${record.metadata.slug}/`,
    image: `/images/memory/${record.metadata.slug}-01.webp`,
    imageAlt: record.photos[0] && record.photos[0].caption,
    photoPath: (item, index) => `/images/memory/${item.metadata.slug}-${String(index + 1).padStart(2, '0')}.webp`,
    repositoryPaths: async () => paths
  });
}

test('Note: valid content passes', async () => {
  assert.equal((await note({}, ['images/ogp/new-note.png'])).status, 'PASS');
});
test('Note: empty slug fails', async () => {
  assert.equal((await note({ slug: '' }, ['images/ogp/new-note.png'])).status, 'FAIL');
});
test('Note: an HTML-like slug fails', async () => {
  assert.equal((await note({ slug: 'post.html' }, ['images/ogp/new-note.png'])).status, 'FAIL');
});
test('Note: missing OGP image fails', async () => {
  const result = await note();
  assert.equal(result.status, 'FAIL');
  assert.match(result.errors.join('\n'), /OGP画像が見つかりません/);
});
test('Note: checks body image paths containing parentheses', async () => {
  const result = await note({ body: '![Headphones](../images/notes/product(1).png)' }, ['images/ogp/new-note.png']);
  assert.equal(result.status, 'FAIL');
  assert.match(result.errors.join('\n'), /\/images\/notes\/product\(1\)\.png/);
});
test('Markdown references preserve balanced and escaped parentheses', () => {
  assert.deepEqual(Preflight.references([
    '[one](/notes/topic_(detail)/)',
    '![two](../images/notes/photo\\(1\\).webp "caption")',
    '[three](<../images/notes/a file.png>)'
  ].join('\n')), [
    '/notes/topic_(detail)/',
    '../images/notes/photo(1).webp',
    '../images/notes/a file.png'
  ]);
});
test('Note: a new duplicate slug fails', async () => {
  assert.equal((await note({}, ['_notes/new-note.md', 'images/ogp/new-note.png'])).status, 'FAIL');
});
test('Note: updating itself is not a duplicate', async () => {
  const data = { title: 'Title', slug: 'new-note', date: '2026-09-30', description: 'Description', image: '/images/ogp/new-note.png', imageAlt: 'Alt', tags: [], body: 'Body' };
  const result = await Preflight.note({ data, permalink: '/notes/new-note/', editing: { path: '_notes/new-note.md' }, repositoryPaths: async () => ['_notes/new-note.md', 'images/ogp/new-note.png'] });
  assert.equal(result.status, 'PASS');
});
test('Memory: valid content and same-commit image pass', async () => {
  assert.equal((await memory()).status, 'PASS');
});
test('Memory: duplicate slug fails', async () => {
  assert.equal((await memory({}, ['_memories/new-memory.md'])).status, 'FAIL');
});
test('Memory: missing photo metadata fails', async () => {
  const result = await memory({ photos: [{ caption: '', blob: null }] });
  assert.equal(result.status, 'FAIL');
  assert.match(result.errors.join('\n'), /キャプション|画像データ/);
});
test('Memory: planned upload is not checked as a missing repository image', async () => {
  const result = await memory({}, []);
  assert.doesNotMatch(result.errors.join('\n'), /画像が見つかりません/);
});

test('Note publish does not save or commit after a failed preflight', async () => {
  const listeners = {};
  const values = {
    title: 'Title', slug: 'new-note', date: '2026-09-30', description: 'Description', image: '/images/ogp/missing.png',
    'image-alt': 'Alt', tags: '', body: 'Body', 'save-status': '', 'save-draft-button': '', 'publish-button': ''
  };
  const elements = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
    id, value, disabled: false, dataset: {}, readOnly: false, textContent: '',
    addEventListener(type, fn) { listeners[id + ':' + type] = fn; }
  }]));
  const form = { querySelector() { return null; } };
  let commits = 0;
  let saves = 0;
  const sandbox = {
    console, Intl, Date, Promise,
    window: null,
    document: {
      getElementById(id) { return id === 'note-form' ? form : elements[id] || null; },
      querySelector() { return {}; }, createElement() { return {}; }, body: { appendChild() {} }, head: { appendChild() {} }
    },
    NoteDraftIdentity: { get() { return 'draft'; } },
    EditorPreflight: { async note() { return { status: 'FAIL', errors: ['missing'], warnings: [] }; } },
    EditorGitHub: { isReady() { return true; }, async saveDraft() { saves += 1; } },
    EditorPublicGitHub: { repositoryPaths() {}, async commit() { commits += 1; }, permissionMessage() { return 'error'; } },
    confirm() { return true; }, alert() {}, localStorage: { setItem() {} }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(require.resolve('../notes/editor/direct-actions.js'), 'utf8'), sandbox);
  await listeners['publish-button:click']();
  assert.equal(saves, 0);
  assert.equal(commits, 0);
  await listeners['save-draft-button:click']();
  assert.equal(saves, 1);
  assert.equal(commits, 0);
});

test('repository lookup lists directories and checks only requested image files', async () => {
  const calls = [];
  const sandbox = {
    window: null, TextDecoder, Uint8Array, Promise, Set, Map,
    EditorGitHub: { getToken() { return 'token'; } },
    fetch: async (url) => {
      calls.push(url);
      const path = new URL(url).pathname;
      let payload;
      if (path.endsWith('/contents/_notes')) payload = [{ type: 'file', path: '_notes/one.md' }];
      else if (path.endsWith('/contents/_memories')) payload = [{ type: 'file', path: '_memories/one.md' }];
      else payload = { type: 'file', path: 'images/ogp/one.png' };
      return { ok: true, status: 200, async json() { return payload; } };
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(require.resolve('../editor/public-github.js'), 'utf8'), sandbox);
  const paths = await sandbox.EditorPublicGitHub.repositoryPaths({
    directories: ['_notes', '_memories'], files: ['images/ogp/one.png']
  });
  assert.deepEqual(Array.from(paths), ['_notes/one.md', '_memories/one.md', 'images/ogp/one.png']);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((url) => /_notes%2Fone|_notes\/one/.test(url)), false);
});

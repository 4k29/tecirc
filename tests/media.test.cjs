const test = require('node:test');
const assert = require('node:assert/strict');
const {readFile, mkdtemp, mkdir, writeFile, rm} = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');

test('all display WebP files, sizes, and original source paths validate', async () => {
  const {checkMedia} = await import('../scripts/check-media.mjs');
  assert.ok(await checkMedia(root) >= 144);
});

test('a missing display derivative cannot pass validation', async () => {
  const {checkMedia} = await import('../scripts/check-media.mjs');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'tecirc-media-'));
  try {
    const manifest = JSON.parse(await readFile(path.join(root, '_data/media.json'), 'utf8'));
    const [source, entry] = Object.entries(manifest)[0];
    await mkdir(path.join(temp, '_data'), {recursive: true});
    await mkdir(path.dirname(path.join(temp, source)), {recursive: true});
    await writeFile(path.join(temp, source), 'original');
    await writeFile(path.join(temp, '_data/media.json'), JSON.stringify({[source]: entry}));
    await assert.rejects(checkMedia(temp), /ENOENT/);
  } finally { await rm(temp, {recursive: true, force: true}); }
});

test('public JS URLs are content-hashed and resolve to generated assets', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, '_data/assets.json'), 'utf8'));
  const {createHash} = require('node:crypto');
  for (const [name, url] of Object.entries(manifest)) {
    const content = await readFile(path.join(root, url));
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
    assert.equal(url, `/assets/${name}.${hash}.js`);
  }
});

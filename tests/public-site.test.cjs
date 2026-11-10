const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const field = (text, key) => text.match(new RegExp('^' + key + ': (.*)$', 'm'))?.[1];

test('English documents retain source routes, dates, images, and photo order', () => {
  for (const [type, source] of [['notes', '_notes'], ['memory', '_memories']]) {
    for (const file of fs.readdirSync(path.join(root, 'en', type)).filter(f => f.endsWith('.md'))) {
      const original = read(source + '/' + file);
      const translated = read('en/' + type + '/' + file);
      assert.equal(field(translated, 'lang'), 'en');
      assert.equal(field(translated, 'permalink'), field(original, 'permalink').replace('"/', '"/en/'));
      for (const key of ['date', 'last_modified_at', 'image']) assert.equal(field(translated, key), field(original, key), file + ': ' + key);
      if (type === 'memory') {
        assert.deepEqual([...translated.matchAll(/^  - src: (.*)$/gm)].map(m => m[1]), [...original.matchAll(/^  - src: (.*)$/gm)].map(m => m[1]), file);
      } else {
        const refs = original.split('## 参考')[1] || '';
        for (const url of refs.matchAll(/\]\((https?:\/\/[^\s]+)\)/g)) assert.ok(translated.includes(url[1]), file + ': missing reference ' + url[1]);
      }
    }
  }
});

test('analytics queues page views without requesting Google until load and idle', () => {
  const listeners = {};
  const appended = [];
  const document = {
    readyState: 'loading',
    documentElement: { dataset: {}, lang: 'ja' },
    createElement: () => ({}),
    head: { appendChild: el => appended.push(el) },
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: (name, cb) => { listeners['document:' + name] = cb; },
  };
  const window = {
    location: { pathname: '/tecirc/' },
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false }),
    addEventListener: (name, cb) => { listeners[name] = cb; },
    requestIdleCallback: cb => { listeners.idle = cb; },
  };
  vm.runInNewContext(read('theme.js'), { window, document });
  assert.equal(appended.length, 0);
  assert.equal(window.dataLayer[1][0], 'config');
  assert.equal(window.dataLayer[1][2].send_page_view, true);
  listeners.load();
  assert.equal(appended.length, 0);
  listeners.idle();
  assert.equal(appended.length, 1);
  assert.match(appended[0].src, /^https:\/\/www.googletagmanager.com\/gtag\/js\?id=/);
  assert.equal(window.dataLayer.filter(args => args[0] === 'config').length, 1);
});

test('the initial theme is applied before content, including when storage is blocked', () => {
  const boot = read('_includes/assets.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [stored, systemLight, blocked, expected] of [
    [null, true, false, 'light'], ['dark', true, false, 'dark'],
    ['light', false, false, 'light'], [null, true, true, 'light'],
    [null, false, true, 'dark'],
  ]) {
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(boot, {
      document, window: { matchMedia: () => ({ matches: systemLight }) },
      localStorage: { getItem: () => { if (blocked) throw new Error('blocked'); return stored; } },
    });
    assert.equal(document.documentElement.dataset.theme, expected);
  }
});

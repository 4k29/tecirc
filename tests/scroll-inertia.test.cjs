const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function page() {
  const handlers = {};
  let frame;
  let time = 0;
  class Element {
    constructor() {
      this.children = [];
      this.style = {};
      this.scrollHeight = this.clientHeight = 100;
      this.classList = { add() {}, remove() {} };
    }
    appendChild(child) { this.children.push(child); }
    setAttribute() {}
    addEventListener() {}
    contains() { return false; }
    closest() { return null; }
  }
  const root = new Element();
  root.scrollHeight = 4000;
  const body = new Element();
  const target = new Element();
  target.parentElement = body;
  const preference = { matches: false, addEventListener() {} };
  const window = {
    innerHeight: 800, scrollY: 0,
    matchMedia: () => preference,
    requestAnimationFrame: cb => { frame = cb; return 1; },
    addEventListener: (name, cb) => { (handlers[name] ||= []).push(cb); },
    getComputedStyle: el => ({ overflowY: el.overflow || 'visible' }),
    scrollTo: ({ top }) => { window.scrollY = top; },
  };
  const document = { documentElement: root, body, createElement: () => new Element(), querySelector: () => null, addEventListener() {} };
  const source = fs.readFileSync(path.join(__dirname, '../theme.js'), 'utf8');
  const start = source.indexOf('function mountReadingProgress(');
  const end = source.indexOf('function followSystemTheme(', start);
  const mount = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    window, document, Element, navigator: {}, performance: { now: () => time },
  });
  mount(0);
  function tick() {
    if (!frame) return;
    const cb = frame;
    frame = undefined;
    cb(time += 16);
  }
  tick();
  return {
    window, target, preference, tick,
    settle() { for (let i = 0; frame && i < 200; i++) tick(); assert.equal(frame, undefined); },
    wheel(overrides = {}) {
      const event = { target, deltaY: 100, deltaX: 0, deltaMode: 0, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides };
      handlers.wheel.forEach(cb => cb(event));
      return event;
    },
    interrupt(type) { handlers[type].forEach(cb => cb({ target })); },
  };
}

test('wheel scroll eases toward accumulated distance, reverses, and settles without an idle loop', () => {
  const p = page();
  assert.equal(p.wheel().defaultPrevented, true);
  assert.equal(p.window.scrollY, 0);
  p.tick();
  assert.ok(p.window.scrollY > 0 && p.window.scrollY < 100);
  p.wheel();
  p.settle();
  assert.equal(p.window.scrollY, 200);
  p.wheel({ deltaY: -100 });
  p.settle();
  assert.equal(p.window.scrollY, 100);
  p.wheel({ deltaY: 100000 });
  p.settle();
  assert.equal(p.window.scrollY, 3200);
});

test('native touch/pointer and keyboard input cancel any remaining wheel inertia', () => {
  for (const type of ['pointerdown', 'keydown']) {
    const p = page();
    p.wheel();
    p.tick();
    const y = p.window.scrollY;
    p.interrupt(type);
    p.settle();
    assert.equal(p.window.scrollY, y);
  }
});

test('reduced motion, zoom, horizontal gestures, controls and nested scroll areas remain native', () => {
  for (const mode of ['reduce', 'zoom', 'horizontal', 'control', 'nested']) {
    const p = page();
    if (mode === 'reduce') p.preference.matches = true;
    if (mode === 'control') p.target.closest = () => p.target;
    if (mode === 'nested') { p.target.overflow = 'auto'; p.target.scrollHeight = 500; }
    const event = p.wheel(mode === 'zoom' ? { ctrlKey: true } : mode === 'horizontal' ? { deltaX: 200 } : {});
    assert.equal(event.defaultPrevented, false, mode);
    p.settle();
    assert.equal(p.window.scrollY, 0, mode);
  }
});

/* Ali Grapph mascot v2.0.0 — vanilla JS, no changes to existing site functions.
   Public lifecycle: window.AliGrapphMascot.destroy() / init().
   Set window.AG_MASCOT_OPTIONS before this file to opt into interaction.
*/
(() => {
  'use strict';
  if (window.AliGrapphMascot) return;
  const scriptURL = document.currentScript && document.currentScript.src;
  const assetURL = scriptURL
    ? new URL('../mascot/ag-mascot.webp', scriptURL).href
    : 'assets/mascot/ag-mascot.webp';
  const config = window.AG_MASCOT_OPTIONS || {};
  const framesURL = scriptURL ? new URL('../mascot/frames/', scriptURL).href : 'assets/mascot/frames/';
  const options = Object.assign({
    interactive: false,
    asset: assetURL,
    frames: !config.asset, // Custom single-image assets keep their existing behavior.
    framesBase: framesURL
  }, config);
  const frameBase = new URL(options.framesBase.replace(/\/?$/, '/'), document.baseURI).href;
  let dispose = null, readState = () => ({ version: '2.0.0', initialized: false });

  function init() {
    if (dispose || !document.body || document.getElementById('ali-grapph-mascot')) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const compact = matchMedia('(max-width: 800px), (pointer: coarse)');
    const root = document.createElement('div');
    root.id = 'ali-grapph-mascot';
    root.className = options.interactive ? 'ag-mascot-interactive' : '';
    if (!options.interactive) root.setAttribute('aria-hidden', 'true');
    const actor = document.createElement('div');
    actor.className = 'ag-mascot';
    const facing = document.createElement('div');
    facing.className = 'ag-mascot-facing';
    const inner = document.createElement(options.interactive ? 'button' : 'div');
    inner.className = 'ag-mascot-inner';
    if (options.interactive) inner.type = 'button';
    const image = document.createElement('img');
    image.alt = '';
    image.width = 160;
    image.height = 160;
    image.decoding = 'async';
    image.draggable = false;
    inner.append(image);
    facing.append(inner);
    actor.append(facing);
    root.append(actor);
    document.body.append(root);

    let dead = false, timer = 0, frame = 0, revision = 0;
    let requested = false, ready = false, failed = false, running = false;
    let position = null, lastAction = '', size = 58, width = 0, height = 0;
    let boxes = [], obstacles = [], focused = false;
    let spriteTimer = 0, spriteIndex = 0, currentFrame = '', wantedFrame = '';
    let spritesEnabled = options.frames !== false, stuckCount = 0, firstMove = true;
    let lastLocation = null;
    const frameCache = new Map();
    const animations = new Set();
    const unlisten = [];
    const random = (a, b) => a + Math.random() * (b - a);
    const translate = p => `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0)`;
    const overlayNodes = [...document.querySelectorAll('[role="dialog"], .menu-overlay, .internal-page, .command-palette, .shortcuts-help')];
    const splash = document.getElementById('splash');

    function listen(target, name, fn, settings) {
      target.addEventListener(name, fn, settings);
      unlisten.push(() => target.removeEventListener(name, fn, settings));
    }
    function mediaListen(query, fn) {
      if (query.addEventListener) listen(query, 'change', fn);
      else { query.addListener(fn); unlisten.push(() => query.removeListener(fn)); }
    }
    function schedule(fn, delay) {
      clearTimeout(timer);
      timer = 0;
      if (!dead) timer = setTimeout(() => { timer = 0; if (!dead) fn(); }, delay);
    }
    // A short-lived frame clock exists only during movement, never during idle.
    // The movement decision timer is not running while a movement is in progress.
    function stopFrames() {
      clearTimeout(spriteTimer);
      spriteTimer = 0;
    }
    function fetchPicture(key, url, done) {
      let record = frameCache.get(key);
      if (record) {
        if (record.state === 'loading') { if (done) record.callbacks.push(done); }
        else if (done) done(record.state === 'ready', record);
        return;
      }
      const preloader = new Image();
      preloader.decoding = 'async';
      preloader.fetchPriority = 'low';
      record = { state: 'loading', image: preloader, url, callbacks: done ? [done] : [] };
      frameCache.set(key, record);
      const finish = ok => {
        record.state = ok ? 'ready' : 'missing';
        preloader.onload = preloader.onerror = null;
        const callbacks = record.callbacks.splice(0);
        if (!dead) callbacks.forEach(fn => fn(ok, record));
      };
      preloader.onload = () => finish(preloader.naturalWidth > 0);
      preloader.onerror = () => finish(false);
      preloader.src = url;
    }
    function requestPose(name, done) {
      fetchPicture(name, new URL(name + '.webp', frameBase).href, done);
    }
    function displayPicture(name, record, isFrame) {
      if (dead || !record || record.state !== 'ready') return;
      currentFrame = name;
      if (image.getAttribute('src') !== record.url) image.src = record.url;
      // Frames have generous transparent margins; keep the visible character small
      // but legible. The safety gap also reserves room for this slight enlargement.
      image.style.transform = isFrame ? 'scale(1.12)' : 'none';
    }
    function setPose(name) {
      if (!spritesEnabled) return;
      wantedFrame = name;
      requestPose(name, (ok, record) => {
        if (ok && wantedFrame === name && running && !blocked()) displayPicture(name, record, true);
      });
    }
    function playFrames(names, duration) {
      stopFrames();
      if (!spritesEnabled || motion.matches || !names.length) return;
      names.forEach(name => requestPose(name));
      const until = performance.now() + duration;
      const delay = compact.matches ? 165 : 130; // ~6 / ~8 fps, only on a moving 42/58px image.
      spriteIndex = 0;
      const tick = () => {
        spriteTimer = 0;
        if (dead || blocked() || !running || motion.matches) return;
        const loaded = names.filter(name => frameCache.get(name)?.state === 'ready');
        if (loaded.length) setPose(loaded[spriteIndex++ % loaded.length]);
        const remaining = until - performance.now();
        if (remaining > 20) spriteTimer = setTimeout(tick, Math.min(delay, remaining));
      };
      tick();
    }
    function loadInitialPicture() {
      if (dead || blocked()) return;
      const legacy = () => {
        spritesEnabled = false;
        fetchPicture('__single', options.asset, (ok, record) => {
          if (!ok) { failed = true; stop(); return; }
          ready = true;
          displayPicture('single-image', record, false);
          sync();
        });
      };
      if (!spritesEnabled) { legacy(); return; }
      requestPose('idle-01', (ok, record) => {
        if (!ok) { legacy(); return; }
        ready = true;
        displayPicture('idle-01', record, true);
        sync();
        // Do not preload all 28 files: just four tiny walking frames, after Loader.
        if (!motion.matches && !blocked()) ['walk-01','walk-02','walk-03','walk-04'].forEach(name => requestPose(name));
      });
    }
    function label() {
      if (options.interactive) inner.setAttribute('aria-label', document.documentElement.lang === 'en'
        ? 'Say hello to the little mascot' : 'سلام به مسکات کوچولو');
    }
    function loaderDone() {
      return !splash || document.body.classList.contains('splash-done');
    }
    function blocked() {
      const vv = window.visualViewport;
      return document.hidden || !loaderDone() || document.body.classList.contains('no-scroll') ||
        !!document.fullscreenElement || !!document.querySelector('input:focus, textarea:focus, select:focus, [contenteditable="true"]:focus') ||
        (vv && (vv.scale > 1.05 || vv.height < window.innerHeight * .75)) ||
        overlayNodes.some(el => el.classList.contains('active') || el.classList.contains('open') ||
          el.getAttribute('aria-hidden') === 'false' || el.hasAttribute('open'));
    }
    function stop() {
      ++revision;
      stopFrames();
      wantedFrame = '';
      if (position) lastLocation = { x: position.x, y: position.y };
      clearTimeout(timer); timer = 0;
      animations.forEach(a => a.cancel()); animations.clear();
      actor.className = 'ag-mascot';
      running = false;
      position = null;
    }
    function animate(element, keys, settings, done) {
      if (dead) return;
      if (!element.animate || motion.matches) { if (done) done(); return; }
      const token = revision;
      const a = element.animate(keys, settings);
      animations.add(a);
      a.finished.then(() => {
        animations.delete(a);
        // Endpoints are committed through inline styles by the callback.
        if (!dead && token === revision) { if (done) done(); }
        a.cancel();
      }, () => { animations.delete(a); });
    }

    // One geometry snapshot per decision, never a per-frame collision loop.
    function survey() {
      width = root.clientWidth; height = root.clientHeight;
      size = actor.getBoundingClientRect().width || (compact.matches ? 42 : 58);
      boxes = [];
      const seen = new Set();
      const visibility = new Map();
      function visible(el) {
        if (!el || el === document.body || el === document.documentElement) return true;
        if (visibility.has(el)) return visibility.get(el);
        const cs = getComputedStyle(el);
        const result = cs.display !== 'none' && cs.visibility === 'visible' && Number(cs.opacity) > .01 && visible(el.parentElement);
        visibility.set(el, result);
        return result;
      }
      function add(rect) {
        if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width) return;
        boxes.push({ x: rect.left, y: rect.top, r: rect.right, b: rect.bottom });
      }
      const solid = 'a, button, input, textarea, select, [contenteditable="true"], [role="button"], img, svg, video, iframe, canvas, .floating-nav, .top-nav, .quick-contact, .back-top, .toast.show, .pwa-install.show, [data-ag-mascot-avoid]';
      obstacles = [...document.querySelectorAll(solid)].filter(el => !root.contains(el));
      obstacles.forEach(el => {
        if (!visible(el)) return;
        seen.add(el);
        for (const r of el.getClientRects()) add(r);
      });
      // Text rectangles, not entire sections: keep real whitespace available.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const el = node.parentElement;
          if (!el || !node.nodeValue.trim() || root.contains(el) || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const range = document.createRange();
      let node;
      while ((node = walker.nextNode())) {
        const el = node.parentElement;
        if (seen.has(el) || !visible(el)) continue;
        const bounds = el.getBoundingClientRect();
        if (bounds.bottom < 0 || bounds.top > height) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) add(r);
      }
      range.detach();
    }
    function clearRect(x, y, r, b) {
      const gap = compact.matches ? 4 : 8;
      return !boxes.some(o => r + gap > o.x && x - gap < o.r && b + gap > o.y && y - gap < o.b);
    }
    function safe(p) {
      return p.x >= 4 && p.y >= 6 && p.x + size <= width - 4 && p.y + size <= height - 4 &&
        clearRect(p.x, p.y, p.x + size, p.y + size);
    }
    function route(a, b, lift = 0) {
      return safe(b) && clearRect(Math.min(a.x, b.x), Math.min(a.y, b.y) - lift,
        Math.max(a.x, b.x) + size, Math.max(a.y, b.y) + size);
    }
    function places() {
      if (width < size + 16 || height < size + 32) return [];
      const result = [], used = new Set();
      let floor = height - size - 8;
      const nav = document.querySelector('.floating-nav');
      if (compact.matches && nav) {
        const r = nav.getBoundingClientRect();
        if (r.top > height / 2 && r.top < height) floor = Math.min(floor, r.top - size - 12);
      }
      floor -= parseFloat(getComputedStyle(root).paddingBottom) || 0;
      function add(x, y) {
        const key = x + ':' + y;
        const p = { x, y };
        if (!used.has(key) && safe(p)) { used.add(key); result.push(p); }
      }
      const rows = [floor, floor - size - 16, floor - 2 * size - 32];
      for (const y of rows) for (let x = 8; x <= width - size - 8; x += compact.matches ? 16 : 32) add(x, y);
      if (compact.matches) {
        // V1 checked only two rows above the bottom menu. On a real phone both
        // often intersected the hero artwork. Search other genuine whitespace too.
        const header = document.querySelector('.top-nav');
        const top = Math.max(84, header ? header.getBoundingClientRect().bottom + 10 : 84);
        for (let y = floor; y >= top; y -= 20) {
          for (let x = 4; x <= width - size - 4; x += 16) add(x, y);
          add(width - size - 4, y);
        }
      } else {
        for (let y = Math.max(90, height * .3); y < floor; y += 32) {
          add(8, y); add(width - size - 8, y);
        }
      }
      // Prefer a spot with room to take an actual step, rather than an isolated
      // hole in the layout. Never weaken collision protection for text/buttons.
      const movable = result.filter(p =>
        [-24, 24].some(dx => route(p, { x: p.x + dx, y: p.y }, 2)) ||
        [-24, 24].some(dy => route(p, { x: p.x, y: p.y + dy }, 2)));
      const pool = movable.length ? movable : result;
      const fresh = lastLocation ? pool.filter(p => Math.hypot(p.x - lastLocation.x, p.y - lastLocation.y) > size) : pool;
      return fresh.length ? fresh : pool;
    }
    function choose(array) { return array[Math.floor(Math.random() * array.length)]; }
    function idle() {
      stopFrames();
      actor.className = 'ag-mascot ag-mascot--visible ag-mascot--idle';
      running = true;
      setPose('idle-01');
      // Reduced motion: completely static; no recurring decision timer.
      if (!motion.matches && !focused) {
        const delay = firstMove ? random(850, 1250) : random(compact.matches ? 1800 : 2000, compact.matches ? 3200 : 4300);
        firstMove = false;
        schedule(step, delay);
      }
    }
    function reveal(p) {
      position = p;
      stuckCount = 0; firstMove = true;
      actor.style.transform = translate(p);
      actor.className = 'ag-mascot ag-mascot--visible';
      running = true;
      setPose('idle-01');
      if (motion.matches) { idle(); return; }
      // Enter from below only if the entire entry corridor is clear.
      const canEnter = p.y > height - size * 2 && clearRect(p.x, p.y, p.x + size, height);
      const from = canEnter ? { x: p.x, y: height + 2 } : p;
      animate(actor, [
        { transform: translate(from) + ' scale(.92)', opacity: 0 },
        { transform: translate(p) + ' scale(1)', opacity: 1 }
      ], { duration: 260, easing: 'ease-out' }, idle);
    }
    function move(to, mode) {
      const from = position;
      const jump = mode === 'jump';
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const duration = jump ? (compact.matches ? 380 : 500) : mode === 'dash'
        ? Math.max(240, Math.min(540, distance * 2))
        : Math.max(500, Math.min(compact.matches ? 1800 : 3500, distance * (compact.matches ? 19 : 15)));
      if (Math.abs(to.x - from.x) > 2) facing.style.setProperty('--ag-mascot-direction', to.x < from.x ? '-1' : '1');
      const climb = Math.abs(to.y - from.y) > 4 && Math.abs(to.x - from.x) < 4;
      actor.className = 'ag-mascot ag-mascot--visible ag-mascot--moving' +
        (mode === 'walk' ? (climb ? ' ag-mascot--climbing' : ' ag-mascot--walking') : '');
      const keys = [{ transform: translate(from) }, { transform: translate(to) }];
      if (jump) keys.splice(1, 0, { transform: translate({ x: (from.x + to.x) / 2, y: from.y - (compact.matches ? 7 : 12) }), offset: .5 });
      if (mode === 'dash') {
        keys[0].opacity = .8;
        keys[1].opacity = 1;
        animate(inner, [{ transform: 'scale(1)' }, { transform: 'scale(1.04, .97)' }, { transform: 'scale(1)' }], { duration });
      }
      lastAction = mode;
      if (mode === 'walk') playFrames(climb
        ? ['climb-01','climb-02','climb-03','climb-04']
        : ['walk-01','walk-02','walk-03','walk-04'], duration);
      else setPose(mode === 'jump' ? 'fly-01' : 'dash-01');
      animate(actor, keys, { duration, easing: jump ? 'ease-in-out' : 'linear' }, () => {
        position = to;
        stuckCount = 0;
        actor.style.transform = translate(to);
        idle();
      });
    }
    function vanish() {
      lastAction = 'hide';
      stopFrames();
      actor.className = 'ag-mascot ag-mascot--visible';
      let exit = null;
      if (position.x < size * 1.5) exit = { x: -size - 2, y: position.y };
      else if (position.x > width - size * 2.5) exit = { x: width + 2, y: position.y };
      else if (position.y > height - size * 2) exit = { x: position.x, y: height + 2 };
      if (exit && !clearRect(Math.min(position.x, exit.x), Math.min(position.y, exit.y),
        Math.max(position.x, exit.x) + size, Math.max(position.y, exit.y) + size)) exit = null;
      const keys = [{ opacity: 1, transform: translate(position) }, { opacity: 0, transform: translate(exit || position) }];
      animate(actor, keys, { duration: compact.matches ? 220 : 360, easing: 'ease-in' }, () => {
        stop();
        schedule(sync, random(compact.matches ? 1400 : 2500, compact.matches ? 3000 : 6000));
      });
    }
    function step() {
      if (dead || blocked()) { stop(); return; }
      if (focused) { idle(); return; }
      survey();
      if (!position || !safe(position)) { stop(); sync(); return; }
      const roll = Math.random();
      if (lastAction && lastAction !== 'hide' && roll < .08) { vanish(); return; }
      if (lastAction && roll < .18 && lastAction !== 'idle') { lastAction = 'idle'; idle(); return; }
      const jumpLift = compact.matches ? 7 : 12;
      if (roll > .9 && lastAction !== 'jump' && position.y > jumpLift + 6 && route(position, position, jumpLift)) {
        move({ ...position }, 'jump'); return;
      }
      const maxDistance = compact.matches ? 100 : 300;
      const targets = [];
      for (const dx of [-maxDistance, -maxDistance / 2, -32, -20, -12, 12, 20, 32, maxDistance / 2, maxDistance]) {
        const p = { x: Math.max(8, Math.min(width - size - 8, position.x + dx)), y: position.y };
        if (Math.abs(p.x - position.x) > 10 && route(position, p, 2)) targets.push(p);
      }
      // Climb only the desktop side edges, never across the content column.
      if (!compact.matches && (position.x < 16 || position.x > width - size - 16)) {
        for (const dy of [-100, -52, 52, 100]) {
          const p = { x: position.x, y: position.y + dy };
          if (route(position, p, 2)) targets.push(p);
        }
      }
      if (compact.matches && !targets.length) {
        // Small vertical steps inside whitespace are allowed on phones, but no
        // wall-climbing or free flight across the content column.
        for (const dy of [-32, -20, -12, 12, 20, 32]) {
          const p = { x: position.x, y: position.y + dy };
          if (route(position, p, 2)) targets.push(p);
        }
      }
      if (!targets.length) {
        ++stuckCount;
        if (stuckCount >= 2) { vanish(); return; }
        lastAction = 'idle';
        idle();
        setPose('look-up-01');
        return;
      }
      const mode = !compact.matches && roll > .78 && lastAction !== 'dash' ? 'dash' : 'walk';
      const longerSteps = targets.filter(p => Math.hypot(p.x - position.x, p.y - position.y) >= (compact.matches ? 28 : 50));
      move(choose(longerSteps.length ? longerSteps : targets), mode);
    }
    function sync() {
      if (dead || failed) return;
      label();
      if (blocked()) { stop(); return; }
      if (!requested) {
        requested = true;
        // Do not start the image request until AFTER the existing loader finishes.
        schedule(loadInitialPicture, 700);
        return;
      }
      if (!ready) {
        // If a visibility/overlay event cancelled the deferred image request.
        if (![...frameCache.values()].some(record => record.state === 'loading')) schedule(loadInitialPicture, 700);
        return;
      }
      if (running) return;
      survey();
      const available = places();
      if (!available.length) {
        // A blocked mobile screen is better than covering its content.
        if (!motion.matches) schedule(sync, compact.matches ? 6500 : 4000);
        return;
      }
      reveal(choose(available));
    }
    function invalidate(delay = 700) {
      if (dead) return;
      stop();
      if (!blocked()) schedule(sync, delay);
    }
    function geometryChanged() {
      // Hide immediately during scroll; one rAF coalesces invalidation only.
      // There is no requestAnimationFrame animation or geometry polling loop.
      actor.className = 'ag-mascot';
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; invalidate(compact.matches ? 950 : 650); });
    }
    function greet() {
      if (!options.interactive || !position || blocked() || motion.matches) return;
      const rect = actor.getBoundingClientRect();
      const keep = { x: rect.left, y: rect.top };
      stop(); position = keep; running = true;
      actor.style.transform = translate(keep);
      actor.className = 'ag-mascot ag-mascot--visible';
      setPose('happy-01');
      animate(inner, [
        { transform: 'scale(1) rotate(0)' },
        { transform: 'scale(1.04, .96) rotate(-7deg)' },
        { transform: 'scale(1) rotate(7deg)' },
        { transform: 'scale(1) rotate(0)' }
      ], { duration: 480, easing: 'ease-in-out' }, idle);
    }

    listen(document, 'visibilitychange', () => invalidate(300));
    listen(document, 'fullscreenchange', () => invalidate());
    listen(window, 'scroll', geometryChanged, { passive: true });
    listen(window, 'resize', geometryChanged, { passive: true });
    if (window.visualViewport) {
      listen(window.visualViewport, 'resize', geometryChanged, { passive: true });
      listen(window.visualViewport, 'scroll', geometryChanged, { passive: true });
    }
    listen(document, 'focusin', event => {
      if (root.contains(event.target)) return;
      if (event.target.matches('input,textarea,select,[contenteditable="true"]')) invalidate();
    });
    listen(document, 'focusout', event => {
      if (event.target.matches('input,textarea,select,[contenteditable="true"]')) invalidate();
    });
    if (options.interactive) {
      listen(inner, 'click', greet);
      listen(inner, 'focus', () => {
        focused = true;
        if (position) {
          const rect = actor.getBoundingClientRect();
          const keep = { x: rect.left, y: rect.top };
          stop(); position = keep; actor.style.transform = translate(keep); idle();
        }
      });
      listen(inner, 'blur', () => { focused = false; invalidate(300); });
    }
    mediaListen(motion, () => invalidate(0));
    mediaListen(compact, () => invalidate());
    const observer = new MutationObserver(records => {
      if (records.every(r => r.target === document.documentElement)) { label(); return; }
      invalidate();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    if (splash) observer.observe(splash, { attributes: true, attributeFilter: ['class'] });
    const watched = new Set([...overlayNodes, ...document.querySelectorAll('.toast, .quick-contact, .pwa-install')]);
    watched.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'open'] }));
    // Portfolio/filter/image changes invalidate a route without observing our own layer.
    const contentObserver = new MutationObserver(geometryChanged);
    document.querySelectorAll('main, footer').forEach(el => contentObserver.observe(el, { childList: true, subtree: true }));
    function contentLoaded(event) {
      if (event.target !== image && /^(IMG|VIDEO|IFRAME)$/.test(event.target.tagName || '')) geometryChanged();
    }
    listen(document, 'load', contentLoaded, true);
    listen(document, 'transitionrun', event => {
      if (!root.contains(event.target) && event.target.matches('.portfolio-card, .portfolio-grid')) geometryChanged();
    }, true);
    let resizeObserver;
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(geometryChanged);
      document.querySelectorAll('main, footer').forEach(el => resizeObserver.observe(el));
    }
    listen(window, 'pagehide', () => { stop(); if (frame) cancelAnimationFrame(frame); frame = 0; });
    listen(window, 'pageshow', () => invalidate(300));

    dispose = () => {
      dead = true;
      stop();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect(); contentObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      unlisten.forEach(fn => fn());
      frameCache.forEach(record => {
        record.image.onload = record.image.onerror = null;
        record.callbacks.length = 0;
      });
      frameCache.clear();
      readState = () => ({ version: '2.0.0', initialized: false });
      root.remove();
      dispose = null;
    };
    readState = () => ({
      version: '2.0.0', initialized: !dead,
      reducedMotion: motion.matches, mobile: compact.matches,
      visible: actor.classList.contains('ag-mascot--visible'),
      blocked: !!blocked(), frame: currentFrame,
      spritesEnabled,
      loadedFrames: [...frameCache.values()].filter(record => record.state === 'ready').length,
      moving: actor.classList.contains('ag-mascot--moving'),
      position: position ? { x: position.x, y: position.y } : null
    });
    label();
    sync();
  }
  window.AliGrapphMascot = Object.freeze({ version: '2.0.0', init, destroy() { if (dispose) dispose(); }, getState() { return readState(); } });
  init();
})();

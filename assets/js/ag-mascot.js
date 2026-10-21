/* Ali Grapph mascot + Grappy v3.1.0 — vanilla JS, no changes to existing site functions.
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
    interactive: true,
    asset: assetURL,
    frames: !config.asset, // Custom single-image assets keep their existing behavior.
    framesBase: framesURL
  }, config);
  const frameBase = new URL(options.framesBase.replace(/\/?$/, '/'), document.baseURI).href;
  let dispose = null, readState = () => ({ version: '3.1.0', initialized: false });

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
    let grappyPanel = null;
    let exitRunning = false;
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
        ? 'Grappy — tap for a message' : 'گرپی — برای یک پیام ضربه بزن');
    }
    function loaderDone() {
      return !splash || document.body.classList.contains('splash-done');
    }
    function blocked() {
      const vv = window.visualViewport;
      return document.hidden || !loaderDone() || document.body.classList.contains('no-scroll') ||
        (grappyPanel && grappyPanel.classList.contains('active')) ||
        !!document.fullscreenElement || !!document.querySelector('input:focus, textarea:focus, select:focus, [contenteditable="true"]:focus') ||
        (vv && (vv.scale > 1.05 || vv.height < window.innerHeight * .75)) ||
        overlayNodes.some(el => el.classList.contains('active') || el.classList.contains('open') ||
          el.getAttribute('aria-hidden') === 'false' || el.hasAttribute('open'));
    }
    function stop() {
      exitRunning = false;
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
      if (introPending) {
        // Fast scrollers never get the intro; everyone else gets it exactly once.
        if (Math.abs(window.scrollY - introScrollY) > 140) introDismissed();
        else { grappyIntro(p); return; }
      }
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
      // Short trick performances while standing: jump, backflip, spin, cheer.
      if (!motion.matches && lastAction !== 'trick' && roll >= .72 && roll < .84) { playTrick(); return; }
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
      // Scrolling triggers a real exit gesture (jump up & vanish or dash off
      // the side) instead of an instant pop; one rAF still coalesces later
      // revalidation. There is no scroll-linked animation or polling loop.
      if (dead || exitRunning) return;
      if (!motion.matches && running && position &&
          actor.classList.contains('ag-mascot--visible') && !blocked()) {
        scrollExit();
        return;
      }
      actor.className = 'ag-mascot';
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; invalidate(compact.matches ? 950 : 650); });
    }
    function greet() {
      if (!options.interactive || !position || blocked()) return;
      grappyTapLine();
      if (motion.matches) return;
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
        // Keyboard focus pauses walking; touch taps must never freeze Grappy.
        if (!inner.matches(':focus-visible')) return;
        focused = true;
        if (position) {
          const rect = actor.getBoundingClientRect();
          const keep = { x: rect.left, y: rect.top };
          stop(); position = keep; actor.style.transform = translate(keep); idle();
        }
      });
      listen(inner, 'blur', () => {
        if (!focused) return;
        focused = false;
        invalidate(300);
      });
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

    /* =========================================================
       GRAPPY — personality layer (v3.1)
       Additive only: tap dialogues, first-visit intro, Grappy
       button beside Eitaa/Telegram, preset chat panel, scroll
       exit gestures and idle trick performances.
       Extension API: AliGrapphMascot.grappy.{addQA,addTapLine,say,trick,…}
    ========================================================= */
    let introPending = true;
    const introScrollY = window.scrollY;
    try { if (localStorage.getItem('grappy_intro_seen') === 'true') introPending = false; } catch (_) {}

    let bubbleEl = null, bubbleTimer = 0, lastBubbleData = null, lastTapIndex = -1;
    let chatLog = null, typing = false, panelTimer = 0;
    let chatBox = null, chipsBox = null, orderButton = null, panelClose = null, panelTitle = null, panelSub = null;
    let trapHandler = null, trapContainer = null, lastFocus = null, langObserver = null;
    let lastExit = null, lastTrick = null;

    const grappyLang = () => (document.documentElement.lang === 'en' ? 'en' : 'fa');
    const grappyText = map => (typeof map === 'string' ? map : (map && map[grappyLang()]) || '');
    const grappySet = (el, map) => { if (el) el.textContent = grappyText(map); };

    function introDismissed() {
      introPending = false;
      try { localStorage.setItem('grappy_intro_seen', 'true'); } catch (_) {}
    }
    function grappyIntro(p) {
      introPending = false;
      try { localStorage.setItem('grappy_intro_seen', 'true'); } catch (_) {}
      position = p;
      stuckCount = 0;
      firstMove = true;
      actor.style.transform = translate(p);
      actor.className = 'ag-mascot ag-mascot--visible';
      running = true;
      setPose('idle-01');
      // Reduced motion: a static mascot with a plain bubble, nothing more.
      if (motion.matches) { idle(); showBubble(GRAPPY_INTRO, 4200); return; }
      // First visit: Grappy drops in from the top of the viewport, bounces once…
      const from = { x: p.x, y: -size - 14 };
      animate(actor, [
        { transform: translate(from) + ' scale(.92)', opacity: 0 },
        { transform: translate({ x: p.x, y: p.y + 11 }) + ' scale(1.05,.95)', opacity: 1, offset: .58 },
        { transform: translate({ x: p.x, y: p.y - 7 }) + ' scale(.97,1.04)', offset: .76 },
        { transform: translate({ x: p.x, y: p.y + 3 }) + ' scale(1.02,.98)', offset: .9 },
        { transform: translate(p) + ' scale(1)' }
      ], { duration: 900, easing: 'cubic-bezier(.22,.9,.28,1)' }, () => {
        idle();
        showBubble(GRAPPY_INTRO, 4200); // …then the hello bubble, 4s, then normal life.
      });
    }

    function ensureBubble() {
      if (bubbleEl || dead) return bubbleEl;
      bubbleEl = document.createElement('div');
      bubbleEl.className = 'ag-mascot-bubble';
      bubbleEl.setAttribute('role', 'status');
      bubbleEl.setAttribute('aria-live', 'polite');
      const bubbleText = document.createElement('div');
      bubbleText.className = 'ag-mascot-bubble-text';
      bubbleEl.append(bubbleText);
      actor.append(bubbleEl);
      return bubbleEl;
    }
    function placeBubble() {
      if (!bubbleEl || !position) return;
      bubbleEl.classList.toggle('ag-mascot-bubble--below', position.y < 118);
      bubbleEl.classList.toggle('ag-mascot-bubble--start', position.x < 96);
      bubbleEl.classList.toggle('ag-mascot-bubble--end', position.x + size > width - 96);
    }
    function hideBubble() {
      clearTimeout(bubbleTimer);
      bubbleTimer = 0;
      if (bubbleEl) bubbleEl.classList.remove('is-shown');
    }
    function showBubble(data, duration = 3200) {
      const b = ensureBubble();
      if (!b || dead) return;
      lastBubbleData = data;
      grappySet(b.querySelector('.ag-mascot-bubble-text'), data);
      b.dir = grappyLang() === 'en' ? 'ltr' : 'rtl';
      placeBubble();
      b.classList.remove('is-shown');
      void b.offsetWidth;
      b.classList.add('is-shown');
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(hideBubble, duration);
    }
    function grappyTapLine() {
      const pool = GRAPPY_TAP_LINES.map((_, i) => i).filter(i => i !== lastTapIndex);
      const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 0;
      lastTapIndex = pick;
      showBubble(GRAPPY_TAP_LINES[pick]);
    }

    /* ---- scroll exits: jump up & vanish, or dash off the side ---- */
    function scrollExit() {
      if (dead || !position) { exitRunning = false; return; }
      exitRunning = true;
      lastExit = Math.random() < 0.5 ? 'jump' : 'dash';
      const from = { x: position.x, y: position.y };
      hideBubble();
      stopFrames();
      clearTimeout(timer);
      timer = 0;
      ++revision;
      animations.forEach(a => a.cancel());
      animations.clear();
      running = true;
      actor.style.transform = translate(from);
      actor.className = 'ag-mascot ag-mascot--visible';
      if (lastExit === 'jump') {
        setPose('fly-01');
        animate(actor, [
          { transform: translate(from), opacity: 1 },
          { transform: translate({ x: from.x, y: Math.max(-size, from.y - 90) }), opacity: 1, offset: .45 },
          { transform: translate({ x: from.x, y: -size - 14 }), opacity: 0 }
        ], { duration: 430, easing: 'ease-in' }, finishExit);
      } else {
        setPose('dash-01');
        facing.style.setProperty('--ag-mascot-direction', from.x + size / 2 < width / 2 ? '-1' : '1');
        const side = from.x + size / 2 < width / 2 ? -size - 12 : width + 12;
        animate(actor, [
          { transform: translate(from), opacity: 1 },
          { transform: translate({ x: side, y: from.y }), opacity: 0 }
        ], { duration: 340, easing: 'ease-in' }, finishExit);
      }
    }
    function finishExit() {
      if (dead) return;
      exitRunning = false;
      stop();
      schedule(sync, compact.matches ? 950 : 650);
    }

    /* ---- idle tricks: jump, backflip, spin, cheer ---- */
    function trickDone() {
      setPose('idle-01');
      idle();
    }
    function playTrick() {
      if (dead || motion.matches || blocked() || !position) return;
      lastAction = 'trick';
      stopFrames();
      clearTimeout(timer);
      timer = 0;
      ++revision;
      animations.forEach(a => a.cancel());
      animations.clear();
      running = true;
      actor.style.transform = translate(position);
      actor.className = 'ag-mascot ag-mascot--visible';
      const roll = Math.random();
      if (roll < 0.3) { lastTrick = 'jump'; trickJump(); }
      else if (roll < 0.55) { lastTrick = 'flip'; trickFlip(); }
      else if (roll < 0.8) { lastTrick = 'spin'; trickSpin(); }
      else { lastTrick = 'cheer'; trickCheer(); }
    }
    function trickJump() {
      setPose('fly-01');
      animate(inner, [
        { transform: 'translate3d(0,0,0) scale(1)' },
        { transform: 'translate3d(0,-22px,0) scale(.94,1.08)', offset: .42 },
        { transform: 'translate3d(0,0,0) scale(1.08,.92)', offset: .72 },
        { transform: 'translate3d(0,0,0) scale(1)' }
      ], { duration: 560, easing: 'ease-out' }, trickDone);
    }
    function trickFlip() {
      setPose('happy-01');
      animate(inner, [
        { transform: 'translate3d(0,0,0) rotate(0deg)' },
        { transform: 'translate3d(0,-16px,0) rotate(-190deg)', offset: .5 },
        { transform: 'translate3d(0,0,0) rotate(-360deg)' }
      ], { duration: 700, easing: 'ease-in-out' }, trickDone);
    }
    function trickSpin() {
      setPose('surprised-01');
      animate(inner, [
        { transform: 'rotate(0deg) scale(1)' },
        { transform: 'rotate(360deg) scale(1.06)' }
      ], { duration: 520, easing: 'cubic-bezier(.34,1.3,.5,1)' }, trickDone);
    }
    function trickCheer() {
      setPose('happy-01');
      animate(inner, [
        { transform: 'translate3d(0,0,0) rotate(0deg)' },
        { transform: 'translate3d(0,-8px,0) rotate(-8deg)', offset: .25 },
        { transform: 'translate3d(0,0,0) rotate(8deg)', offset: .5 },
        { transform: 'translate3d(0,-8px,0) rotate(-6deg)', offset: .75 },
        { transform: 'translate3d(0,0,0) rotate(0deg)' }
      ], { duration: 640, easing: 'ease-in-out' }, trickDone);
    }

    function grappyTrap(container) {
      grappyReleaseTrap();
      trapContainer = container;
      trapHandler = event => {
        if (event.key !== 'Tab') return;
        const items = [...container.querySelectorAll(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
        )].filter(el => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      container.addEventListener('keydown', trapHandler);
      const first = container.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
      if (first) first.focus();
    }
    function grappyReleaseTrap() {
      if (trapContainer && trapHandler) trapContainer.removeEventListener('keydown', trapHandler);
      trapHandler = null;
      trapContainer = null;
    }

    function renderChat() {
      if (!chatBox) return;
      chatBox.textContent = '';
      for (const item of chatLog) {
        const row = document.createElement('div');
        row.className = 'ag-grappy-msg ' + (item.type === 'user' ? 'ag-grappy-msg--user' : 'ag-grappy-msg--bot');
        const bubble = document.createElement('div');
        bubble.className = 'ag-grappy-msg-bubble';
        bubble.textContent = grappyText(item.text);
        row.append(bubble);
        chatBox.append(row);
      }
      if (typing) {
        const row = document.createElement('div');
        row.className = 'ag-grappy-msg ag-grappy-msg--bot';
        const dots = document.createElement('div');
        dots.className = 'ag-grappy-typing';
        dots.setAttribute('aria-label', grappyLang() === 'en' ? 'Grappy is typing' : 'گرپی در حال نوشتن');
        dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
        row.append(dots);
        chatBox.append(row);
      }
      chatBox.scrollTop = chatBox.scrollHeight;
    }
    function renderChips() {
      if (!chipsBox) return;
      chipsBox.textContent = '';
      GRAPPY_QA.forEach((qa, index) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ag-grappy-chip';
        chip.textContent = grappyText(qa.question);
        chip.disabled = typing;
        chip.addEventListener('click', () => grappyAsk(index));
        chipsBox.append(chip);
      });
    }
    function grappyAsk(index) {
      if (typing || dead || !chatLog) return;
      const qa = GRAPPY_QA[index];
      if (!qa) return;
      chatLog.push({ type: 'user', text: qa.question });
      typing = true;
      renderChat();
      renderChips();
      clearTimeout(panelTimer);
      panelTimer = setTimeout(() => {
        typing = false;
        chatLog.push({ type: 'bot', text: qa.answer });
        renderChat();
        renderChips();
      }, motion.matches ? 160 : 620);
    }

    function buildGrappyPanel() {
      grappyPanel = document.createElement('div');
      grappyPanel.id = 'ag-grappy-panel';
      grappyPanel.className = 'ag-grappy-panel';
      grappyPanel.setAttribute('role', 'dialog');
      grappyPanel.setAttribute('aria-modal', 'true');
      grappyPanel.setAttribute('aria-hidden', 'true');
      grappyPanel.setAttribute('aria-labelledby', 'agGrappyTitle');
      const box = document.createElement('div');
      box.className = 'ag-grappy-box';
      const head = document.createElement('div');
      head.className = 'ag-grappy-head';
      const avatar = document.createElement('img');
      avatar.className = 'ag-grappy-avatar';
      avatar.alt = '';
      avatar.width = 44;
      avatar.height = 44;
      avatar.decoding = 'async';
      avatar.src = spritesEnabled ? new URL('idle-01.webp', frameBase).href : options.asset;
      avatar.addEventListener('error', () => { avatar.src = options.asset; }, { once: true });
      const titles = document.createElement('div');
      titles.className = 'ag-grappy-titles';
      panelTitle = document.createElement('h2');
      panelTitle.id = 'agGrappyTitle';
      panelSub = document.createElement('p');
      panelClose = document.createElement('button');
      panelClose.type = 'button';
      panelClose.className = 'ag-grappy-close';
      panelClose.innerHTML = '<svg aria-hidden="true" viewbox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
      titles.append(panelTitle, panelSub);
      head.append(avatar, titles, panelClose);
      chatBox = document.createElement('div');
      chatBox.className = 'ag-grappy-msgs';
      chatBox.setAttribute('aria-live', 'polite');
      chipsBox = document.createElement('div');
      chipsBox.className = 'ag-grappy-chips';
      box.append(head, chatBox, chipsBox);
      grappyPanel.append(box);
      document.body.append(grappyPanel);
      panelClose.addEventListener('click', closeGrappy);
      grappyPanel.addEventListener('click', event => {
        if (event.target === grappyPanel) closeGrappy();
      });
    }

    function openGrappy() {
      if (dead || !grappyPanel || grappyPanel.classList.contains('active')) return;
      lastFocus = document.activeElement;
      hideBubble();
      grappyPanel.classList.add('active');
      grappyPanel.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ag-grappy-lock');
      renderChat();
      renderChips();
      grappyTrap(grappyPanel);
      invalidate(60);
    }
    function closeGrappy() {
      if (!grappyPanel || !grappyPanel.classList.contains('active')) return;
      grappyPanel.classList.remove('active');
      grappyPanel.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ag-grappy-lock');
      clearTimeout(panelTimer);
      panelTimer = 0;
      typing = false;
      grappyReleaseTrap();
      const back = lastFocus && lastFocus.isConnected ? lastFocus : orderButton;
      if (back && back.focus) back.focus({ preventScroll: true });
      invalidate(150);
    }
    function toggleGrappy() {
      if (!grappyPanel) return;
      if (grappyPanel.classList.contains('active')) closeGrappy();
      else openGrappy();
    }

    function injectOrderButton() {
      const grid = document.querySelector('.orders-grid');
      if (!grid || orderButton) return;
      orderButton = document.createElement('button');
      orderButton.type = 'button';
      orderButton.className = 'order-card ag-grappy-order';
      orderButton.id = 'agGrappyOpen';
      const icon = document.createElement('div');
      icon.className = 'order-icon ag-grappy-order-icon';
      const img = document.createElement('img');
      img.alt = '';
      img.width = 30;
      img.height = 30;
      img.decoding = 'async';
      img.src = spritesEnabled ? new URL('idle-01.webp', frameBase).href : options.asset;
      img.addEventListener('error', () => { img.src = options.asset; }, { once: true });
      icon.append(img);
      const copy = document.createElement('div');
      const h3 = document.createElement('h3');
      h3.dataset.en = 'Grappy';
      h3.dataset.fa = 'گرپی';
      const p = document.createElement('p');
      p.dataset.en = 'Have a quick chat with Grappy, your site buddy';
      p.dataset.fa = 'گپ کوتاه با گرپی، رفیق سایت';
      copy.append(h3, p);
      orderButton.append(icon, copy);
      orderButton.addEventListener('click', openGrappy);
      grid.append(orderButton);
    }

    function syncGrappyLang() {
      const en = grappyLang() === 'en';
      if (orderButton) {
        orderButton.querySelectorAll('[data-fa]').forEach(el => {
          el.textContent = en ? el.dataset.en : el.dataset.fa;
        });
      }
      if (grappyPanel) {
        grappyPanel.dir = en ? 'ltr' : 'rtl';
        grappySet(panelTitle, en ? 'Grappy' : 'گرپی');
        grappySet(panelSub, en ? "Ali Grapph's buddy" : 'همراه علی گراف');
        if (panelClose) panelClose.setAttribute('aria-label', en ? 'Close' : 'بستن');
      }
      renderChat();
      renderChips();
      if (bubbleEl && bubbleEl.classList.contains('is-shown') && lastBubbleData) {
        grappySet(bubbleEl.querySelector('.ag-mascot-bubble-text'), lastBubbleData);
        bubbleEl.dir = en ? 'ltr' : 'rtl';
      }
    }

    buildGrappyPanel();
    injectOrderButton();
    if (!chatLog) chatLog = [{ type: 'bot', text: GRAPPY_GREETING }];
    syncGrappyLang();
    langObserver = new MutationObserver(() => syncGrappyLang());
    langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    listen(document, 'keydown', event => {
      if (event.key === 'Escape' && grappyPanel && grappyPanel.classList.contains('active')) closeGrappy();
    });

    grappyBridge = {
      addQA(qa) { if (qa && qa.question && qa.answer) { GRAPPY_QA.push(qa); renderChips(); } },
      addTapLine(line) { if (line) GRAPPY_TAP_LINES.push(line); },
      say(data, duration) { showBubble(data, duration || 3600); },
      open: openGrappy,
      close: closeGrappy,
      toggle: toggleGrappy,
      trick: playTrick,
      resetIntro() {
        try { localStorage.removeItem('grappy_intro_seen'); } catch (_) {}
        introPending = true;
      }
    };

    function grappyDispose() {
      hideBubble();
      clearTimeout(panelTimer);
      panelTimer = 0;
      typing = false;
      exitRunning = false;
      grappyReleaseTrap();
      if (langObserver) langObserver.disconnect();
      langObserver = null;
      if (grappyPanel) grappyPanel.remove();
      grappyPanel = null;
      if (orderButton) orderButton.remove();
      orderButton = null;
      document.body.classList.remove('ag-grappy-lock');
      chatBox = chipsBox = panelClose = panelTitle = panelSub = null;
      chatLog = null;
      bubbleEl = null;
    }

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
      grappyDispose();
      grappyBridge = null;
      readState = () => ({ version: '3.1.0', initialized: false });
      root.remove();
      dispose = null;
    };
    readState = () => ({
      version: '3.1.0', initialized: !dead,
      reducedMotion: motion.matches, mobile: compact.matches,
      visible: actor.classList.contains('ag-mascot--visible'),
      blocked: !!blocked(), frame: currentFrame,
      spritesEnabled,
      loadedFrames: [...frameCache.values()].filter(record => record.state === 'ready').length,
      moving: actor.classList.contains('ag-mascot--moving'),
      position: position ? { x: position.x, y: position.y } : null,
      grappy: {
        panelOpen: !!(grappyPanel && grappyPanel.classList.contains('active')),
        bubble: !!(bubbleEl && bubbleEl.classList.contains('is-shown')),
        introPending,
        lastExit,
        lastTrick
      }
    });
    label();
    sync();
  }
  /* Grappy content lives at module scope so AliGrapphMascot.grappy.addQA()
     and addTapLine() survive destroy()/init() cycles. */
  const GRAPPY_INTRO = {
    fa: 'سلام! 👋\nمن گرپی‌ام!\nاگه توی سایت کمکی خواستی، من هستم 😎',
    en: "Hey! 👋\nI'm Grappy!\nIf you need any help around the site, I'm here 😎"
  };
  const GRAPPY_GREETING = {
    fa: 'سلاممم 👋\nمن گرپی‌ام!\nاگه درباره سایت، نمونه‌کارها، سفارش یا علی گراف سوالی داری، روی یکی از گزینه‌ها بزن 😎',
    en: "Heeey 👋\nI'm Grappy!\nIf you have questions about the site, the portfolio, ordering or Ali Grapph, tap one of the options 😎"
  };
  const GRAPPY_TAP_LINES = [
    { fa: 'آییی دردم گرفت 😭', en: 'Ouch, that hurt 😭' },
    { fa: 'نکن دیگه 😂', en: 'Stop it already 😂' },
    { fa: 'کار نداری؟', en: 'Got nothing better to do?' },
    { fa: 'بی‌جنبه 🗿', en: 'Real smooth 🗿' },
    { fa: 'عه! باز اومدی؟ 👀', en: "Oh! You're back? 👀" },
    { fa: 'چیه خب؟ 😐', en: 'What? 😐' },
    { fa: 'فقط یه ضربه بود دیگه!', en: 'It was just one tap!' },
    { fa: 'منو ول کن دارم کار می‌کنم 😂', en: "Leave me alone, I'm working 😂" },
    { fa: 'آروم‌تر داداش 😭', en: 'Easy there, buddy 😭' },
    { fa: 'باز منو پیدا کردی؟', en: 'You found me again?' },
    { fa: 'هیس! دارم فکر می‌کنم 🤔', en: "Shh! I'm thinking 🤔" },
    { fa: 'یکی دیگه بزن ببینم 💢', en: 'Do it again, I dare you 💢' },
    { fa: 'وایسا ببینم چی شد 😳', en: 'Wait… what just happened 😳' },
    { fa: 'داری با من ور می‌ری؟ 😏', en: 'Are you messing with me? 😏' },
    { fa: 'این دفعه آخری بود ها 😤', en: 'That was the last time 😤' },
    { fa: 'قربونت برم، ول کن دیگه 😜', en: 'Aw you love me, now stop 😜' },
    { fa: 'یاااا! 🤩', en: 'Whoaa! 🤩' },
    { fa: 'چته داداش؟ 😂', en: "What's up with you? 😂" },
    { fa: 'حواست هست دیگه؟ 😬', en: "You're paying attention, right? 😬" },
    { fa: 'گرپی‌ام، دکمه نیستم 😂', en: "I'm Grappy, not a button 😂" }
  ];
  const GRAPPY_QA = [
    {
      id: 'about',
      question: { fa: 'علی گراف کیه؟', en: 'Who is Ali Grapph?' },
      answer: {
        fa: 'علی گراف یعنی امیرعلی؛ طراح گرافیک که از موبایل شروع کرد و حالا روی پوستر، لوگو، بنر و کاور کار می‌کنه. همه‌ی کارهاش همین پایینه 🎨',
        en: 'Ali Grapph is Amirali — a graphic designer who started on mobile and now works on posters, logos, banners and covers. All his work is right down there 🎨'
      }
    },
    {
      id: 'services',
      question: { fa: 'چه خدماتی ارائه میشه؟', en: 'What services do you offer?' },
      answer: {
        fa: 'لوگو، پوستر، بنر، کاور و کارهای گرافیکی برای برندها و کسب‌وکارها. برای جزئیات برو بخش تعرفه‌ها 😉',
        en: 'Logos, posters, banners, covers and graphic work for brands and businesses. Check the Pricing section for details 😉'
      }
    },
    {
      id: 'portfolio',
      question: { fa: 'نمونه‌کارها کجاست؟', en: "Where's the portfolio?" },
      answer: {
        fa: 'همین پایینِ سایت، بخش «نمونه‌کارها». روی هر کدوم بزنی بزرگش می‌کنه و می‌تونی دانلودشون هم بکنی 👀',
        en: "Scroll down to the Portfolio section. Tap any work to view it bigger — you can download them too 👀"
      }
    },
    {
      id: 'order',
      question: { fa: 'چطور سفارش بدم؟', en: 'How do I order?' },
      answer: {
        fa: 'خیلی راحته 😎\nبرو بخش سفارش، اطلاعات کارت رو بفرست و درخواستت رو ثبت کن. بعدش علی بررسیش می‌کنه. منم از دور حواسم هست 😂',
        en: "Super easy 😎\nGo to the Order section, send your details and submit your request. Ali will review it — I'll keep an eye from afar 😂"
      }
    },
    {
      id: 'articles',
      question: { fa: 'مقالات جدید چیا هستن؟', en: "What's new in articles?" },
      answer: {
        fa: 'یه بخش مخصوص مقاله‌ها داریم 👀\nاونجا می‌تونی آموزش‌ها، مطالب گرافیکی و چیزای جدیدی که منتشر می‌شن رو ببینی.',
        en: "We have a dedicated Articles section 👀\nThere you'll find tutorials, graphic design posts and everything new as it's published."
      }
    },
    {
      id: 'news',
      question: { fa: 'آخرین اطلاعیه‌ها چیه؟', en: 'Any recent announcements?' },
      answer: {
        fa: 'اطلاعیه‌های مهم بالای بخش مقالات قرار می‌گیره 📢 اگه خبر مهمی باشه، همونجا اول از همه می‌بینیش.',
        en: 'Important announcements live at the top of the Articles section 📢 Any big news shows up there first.'
      }
    },
    {
      id: 'contact',
      question: { fa: 'راه‌های ارتباطی کجاست؟', en: 'How can I get in touch?' },
      answer: {
        fa: 'ایتا، تلگرام، اینستاگرام و روبیکا؛ همه‌شون توی بخش سفارش و شبکه‌های اجتماعی هستن. هرکدوم راحت‌تری بزن 💬',
        en: 'Eitaa, Telegram, Instagram and Rubika — all in the Order and Social sections. Pick whichever you like 💬'
      }
    },
    {
      id: 'grappy',
      question: { fa: 'گرپی تو این سایت چیکار می‌کنه؟ 😐', en: 'What do you do here, Grappy? 😐' },
      answer: {
        fa: 'من؟ 😂\nمن مسئول رسمیِ راه رفتن بی‌هدف توی سایتم!\nالبته اگه سوالی داشته باشی هم کمکت می‌کنم 🗿🚬',
        en: "Me? 😂\nI'm the official manager of walking around the site for no reason!\nBut I'll help if you have a question 🗿🚬"
      }
    }
  ];
  let grappyBridge = null;
  const grappyApi = {
    addQA(qa) { if (grappyBridge) grappyBridge.addQA(qa); },
    addTapLine(line) { if (grappyBridge) grappyBridge.addTapLine(line); },
    say(data, duration) { if (grappyBridge) grappyBridge.say(data, duration); },
    open() { if (grappyBridge) grappyBridge.open(); },
    close() { if (grappyBridge) grappyBridge.close(); },
    toggle() { if (grappyBridge) grappyBridge.toggle(); },
    trick() { if (grappyBridge) grappyBridge.trick(); },
    resetIntro() { if (grappyBridge) grappyBridge.resetIntro(); }
  };

  window.AliGrapphMascot = Object.freeze({
    version: '3.1.0',
    init,
    destroy() { if (dispose) dispose(); },
    getState() { return readState(); },
    grappy: grappyApi
  });
  init();
})();

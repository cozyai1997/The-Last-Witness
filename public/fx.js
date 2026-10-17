/* 마지막 목격자 — offline atmospheric effects.
 * Plain script; no assets, packages, audio, or network requests.
 * Usage: WitnessFX.init({ canvas: document.querySelector('#fx') });
 * burst(x, y) takes viewport client coordinates. Give the canvas a CSS size.
 */
(function (window, document) {
  'use strict';

  var TAU = Math.PI * 2;
  var canvas = null;
  var context = null;
  var width = 1;
  var height = 1;
  var scale = 1;
  var quality = 'high';
  var privateView = false;
  var reducedMotion = false;
  var particles = [];
  var textures = null;
  var frameId = 0;
  var resizeTimer = 0;
  var lastFrame = 0;
  var elapsed = 0;
  var lightningAt = 20;
  var lightningAge = -1;
  var halo = null;
  var motionQuery = null;
  var resizeObserver = null;
  var previousStyle = null;
  var grainPattern = null;
  var pointer = { x: -1000, y: -1000, vx: 0, vy: 0, age: 9, time: 0, kick: 0 };
  var requestFrame = window.requestAnimationFrame ? function (fn) { return window.requestAnimationFrame(fn); } : function (fn) { return window.setTimeout(function () { fn(Date.now()); }, 17); };
  var cancelFrame = window.cancelAnimationFrame ? function (id) { window.cancelAnimationFrame(id); } : function (id) { window.clearTimeout(id); };

  function random(min, max) { return min + Math.random() * (max - min); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function smooth(value) { return value * value * (3 - 2 * value); }
  function budget() { return quality === 'low' ? 18 : 55; }

  function createSurface(size) {
    var surface = document.createElement('canvas');
    surface.width = size;
    surface.height = size;
    return surface;
  }

  // Every gradient and every noise pixel is made once, outside the frame loop.
  function cloudTexture(color, variant) {
    var surface = createSurface(256);
    var ctx = surface.getContext('2d');
    var i;
    for (i = 0; i < 19; i += 1) {
      var angle = i * 2.399963 + variant * 0.8;
      var spread = 11 + Math.sqrt(i) * 12;
      var x = 128 + Math.cos(angle) * spread * 0.91;
      var y = 128 + Math.sin(angle) * spread * 0.69;
      var radius = 36 + ((i * 17 + variant * 11) % 43);
      var gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(' + color + ',0.20)');
      gradient.addColorStop(0.33, 'rgba(' + color + ',0.12)');
      gradient.addColorStop(0.73, 'rgba(' + color + ',0.035)');
      gradient.addColorStop(1, 'rgba(' + color + ',0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Preserve the soft outline while breaking up perfectly smooth fog.
    var pixels = ctx.getImageData(0, 0, 256, 256);
    var data = pixels.data;
    for (i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * random(0.84, 1));
    }
    ctx.putImageData(pixels, 0, 0);
    return surface;
  }

  function makeTextures() {
    var result = {
      smoke: [cloudTexture('125,137,146', 0), cloudTexture('99,113,123', 1), cloudTexture('119,20,29', 2), cloudTexture('82,13,22', 3)],
      light: createSurface(256),
      grain: createSurface(96),
      glow: createSurface(32)
    };
    var ctx = result.light.getContext('2d');
    var gradient = ctx.createRadialGradient(128, 20, 0, 128, 20, 230);
    gradient.addColorStop(0, 'rgba(155,171,184,0.27)');
    gradient.addColorStop(0.32, 'rgba(114,132,151,0.12)');
    gradient.addColorStop(1, 'rgba(80,99,118,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    ctx = result.grain.getContext('2d');
    var pixels = ctx.createImageData(96, 96);
    var i;
    for (i = 0; i < pixels.data.length; i += 4) {
      var value = Math.random() > 0.52 ? 202 : 25;
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
      pixels.data[i + 3] = Math.floor(random(3, 17));
    }
    ctx.putImageData(pixels, 0, 0);

    ctx = result.glow.getContext('2d');
    gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(234,141,98,0.8)');
    gradient.addColorStop(0.17, 'rgba(202,66,44,0.48)');
    gradient.addColorStop(1, 'rgba(164,32,31,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    return result;
  }

  function resetParticle(particle, initial) {
    particle.kind = particle.baseKind;
    particle.phase = random(0, TAU);
    particle.age = initial ? random(3, 26) : 0;
    particle.ttl = random(27, 51);
    particle.spin = random(-0.025, 0.025);
    particle.rotation = random(0, TAU);
    particle.dx = 0;
    particle.dy = 0;
    if (particle.kind === 'smoke') {
      particle.red = Math.random() > 0.57;
      particle.texture = particle.red ? (Math.random() > 0.5 ? 2 : 3) : (Math.random() > 0.5 ? 0 : 1);
      particle.x = random(-0.18, 1.18) * width;
      particle.y = (particle.red ? random(0.52, 1.23) : random(0.02, 1.06)) * height;
      particle.size = random(0.28, 0.65) * Math.max(550, Math.min(width, height * 1.7));
      particle.aspect = random(0.65, 1.08);
      particle.vx = random(-6, 7);
      particle.vy = random(-10, -3);
      particle.opacity = particle.red ? random(0.14, 0.25) : random(0.10, 0.19);
    } else {
      particle.x = random(0, width);
      particle.y = initial ? random(0, height) : height + 10;
      particle.size = random(0.45, 1.35);
      particle.vx = random(-3, 6);
      particle.vy = random(-17, -5);
      particle.ttl = random(32, 75);
      particle.opacity = random(0.12, 0.37);
      particle.warm = Math.random() > 0.68;
    }
    return particle;
  }

  function seedParticles() {
    particles.length = 0;
    var count = budget();
    var smokeCount = quality === 'low' ? 11 : 32;
    var i;
    for (i = 0; i < count; i += 1) {
      particles.push(resetParticle({ baseKind: i < smokeCount ? 'smoke' : 'dust' }, true));
    }
  }

  function resizeCanvas() {
    if (!canvas || !context) { return; }
    var bounds = canvas.getBoundingClientRect();
    var oldWidth = width;
    var oldHeight = height;
    width = Math.max(1, Math.round(bounds.width || window.innerWidth || 1));
    height = Math.max(1, Math.round(bounds.height || window.innerHeight || 1));
    // A pixel cap also protects large/4K screens; DPR never exceeds 1.5.
    scale = Math.min(1.5, window.devicePixelRatio || 1, Math.sqrt(4200000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    grainPattern = context.createPattern(textures.grain, 'repeat');
    var i;
    for (i = 0; i < particles.length; i += 1) {
      particles[i].x *= width / oldWidth;
      particles[i].y *= height / oldHeight;
      if (particles[i].kind === 'smoke') {
        particles[i].size *= Math.min(width / oldWidth, height / oldHeight);
      }
    }
    if (halo) {
      halo.x *= width / oldWidth;
      halo.y *= height / oldHeight;
    }
    render(0);
    start();
  }

  function queueResize() {
    if (resizeTimer) { window.clearTimeout(resizeTimer); }
    resizeTimer = window.setTimeout(function () { resizeTimer = 0; resizeCanvas(); }, 90);
  }

  function onPointer(event) {
    if (!canvas || reducedMotion || quality === 'off' || privateView) { return; }
    if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') { return; }
    var bounds = canvas.getBoundingClientRect();
    var x = event.clientX - bounds.left;
    var y = event.clientY - bounds.top;
    var now = Date.now();
    var dt = clamp((now - pointer.time) / 1000, 0.016, 0.1);
    if (pointer.age < 0.4) {
      pointer.vx = clamp((x - pointer.x) / dt, -700, 700);
      pointer.vy = clamp((y - pointer.y) / dt, -700, 700);
    }
    pointer.x = x;
    pointer.y = y;
    pointer.age = 0;
    pointer.time = now;
    if (event.type === 'pointerdown') { pointer.kick = 1; }
  }

  function forgetPointer() {
    pointer.age = 9;
    pointer.vx = 0;
    pointer.vy = 0;
  }

  function drawSmoke(particle, dt) {
    var life = Math.sin(Math.PI * clamp(particle.age / particle.ttl, 0, 1));
    var sway = Math.sin(elapsed * 0.13 + particle.phase) * 11;
    var radius = particle.size * (0.88 + particle.age / particle.ttl * 0.26);
    var factor = privateView ? 0.42 : 1;
    if (!reducedMotion && !privateView && pointer.age < 1.8 && dt > 0) {
      var dx = particle.x - pointer.x;
      var dy = particle.y - pointer.y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var reach = radius * 0.42 + 100;
      if (distance < reach) {
        var force = (1 - distance / reach) * (1 - pointer.age / 1.8);
        particle.dx += ((dx / (distance || 1)) * (23 + pointer.kick * 70) + pointer.vx * 0.065) * force * dt;
        particle.dy += ((dy / (distance || 1)) * (23 + pointer.kick * 70) + pointer.vy * 0.065) * force * dt;
      }
    }
    particle.dx *= Math.pow(0.48, dt);
    particle.dy *= Math.pow(0.48, dt);
    context.save();
    context.translate(particle.x + particle.dx + sway, particle.y + particle.dy);
    context.rotate(particle.rotation);
    context.globalAlpha = particle.opacity * smooth(life) * factor;
    context.drawImage(textures.smoke[particle.texture], -radius / 2, -radius * particle.aspect / 2, radius, radius * particle.aspect);
    context.restore();
  }

  function drawDust(particle) {
    var life = Math.sin(Math.PI * clamp(particle.age / particle.ttl, 0, 1));
    var opacity = particle.opacity * (0.55 + 0.45 * life) * (privateView ? 0.22 : 1);
    var x = particle.x + Math.sin(elapsed * 0.38 + particle.phase) * 8;
    context.globalAlpha = opacity;
    if (particle.warm) {
      var diameter = particle.size * 10;
      context.drawImage(textures.glow, x - diameter / 2, particle.y - diameter / 2, diameter, diameter);
      context.fillStyle = '#cb795c';
    } else {
      context.fillStyle = '#a5b0ba';
    }
    context.fillRect(x, particle.y, particle.size, particle.size * 1.7);
  }

  function drawBlood(particle) {
    var remaining = 1 - particle.age / particle.ttl;
    context.globalAlpha = remaining * remaining * 0.76;
    context.strokeStyle = '#8c2530';
    context.lineWidth = Math.max(0.45, particle.size * 0.6);
    context.beginPath();
    context.moveTo(particle.x, particle.y);
    context.lineTo(particle.x - particle.vx * 0.025, particle.y - particle.vy * 0.025);
    context.stroke();
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(Math.atan2(particle.vy, particle.vx));
    context.scale(1.6, 1);
    context.fillStyle = particle.tone;
    context.beginPath();
    context.arc(0, 0, particle.size, 0, TAU);
    context.fill();
    context.restore();
  }

  function render(dt) {
    if (!canvas || !context) { return; }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (quality === 'off') { return; }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = privateView ? 0.15 : 0.36;
    context.save();
    context.translate(width * 0.82, -height * 0.08);
    context.rotate(0.36);
    context.drawImage(textures.light, -width * 0.34, 0, width * 0.68, height * 1.7);
    context.restore();

    var i;
    for (i = 0; i < particles.length; i += 1) {
      var particle = particles[i];
      if (dt > 0) {
        particle.age += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.rotation += particle.spin * dt;
        if (particle.kind === 'blood') { particle.vy += 145 * dt; }
        if (particle.age > particle.ttl || particle.y < -particle.size || particle.x < -width * 0.4 || particle.x > width * 1.4) {
          resetParticle(particle, false);
        }
      }
      if (particle.kind === 'smoke') { drawSmoke(particle, dt); }
      else if (particle.kind === 'blood' && !privateView) { drawBlood(particle); }
      else { drawDust(particle); }
    }

    if (halo && !privateView && !reducedMotion) {
      halo.age += dt;
      var progress = clamp(halo.age / halo.ttl, 0, 1);
      var size = 140 + progress * 125;
      context.globalAlpha = Math.pow(1 - progress, 2) * 0.30;
      context.drawImage(textures.smoke[2], halo.x - size / 2, halo.y - size / 2, size, size);
      if (progress >= 1) { halo = null; }
    }

    // A single, slow diffuse change in light, never a strobe or sharp bolt.
    if (dt > 0 && !privateView && quality === 'high') {
      if (elapsed > lightningAt && lightningAge < 0) { lightningAge = 0; }
      if (lightningAge >= 0) {
        lightningAge += dt;
        var flash = Math.sin(Math.PI * clamp(lightningAge / 1.65, 0, 1));
        context.globalAlpha = flash * flash * 0.034;
        context.fillStyle = '#aab7c6';
        context.fillRect(0, 0, width, height);
        if (lightningAge > 1.65) { lightningAge = -1; lightningAt = elapsed + random(22, 42); }
      }
    }
    if (grainPattern) {
      context.globalAlpha = privateView ? 0.13 : 0.28;
      context.fillStyle = grainPattern;
      context.fillRect(0, 0, width, height);
    }
    context.globalAlpha = 1;
  }

  function tick(now) {
    frameId = 0;
    if (!canvas || quality === 'off' || reducedMotion || document.hidden) { return; }
    var interval = quality === 'low' ? 1000 / 30 : 1000 / 60;
    if (!lastFrame) { lastFrame = now - interval; }
    var difference = now - lastFrame;
    if (difference >= interval - 0.7) {
      var dt = Math.min(difference / 1000, 0.065);
      lastFrame = now;
      elapsed += dt;
      pointer.age += dt;
      pointer.kick *= Math.pow(0.025, dt);
      render(dt);
    }
    frameId = requestFrame(tick);
  }

  function stop() {
    if (frameId) { cancelFrame(frameId); frameId = 0; }
    lastFrame = 0;
  }

  function start() {
    if (!canvas || frameId || quality === 'off' || reducedMotion || document.hidden) { return; }
    lastFrame = 0;
    frameId = requestFrame(tick);
  }

  function onVisibility() {
    if (document.hidden) { stop(); forgetPointer(); }
    else { render(0); start(); }
  }

  function onMotionChange(event) {
    reducedMotion = !!event.matches;
    stop();
    forgetPointer();
    halo = null;
    lightningAge = -1;
    var i;
    for (i = 0; i < particles.length; i += 1) {
      if (particles[i].kind === 'blood') { resetParticle(particles[i], true); }
    }
    render(0);
    start();
  }

  function destroy() {
    stop();
    if (resizeTimer) { window.clearTimeout(resizeTimer); resizeTimer = 0; }
    window.removeEventListener('resize', queueResize);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('blur', forgetPointer);
    document.removeEventListener('visibilitychange', onVisibility);
    if (motionQuery) {
      if (motionQuery.removeEventListener) { motionQuery.removeEventListener('change', onMotionChange); }
      else if (motionQuery.removeListener) { motionQuery.removeListener(onMotionChange); }
    }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (canvas && context) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.pointerEvents = previousStyle.pointerEvents;
      canvas.style.visibility = previousStyle.visibility;
      if (previousStyle.ariaHidden === null) { canvas.removeAttribute('aria-hidden'); }
      else { canvas.setAttribute('aria-hidden', previousStyle.ariaHidden); }
    }
    canvas = null;
    context = null;
    textures = null;
    grainPattern = null;
    particles.length = 0;
    motionQuery = null;
    halo = null;
    forgetPointer();
    return api;
  }

  function init(options) {
    var target = options && options.canvas;
    if (!target || typeof target.getContext !== 'function') {
      throw new TypeError('WitnessFX.init requires a canvas element.');
    }
    destroy();
    canvas = target;
    context = canvas.getContext('2d', { alpha: true });
    if (!context) { canvas = null; return api; }
    previousStyle = { pointerEvents: canvas.style.pointerEvents, visibility: canvas.style.visibility, ariaHidden: canvas.getAttribute('aria-hidden') };
    canvas.style.pointerEvents = 'none';
    canvas.style.visibility = quality === 'off' ? 'hidden' : previousStyle.visibility;
    canvas.setAttribute('aria-hidden', 'true');
    textures = makeTextures();
    elapsed = 0;
    lightningAt = random(18, 30);
    lightningAge = -1;
    motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    reducedMotion = !!(motionQuery && motionQuery.matches);
    if (motionQuery) {
      if (motionQuery.addEventListener) { motionQuery.addEventListener('change', onMotionChange); }
      else if (motionQuery.addListener) { motionQuery.addListener(onMotionChange); }
    }
    width = 1;
    height = 1;
    resizeCanvas();
    seedParticles();
    render(0);
    window.addEventListener('resize', queueResize, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('blur', forgetPointer);
    document.addEventListener('visibilitychange', onVisibility);
    if (window.ResizeObserver) {
      resizeObserver = new window.ResizeObserver(queueResize);
      resizeObserver.observe(canvas);
    }
    start();
    return api;
  }

  function setQuality(value) {
    var next = value === 'off' || value === 'low' ? value : 'high';
    if (quality === next) { return api; }
    quality = next;
    stop();
    halo = null;
    lightningAge = -1;
    if (canvas) {
      canvas.style.visibility = quality === 'off' ? 'hidden' : previousStyle.visibility;
      if (quality !== 'off') { seedParticles(); }
      render(0);
      start();
    }
    return api;
  }

  function setPrivate(value) {
    privateView = !!value;
    halo = null;
    lightningAge = -1;
    lightningAt = elapsed + random(22, 42);
    forgetPointer();
    var i;
    for (i = 0; i < particles.length; i += 1) {
      if (particles[i].kind === 'blood') { resetParticle(particles[i], true); }
      particles[i].dx = 0;
      particles[i].dy = 0;
    }
    render(0);
    return api;
  }

  function burst(x, y, type) {
    if (!canvas || quality === 'off' || privateView || reducedMotion || document.hidden) { return api; }
    var bounds = canvas.getBoundingClientRect();
    var localX = typeof x === 'number' && isFinite(x) ? x - bounds.left : width * 0.5;
    var localY = typeof y === 'number' && isFinite(y) ? y - bounds.top : height * 0.5;
    localX = clamp(localX, 0, width);
    localY = clamp(localY, 0, height);
    pointer.x = localX;
    pointer.y = localY;
    pointer.age = 0;
    pointer.kick = 1;
    if (type && type !== 'blood') { return api; }
    halo = { x: localX, y: localY, age: 0, ttl: 1.2 };
    var count = quality === 'low' ? 5 : 12;
    var i;
    // Borrow existing dust slots; bursts never grow the particle pool.
    for (i = particles.length - 1; i >= 0 && count > 0; i -= 1) {
      var particle = particles[i];
      if (particle.baseKind !== 'dust') { continue; }
      particle.kind = 'blood';
      particle.x = localX + random(-6, 6);
      particle.y = localY + random(-5, 5);
      particle.vx = random(-67, 67);
      particle.vy = random(-95, -14);
      particle.age = 0;
      particle.ttl = random(0.55, 1.25);
      particle.size = random(0.65, 2.0);
      particle.tone = Math.random() > 0.5 ? '#9a2937' : '#661b29';
      count -= 1;
    }
    start();
    return api;
  }

  var api = { init: init, setQuality: setQuality, burst: burst, setPrivate: setPrivate, destroy: destroy };
  window.WitnessFX = api;
}(window, document));

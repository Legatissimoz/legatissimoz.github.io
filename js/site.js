const NS = "http://www.w3.org/2000/svg";

function strokeWidth(style) {
  const m = (style || "").match(/stroke-width:\s*([\d.]+)px/);
  return m ? parseFloat(m[1]) : 0;
}

function parseMatrix(el) {
  const t = el.getAttribute("transform") || "";
  const m = t.match(/matrix\(\s*([^)]+)\)/);
  if (!m) return null;
  return m[1].split(/[\s,]+/).filter(Boolean).map(Number);
}

function lineSpan(d) {
  const n = (d || "").match(/-?\d*\.?\d+/g);
  if (!n || n.length < 4) return 0;
  return Math.hypot(+n[2] - +n[0], +n[3] - +n[1]);
}

function classify(group) {
  const inner = group.querySelector("path, rect, polyline, line");
  if (!inner) return "ignore";
  const style = inner.getAttribute("style") || "";
  const d = inner.getAttribute("d") || "";
  const fillNone = /fill:\s*none/.test(style);
  const fillWhite = /fill:\s*white/.test(style);
  const sw = strokeWidth(style);
  const mat = parseMatrix(group);
  const a = mat ? mat[0] : 1;
  const b = mat ? mat[1] : 0;
  const tx = mat ? mat[4] : 0;
  const w = parseFloat(inner.getAttribute("width") || 0);
  const h = parseFloat(inner.getAttribute("height") || 0);
  if (fillWhite) return "ignore";
  if (inner.tagName.toLowerCase() === "rect" && fillNone && w > 1000 && h > 1000) return "ignore";
  if (fillNone && sw > 0.3 && sw < 0.38 && Math.abs(a) > 10 && Math.abs(b) < 0.15 && lineSpan(d) > 200) return "staff";
  if (fillNone && Math.abs(sw - 0.59) < 0.08 && Math.abs(a) < 0.15 && Math.abs(b) > 10 && lineSpan(d) > 50) return "bar";
  if (d.startsWith("M10.724,-157") || d.startsWith("M10.045,-147")) return "brace";
  if (d.startsWith("M13.198,-24.62") || d.startsWith("M18.843,17.564")) return "clef";
  if (d.startsWith("M2.756,-12.451") && tx < 1100) return "header";
  if (d.startsWith("M4.283,3.818") && tx > 790 && tx < 990) return "header";
  return "fly";
}

function makeLayer(className) {
  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", className);
  return g;
}

function prepareInline(svg) {
  if (!svg || svg.dataset.prepared === "1") return;
  svg.dataset.prepared = "1";
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  [...svg.children].forEach((el) => {
    const tag = el.tagName && el.tagName.toLowerCase();
    if (tag === "style" || tag === "script") {
      el.remove();
      return;
    }
    if (tag === "g" && el.id !== "画板1") el.style.display = "none";
  });
  const board = svg.querySelector("#画板1") || svg;
  const staffLayer = makeLayer("piece-staff");
  const frameLayer = makeLayer("piece-frame");
  const waves = [0, 1, 2, 3, 4, 5].map((i) => {
    const g = makeLayer("piece-wave");
    const side = i % 2 === 0 ? -1 : 1;
    g.style.setProperty("--dx", (side * (72 + i * 14)) + "px");
    g.style.setProperty("--dy", (56 + (i % 3) * 14) + "px");
    g.style.setProperty("--delay", (0.22 + i * 0.07) + "s");
    return g;
  });
  let flyIndex = 0;
  [...board.children].forEach((el) => {
    const tag = el.tagName && el.tagName.toLowerCase();
    if (tag !== "g") {
      if (tag === "rect") el.style.display = "none";
      return;
    }
    const kind = classify(el);
    if (kind === "ignore") el.style.display = "none";
    else if (kind === "staff" || kind === "bar") staffLayer.appendChild(el);
    else if (kind === "brace" || kind === "clef" || kind === "header") frameLayer.appendChild(el);
    else {
      waves[flyIndex % waves.length].appendChild(el);
      flyIndex += 1;
    }
  });
  board.append(staffLayer, frameLayer, ...waves);
}

function fillScoreSlots(svg) {
  document.querySelectorAll(".page-score-inner").forEach((slot) => {
    if (slot.dataset.filled === "1") return;
    slot.dataset.filled = "1";
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.addEventListener("error", () => {
      if (!svg) return;
      const clone = svg.cloneNode(true);
      clone.removeAttribute("id");
      clone.querySelectorAll(".piece-staff, .piece-frame, .piece-wave").forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
        el.style.transition = "none";
      });
      slot.innerHTML = "";
      slot.appendChild(clone);
    });
    img.src = "assets/score.svg";
    slot.appendChild(img);
  });
}


function bindWorks() {
  const scores = window.WORKS_SCORES || [];
  const byId = Object.fromEntries(scores.map((item) => [item.id, item]));
  const rail = document.getElementById("works-rail");
  const viewer = document.getElementById("pdf-viewer");
  const detail = document.getElementById("works-detail");
  if (!rail || !viewer) return;

  const covers = [...rail.querySelectorAll(".works-cover")];
  const titleEl = viewer.querySelector(".pdf-title");
  const pageEl = viewer.querySelector(".pdf-page");
  const imgEl = viewer.querySelector(".pdf-stage img");
  const prevBtn = viewer.querySelector(".pdf-prev");
  const nextBtn = viewer.querySelector(".pdf-next");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let worksOn = true;
  let current = null;
  let page = 0;
  let down = false;
  let dragged = false;
  let x0 = 0;
  let s0 = 0;
  let pressEl = null;
  let focusTick = 0;
  let moveTick = 0;
  let snapTick = 0;
  let wheelLock = 0;

  function showPage() {
    if (!current) return;
    imgEl.src = current.pages[page];
    imgEl.alt = current.title + " " + (page + 1);
    pageEl.textContent = (page + 1) + " / " + current.pages.length;
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= current.pages.length - 1;
    viewer.querySelector(".pdf-stage").scrollTop = 0;
  }

  function openWork(id) {
    const item = byId[id];
    if (!item) return;
    current = item;
    page = 0;
    titleEl.textContent = item.title;
    document.documentElement.classList.add("pdf-open");
    viewer.setAttribute("aria-hidden", "false");
    showPage();
  }

  function closeWork() {
    document.documentElement.classList.remove("pdf-open");
    viewer.setAttribute("aria-hidden", "true");
    current = null;
    imgEl.removeAttribute("src");
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  }

  function nearestCover() {
    const mid = centerOf(rail);
    let best = covers[0];
    let bestDist = Infinity;
    covers.forEach((el) => {
      const dist = Math.abs(centerOf(el) - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    });
    return best;
  }

  function paintFocus() {
    if (!worksOn || !covers.length) return;
    const mid = centerOf(rail);
    const span = Math.max(rail.clientWidth * 0.42, 1);
    const best = nearestCover();
    covers.forEach((el) => {
      const signed = (centerOf(el) - mid) / span;
      const t = Math.min(1, Math.abs(signed));
      el.style.setProperty("--t", t.toFixed(3));
      el.style.setProperty("--s", signed.toFixed(3));
      el.classList.toggle("is-center", el === best);
    });
  }

  function requestFocus() {
    if (focusTick) return;
    focusTick = window.requestAnimationFrame(() => {
      focusTick = 0;
      paintFocus();
    });
  }

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateTo(target, duration) {
    const start = rail.scrollLeft;
    const dist = target - start;
    if (Math.abs(dist) < 0.6) {
      paintFocus();
      return;
    }
    if (reduce) {
      rail.scrollLeft = target;
      paintFocus();
      return;
    }
    const t0 = performance.now();
    const dur = duration || 560;
    if (snapTick) window.cancelAnimationFrame(snapTick);
    rail.classList.add("is-settling");
    function tick(now) {
      const p = Math.min(1, (now - t0) / dur);
      rail.scrollLeft = start + dist * easeOut(p);
      paintFocus();
      if (p < 1) snapTick = window.requestAnimationFrame(tick);
      else {
        snapTick = 0;
        rail.classList.remove("is-settling");
        paintFocus();
      }
    }
    snapTick = window.requestAnimationFrame(tick);
  }

  function snapToCover(el, duration) {
    if (!el) return;
    const target = rail.scrollLeft + (centerOf(el) - centerOf(rail));
    animateTo(target, duration);
  }

  function activeId() {
    const el = nearestCover();
    return el ? el.dataset.work : "";
  }

  rail.addEventListener("scroll", requestFocus, { passive: true });
  window.addEventListener("resize", () => {
    snapToCover(nearestCover(), 1);
  });

  rail.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (snapTick) {
      window.cancelAnimationFrame(snapTick);
      snapTick = 0;
      rail.classList.remove("is-settling");
    }
    pressEl = e.target.closest(".works-cover");
    down = true;
    dragged = false;
    x0 = e.clientX;
    s0 = rail.scrollLeft;
    rail.classList.add("is-dragging");
  });
  rail.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 6) dragged = true;
    rail.scrollLeft = s0 - dx;
    if (!moveTick) {
      moveTick = window.requestAnimationFrame(() => {
        moveTick = 0;
        paintFocus();
      });
    }
  });
  function endPointer() {
    if (!down) return;
    down = false;
    rail.classList.remove("is-dragging");
    if (dragged) snapToCover(nearestCover(), 620);
    else if (pressEl) snapToCover(pressEl, 520);
    pressEl = null;
  }
  rail.addEventListener("pointerup", endPointer);
  window.addEventListener("pointerup", endPointer);
  rail.addEventListener("pointercancel", () => {
    down = false;
    pressEl = null;
    rail.classList.remove("is-dragging");
  });
  rail.addEventListener("click", (e) => {
    if (e.target.closest(".works-cover")) e.preventDefault();
  });

  window.__worksNudge = (dy) => {
    if (performance.now() < wheelLock) return;
    wheelLock = performance.now() + 380;
    const i = covers.indexOf(nearestCover());
    const next = covers[Math.max(0, Math.min(covers.length - 1, i + (dy > 0 ? 1 : -1)))];
    snapToCover(next, 540);
  };

  if (detail) {
    detail.addEventListener("click", () => openWork(activeId()));
  }

  viewer.addEventListener("click", (e) => {
    if (e.target === viewer) closeWork();
  });
  viewer.querySelector(".pdf-close").addEventListener("click", closeWork);
  prevBtn.addEventListener("click", () => {
    if (page > 0) { page -= 1; showPage(); }
  });
  nextBtn.addEventListener("click", () => {
    if (current && page < current.pages.length - 1) { page += 1; showPage(); }
  });
  viewer.addEventListener("contextmenu", (e) => e.preventDefault());
  rail.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (!document.documentElement.classList.contains("pdf-open")) return;
    if (e.key === "Escape") { e.preventDefault(); closeWork(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (page > 0) { page -= 1; showPage(); } }
    else if (e.key === "ArrowRight") { e.preventDefault(); if (current && page < current.pages.length - 1) { page += 1; showPage(); } }
    else if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"].includes(e.key)) {
      e.preventDefault();
    }
  });

  const worksEl = document.getElementById("works");
  if (worksEl && "IntersectionObserver" in window) {
    worksOn = false;
    const io = new IntersectionObserver((entries) => {
      worksOn = entries[0].isIntersecting;
      if (worksOn) requestFocus();
    }, { threshold: 0.12 });
    io.observe(worksEl);
  }

  if (covers[0]) {
    window.requestAnimationFrame(() => snapToCover(covers[0], 1));
  }
}

function bindPlayback() {
  const score = document.getElementById("score");
  const siteNav = document.getElementById("site-nav");
  const copy = document.querySelector(".copyright");
  const navLinks = [...siteNav.querySelectorAll("a[data-section]")];
  const named = ["about", "engraving", "toccatina", "works", "service", "contact"].map((id) => document.getElementById(id));
  const panels = [document.getElementById("stage"), ...document.querySelectorAll(".page")].filter(Boolean);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let delayTimer = 0;
  let settleTimer = 0;
  let jumping = false;
  let anim = 0;
  let coolUntil = 0;
  let touchY = 0;
  let activeIndex = 0;
  let pendingDir = 0;
  let wheelAcc = 0;
  let wheelGate = 0;
  let progress = 1;
  const root = document.scrollingElement || document.documentElement;

  const toc = document.getElementById("engraving");

  function onToc(idx) {
    return panels[idx] === toc;
  }

  function playScore(show) {
    if (!show) return;
    window.clearTimeout(delayTimer);
    window.clearTimeout(settleTimer);
    document.documentElement.classList.remove("score-idle");
    score.classList.remove("is-on", "is-settled");
    void score.offsetWidth;
    delayTimer = window.setTimeout(() => {
      score.classList.add("is-on");
      settleTimer = window.setTimeout(() => score.classList.add("is-settled"), 1200);
    }, 40);
  }

  function setNav(id) {
    const navId = id === "toccatina" ? "engraving" : id;
    navLinks.forEach((a) => a.classList.toggle("is-current", a.dataset.section === navId));
  }

  function syncChrome() {
    const homeH = document.getElementById("stage").offsetHeight;
    const pastHome = window.scrollY > homeH * 0.42;
    siteNav.classList.toggle("is-on", pastHome);
    copy.classList.toggle("is-dim", pastHome);
    document.body.classList.toggle("past-home", pastHome);
    if (!pastHome) {
      setNav("home");
      return;
    }
    let current = "about";
    named.forEach((el) => {
      if (!el) return;
      if (el.getBoundingClientRect().top < window.innerHeight * 0.55) current = el.id;
    });
    setNav(current);
  }

  let nightValue = "";
  function updateNight() {
    const el = document.getElementById("toccatina");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = window.innerHeight || 1;
    const visible = Math.min(h, r.bottom) - Math.max(0, r.top);
    const cover = Math.max(0, Math.min(1, visible / h));
    let t = (cover - 0.16) / 0.78;
    t = Math.max(0, Math.min(1, t));
    t = t * t * (3 - 2 * t);
    const v = t.toFixed(4);
    if (v === nightValue) return;
    nightValue = v;
    document.documentElement.style.setProperty("--night", v);
  }

  function easeSoft(t) {
    return 0.5 - Math.cos(Math.PI * t) / 2;
  }

  function panelY(el) {
    return window.scrollY + el.getBoundingClientRect().top;
  }

  function currentIndex() {
    const y = root.scrollTop;
    let best = 0;
    let dist = Infinity;
    panels.forEach((el, i) => {
      const d = Math.abs(panelY(el) - y);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  }

  function durationFor(dist) {
    if (reduce) return 0;
    const screens = Math.max(1, Math.abs(dist) / Math.max(1, window.innerHeight));
    return Math.round(Math.min(1480, 960 + (screens - 1) * 160));
  }

  function finishJump(idx) {
    jumping = false;
    progress = 1;
    activeIndex = idx;
    coolUntil = performance.now() + 40;
    wheelGate = performance.now() + 360;
    if (score) score.style.willChange = "auto";
    if (!onToc(idx)) document.documentElement.classList.add("score-idle");
    syncChrome();
    updateNight();
    if (pendingDir) {
      const dir = pendingDir;
      pendingDir = 0;
      const next = Math.max(0, Math.min(panels.length - 1, activeIndex + dir));
      if (onToc(next)) playScore(true);
      goToIndex(activeIndex + dir);
      return;
    }
    if (onToc(idx)) playScore(true);
  }

  function scrollToY(target, idx) {
    const start = root.scrollTop;
    const dist = target - start;
    window.cancelAnimationFrame(anim);
    if (Math.abs(dist) < 0.5) {
      finishJump(idx);
      return;
    }
    jumping = true;
    progress = 0;
    const ms = durationFor(dist);
    if (ms <= 0) {
      root.scrollTop = target;
      finishJump(idx);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      progress = Math.min(1, (now - t0) / ms);
      root.scrollTop = start + dist * easeSoft(progress);
      updateNight();
      if (progress < 1) anim = window.requestAnimationFrame(step);
      else {
        root.scrollTop = target;
        finishJump(idx);
      }
    };
    anim = window.requestAnimationFrame(step);
  }

  function goToIndex(i) {
    const idx = Math.max(0, Math.min(panels.length - 1, i));
    if (onToc(activeIndex) && !onToc(idx) && score) {
      score.style.willChange = "transform";
    }
    scrollToY(panelY(panels[idx]), idx);
  }

  function goBy(dir, fromWheel) {
    if (!dir) return;
    if (fromWheel) {
      if (jumping || performance.now() < wheelGate) return;
      pendingDir = 0;
      goToIndex(activeIndex + dir);
      return;
    }
    if (jumping) {
      if (progress > 0.38) pendingDir = dir;
      return;
    }
    if (performance.now() < coolUntil) {
      pendingDir = dir;
      return;
    }
    goToIndex(activeIndex + dir);
  }

  function goToId(id) {
    pendingDir = 0;
    if (id === "home") {
      goToIndex(0);
      return;
    }
    const idx = panels.findIndex((el) => el.id === id);
    if (idx >= 0) goToIndex(idx);
  }

  let chromeTick = 0;
  window.addEventListener("scroll", () => {
    if (chromeTick) return;
    chromeTick = window.requestAnimationFrame(() => {
      chromeTick = 0;
      updateNight();
      if (!jumping) syncChrome();
    });
  }, { passive: true });

  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;
    if (document.documentElement.classList.contains("pdf-open")) {
      if (!e.target.closest(".pdf-stage")) e.preventDefault();
      return;
    }
    const onCover = e.target.closest && e.target.closest(".works-cover");
    if (onCover) {
      e.preventDefault();
      if (window.__worksNudge) window.__worksNudge(e.deltaY + e.deltaX);
      return;
    }
    e.preventDefault();
    if (jumping || performance.now() < wheelGate) return;
    let dy = e.deltaY;
    if (Math.abs(dy) < Math.abs(e.deltaX) * 0.55) return;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= window.innerHeight;
    wheelAcc = Math.sign(dy) !== Math.sign(wheelAcc) ? dy : wheelAcc + dy;
    const need = e.deltaMode === 0 ? 70 : 28;
    if (wheelAcc > need) {
      goBy(1, true);
      wheelAcc = 0;
    } else if (wheelAcc < -need) {
      goBy(-1, true);
      wheelAcc = 0;
    }
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (document.documentElement.classList.contains("pdf-open")) return;
    if (e.key === "Home") { e.preventDefault(); goToIndex(0); return; }
    if (e.key === "End") { e.preventDefault(); goToIndex(panels.length - 1); return; }
    const dir = ({ ArrowDown: 1, PageDown: 1, " ": 1, ArrowUp: -1, PageUp: -1 })[e.key];
    if (!dir) return;
    if (e.key === " " && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.preventDefault();
    goBy(dir);
  });

  window.addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener("touchend", (e) => {
    if (document.documentElement.classList.contains("pdf-open")) return;
    if (e.target.closest && e.target.closest(".works-cover")) return;
    const dy = touchY - e.changedTouches[0].clientY;
    if (Math.abs(dy) < 28) goToIndex(currentIndex());
    else goBy(dy > 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener("resize", () => {
    window.cancelAnimationFrame(anim);
    jumping = false;
    pendingDir = 0;
    activeIndex = currentIndex();
    const el = panels[activeIndex];
    if (el) root.scrollTop = panelY(el);
  });

  siteNav.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-section]");
    if (!a) return;
    e.preventDefault();
    goToId(a.dataset.section);
  });

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.closest("#site-nav")) return;
    const id = (a.getAttribute("href") || "").slice(1);
    if (!id || !document.getElementById(id)) return;
    e.preventDefault();
    goToId(id);
  });

  activeIndex = currentIndex();
  syncChrome();
  updateNight();
  if (onToc(activeIndex)) playScore(true);
  else document.documentElement.classList.add("score-idle");
}

function boot() {
  const host = document.getElementById("score");
  const svg = host && host.querySelector("svg");
  prepareInline(svg);
  fillScoreSlots(svg);
  const toc = document.getElementById("engraving");
  if (toc && host) toc.appendChild(host);
  bindPlayback();
  bindWorks();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
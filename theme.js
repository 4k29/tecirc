(function () {
  "use strict";

  var STORAGE_KEY = "4k29-theme";
  var GA_ID = "G-KK7MDCLBGT";
  var FAVICON_URL = "/tecirc/favicon.svg";
  var root = document.documentElement;
  var mobileQuery = window.matchMedia ? window.matchMedia("(max-width: 560px)") : null;

  function ensureAnalytics() {
    if (typeof window.gtag === "function") return;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };

    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(script);

    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { send_page_view: true });
  }

  function trackEvent(name, params) {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", name, params || {});
  }

  function mountFavicon() {
    var icon = document.querySelector('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.type = "image/svg+xml";
    icon.href = FAVICON_URL;
  }

  function getContentContext() {
    var path = window.location.pathname;
    var base = "/tecirc";

    if (path === base + "/notes/" || path === base + "/notes") {
      return { type: "archive", section: "notes" };
    }
    if (path.indexOf(base + "/notes/") === 0 && path.indexOf("/editor/") === -1) {
      return { type: "note", section: "notes" };
    }
    if (path === base + "/memory/" || path === base + "/memory") {
      return { type: "archive", section: "memory" };
    }
    if (path.indexOf(base + "/memory/") === 0 && path.indexOf("/editor/") === -1) {
      return { type: "memory", section: "memory" };
    }
    if (path === base + "/" || path === base) {
      return { type: "home", section: "home" };
    }
    if (path.indexOf(base + "/sitemap") === 0) {
      return { type: "sitemap", section: "sitemap" };
    }
    return { type: "page", section: "other" };
  }

  function mountAnalytics() {
    var context = getContentContext();

    trackEvent("content_view", {
      content_type: context.type,
      content_section: context.section,
      page_path: window.location.pathname,
      page_title: document.title
    });

    document.querySelectorAll("a.row-item, .note-index-item > a").forEach(function (link) {
      link.addEventListener("click", function () {
        trackEvent("content_open", {
          link_url: link.href,
          link_text: (link.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
          source_section: context.section
        });
      });
    });

    var shareLink = document.querySelector(".article-share a");
    if (shareLink) {
      shareLink.addEventListener("click", function () {
        trackEvent("note_share", {
          method: "x",
          page_path: window.location.pathname,
          page_title: document.title
        });
      });
    }

    if (context.type === "note") {
      var sent50 = false;
      var sent90 = false;
      window.addEventListener("scroll", function () {
        var doc = document.documentElement;
        var maxScroll = Math.max(doc.scrollHeight - window.innerHeight, 1);
        var progress = Math.min((window.scrollY || 0) / maxScroll, 1);

        if (!sent50 && progress >= 0.5) {
          sent50 = true;
          trackEvent("read_depth", {
            percent_scrolled: 50,
            page_path: window.location.pathname,
            page_title: document.title
          });
        }
        if (!sent90 && progress >= 0.9) {
          sent90 = true;
          trackEvent("read_depth", {
            percent_scrolled: 90,
            page_path: window.location.pathname,
            page_title: document.title
          });
        }
      }, { passive: true });
    }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function storedTheme() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : "";
    } catch (error) {
      return "";
    }
  }

  function iconMarkup(theme) {
    if (theme === "dark") {
      return '<svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.25"></circle><path d="M12 2.75v2.1M12 19.15v2.1M4.46 4.46l1.49 1.49M18.05 18.05l1.49 1.49M2.75 12h2.1M19.15 12h2.1M4.46 19.54l1.49-1.49M18.05 5.95l1.49-1.49"></path></svg>';
    }
    return '<svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.1 14.6A8.35 8.35 0 0 1 9.4 3.9 8.5 8.5 0 1 0 20.1 14.6Z"></path></svg>';
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    var button = document.getElementById("theme-toggle");
    if (!button) return;

    var nextTheme = theme === "light" ? "dark" : "light";
    button.dataset.currentTheme = theme;
    button.innerHTML = iconMarkup(theme);
    button.setAttribute("aria-label", nextTheme === "light"
      ? "ライトモードに切り替える"
      : "ダークモードに切り替える");
    button.setAttribute("title", nextTheme === "light"
      ? "ライトモード"
      : "ダークモード");
  }

  function saveTheme(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      // Keep the selected theme for this page even when storage is unavailable.
    }
  }

  function placeToggle(button) {
    var nav = document.querySelector(".global-header .global-nav");
    if (mobileQuery && mobileQuery.matches && nav) {
      if (button.parentNode !== nav) nav.appendChild(button);
      return;
    }

    if (button.parentNode !== document.body) document.body.appendChild(button);
  }

  function mountToggle() {
    if (document.getElementById("theme-toggle")) return;

    var button = document.createElement("button");
    button.id = "theme-toggle";
    button.className = "theme-toggle";
    button.type = "button";
    document.body.appendChild(button);

    placeToggle(button);
    applyTheme(root.dataset.theme || systemTheme());

    button.addEventListener("click", function () {
      var current = root.dataset.theme || systemTheme();
      var next = current === "light" ? "dark" : "light";
      applyTheme(next);
      saveTheme(next);
      trackEvent("theme_change", { theme: next });
    });

    if (mobileQuery) {
      if (typeof mobileQuery.addEventListener === "function") {
        mobileQuery.addEventListener("change", function () { placeToggle(button); });
      } else if (typeof mobileQuery.addListener === "function") {
        mobileQuery.addListener(function () { placeToggle(button); });
      }
    }
  }

  function mountHeaderReveal() {
    var header = document.querySelector(".global-header");
    if (!header) return;

    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    var lastY = Math.max(window.scrollY || 0, 0);
    var ticking = false;
    var topZone = 72;
    var delta = 3;

    function updateHeader() {
      var currentY = Math.max(window.scrollY || 0, 0);
      header.classList.toggle("is-scrolled", currentY > 8);

      if (currentY <= topZone || reducedMotion.matches || header.contains(document.activeElement)) {
        header.classList.remove("is-hidden");
      } else if (currentY > lastY + delta) {
        header.classList.add("is-hidden");
      } else if (currentY < lastY - delta) {
        header.classList.remove("is-hidden");
      }

      lastY = currentY;
      ticking = false;
    }

    header.addEventListener("focusin", function () {
      header.classList.remove("is-hidden");
    });
    if (typeof reducedMotion.addEventListener === "function") {
      reducedMotion.addEventListener("change", updateHeader);
    }
    updateHeader();

    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateHeader);
    }, { passive: true });
  }

  // An interactive page ruler with a softly trailing colour wake.
  function mountReadingProgress() {
    var root = document.documentElement;
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    var ruler = document.createElement("div");
    ruler.className = "page-ruler";
    ruler.tabIndex = 0;
    ruler.setAttribute("role", "slider");
    ruler.setAttribute("aria-label", "ページのスクロール位置");
    ruler.setAttribute("aria-orientation", "vertical");
    ruler.setAttribute("aria-valuemin", "0");
    ruler.setAttribute("aria-valuemax", "100");
    ruler.title = "上下にドラッグして移動 · 矢印キーでも操作できます";
    for (var i = 0; i < 25; i += 1) {
      ruler.appendChild(document.createElement("i"));
    }
    document.body.appendChild(ruler);
    var ticks = Array.from(ruler.children);
    var article = document.querySelector(".note-content .article-body");
    var totalLabel;
    var remainingLabel;
    var blocks = [];
    var totalMinutes = 0;
    if (article) {
      // Count Japanese characters and Latin words separately. This is an estimate,
      // not a timer: scrolling back restores the remaining reading time.
      blocks = Array.from(article.children).map(function (element) {
        var text = element.textContent.replace(/\s+/g, " ").trim();
        var words = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || [];
        var characters = text.replace(/[\x00-\x7F\s]/g, "").length;
        return { element: element, minutes: characters / 500 + words.length / 200 };
      });
      totalMinutes = blocks.reduce(function (sum, block) { return sum + block.minutes; }, 0);
      if (totalMinutes > 0) {
        totalLabel = document.createElement("p");
        totalLabel.className = "reading-estimate";
        totalLabel.textContent = "約" + Math.max(1, Math.ceil(totalMinutes)) + "分で読めます";
        totalLabel.title = "日本語は毎分約500文字、英語は毎分約200語を目安にしています";
        document.querySelector(".note-hero").appendChild(totalLabel);
        remainingLabel = document.createElement("span");
        remainingLabel.className = "reading-remaining";
        // Deliberately not live: announcing every scroll would interrupt reading.
        document.body.appendChild(remainingLabel);
      }
    }
    var frame = 0;
    var lastY = Math.max(0, window.scrollY);
    var lastTime = performance.now();
    var energy = 0;
    var wake = null;
    var direction = 0;
    var targetDirection = 0;
    var lastMotionTime = -Infinity;
    var motionSpeed = 0;
    var displayedProgress = null;
    var geometryDirty = true;
    var geometry = { max: 0, height: 0, articleTop: 0, articleBottom: 0 };
    var pendingScroll = null;
    var pointerId = null;
    var dragOffset = 0;
    var hapticStep = -1;
    var lastHaptic = -Infinity;

    function scrollRange() {
      return Math.max(0, root.scrollHeight - window.innerHeight);
    }
    function scrollToPosition(position, haptic) {
      var progress = Math.min(1, Math.max(0, position));
      // Pointer events can arrive faster than the display refresh rate.
      pendingScroll = progress;
      if (haptic && !reducedMotion.matches && typeof navigator.vibrate === "function") {
        var step = Math.round(progress * 20);
        var now = performance.now();
        if (step !== hapticStep && now - lastHaptic > 80) {
          navigator.vibrate(6);
          lastHaptic = now;
        }
        hapticStep = step;
      }
      schedule();
    }
    function pointerPosition(event) {
      var rect = ruler.getBoundingClientRect();
      return (event.clientY - rect.top - 12) / Math.max(1, rect.height - 24);
    }
    ruler.addEventListener("pointerdown", function (event) {
      if (!event.isPrimary || event.button !== 0 || pointerId !== null) return;
      pointerId = event.pointerId;
      ruler.setPointerCapture(pointerId);
      ruler.classList.add("is-dragging");
      ruler.focus({ preventScroll: true });
      var progress = scrollRange() ? window.scrollY / scrollRange() : 0;
      var position = pointerPosition(event);
      // Grabbing the active part preserves its position; elsewhere seeks directly.
      dragOffset = Math.abs(position - progress) < 0.08 ? position - progress : 0;
      hapticStep = -1;
      scrollToPosition(position - dragOffset, true);
      event.preventDefault();
    });
    ruler.addEventListener("pointermove", function (event) {
      if (event.pointerId !== pointerId) return;
      scrollToPosition(pointerPosition(event) - dragOffset, true);
    });
    function stopDragging(event) {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      ruler.classList.remove("is-dragging");
      if (ruler.hasPointerCapture(event.pointerId)) ruler.releasePointerCapture(event.pointerId);
    }
    ruler.addEventListener("pointerup", stopDragging);
    ruler.addEventListener("pointercancel", stopDragging);
    ruler.addEventListener("lostpointercapture", stopDragging);
    ruler.addEventListener("keydown", function (event) {
      var max = scrollRange();
      var target = window.scrollY;
      switch (event.key) {
        case "ArrowDown": case "ArrowRight": target += 80; break;
        case "ArrowUp": case "ArrowLeft": target -= 80; break;
        case "PageDown": target += window.innerHeight * 0.9; break;
        case "PageUp": target -= window.innerHeight * 0.9; break;
        case "Home": target = 0; break;
        case "End": target = max; break;
        default: return;
      }
      event.preventDefault();
      scrollToPosition(max ? target / max : 0, true);
    });
    // Hide the native scrollbar only once its accessible replacement is mounted.
    root.classList.add("has-page-ruler");

    function update(now) {
      frame = 0;
      // Read layout before writing animation styles, and only when it changed.
      if (geometryDirty) {
        var documentY = window.scrollY;
        geometry.max = scrollRange();
        geometry.height = window.innerHeight;
        if (article) {
          var articleRect = article.getBoundingClientRect();
          geometry.articleTop = articleRect.top + documentY;
          geometry.articleBottom = articleRect.bottom + documentY;
          blocks.forEach(function (block) {
            var rect = block.element.getBoundingClientRect();
            block.bottom = rect.bottom + documentY;
            block.height = rect.height;
          });
        }
        geometryDirty = false;
      }
      if (pendingScroll !== null) {
        window.scrollTo({ top: pendingScroll * geometry.max, behavior: "instant" });
        pendingScroll = null;
      }
      var y = Math.min(geometry.max, Math.max(0, window.scrollY));
      var elapsed = Math.min(64, Math.max(1, now - lastTime));
      var delta = y - lastY;
      var moving = Math.abs(delta) > 0.01;
      if (moving) {
        lastMotionTime = now;
        motionSpeed = Math.min(1, Math.abs(delta) / elapsed / 2);
        targetDirection = Math.sign(delta);
      }
      // Bridge gaps between scroll events instead of pulsing at their frequency.
      var active = now - lastMotionTime < 100;
      var targetEnergy = active ? 0.38 + motionSpeed * 0.62 : 0;
      energy = reducedMotion.matches ? 0 : targetEnergy + (energy - targetEnergy) * Math.exp(-elapsed / (active ? 90 : 280));
      direction += (targetDirection - direction) * (1 - Math.exp(-elapsed / 120));
      var max = geometry.max;
      var progress = max ? y / max : 0;
      if (displayedProgress === null || reducedMotion.matches) displayedProgress = progress;
      else displayedProgress += (progress - displayedProgress) * (1 - Math.exp(-elapsed / 75));
      if (wake === null || reducedMotion.matches) wake = progress;
      else wake += (displayedProgress - wake) * (1 - Math.exp(-elapsed / 130));
      ruler.hidden = max <= 1;
      var percent = Math.round(progress * 100);
      ruler.setAttribute("aria-valuenow", String(percent));
      ruler.setAttribute("aria-valuetext", percent + "%");
      ticks.forEach(function (tick, index) {
        var position = index / (ticks.length - 1);
        var distance = position - wake;
        var spread = 0.075 + energy * 0.16;
        var wave = Math.exp(-0.5 * Math.pow(distance / spread, 2));
        var current = Math.exp(-0.5 * Math.pow((position - displayedProgress) / 0.045, 2));
        tick.style.opacity = String(0.2 + current * 0.48 + wave * energy * 0.25);
        // Keep the one-pixel lines stationary; subpixel vertical movement flickers.
        tick.style.transform = "scaleX(" + (0.55 + current * 0.35 + wave * energy * 0.35) + ")";
        tick.style.backgroundPosition = (wake * 100 + wave * energy * direction * 60) + "% 50%";
      });
      if (remainingLabel) {
        var readingLine = y + geometry.height * 0.35;
        var remaining = blocks.reduce(function (sum, block) {
          var unread = block.height > 0 ? Math.min(1, Math.max(0, (block.bottom - readingLine) / block.height)) : 0;
          return sum + block.minutes * unread;
        }, 0);
        var finished = geometry.articleBottom <= y + geometry.height || (max > 0 && y >= max - 2);
        var label = finished ? "読了" : remaining < 1 ? "あと1分未満" : "あと約" + Math.ceil(remaining) + "分";
        if (remainingLabel.textContent !== label) remainingLabel.textContent = label;
        remainingLabel.hidden = geometry.articleTop > readingLine || geometry.articleBottom < y;
      }
      lastY = y;
      lastTime = now;
      if (energy > 0.002 || Math.abs(wake - progress) > 0.0001 || Math.abs(displayedProgress - progress) > 0.0001) schedule();
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    window.addEventListener("scroll", schedule, { passive: true });
    function invalidateGeometry() {
      geometryDirty = true;
      schedule();
    }
    window.addEventListener("resize", invalidateGeometry, { passive: true });
    window.addEventListener("pageshow", invalidateGeometry);
    document.addEventListener("load", invalidateGeometry, true);
    reducedMotion.addEventListener("change", schedule);
    if (typeof ResizeObserver === "function") new ResizeObserver(invalidateGeometry).observe(document.body);
    if (document.fonts) document.fonts.ready.then(invalidateGeometry);
    schedule();
  }

  function followSystemTheme() {
    var preference = window.matchMedia("(prefers-color-scheme: light)");
    function sync() {
      if (!storedTheme()) applyTheme(systemTheme());
    }
    if (typeof preference.addEventListener === "function") preference.addEventListener("change", sync);
    window.addEventListener("storage", function (event) {
      if (event.key === STORAGE_KEY || event.key === null) applyTheme(storedTheme() || systemTheme());
    });
  }

  function mountUi() {
    mountFavicon();
    mountToggle();
    followSystemTheme();
    mountHeaderReveal();
    mountReadingProgress();
    mountAnalytics();
  }

  ensureAnalytics();
  applyTheme(storedTheme() || systemTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountUi, { once: true });
  } else {
    mountUi();
  }
}());

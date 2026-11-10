(function () {
  "use strict";

  var STORAGE_KEY = "4k29-note-editor-v1";
  var BASE_URL = "https://4k29.github.io/tecirc";
  var GITHUB_UPLOAD_URL = "https://github.com/4k29/tecirc/upload/main/_notes";
  var saveTimer = null;
  var githubSaveTimer = null;
  var slugTouched = false;
  var githubApi = null;
  var localUpdatedAt = "";

  var form = document.getElementById("note-form");
  var fields = {
    title: document.getElementById("title"),
    slug: document.getElementById("slug"),
    date: document.getElementById("date"),
    description: document.getElementById("description"),
    image: document.getElementById("image"),
    imageAlt: document.getElementById("image-alt"),
    body: document.getElementById("body")
  };

  var status = document.getElementById("save-status");
  var descriptionCount = document.getElementById("description-count");
  var bodyCount = document.getElementById("body-count");
  var urlPreview = document.getElementById("url-preview");
  var previewTitle = document.getElementById("preview-title");
  var previewDate = document.getElementById("preview-date");
  var previewDateInline = document.getElementById("preview-date-inline");
  var previewBody = document.getElementById("preview-body");
  var importFile = document.getElementById("import-file");
  var videoDialog = document.getElementById("video-dialog");
  var videoPath = document.getElementById("dialog-video-path");
  var youtubeDialog = document.getElementById("youtube-dialog");
  var youtubeUrl = document.getElementById("dialog-youtube-url");
  window.noteVideoPreviews = new Map();
  var lastPreviewBody = null;
  var videoSelection = null;
  var youtubeSelection = null;
  var imageSelection = null;
  var imageDialog = document.getElementById("image-dialog");
  var dialogImagePath = document.getElementById("dialog-image-path");
  var dialogImageAlt = document.getElementById("dialog-image-alt");
  var dialogImageCaption = document.getElementById("dialog-image-caption");

  function jstDate() {
    var now = new Date();
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    var map = {};
    parts.forEach(function (part) {
      map[part.type] = part.value;
    });
    return map.year + "-" + map.month + "-" + map.day;
  }

  function displayDate(value) {
    return value ? value.replace(/-/g, ".") : "YYYY.MM.DD";
  }

  function slugify(value) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/\((\d+)\)/g, "-$1-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .replace(/-{2,}/g, "-")
      .toLowerCase();
  }

  function normalizeOgImage(value) {
    var path = (value || "").trim();
    path = path.replace(BASE_URL, "");
    path = path.replace(/^\.\.\/images\//, "/images/");
    path = path.replace(/^images\//, "/images/");
    if (path && path.charAt(0) !== "/" && !/^https?:\/\//i.test(path)) {
      path = "/" + path;
    }
    return path;
  }

  function normalizeBodyImage(value) {
    var path = (value || "").trim();
    path = path.replace(BASE_URL, "");
    path = path.replace(/^\/(?:tecirc|4k29)\/images\//, "../images/");
    path = path.replace(/^\/images\//, "../images/");
    path = path.replace(/^images\//, "../images/");
    return path;
  }

  function getData() {
    return {
      draftId: window.NoteDraftIdentity.get(),
      title: fields.title.value.trim(),
      slug: fields.slug.value.trim(),
      date: fields.date.value,
      description: fields.description.value.trim(),
      image: normalizeOgImage(fields.image.value),
      imageAlt: fields.imageAlt.value.trim(),
      body: fields.body.value.trim()
    };
  }

  function setData(data, skipSave) {
    window.NoteDraftIdentity.open(data, "import");
    Object.keys(fields).forEach(function (key) {
      if (typeof data[key] === "string") {
        fields[key].value = data[key];
      }
    });
    slugTouched = Boolean(fields.slug.value);
    if (skipSave) {
      updatePreview();
    } else {
      updateAll();
    }
  }

  function yamlValue(value) {
    return JSON.stringify(value == null ? "" : value);
  }

  function buildMarkdown() {
    var data = getData();
    var modified = jstDate() + " 00:00:00 +0900";
    var published = data.date + " 00:00:00 +0900";
    var lines = [
      "---",
      "title: " + yamlValue(data.title),
      "description: " + yamlValue(data.description),
      "date: " + yamlValue(published),
      "last_modified_at: " + yamlValue(modified),
      "permalink: " + yamlValue("/notes/" + data.slug + "/"),
      "image: " + yamlValue(data.image),
      "image_alt: " + yamlValue(data.imageAlt),
      "---",
      "",
      data.body,
      ""
    ];
    return lines.join("\n");
  }

  function validate() {
    var data = getData();
    var errors = [];

    if (!data.title) errors.push("タイトル");
    if (!data.slug || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(data.slug)) errors.push("スラッグ");
    if (!data.date) errors.push("公開日");
    if (!data.description) errors.push("概要");
    if (!data.image) errors.push("OGP画像");
    if (!data.imageAlt) errors.push("画像の代替テキスト");
    if (!data.body) errors.push("本文");

    if (errors.length) {
      window.alert("未入力または形式が違う項目があります: " + errors.join("、"));
      var firstInvalid = form.querySelector(":invalid");
      if (firstInvalid) firstInvalid.focus();
      return false;
    }
    return true;
  }

  function downloadMarkdown() {
    if (!validate()) return false;
    var data = getData();
    var blob = new Blob([buildMarkdown()], { type: "text/markdown;charset=utf-8" });
    var href = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = data.slug + ".md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(href);
    }, 1000);
    status.textContent = data.slug + ".md を保存しました";
    return true;
  }

  function copyMarkdown() {
    if (!validate()) return;
    navigator.clipboard.writeText(buildMarkdown()).then(function () {
      status.textContent = "Markdownをコピーしました";
    }).catch(function () {
      window.alert("コピーできませんでした。Markdownを保存してください。");
    });
  }

  function hasDraftContent(data) {
    return Boolean(data.title || data.description || data.body);
  }

  function saveDraft() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    var data = getData();
    var updatedAt = new Date().toISOString();
    localUpdatedAt = updatedAt;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        data: data,
        updatedAt: updatedAt
      }));
      status.textContent = githubApi ? "GitHubへの保存待ち…" : "端末内に保存済み";
    } catch (error) {
      status.textContent = githubApi ? "GitHubに保存中・端末内保存不可" : "自動保存できませんでした";
    }

    if (githubApi && hasDraftContent(data)) scheduleGitHubSave();
  }

  function scheduleGitHubSave() {
    window.clearTimeout(githubSaveTimer);
    githubSaveTimer = window.setTimeout(syncGitHubDraft, 3000);
  }

  async function syncGitHubDraft() {
    window.clearTimeout(githubSaveTimer);
    githubSaveTimer = null;
    if (!githubApi) return;
    var data = getData();
    if (!hasDraftContent(data)) return;
    var updatedAt = localUpdatedAt || new Date().toISOString();
    localUpdatedAt = updatedAt;
    status.textContent = "GitHubに保存中…";
    try {
      await githubApi.saveDraft("notes", Object.assign({}, data, {
        updatedAt: updatedAt
      }));
      if (localUpdatedAt === updatedAt) status.textContent = "GitHubに保存済み";
    } catch (error) {
      if (localUpdatedAt === updatedAt) status.textContent = "端末内に保存済み・GitHub未同期";
    }
  }

  function scheduleSave() {
    status.textContent = "保存中…";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 450);
  }

  function loadDraft() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      var parsed = JSON.parse(stored);
      var record = parsed && parsed.data ? parsed : {
        data: parsed,
        updatedAt: ""
      };
      localUpdatedAt = record.updatedAt || "";
      setData(record.data || {}, true);
      status.textContent = "下書きを復元しました";
      return true;
    } catch (error) {
      return false;
    }
  }

  async function connectGitHub(api) {
    githubApi = api;
    status.textContent = "GitHubの下書きを確認中…";

    try {
      var githubRecord = await api.loadDraft("notes");
      var githubData = githubRecord && githubRecord.data;
      var githubUpdatedAt = githubData && githubData.updatedAt ? githubData.updatedAt : "";
      var localData = getData();

      if (githubData && (!hasDraftContent(localData) || githubUpdatedAt > localUpdatedAt)) {
        localUpdatedAt = githubUpdatedAt;
        setData(githubData, true);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            data: getData(),
            updatedAt: localUpdatedAt
          }));
        } catch (error) {
          // GitHub remains the source of truth if this browser blocks local storage.
        }
        status.textContent = "GitHubの下書きを復元しました";
      } else if (hasDraftContent(localData)) {
        var updatedAt = localUpdatedAt || new Date().toISOString();
        localUpdatedAt = updatedAt;
        await api.saveDraft("notes", Object.assign({}, localData, {
          updatedAt: updatedAt
        }));
        status.textContent = "GitHubに保存済み";
      } else {
        status.textContent = "GitHubに接続済み";
      }
    } catch (error) {
      status.textContent = "端末内の下書きを使用中・GitHub未同期";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isSafeUrl(value) {
    return /^(https?:\/\/|\.\.\/|\.\/|\/|#)/i.test(value);
  }

  function youtubeIdFromUrl(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";

    try {
      var url = new URL(raw);
      var host = url.hostname.replace(/^www\./, "").toLowerCase();
      var id = "";

      if (host === "youtu.be") {
        id = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (host === "youtube.com" || host === "m.youtube.com") {
        if (url.pathname === "/watch") {
          id = url.searchParams.get("v") || "";
        } else {
          var parts = url.pathname.split("/").filter(Boolean);
          if (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") {
            id = parts[1] || "";
          }
        }
      }

      return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : "";
    } catch (error) {
      return "";
    }
  }

  function youtubeEmbedMarkup(id) {
    return '<figure class="youtube-embed"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/' +
      id + "?autoplay=0" +
      '" title="YouTube video player" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay \'none\'; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></figure>';
  }

  function previewImageUrl(value) {
    if (/^\.\.\/images\//.test(value)) {
      return "../../images/" + value.replace(/^\.\.\/images\//, "");
    }
    if (/^\/images\//.test(value)) {
      return "../../images/" + value.replace(/^\/images\//, "");
    }
    return value;
  }

  function inlineMarkdown(value) {
    var output = escapeHtml(value);

    output = output.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, function (_, alt, url) {
      var safe = isSafeUrl(url) ? previewImageUrl(url) : "#";
      return '<img src="' + safe + '" alt="' + alt + '" loading="lazy">';
    });

    output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
      var safe = isSafeUrl(url) ? url : "#";
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });

    output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    output = output.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1<em>$2</em>");
    return output;
  }

  function renderMarkdown(markdown) {
    var lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    var html = [];
    var paragraph = [];
    var listType = "";
    var inCode = false;
    var code = [];
    var fence = String.fromCharCode(96).repeat(3);

    function closeList() {
      if (listType) {
        html.push("</" + listType + ">");
        listType = "";
      }
    }

    function flushParagraph() {
      if (!paragraph.length) return;
      var parts = paragraph.map(function (line) {
        var hardBreak = /\s{2}$/.test(line);
        var clean = line.replace(/\s+$/, "");
        return inlineMarkdown(clean) + (hardBreak ? "<br>" : " ");
      });
      html.push("<p>" + parts.join("").trim() + "</p>");
      paragraph = [];
    }

    lines.forEach(function (line) {
      if (line.trim().indexOf(fence) === 0) {
        flushParagraph();
        closeList();
        if (inCode) {
          html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
          code = [];
          inCode = false;
        } else {
          inCode = true;
        }
        return;
      }

      if (inCode) {
        code.push(line);
        return;
      }



      // Render only the YouTube embed markup produced by this editor.
      if (/^\s*<figure\b/i.test(line) && /class=["']youtube-embed["']/i.test(line)) {
        var youtubeDocument = new DOMParser().parseFromString(line, "text/html");
        var figure = youtubeDocument.body.firstElementChild;
        var iframe = figure && figure.querySelector("iframe");
        var youtubeSource = iframe && iframe.getAttribute("src");
        var youtubeMatch = youtubeSource && youtubeSource.match(/^https:\/\/www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{6,20})(?:\?autoplay=[01])?$/);
        if (figure && figure.tagName === "FIGURE" && youtubeMatch) {
          flushParagraph();
          closeList();
          html.push(youtubeEmbedMarkup(youtubeMatch[1]));
          return;
        }
      }

      // Render only our video markup, never arbitrary user-provided HTML.
      if (/^\s*<video\b/i.test(line)) {
        var videoDocument = new DOMParser().parseFromString(line, "text/html");
        var video = videoDocument.body.firstElementChild;
        var source = video && video.getAttribute("src");
        if (video && video.tagName === "VIDEO" && source && isSafeUrl(source)) {
          flushParagraph();
          closeList();
          html.push('<video controls playsinline preload="metadata" src="' + escapeHtml(window.noteVideoPreviews.get(source) || previewImageUrl(source)) + '"></video>');
          return;
        }
      }

      if (!line.trim()) {
        flushParagraph();
        closeList();
        return;
      }

      var heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        var level = heading[1].length;
        html.push("<h" + level + ">" + inlineMarkdown(heading[2]) + "</h" + level + ">");
        return;
      }

      var unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        if (listType !== "ul") {
          closeList();
          listType = "ul";
          html.push("<ul>");
        }
        html.push("<li>" + inlineMarkdown(unordered[1]) + "</li>");
        return;
      }

      var ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        if (listType !== "ol") {
          closeList();
          listType = "ol";
          html.push("<ol>");
        }
        html.push("<li>" + inlineMarkdown(ordered[1]) + "</li>");
        return;
      }

      var quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        closeList();
        html.push("<blockquote><p>" + inlineMarkdown(quote[1]) + "</p></blockquote>");
        return;
      }

      closeList();
      paragraph.push(line);
    });

    flushParagraph();
    closeList();

    if (inCode) {
      html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
    }

    return html.join("");
  }

  function updatePreview() {
    var data = getData();
    var date = displayDate(data.date);
    previewTitle.textContent = data.title || "記事のタイトル";
    previewDate.textContent = date;
    previewDateInline.textContent = date;
    if (lastPreviewBody !== data.body) {
    lastPreviewBody = data.body;
    previewBody.innerHTML = data.body ? renderMarkdown(data.body) : '<p class="preview-placeholder">ここに記事のプレビューが表示されます。</p>';
    }
    descriptionCount.textContent = fields.description.value.length;
    bodyCount.textContent = fields.body.value.length;
    urlPreview.textContent = BASE_URL + "/notes/" + (data.slug || "…") + "/";
  }

  function updateAll() {
    updatePreview();
    scheduleSave();
  }

  function insertText(before, after, placeholder) {
    var textarea = fields.body;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.slice(start, end) || placeholder;
    var replacement = before + selected + after;
    textarea.setRangeText(replacement, start, end, "end");
    textarea.focus();
    updateAll();
  }

  function prefixSelectedLines(prefix) {
    var textarea = fields.body;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.slice(start, end) || "テキスト";
    var replacement = selected.split("\n").map(function (line) {
      return prefix + line;
    }).join("\n");
    textarea.setRangeText(replacement, start, end, "end");
    textarea.focus();
    updateAll();
  }

  function toolbarAction(action) {
    if (action === "h2") prefixSelectedLines("## ");
    if (action === "h3") prefixSelectedLines("### ");
    if (action === "bold") insertText("**", "**", "強調する言葉");
    if (action === "list") prefixSelectedLines("- ");
    if (action === "quote") prefixSelectedLines("> ");
    if (action === "link") {
      var url = window.prompt("リンク先のURL", "https://");
      if (url) insertText("[", "](" + url + ")", "リンクテキスト");
    }
    if (action === "video") {
      videoSelection = [fields.body.selectionStart, fields.body.selectionEnd];
      videoPath.value = "";
      videoDialog.showModal();
      videoPath.focus();
    }
    if (action === "youtube") {
      youtubeSelection = [fields.body.selectionStart, fields.body.selectionEnd];
      youtubeUrl.value = "";
      youtubeDialog.showModal();
      youtubeUrl.focus();
    }
    if (action === "image") {
      imageSelection = [fields.body.selectionStart, fields.body.selectionEnd];
      dialogImagePath.value = "";
      dialogImageAlt.value = "";
      dialogImageCaption.value = "";
      imageDialog.showModal();
      window.setTimeout(function () {
        dialogImagePath.focus();
      }, 0);
    }
  }

  function insertImage() {
    var path = normalizeBodyImage(dialogImagePath.value);
    var alt = dialogImageAlt.value.trim();
    var caption = dialogImageCaption.value.trim();

    if (!path || !alt) {
      window.alert("画像のパスと代替テキストを入力してください。");
      return false;
    }

    var markdown = "![" + alt.replace(/\]/g, "") + "](" + path.replace(/\s/g, "%20") + ")";
    if (caption) markdown += "\n*" + caption.replace(/\*/g, "") + "*";
    var selection = imageSelection || [fields.body.selectionStart, fields.body.selectionEnd];
    fields.body.setRangeText("\n\n" + markdown + "\n\n", selection[0], selection[1], "end");
    imageDialog.close();
    fields.body.focus();
    updateAll();
    return true;
  }

  function parseFrontMatter(text) {
    var normalized = String(text).replace(/\r\n?/g, "\n");
    if (normalized.indexOf("---\n") !== 0) throw new Error("front matter not found");
    var end = normalized.indexOf("\n---\n", 4);
    if (end < 0) throw new Error("front matter not closed");

    var raw = normalized.slice(4, end);
    var body = normalized.slice(end + 5).trim();
    var data = { body: body };

    raw.split("\n").forEach(function (line) {
      var separator = line.indexOf(":");
      if (separator < 0) return;
      var key = line.slice(0, separator).trim();
      var value = line.slice(separator + 1).trim();
      try {
        value = JSON.parse(value);
      } catch (error) {
        value = value.replace(/^["']|["']$/g, "");
      }

      if (key === "title") data.title = String(value);
      if (key === "description") data.description = String(value);
      if (key === "date") data.date = String(value).slice(0, 10);
      if (key === "image") data.image = String(value);
      if (key === "image_alt") data.imageAlt = String(value);
      if (key === "permalink") {
        var match = String(value).match(/\/notes\/([^/]+?)(?:\.html|\/)?$/);
        if (match) data.slug = match[1];
      }
    });

    return data;
  }

  form.addEventListener("input", function (event) {
    if (event.target === fields.title && !slugTouched) {
      var automaticSlug = slugify(fields.title.value);
      if (automaticSlug) fields.slug.value = automaticSlug;
    }
    if (event.target === fields.slug) slugTouched = true;
    updateAll();
  });

  document.querySelector(".format-toolbar").addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (button) toolbarAction(button.dataset.action);
  });

  document.getElementById("insert-image-button").addEventListener("click", function (event) {
    event.preventDefault();
    insertImage();
  });



  document.getElementById("insert-youtube-button").addEventListener("click", function (event) {
    event.preventDefault();
    var id = youtubeIdFromUrl(youtubeUrl.value);
    if (!id) {
      window.alert("YouTubeの動画URLを入力してください。");
      return;
    }

    var selection = youtubeSelection || [fields.body.selectionStart, fields.body.selectionEnd];
    var markup = "\n\n" + youtubeEmbedMarkup(id) + "\n\n";
    fields.body.setRangeText(markup, selection[0], selection[1], "end");
    youtubeDialog.close();
    fields.body.focus();
    updateAll();
  });

  document.getElementById("insert-video-button").addEventListener("click", function (event) {
    event.preventDefault();
    var path = normalizeBodyImage(videoPath.value);
    if (!isSafeUrl(path)) {
      window.alert("動画のURL（https://…）またはパスを入力してください。");
      return;
    }
    var selection = videoSelection || [fields.body.selectionStart, fields.body.selectionEnd];
    var markup = '\n\n<video controls playsinline preload="metadata" src="' + escapeHtml(path.replace(/\s/g, "%20")) + '"></video>\n\n';
    fields.body.setRangeText(markup, selection[0], selection[1], "end");
    videoDialog.close();
    fields.body.focus();
    updateAll();
  });

  document.getElementById("dialog-video-upload").addEventListener("click", function () {
    document.getElementById("video-upload-input").click();
  });

  document.getElementById("copy-button").addEventListener("click", copyMarkdown);
  document.getElementById("download-button").addEventListener("click", downloadMarkdown);

  document.getElementById("github-button").addEventListener("click", function () {
    if (!validate()) return;
    var uploadWindow = window.open(GITHUB_UPLOAD_URL, "_blank", "noopener");
    downloadMarkdown();
    if (!uploadWindow) {
      window.location.href = GITHUB_UPLOAD_URL;
    }
  });

  window.addEventListener("notedraftdeleted", function () {
    window.clearTimeout(saveTimer);
    window.clearTimeout(githubSaveTimer);
    saveTimer = null;
    githubSaveTimer = null;
    window.NoteDraftIdentity.reset();
    window.NotePublishedEdit = null;
    form.reset();
    fields.slug.readOnly = false;
    fields.date.value = jstDate();
    slugTouched = false;
    localUpdatedAt = "";
    var publishButton = document.getElementById("publish-button");
    publishButton.textContent = "公開";
    delete publishButton.dataset.mode;
    updatePreview();
    status.textContent = "下書きを削除しました";
  });

  document.getElementById("new-button").addEventListener("click", function () {
    if (!window.confirm("端末内とGitHubの現在の下書きを消して、新規作成しますか？")) return;
    window.clearTimeout(githubSaveTimer);
    githubSaveTimer = null;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // Continue resetting the form when browser storage is unavailable.
    }
    localUpdatedAt = "";
    if (githubApi) {
      githubApi.deleteDraft("notes").catch(function () {
        status.textContent = "GitHubの下書きを削除できませんでした";
      });
    }
    window.NoteDraftIdentity.reset();
    form.reset();
    fields.date.value = jstDate();
    slugTouched = false;
    updateAll();
    fields.title.focus();
    status.textContent = "新しい下書き";
  });

  document.getElementById("import-button").addEventListener("click", function () {
    importFile.click();
  });

  importFile.addEventListener("change", function () {
    var file = importFile.files && importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        setData(parseFrontMatter(reader.result));
        status.textContent = file.name + " を読み込みました";
      } catch (error) {
        window.alert("このMarkdownファイルを読み込めませんでした。");
      }
      importFile.value = "";
    };
    reader.readAsText(file, "UTF-8");
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "hidden") return;
    if (saveTimer) saveDraft();
    if (githubSaveTimer) syncGitHubDraft();
  });

  if (!loadDraft()) {
    fields.date.value = jstDate();
    updatePreview();
  }

  if (window.EditorGitHub) {
    window.EditorGitHub.onReady(connectGitHub);
  }
})();




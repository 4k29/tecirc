(function () {
  "use strict";

  var STORAGE_KEY = "4k29-note-editor-v1";
  var BASE_URL = "https://4k29.github.io/tecirc";
  var form = document.getElementById("note-form");
  var status = document.getElementById("save-status");
  var saveButton = document.getElementById("save-draft-button");
  var publishButton = document.getElementById("publish-button");

  if (!form || !saveButton || !publishButton) return;

  var fields = {
    title: document.getElementById("title"),
    slug: document.getElementById("slug"),
    date: document.getElementById("date"),
    description: document.getElementById("description"),
    image: document.getElementById("image"),
    imageAlt: document.getElementById("image-alt"),
    tags: document.getElementById("tags"),
    body: document.getElementById("body")
  };

  function jstDate() {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) {
      values[part.type] = part.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function normalizeOgImage(value) {
    var path = String(value || "").trim();
    path = path.replace(BASE_URL, "");
    path = path.replace(/^\.\.\/images\//, "/images/");
    path = path.replace(/^images\//, "/images/");
    if (path && path.charAt(0) !== "/" && !/^https?:\/\//i.test(path)) {
      path = "/" + path;
    }
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
      tags: fields.tags.value.split(/[,、，]/).map(function (tag) {
        return tag.trim();
      }).filter(Boolean),
      body: fields.body.value.trim()
    };
  }

  function validate(data) {
    var errors = [];
    if (!data.title) errors.push("タイトル");
    if (!data.slug || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(data.slug)) errors.push("スラッグ");
    if (!data.date) errors.push("公開日");
    if (!data.description) errors.push("概要");
    if (!data.image) errors.push("OGP画像");
    if (!data.imageAlt) errors.push("画像の代替テキスト");
    if (!data.body) errors.push("本文");

    if (!errors.length) return true;
    window.alert("未入力または形式が違う項目があります: " + errors.join("、"));
    var firstInvalid = form.querySelector(":invalid");
    if (firstInvalid) firstInvalid.focus();
    return false;
  }

  function yamlValue(value) {
    return JSON.stringify(value == null ? "" : value);
  }

  function buildMarkdown(data) {
    var modified = jstDate() + " 00:00:00 +0900";
    var published = data.date + " 00:00:00 +0900";
    return [
      "---",
      "title: " + yamlValue(data.title),
      "description: " + yamlValue(data.description),
      "date: " + yamlValue(published),
      "last_modified_at: " + yamlValue(modified),
      "permalink: " + yamlValue("/notes/" + data.slug + "/"),
      "image: " + yamlValue(data.image),
      "image_alt: " + yamlValue(data.imageAlt),
      "tags: " + JSON.stringify(data.tags),
      "---",
      "",
      data.body,
      ""
    ].join("\n");
  }

  function setBusy(busy) {
    saveButton.disabled = busy;
    publishButton.disabled = busy;
  }

  function showPreflightFailure(check) {
    var problems = check.errors.concat(check.warnings || []);
    status.textContent = "公開前チェックで問題が見つかりました: " + problems.join(" / ");
    window.alert("公開前チェックで問題が見つかりました\n\n" + problems.map(function (problem) {
      return "・" + problem;
    }).join("\n"));
  }

  async function overwriteDraft() {
    var api = window.EditorGitHub;
    if (!api || !api.isReady()) {
      window.alert("GitHubへの接続が完了していません。");
      return;
    }

    var data = getData();
    var updatedAt = new Date().toISOString();
    setBusy(true);
    status.textContent = "下書きを保存中…";

    try {
      await api.saveDraft("notes", Object.assign({}, data, {
        updatedAt: updatedAt
      }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          data: data,
          updatedAt: updatedAt
        }));
      } catch (error) {
        // GitHubへの保存が成功していれば続行する。
      }
      status.textContent = "下書きを上書き保存しました";
    } catch (error) {
      status.textContent = "下書きを保存できませんでした";
      window.alert("下書きをGitHubへ保存できませんでした。通信状況を確認してください。");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    var data = getData();
    if (!validate(data)) return;
    if (!window.EditorPublicGitHub) {
      window.alert("公開機能を読み込めませんでした。ページを再読み込みしてください。");
      return;
    }

    var editing = window.NotePublishedEdit || null;
    if (editing && data.slug !== editing.slug) {
      window.alert("公開済み記事のURLはEditorから変更できません。新しいURLにする場合は新規記事として作成してください。");
      return;
    }

    var actionLabel = editing ? "更新" : "公開";
    if (!window.confirm("この記事を" + actionLabel + "しますか？")) return;

    setBusy(true);
    status.textContent = "公開前チェック中…";

    try {
      var check = await window.EditorPreflight.note({
        data: data,
        permalink: "/notes/" + data.slug + "/",
        editing: editing,
        repositoryPaths: window.EditorPublicGitHub.repositoryPaths
      });
      if (check.status === "FAIL") {
        showPreflightFailure(check);
        return;
      }
      status.textContent = "✓ 公開前チェック完了";

      if (window.EditorGitHub && window.EditorGitHub.isReady()) {
        var updatedAt = new Date().toISOString();
        status.textContent = actionLabel + "前に下書きを保存中…";
        await window.EditorGitHub.saveDraft("notes", Object.assign({}, data, {
          updatedAt: updatedAt
        }));
      }

      status.textContent = "GitHubへ" + actionLabel + "中…";
      var targetPath = editing && editing.path
        ? editing.path
        : "_notes/" + data.slug + ".md";

      var publishedCommit = await window.EditorPublicGitHub.commit([
        {
          path: targetPath,
          expectedSha: editing ? editing.sha : null,
          content: buildMarkdown(data)
        }
      ], (editing ? "Update note: " : "Publish note: ") + data.title);

      window.NotePublishedEdit = {
        path: targetPath, slug: data.slug, title: data.title,
        sha: publishedCommit.contentShas[targetPath]
      };
      fields.slug.readOnly = true;
      publishButton.textContent = "更新";
      publishButton.dataset.mode = "update";
      status.textContent = actionLabel + "内容を保存しました。サイトへの反映待ちです";
      window.alert(actionLabel + "内容を保存しました。サイトの再生成後、ホーム・記事一覧・記事ページに反映されます。");
    } catch (error) {
      status.textContent = actionLabel + "できませんでした";
      window.alert(window.EditorPublicGitHub.permissionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function loadPublishedEditor() {
    if (!document.querySelector('link[href^="published-articles.css"]')) {
      var stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "published-articles.css?v=20260910-1";
      document.head.appendChild(stylesheet);
    }

    if (!document.querySelector('script[src^="published-articles.js"]')) {
      var script = document.createElement("script");
      script.src = "published-articles.js?v=20260922-1";
      document.body.appendChild(script);
    }
  }

  saveButton.addEventListener("click", overwriteDraft);
  publishButton.addEventListener("click", publish);
  loadPublishedEditor();
}());


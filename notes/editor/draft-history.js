(function () {
  "use strict";

  var EDITOR = "notes";
  var DRAFT_PATH = EDITOR + "/current.json";
  var API_ROOT = "https://api.github.com";
  var API_VERSION = "2022-11-28";
  var MAX_RESULTS = 16;
  var COMMITS_PER_PAGE = 30;
  var MAX_PAGES = 3;

  var config = window.EDITOR_GITHUB_CONFIG || {};
  var button = document.getElementById("drafts-button");
  var dialog = document.getElementById("draft-history-dialog");
  var closeButton = document.getElementById("draft-history-close");
  var refreshButton = document.getElementById("draft-history-refresh");
  var status = document.getElementById("draft-history-status");
  var list = document.getElementById("draft-history-list");
  var editorStatus = document.getElementById("save-status");
  var historyLoaded = false;
  var loading = false;

  if (!button || !dialog || !list) return;

  function getStoredToken() {
    return window.EditorGitHub && window.EditorGitHub.getToken
      ? window.EditorGitHub.getToken() : "";
  }

  function repoPath(suffix) {
    return "/repos/" + encodeURIComponent(config.owner) + "/" + encodeURIComponent(config.repository) + (suffix || "");
  }

  async function apiRequest(path, options) {
    options = options || {};
    var token = getStoredToken();
    if (!token) throw new Error("GitHub token is unavailable");

    var response = await window.fetch(API_ROOT + path, {
      method: options.method || "GET",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": API_VERSION
      },
      cache: "no-store",
      credentials: "omit"
    });

    if (options.allow404 && response.status === 404) return null;
    if (!response.ok) {
      var error = new Error("GitHub API request failed");
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function decodeBase64Text(value) {
    var binary = window.atob(String(value || "").replace(/\s/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  function hasDraftContent(data) {
    return Boolean(data && (data.title || data.description || data.body));
  }

  function draftIdentity(data, fallback) {
    return window.NoteDraftIdentity.identity(data, fallback);
  }

  function commitDate(commit) {
    var details = commit && commit.commit;
    return (details && details.committer && details.committer.date) ||
      (details && details.author && details.author.date) || "";
  }

  async function readDraftAtRef(ref) {
    var file = await apiRequest(
      repoPath("/contents/" + DRAFT_PATH + "?ref=" + encodeURIComponent(ref)),
      { allow404: true }
    );
    if (!file || !file.content) return null;
    try {
      return JSON.parse(decodeBase64Text(file.content));
    } catch (error) {
      return null;
    }
  }

  async function snapshotFromCommit(commit) {
    var data = await readDraftAtRef(commit.sha);
    var sourceRef = commit.sha;

    if (!data && commit.parents && commit.parents[0]) {
      sourceRef = commit.parents[0].sha;
      data = await readDraftAtRef(sourceRef);
    }
    if (!hasDraftContent(data)) return null;

    return {
      data: data,
      commitSha: commit.sha,
      sourceRef: sourceRef,
      committedAt: commitDate(commit),
      updatedAt: data.updatedAt || commitDate(commit)
    };
  }

  async function fetchHistory() {
    var results = [];
    var seen = new Set();

    for (var page = 1; page <= MAX_PAGES && results.length < MAX_RESULTS; page += 1) {
      var commits = await apiRequest(
        repoPath("/commits?path=" + encodeURIComponent(DRAFT_PATH) +
          "&sha=" + encodeURIComponent(config.branch || "main") +
          "&per_page=" + COMMITS_PER_PAGE +
          "&page=" + page)
      );
      if (!Array.isArray(commits) || !commits.length) break;

      for (var start = 0; start < commits.length && results.length < MAX_RESULTS; start += 6) {
        var batch = commits.slice(start, start + 6);
        var snapshots = await Promise.all(batch.map(snapshotFromCommit));
        snapshots.forEach(function (snapshot) {
          if (!snapshot || results.length >= MAX_RESULTS) return;
          var identity = draftIdentity(snapshot.data, snapshot.sourceRef);
          if (seen.has(identity)) return;
          seen.add(identity);
          results.push(snapshot);
        });
      }

      if (commits.length < COMMITS_PER_PAGE) break;
    }
    return results;
  }

  function collectCurrentData() {
    return {
      draftId: window.NoteDraftIdentity.get(),
      title: document.getElementById("title").value.trim(),
      slug: document.getElementById("slug").value.trim(),
      date: document.getElementById("date").value,
      description: document.getElementById("description").value.trim(),
      image: document.getElementById("image").value.trim(),
      imageAlt: document.getElementById("image-alt").value.trim(),
      body: document.getElementById("body").value.trim()
    };
  }

  function comparableDraft(data) {
    return {
      title: String(data.title || ""),
      slug: String(data.slug || ""),
      date: String(data.date || ""),
      description: String(data.description || ""),
      image: String(data.image || ""),
      imageAlt: String(data.imageAlt || ""),
      body: String(data.body || "")
    };
  }

  function sameDraft(left, right) {
    if (!left || !right) return false;
    return JSON.stringify(comparableDraft(left)) === JSON.stringify(comparableDraft(right));
  }

  async function preserveCurrentDraft(nextData) {
    var current = collectCurrentData();
    if (!hasDraftContent(current) || sameDraft(current, nextData)) return;
    if (!window.EditorGitHub || !window.EditorGitHub.isReady()) return;

    editorStatus.textContent = "現在の下書きをGitHubに保存中…";
    await window.EditorGitHub.saveDraft(EDITOR, Object.assign({}, current, {
      updatedAt: new Date().toISOString()
    }));
  }

  function applyDraft(data, sourceRef) {
    window.NoteDraftIdentity.open(data, sourceRef);
    window.NotePublishedEdit = null;
    document.getElementById("slug").readOnly = false;
    var publishButton = document.getElementById("publish-button");
    publishButton.textContent = "公開";
    delete publishButton.dataset.mode;
    var values = {
      title: data.title || "",
      slug: data.slug || "",
      date: data.date || "",
      description: data.description || "",
      image: data.image || "",
      "image-alt": data.imageAlt || "",
      body: data.body || ""
    };

    Object.keys(values).forEach(function (id) {
      document.getElementById(id).value = values[id];
    });

    document.getElementById("slug").dispatchEvent(new Event("input", { bubbles: true }));
    editorStatus.textContent = "「" + (data.title || "無題の下書き") + "」を開きました";
    document.getElementById("title").focus();
  }

  function formatDateTime(value) {
    if (!value) return "保存日時不明";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "保存日時不明";
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function summaryText(data) {
    var source = String(data.description || data.body || "").replace(/\s+/g, " ").trim();
    if (!source) return "本文はまだありません。";
    return source.length > 110 ? source.slice(0, 110) + "…" : source;
  }

  function currentDraftIdentity() {
    var data = collectCurrentData();
    return draftIdentity(data, "current");
  }

  function renderHistory(records) {
    list.innerHTML = "";
    var currentIdentity = currentDraftIdentity();

    if (!records.length) {
      var empty = document.createElement("p");
      empty.className = "draft-history-empty";
      empty.textContent = "復元できる過去の下書きはまだありません。";
      list.appendChild(empty);
      return;
    }

    records.forEach(function (record) {
      var data = record.data;
      var item = document.createElement("button");
      item.type = "button";
      item.className = "draft-history-item";
      item.dataset.draftIdentity = draftIdentity(data, record.sourceRef);

      var heading = document.createElement("span");
      heading.className = "draft-history-item-heading";

      var title = document.createElement("strong");
      title.textContent = data.title || "無題の下書き";
      heading.appendChild(title);

      if (draftIdentity(data, record.sourceRef) === currentIdentity) {
        var badge = document.createElement("span");
        badge.className = "draft-history-current";
        badge.textContent = "現在";
        heading.appendChild(badge);
      }

      var meta = document.createElement("span");
      meta.className = "draft-history-meta";
      var published = data.date ? data.date.replace(/-/g, ".") + " 公開予定 / " : "";
      meta.textContent = published + formatDateTime(record.updatedAt) + " 保存";

      var summary = document.createElement("span");
      summary.className = "draft-history-summary";
      summary.textContent = summaryText(data);

      item.append(heading, meta, summary);
      item.addEventListener("click", async function () {
        if (item.disabled) return;
        item.disabled = true;
        status.textContent = "現在の内容を保存して、下書きを開いています…";
        try {
          await preserveCurrentDraft(data);
          applyDraft(data, record.sourceRef);
          dialog.close();
        } catch (error) {
          item.disabled = false;
          status.textContent = "下書きを開けませんでした。通信状況を確認してください。";
        }
      });
      list.appendChild(item);
    });
  }

  function historyErrorMessage(error) {
    if (error && error.status === 403) {
      return "GitHub APIの利用上限に達したか、履歴の読み取り権限がありません。";
    }
    if (error && error.status === 404) {
      return "GitHubの下書き履歴を確認できませんでした。";
    }
    return "下書き履歴を読み込めませんでした。通信状況を確認してください。";
  }

  async function loadAndRender(force) {
    if (loading || (historyLoaded && !force)) return;
    loading = true;
    refreshButton.disabled = true;
    list.innerHTML = "";
    status.textContent = "GitHubから過去の下書きを確認中…";

    try {
      var records = await fetchHistory();
      renderHistory(records);
      historyLoaded = true;
      status.textContent = records.length + "件の下書きを表示しています。";
    } catch (error) {
      list.innerHTML = "";
      status.textContent = historyErrorMessage(error);
    } finally {
      loading = false;
      refreshButton.disabled = false;
    }
  }

  button.addEventListener("click", function () {
    dialog.showModal();
    loadAndRender(true);
  });

  closeButton.addEventListener("click", function () {
    dialog.close();
  });

  refreshButton.addEventListener("click", function () {
    historyLoaded = false;
    loadAndRender(true);
  });

  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    dialog.close();
  });

  button.disabled = true;
  if (window.EditorGitHub) {
    window.EditorGitHub.onReady(function () {
      button.disabled = false;
    });
  }
}());


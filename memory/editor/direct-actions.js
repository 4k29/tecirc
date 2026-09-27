(function () {
  "use strict";

  var form = document.getElementById("memory-form");
  var status = document.getElementById("save-status");
  var saveButton = document.getElementById("save-draft-button");
  var publishButton = document.getElementById("publish-button");

  if (!form || !saveButton || !publishButton) return;

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

  async function currentRecord() {
    if (!window.MemoryEditor) throw new Error("エディターを読み込めませんでした");
    return window.MemoryEditor.getDraftSnapshot();
  }

  function extension(photo) {
    return photo.type === "image/webp" ? "webp" : "jpg";
  }

  function draftPath(photo) {
    return photo.githubPath || ("memory/files/" + photo.id + "." + extension(photo));
  }

  async function saveRecord(record) {
    var api = window.EditorGitHub;
    if (!api || !api.isReady()) throw new Error("GitHubへの接続が完了していません");

    var paths = {};
    var files = [];
    record.photos.forEach(function (photo) {
      var path = draftPath(photo);
      paths[photo.id] = path;
      if (!photo.githubPath && photo.blob) {
        files.push({ path: path, blob: photo.blob });
      }
    });

    var githubPhotos = record.photos.map(function (photo) {
      return {
        id: photo.id,
        originalName: photo.originalName,
        caption: photo.caption || "",
        width: photo.width || 0,
        height: photo.height || 0,
        type: photo.type || (photo.blob && photo.blob.type) || "image/webp",
        githubPath: paths[photo.id]
      };
    });

    await api.saveDraft("memory", {
      metadata: record.metadata,
      photos: githubPhotos,
      flags: record.flags || {},
      updatedAt: record.updatedAt
    }, {
      files: files,
      deletePaths: record.pendingDeletedPaths || []
    });

    record.photos = record.photos.map(function (photo) {
      return Object.assign({}, photo, { githubPath: paths[photo.id] });
    });
    record.pendingDeletedPaths = [];

    // The editor's autosave owns local state. Do not overwrite newer edits
    // with a snapshot after a slow network request completes.
    return record;
  }

  function validate(record) {
    var data = record.metadata;
    var errors = [];

    if (!data.title) errors.push("場所・タイトル");
    if (!data.slug || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(data.slug)) errors.push("スラッグ");
    if (!data.date) errors.push("並び替え用の日付");
    if (!data.dateDisplay) errors.push("画面に表示する日付");
    if (!data.description) errors.push("概要");
    if (!record.photos.length) errors.push("写真");

    var missingCaptions = record.photos.reduce(function (indexes, photo, index) {
      if (!String(photo.caption || "").trim()) indexes.push(index + 1);
      return indexes;
    }, []);
    if (missingCaptions.length) {
      errors.push("写真 " + missingCaptions.join("・") + " のキャプション");
    }

    if (!errors.length) return true;
    window.alert("未入力または形式が違う項目があります: " + errors.join("、"));
    var firstInvalid = form.querySelector(":invalid");
    if (firstInvalid) firstInvalid.focus();
    return false;
  }

  function yamlValue(value) {
    return JSON.stringify(value == null ? "" : String(value));
  }

  function publicImagePath(record, index) {
    return "/images/memory/" + record.metadata.slug + "-" +
      String(index + 1).padStart(2, "0") + "." + extension(record.photos[index]);
  }

  function buildMemoryData(record) {
    var data = record.metadata;
    var lines = [
      "---",
      "title: " + yamlValue(data.title),
      "description: " + yamlValue(data.description),
      "date: " + yamlValue(data.date + " 00:00:00 +0900"),
      "last_modified_at: " + yamlValue(jstDate() + " 00:00:00 +0900"),
      "date_display: " + yamlValue(data.dateDisplay),
      "permalink: " + yamlValue("/memory/" + data.slug + "/"),
      "image: " + yamlValue(publicImagePath(record, 0)),
      "image_alt: " + yamlValue(String(record.photos[0].caption || "").trim() || data.title),
      "photos:"
    ];

    record.photos.forEach(function (photo, index) {
      lines.push("  - src: " + yamlValue(publicImagePath(record, index)));
      lines.push("    caption: " + yamlValue(String(photo.caption || "").trim()));
    });
    lines.push("---", "");
    return lines.join("\n");
  }

  function setBusy(busy) {
    saveButton.disabled = busy;
    publishButton.disabled = busy;
  }

  async function overwriteDraft() {
    setBusy(true);
    status.textContent = "下書きを保存中…";
    try {
      var record = await currentRecord();
      await saveRecord(record);
      status.textContent = "下書きを上書き保存しました";
    } catch (error) {
      status.textContent = "下書きを保存できませんでした";
      window.alert("下書きをGitHubへ保存できませんでした。通信状況を確認してください。");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      var record = await currentRecord();
      if (!validate(record)) return;
      if (!window.EditorPublicGitHub) {
        window.alert("公開機能を読み込めませんでした。ページを再読み込みしてください。");
        return;
      }
      if (!window.confirm("このMemoryを写真ごと公開しますか？")) return;

      status.textContent = "公開前に下書きを保存中…";
      record = await saveRecord(record);

      var entries = [{
        path: "_memories/" + record.metadata.slug + ".md",
        content: buildMemoryData(record)
      }];

      record.photos.forEach(function (photo, index) {
        entries.push({
          path: publicImagePath(record, index).replace(/^\//, ""),
          blob: photo.blob
        });
      });

      status.textContent = "写真とMemoryを公開中…";
      await window.EditorPublicGitHub.commit(
        entries,
        "Publish memory: " + record.metadata.title
      );

      status.textContent = "公開しました";
      window.alert("公開しました。GitHub Pagesへの反映後、Memoryページに表示されます。");
    } catch (error) {
      status.textContent = "公開できませんでした";
      if (window.EditorPublicGitHub) {
        window.alert(window.EditorPublicGitHub.permissionMessage(error));
      } else {
        window.alert("公開できませんでした。ページを再読み込みしてください。");
      }
    } finally {
      setBusy(false);
    }
  }

  saveButton.addEventListener("click", overwriteDraft);
  publishButton.addEventListener("click", publish);
}());

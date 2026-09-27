(function () {
  "use strict";

  var BASE_URL = "https://4k29.github.io/tecirc";
  var DB_NAME = "4k29-memory-editor-v1";
  var DB_STORE = "drafts";
  var DB_KEY = "current";
  var MAX_IMAGE_EDGE = 2400;
  var WEBP_QUALITY = 0.86;

  var form = document.getElementById("memory-form");
  var fields = {
    title: document.getElementById("title"),
    slug: document.getElementById("slug"),
    date: document.getElementById("date"),
    dateDisplay: document.getElementById("date-display"),
    description: document.getElementById("description")
  };
  var status = document.getElementById("save-status");
  var descriptionCount = document.getElementById("description-count");
  var photoCount = document.getElementById("photo-count");
  var urlPreview = document.getElementById("url-preview");
  var photoInput = document.getElementById("photo-input");
  var dropZone = document.getElementById("drop-zone");
  var photoList = document.getElementById("photo-list");
  var photoEmpty = document.getElementById("photo-empty");
  var photoCardTemplate = document.getElementById("photo-card-template");

  var photos = [];
  var saveTimer = null;
  var githubSyncTimer = null;
  var slugTouched = false;
  var dateDisplayTouched = false;
  var descriptionTouched = false;
  var draggedPhotoId = "";
  var processing = false;
  var githubApi = null;
  var githubSyncing = false;
  var githubSyncQueued = false;
  var pendingDeletedPaths = [];
  var localUpdatedAt = "";
  var initialRestorePromise = null;

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

  function displayDate(value) {
    return value ? value.replace(/-/g, ".") : "";
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/\((\d+)\)/g, "-$1-")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .replace(/-{2,}/g, "-")
      .toLowerCase();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function yamlValue(value) {
    return JSON.stringify(value == null ? "" : String(value));
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function getMetadata() {
    return {
      title: fields.title.value.trim(),
      slug: fields.slug.value.trim(),
      date: fields.date.value,
      dateDisplay: fields.dateDisplay.value.trim(),
      description: fields.description.value.trim()
    };
  }

  function setMetadata(data) {
    Object.keys(fields).forEach(function (key) {
      if (typeof data[key] === "string") fields[key].value = data[key];
    });
  }

  function updateAutomaticDescription() {
    if (descriptionTouched) return;
    var title = fields.title.value.trim();
    var shownDate = fields.dateDisplay.value.trim();
    fields.description.value = title && shownDate
      ? shownDate + " — " + title + "で撮影した写真の記録。"
      : "";
  }

  function updateSummary() {
    var data = getMetadata();
    descriptionCount.textContent = fields.description.value.length;
    photoCount.textContent = photos.length;
    urlPreview.textContent = BASE_URL + "/memory/" + (data.slug || "…") + "/";
  }

  function fileExtension(photo) {
    return photo.type === "image/webp" ? "webp" : "jpg";
  }

  function generatedPhotoName(index, photo) {
    var slug = fields.slug.value.trim() || "memory";
    return slug + "-" + String(index + 1).padStart(2, "0") + "." + fileExtension(photo);
  }

  function generatedPhotoPath(index, photo) {
    return "/images/memory/" + generatedPhotoName(index, photo);
  }

  function renderPhotos() {
    photoList.innerHTML = "";
    photoEmpty.hidden = photos.length > 0;

    photos.forEach(function (photo, index) {
      var card = photoCardTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.id = photo.id;

      var image = card.querySelector("img");
      image.src = photo.previewUrl;
      image.alt = photo.caption || "選択した写真 " + (index + 1);

      card.querySelector(".memory-photo-number").textContent = String(index + 1).padStart(2, "0");
      card.querySelector(".memory-photo-file strong").textContent = photo.originalName;
      card.querySelector(".memory-photo-file small").textContent = formatBytes(photo.blob.size);

      var caption = card.querySelector(".memory-caption-input");
      caption.value = photo.caption;
      caption.dataset.id = photo.id;

      card.querySelector('[data-action="before"]').disabled = index === 0;
      card.querySelector('[data-action="after"]').disabled = index === photos.length - 1;
      photoList.appendChild(card);
    });

    updateSummary();
  }

  function scheduleSave() {
    status.textContent = "保存中…";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 700);
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }

      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(DB_STORE)) {
          database.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("Could not open IndexedDB"));
      };
    });
  }

  function databaseRequest(mode, action) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(DB_STORE, mode);
        var store = transaction.objectStore(DB_STORE);
        var request = action(store);

        // A successful request can still be rolled back before commit.
        var result;
        request.onsuccess = function () {
          result = request.result;
        };
        request.onerror = function () {
          reject(request.error || new Error("IndexedDB request failed"));
        };
        transaction.oncomplete = function () {
          database.close();
          resolve(result);
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("IndexedDB transaction aborted"));
          database.close();
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error("IndexedDB transaction failed"));
          database.close();
        };
      });
    });
  }

  function serializablePhotos() {
    return photos.map(function (photo) {
      return {
        id: photo.id,
        originalName: photo.originalName,
        caption: photo.caption,
        width: photo.width,
        height: photo.height,
        type: photo.type,
        blob: photo.blob,
        githubPath: photo.githubPath || ""
      };
    });
  }

  window.MemoryEditor = Object.freeze({
    getDraftSnapshot: function () {
      if (processing) throw new Error("写真の軽量化が終わってから操作してください。");
      return buildDraftRecord(new Date().toISOString());
    },
    isProcessing: function () { return processing; }
  });

  function buildDraftRecord(updatedAt) {
    return {
      metadata: getMetadata(),
      photos: serializablePhotos(),
      flags: {
        slugTouched: slugTouched,
        dateDisplayTouched: dateDisplayTouched,
        descriptionTouched: descriptionTouched
      },
      pendingDeletedPaths: pendingDeletedPaths.slice(),
      updatedAt: updatedAt || localUpdatedAt || new Date().toISOString()
    };
  }

  function hasDraftContent() {
    var metadata = getMetadata();
    return Boolean(metadata.title || metadata.description || photos.length);
  }

  function saveDraft() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    var updatedAt = new Date().toISOString();
    localUpdatedAt = updatedAt;
    var draft = buildDraftRecord(updatedAt);
    var shouldSyncGitHub = githubApi && (hasDraftContent() || pendingDeletedPaths.length);

    status.textContent = shouldSyncGitHub ? "GitHubへの保存待ち…" : "端末内に保存中…";

    databaseRequest("readwrite", function (store) {
      return store.put(draft, DB_KEY);
    }).then(function () {
      if (!shouldSyncGitHub) status.textContent = "端末内に保存済み";
    }).catch(function () {
      if (!shouldSyncGitHub) status.textContent = "端末内へ自動保存できませんでした";
    });

    if (shouldSyncGitHub) scheduleGitHubSync();
  }

  function scheduleGitHubSync() {
    window.clearTimeout(githubSyncTimer);
    githubSyncTimer = window.setTimeout(syncGitHubDraft, 3000);
  }

  function restoreDraft() {
    return databaseRequest("readonly", function (store) {
      return store.get(DB_KEY);
    }).then(function (draft) {
      if (!draft) return false;

      localUpdatedAt = draft.updatedAt || "";
      setMetadata(draft.metadata || {});
      slugTouched = Boolean(draft.flags && draft.flags.slugTouched);
      dateDisplayTouched = Boolean(draft.flags && draft.flags.dateDisplayTouched);
      descriptionTouched = Boolean(draft.flags && draft.flags.descriptionTouched);
      pendingDeletedPaths = Array.isArray(draft.pendingDeletedPaths)
        ? draft.pendingDeletedPaths.filter(Boolean)
        : [];

      photos = (draft.photos || []).filter(function (photo) {
        return photo && photo.blob;
      }).map(function (photo) {
        return {
          id: photo.id || createId(),
          originalName: photo.originalName || "photo",
          caption: photo.caption || "",
          width: photo.width || 0,
          height: photo.height || 0,
          type: photo.type || (photo.blob && photo.blob.type) || "image/webp",
          blob: photo.blob,
          previewUrl: URL.createObjectURL(photo.blob),
          githubPath: photo.githubPath || ""
        };
      });

      renderPhotos();
      status.textContent = "下書きを復元しました";
      return true;
    }).catch(function () {
      return false;
    });
  }

  function clearSavedDraft() {
    return databaseRequest("readwrite", function (store) {
      return store.delete(DB_KEY);
    }).catch(function () {
      return undefined;
    });
  }

  function githubFilePath(photo) {
    return photo.githubPath || ("memory/files/" + photo.id + "." + fileExtension(photo));
  }

  function githubPhotoData(photoSnapshot, pathsById) {
    return photoSnapshot.map(function (photo) {
      return {
        id: photo.id,
        originalName: photo.originalName,
        caption: photo.caption,
        width: photo.width,
        height: photo.height,
        type: photo.type,
        githubPath: pathsById[photo.id]
      };
    });
  }

  async function syncGitHubDraft() {
    window.clearTimeout(githubSyncTimer);
    githubSyncTimer = null;
    if (!githubApi || (!hasDraftContent() && !pendingDeletedPaths.length)) return;
    if (githubSyncing) {
      githubSyncQueued = true;
      return;
    }

    githubSyncing = true;
    githubSyncQueued = false;
    var syncingUpdatedAt = localUpdatedAt || new Date().toISOString();
    var photoSnapshot = photos.slice();
    var metadataSnapshot = getMetadata();
    var flagsSnapshot = {
      slugTouched: slugTouched,
      dateDisplayTouched: dateDisplayTouched,
      descriptionTouched: descriptionTouched
    };
    var deletedSnapshot = pendingDeletedPaths.slice();
    var pathsById = {};
    var files = [];
    var syncSucceeded = false;
    status.textContent = "GitHubに保存中…";

    try {
      photoSnapshot.forEach(function (photo) {
        var path = githubFilePath(photo);
        pathsById[photo.id] = path;
        if (!photo.githubPath) files.push({ path: path, blob: photo.blob });
      });

      await githubApi.saveDraft("memory", {
        metadata: metadataSnapshot,
        photos: githubPhotoData(photoSnapshot, pathsById),
        flags: flagsSnapshot,
        updatedAt: syncingUpdatedAt
      }, {
        files: files,
        deletePaths: deletedSnapshot
      });

      photoSnapshot.forEach(function (savedPhoto) {
        var currentPhoto = photos.find(function (photo) {
          return photo.id === savedPhoto.id;
        });
        if (currentPhoto) currentPhoto.githubPath = pathsById[savedPhoto.id];
      });
      pendingDeletedPaths = pendingDeletedPaths.filter(function (path) {
        return !deletedSnapshot.includes(path);
      });

      await databaseRequest("readwrite", function (store) {
        return store.put(buildDraftRecord(localUpdatedAt || syncingUpdatedAt), DB_KEY);
      }).catch(function () {
        return undefined;
      });
      syncSucceeded = true;

      if (localUpdatedAt === syncingUpdatedAt) {
        status.textContent = "GitHubに保存済み";
      }
    } catch (error) {
      if (localUpdatedAt === syncingUpdatedAt) {
        status.textContent = "端末内に保存済み・GitHub未同期";
      }
    } finally {
      githubSyncing = false;
      if (githubSyncQueued || localUpdatedAt !== syncingUpdatedAt || (syncSucceeded && pendingDeletedPaths.length)) {
        githubSyncQueued = false;
        syncGitHubDraft();
      }
    }
  }

  async function applyGitHubDraft(githubRecord) {
    var data = githubRecord.data || {};
    var githubPhotos = data.photos || [];
    status.textContent = "GitHubの写真を復元中…";

    var restoredPhotos = await Promise.all(githubPhotos.map(async function (photo) {
      var blob = await githubApi.downloadDraftFile(photo.githubPath);
      return {
        id: photo.id || createId(),
        originalName: photo.originalName || "photo",
        caption: photo.caption || "",
        width: photo.width || 0,
        height: photo.height || 0,
        type: photo.type || blob.type || "image/webp",
        blob: blob,
        previewUrl: URL.createObjectURL(blob),
        githubPath: photo.githubPath
      };
    }));

    photos.forEach(function (photo) {
      URL.revokeObjectURL(photo.previewUrl);
    });
    photos = restoredPhotos;
    setMetadata(data.metadata || {});
    slugTouched = Boolean(data.flags && data.flags.slugTouched);
    dateDisplayTouched = Boolean(data.flags && data.flags.dateDisplayTouched);
    descriptionTouched = Boolean(data.flags && data.flags.descriptionTouched);
    pendingDeletedPaths = [];
    localUpdatedAt = data.updatedAt || "";
    renderPhotos();

    await databaseRequest("readwrite", function (store) {
      return store.put(buildDraftRecord(localUpdatedAt), DB_KEY);
    }).catch(function () {
      return undefined;
    });
    status.textContent = "GitHubの下書きを復元しました";
  }

  async function connectGitHub(api) {
    githubApi = api;
    if (initialRestorePromise) await initialRestorePromise;
    status.textContent = "GitHubの下書きを確認中…";

    try {
      var githubRecord = await api.loadDraft("memory");
      var githubUpdatedAt = githubRecord && githubRecord.data && githubRecord.data.updatedAt
        ? githubRecord.data.updatedAt
        : "";

      if (githubRecord && (!hasDraftContent() || githubUpdatedAt > localUpdatedAt)) {
        await applyGitHubDraft(githubRecord);
      } else if (hasDraftContent()) {
        localUpdatedAt = localUpdatedAt || new Date().toISOString();
        await syncGitHubDraft();
      } else {
        status.textContent = "GitHubに接続済み";
      }
    } catch (error) {
      status.textContent = "端末内の下書きを使用中・GitHub未同期";
    }
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        resolve({ image: image, url: url });
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error(file.name + " を読み込めませんでした"));
      };
      image.src = url;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, type, quality);
    });
  }

  async function processImage(file) {
    var loaded = await loadImage(file);
    var source = loaded.image;
    var longest = Math.max(source.naturalWidth, source.naturalHeight);
    var scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1;
    var width = Math.max(1, Math.round(source.naturalWidth * scale));
    var height = Math.max(1, Math.round(source.naturalHeight * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    var context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    URL.revokeObjectURL(loaded.url);

    var blob = await canvasBlob(canvas, "image/webp", WEBP_QUALITY);
    if (!blob || blob.type !== "image/webp") {
      blob = await canvasBlob(canvas, "image/jpeg", 0.88);
    }
    canvas.width = 1;
    canvas.height = 1;

    if (!blob) throw new Error(file.name + " を変換できませんでした");
    return {
      id: createId(),
      originalName: file.name,
      caption: "",
      width: width,
      height: height,
      type: blob.type,
      blob: blob,
      previewUrl: URL.createObjectURL(blob)
    };
  }

  async function addFiles(fileList) {
    if (processing) return;
    var files = Array.from(fileList || []).filter(function (file) {
      return file.type.indexOf("image/") === 0;
    });
    if (!files.length) return;

    processing = true;
    photoInput.disabled = true;
    var failed = [];

    for (var index = 0; index < files.length; index += 1) {
      status.textContent = (index + 1) + " / " + files.length + " 枚を軽量化中…";
      try {
        photos.push(await processImage(files[index]));
        renderPhotos();
      } catch (error) {
        failed.push(files[index].name);
      }
    }

    processing = false;
    photoInput.disabled = false;
    photoInput.value = "";
    scheduleSave();

    if (failed.length) {
      window.alert("読み込めなかった写真があります: " + failed.join("、"));
    }
  }

  function movePhoto(id, direction) {
    var index = photos.findIndex(function (photo) {
      return photo.id === id;
    });
    if (index < 0) return;
    var nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= photos.length) return;
    var temporary = photos[index];
    photos[index] = photos[nextIndex];
    photos[nextIndex] = temporary;
    renderPhotos();
    scheduleSave();
  }

  function removePhoto(id) {
    var index = photos.findIndex(function (photo) {
      return photo.id === id;
    });
    if (index < 0) return;
    if (!window.confirm("この写真をMemoryから削除しますか？")) return;
    var removedPhoto = photos[index];
    URL.revokeObjectURL(removedPhoto.previewUrl);
    photos.splice(index, 1);
    if (githubApi) {
      var removedPath = githubFilePath(removedPhoto);
      if (!pendingDeletedPaths.includes(removedPath)) pendingDeletedPaths.push(removedPath);
    }
    renderPhotos();
    scheduleSave();
  }

  function validate() {
    var data = getMetadata();
    var errors = [];

    if (!data.title) errors.push("場所・タイトル");
    if (!data.slug || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(data.slug)) errors.push("スラッグ");
    if (!data.date) errors.push("並び替え用の日付");
    if (!data.dateDisplay) errors.push("画面に表示する日付");
    if (!data.description) errors.push("概要");
    if (!photos.length) errors.push("写真");

    var missingCaptions = photos.reduce(function (indexes, photo, index) {
      if (!photo.caption.trim()) indexes.push(index + 1);
      return indexes;
    }, []);
    if (missingCaptions.length) {
      errors.push("写真 " + missingCaptions.join("・") + " のキャプション");
    }

    if (errors.length) {
      window.alert("未入力または形式が違う項目があります: " + errors.join("、"));
      var firstInvalid = form.querySelector(":invalid");
      if (firstInvalid) firstInvalid.focus();
      return false;
    }
    return true;
  }

  function buildMemoryData() {
    var data = getMetadata();
    var modified = jstDate() + " 00:00:00 +0900";
    var published = data.date + " 00:00:00 +0900";
    var firstPath = generatedPhotoPath(0, photos[0]);
    var lines = [
      "---",
      "title: " + yamlValue(data.title),
      "description: " + yamlValue(data.description),
      "date: " + yamlValue(published),
      "last_modified_at: " + yamlValue(modified),
      "date_display: " + yamlValue(data.dateDisplay),
      "permalink: " + yamlValue("/memory/" + data.slug + "/"),
      "image: " + yamlValue(firstPath),
      "image_alt: " + yamlValue(photos[0].caption.trim() || data.title),
      "photos:"
    ];

    photos.forEach(function (photo, index) {
      lines.push("  - src: " + yamlValue(generatedPhotoPath(index, photo)));
      lines.push("    caption: " + yamlValue(photo.caption.trim()));
    });
    lines.push("---", "");
    return lines.join("\n");
  }

  function copyMemoryData() {
    if (!validate()) return;
    var content = buildMemoryData();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(content).then(function () {
        status.textContent = "Memoryデータをコピーしました";
      }).catch(function () {
        fallbackCopy(content);
      });
    } else {
      fallbackCopy(content);
    }
  }

  function fallbackCopy(content) {
    var textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "");
    textarea.className = "memory-copy-helper";
    document.body.appendChild(textarea);
    textarea.select();
    var copied = document.execCommand("copy");
    textarea.remove();
    status.textContent = copied ? "Memoryデータをコピーしました" : "コピーできませんでした";
  }

  var crcTable = (function () {
    var table = new Uint32Array(256);
    for (var number = 0; number < 256; number += 1) {
      var crc = number;
      for (var bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      }
      table[number] = crc >>> 0;
    }
    return table;
  }());

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var index = 0; index < bytes.length; index += 1) {
      crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipDateTime(date) {
    var year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function joinBytes(parts) {
    var length = parts.reduce(function (total, part) {
      return total + part.length;
    }, 0);
    var result = new Uint8Array(length);
    var offset = 0;
    parts.forEach(function (part) {
      result.set(part, offset);
      offset += part.length;
    });
    return result;
  }

  async function makeZip(entries) {
    var encoder = new TextEncoder();
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var stamp = zipDateTime(new Date());

    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      var name = encoder.encode(entry.name);
      var bytes = entry.data instanceof Blob
        ? new Uint8Array(await entry.data.arrayBuffer())
        : entry.data;
      var checksum = crc32(bytes);

      var localHeader = new Uint8Array(30 + name.length);
      var localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, bytes.length, true);
      localView.setUint32(22, bytes.length, true);
      localView.setUint16(26, name.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(name, 30);
      localParts.push(localHeader, bytes);

      var centralHeader = new Uint8Array(46 + name.length);
      var centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, bytes.length, true);
      centralView.setUint32(24, bytes.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      centralHeader.set(name, 46);
      centralParts.push(centralHeader);

      offset += localHeader.length + bytes.length;
    }

    var centralDirectory = joinBytes(centralParts);
    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return new Blob([joinBytes(localParts), centralDirectory, end], { type: "application/zip" });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  async function downloadPublishSet() {
    if (!validate()) return;
    status.textContent = "公開セットを作成中…";
    var encoder = new TextEncoder();
    var slug = fields.slug.value.trim();
    var entries = [{
      name: slug + ".md",
      data: encoder.encode(buildMemoryData())
    }];

    photos.forEach(function (photo, index) {
      entries.push({
        name: generatedPhotoName(index, photo),
        data: photo.blob
      });
    });

    try {
      var zip = await makeZip(entries);
      downloadBlob(zip, slug + "-memory.zip");
      status.textContent = slug + "-memory.zip を保存しました";
    } catch (error) {
      status.textContent = "公開セットを作成できませんでした";
      window.alert("ZIPを作成できませんでした。もう一度試してください。");
    }
  }

  form.addEventListener("input", function (event) {
    if (event.target === fields.title && !slugTouched) {
      var automaticSlug = slugify(fields.title.value);
      if (automaticSlug) fields.slug.value = automaticSlug;
    }
    if (event.target === fields.slug) slugTouched = true;
    if (event.target === fields.date && !dateDisplayTouched) {
      fields.dateDisplay.value = displayDate(fields.date.value);
    }
    if (event.target === fields.dateDisplay) dateDisplayTouched = true;
    if (event.target === fields.description) descriptionTouched = true;
    if (event.target !== fields.description) updateAutomaticDescription();
    updateSummary();
    scheduleSave();
  });

  photoList.addEventListener("input", function (event) {
    var input = event.target.closest(".memory-caption-input");
    if (!input) return;
    var photo = photos.find(function (item) {
      return item.id === input.dataset.id;
    });
    if (photo) {
      photo.caption = input.value;
      scheduleSave();
    }
  });

  photoList.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;
    var card = button.closest(".memory-photo-card");
    var id = card.dataset.id;
    if (button.dataset.action === "before") movePhoto(id, -1);
    if (button.dataset.action === "after") movePhoto(id, 1);
    if (button.dataset.action === "remove") removePhoto(id);
  });

  photoList.addEventListener("dragstart", function (event) {
    var card = event.target.closest(".memory-photo-card");
    if (!card) return;
    draggedPhotoId = card.dataset.id;
    card.classList.add("is-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedPhotoId);
    }
  });

  photoList.addEventListener("dragend", function () {
    draggedPhotoId = "";
    photoList.querySelectorAll(".memory-photo-card").forEach(function (card) {
      card.classList.remove("is-dragging", "is-drag-over");
    });
  });

  photoList.addEventListener("dragover", function (event) {
    var card = event.target.closest(".memory-photo-card");
    if (!card || card.dataset.id === draggedPhotoId) return;
    event.preventDefault();
    photoList.querySelectorAll(".is-drag-over").forEach(function (item) {
      item.classList.remove("is-drag-over");
    });
    card.classList.add("is-drag-over");
  });

  photoList.addEventListener("drop", function (event) {
    var card = event.target.closest(".memory-photo-card");
    if (!card || !draggedPhotoId) return;
    event.preventDefault();
    var from = photos.findIndex(function (photo) {
      return photo.id === draggedPhotoId;
    });
    var to = photos.findIndex(function (photo) {
      return photo.id === card.dataset.id;
    });
    if (from < 0 || to < 0 || from === to) return;
    var moved = photos.splice(from, 1)[0];
    if (from < to) to -= 1;
    photos.splice(to, 0, moved);
    renderPhotos();
    scheduleSave();
  });

  photoInput.addEventListener("change", function () {
    addFiles(photoInput.files);
  });

  ["dragenter", "dragover"].forEach(function (eventName) {
    dropZone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach(function (eventName) {
    dropZone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  });

  dropZone.addEventListener("drop", function (event) {
    addFiles(event.dataTransfer && event.dataTransfer.files);
  });

  document.getElementById("copy-button").addEventListener("click", copyMemoryData);
  document.getElementById("download-button").addEventListener("click", downloadPublishSet);

  document.getElementById("new-button").addEventListener("click", async function () {
    if (!window.confirm("端末内とGitHubの現在の下書きを消して、新規作成しますか？")) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    window.clearTimeout(githubSyncTimer);
    githubSyncTimer = null;
    var githubPaths = photos.map(githubFilePath).concat(pendingDeletedPaths).filter(Boolean);
    photos.forEach(function (photo) {
      URL.revokeObjectURL(photo.previewUrl);
    });
    photos = [];
    await clearSavedDraft();
    localUpdatedAt = "";
    pendingDeletedPaths = [];
    form.reset();
    fields.date.value = jstDate();
    fields.dateDisplay.value = displayDate(fields.date.value);
    slugTouched = false;
    dateDisplayTouched = false;
    descriptionTouched = false;
    updateAutomaticDescription();
    renderPhotos();
    fields.title.focus();

    if (githubApi) {
      try {
        await githubApi.deleteDraft("memory", githubPaths);
        status.textContent = "新しい下書き・GitHubから削除済み";
      } catch (error) {
        status.textContent = "新しい下書き・GitHubの削除に失敗";
      }
    } else {
      status.textContent = "新しい下書き";
    }
  });

  fields.date.value = jstDate();
  fields.dateDisplay.value = displayDate(fields.date.value);
  initialRestorePromise = restoreDraft().then(function (restored) {
    if (!restored) {
      updateAutomaticDescription();
      renderPhotos();
    }
    return restored;
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "hidden") return;
    if (saveTimer) saveDraft();
    if (githubSyncTimer) syncGitHubDraft();
  });

  if (window.EditorGitHub) {
    window.EditorGitHub.onReady(connectGitHub);
  }
}());


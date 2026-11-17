(function () {
  "use strict";

  var API_ROOT = "https://api.github.com";
  var config = window.EDITOR_GITHUB_CONFIG || {};
  var OWNER = config.owner || "4k29";
  var REPOSITORY = config.publicRepository || "tecirc";
  var BRANCH = config.publicBranch || "main";
  var NOTE_IMAGE_DIRECTORY = "images/notes";
  var OGP_IMAGE_DIRECTORY = "images/ogp";

  var uploadButton = document.getElementById("image-upload-button");
  var uploadInput = document.getElementById("image-upload-input");
  var uploadStatus = document.getElementById("image-upload-status");
  var imagePathInput = document.getElementById("dialog-image-path");
  var imageAltInput = document.getElementById("dialog-image-alt");
  var imageDialog = document.getElementById("image-dialog");
  var body = document.getElementById("body");
  var slugInput = document.getElementById("slug");
  var titleInput = document.getElementById("title");
  var videoUploadButton = document.getElementById("video-upload-button");
  var videoUploadInput = document.getElementById("video-upload-input");
  var videoUploadStatus = document.getElementById("video-upload-status") || uploadStatus;
  var ogpPathInput = document.getElementById("image");
  var ogpAltInput = document.getElementById("image-alt");
  var ogpUploadButton = document.getElementById("ogp-upload-button");
  var ogpUploadInput = document.getElementById("ogp-upload-input");
  var ogpUploadStatus = document.getElementById("ogp-upload-status");
  var dialogPreview = document.getElementById("image-dialog-preview");
  var imageDrop = document.getElementById("image-drop");
  var imageDropChange = document.getElementById("image-drop-change");
  var imageCaptionInput = document.getElementById("dialog-image-caption");
  var insertImageButton = document.getElementById("insert-image-button");
  var imageToolbarButton = document.querySelector('.format-toolbar [data-action="image"]');
  var IMAGE_STATUS_DEFAULT = uploadStatus.textContent;
  var uploadingImage = false;

  if (!uploadButton || !uploadInput || !uploadStatus || !ogpUploadButton || !ogpUploadInput || !ogpUploadStatus) return;

  // Blob URLs let the editor preview files that GitHub Pages has not rebuilt yet.
  window.noteImagePreviews = window.noteImagePreviews || new Map();
  window.noteOgpPreviews = window.noteOgpPreviews || new Map();

  function readToken() {
    return window.EditorGitHub && window.EditorGitHub.getToken
      ? window.EditorGitHub.getToken() : "";
  }

  function normalizeBaseName(value) {
    var base = String(value || "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[\\/:*?"<>|#%]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "note";
  }

  function fileExtension(file) {
    if (file.type === "video/mp4" || (!file.type && /\.mp4$/i.test(file.name))) return ".mp4";

    var extensions = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/avif": ".avif"
    };
    return extensions[file.type] || ".webp";
  }

  function articleBaseName() {
    var slug = slugInput ? slugInput.value : "";
    var title = titleInput ? titleInput.value : "";
    return normalizeBaseName(slug || title);
  }

  function repositoryContentUrl(path) {
    return API_ROOT + "/repos/" + OWNER + "/" + REPOSITORY + "/contents/" +
      path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(BRANCH);
  }

  async function fetchExistingFile(path, token) {
    var response = await window.fetch(repositoryContentUrl(path), {
      method: "GET",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store",
      credentials: "omit"
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      var error = new Error("画像の保存先を確認できませんでした");
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function nextNoteFileName(file, token) {
    var base = articleBaseName();
    var extension = fileExtension(file);

    for (var number = 1; number <= 999; number += 1) {
      var filename = base + "-" + number + extension;
      var path = NOTE_IMAGE_DIRECTORY + "/" + filename;
      if (!(await fetchExistingFile(path, token))) return filename;
    }

    throw new Error("画像番号の上限に達しました");
  }

  function blobToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(reader.error || new Error("画像を読み込めませんでした"));
      };
      reader.onload = function () {
        resolve(String(reader.result).split(",")[1] || "");
      };
      reader.readAsDataURL(file);
    });
  }

  function validateFile(file) {
    if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(file.type)) {
      throw new Error("JPEG、PNG、WebP、GIF、AVIFの画像を選んでください。");
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new Error("画像は20MB以下にしてください。");
    }
  }

  async function putFile(path, file, token, existingSha, message) {
    var content = await blobToBase64(file);
    var payload = {
      message: message,
      content: content,
      branch: BRANCH
    };
    if (existingSha) payload.sha = existingSha;

    var response = await window.fetch(
      API_ROOT + "/repos/" + OWNER + "/" + REPOSITORY + "/contents/" + path.split("/").map(encodeURIComponent).join("/"),
      {
        method: "PUT",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      }
    );

    if (!response.ok) {
      var details = null;
      try {
        details = await response.json();
      } catch (error) {
        details = null;
      }
      var uploadError = new Error(details && details.message ? details.message : "GitHubへアップロードできませんでした");
      uploadError.status = response.status;
      throw uploadError;
    }
  }

  async function uploadNoteImage(file) {
    var token = readToken();
    if (!token) throw new Error("GitHubキーが見つかりません");

    var filename = await nextNoteFileName(file, token);
    var path = NOTE_IMAGE_DIRECTORY + "/" + filename;
    await putFile(path, file, token, null, "Upload note image: " + filename);

    return {
      markdownPath: "../" + path,
      filename: filename
    };
  }

  async function uploadOgpImage(file) {
    var token = readToken();
    if (!token) throw new Error("GitHubキーが見つかりません");

    var filename = articleBaseName() + fileExtension(file);
    var path = OGP_IMAGE_DIRECTORY + "/" + filename;
    var existing = await fetchExistingFile(path, token);
    await putFile(path, file, token, existing && existing.sha, "Upload OGP image: " + filename);

    return {
      path: "/" + path,
      filename: filename
    };
  }

  function insertImageMarkdown(path, alt) {
    var start = body.selectionStart;
    var end = body.selectionEnd;
    var markdown = "![" + alt.replace(/\]/g, "") + "](" + path.replace(/\s/g, "%20") + ")";
    var before = body.value.slice(0, start);
    var after = body.value.slice(end);
    var prefix = before && !/\n\n$/.test(before) ? "\n\n" : "";
    var suffix = after && !/^\n\n/.test(after) ? "\n\n" : "";
    body.value = before + prefix + markdown + suffix + after;
    var caret = (before + prefix + markdown).length;
    body.setSelectionRange(caret, caret);
    body.dispatchEvent(new Event("input", { bubbles: true }));
    body.focus();
  }

  function showUploadError(error, statusElement) {
    if (error.status === 403 || error.status === 404) {
      statusElement.textContent = "書き込み権限がありません";
      window.alert("GitHubキーの対象リポジトリに「" + REPOSITORY + "」を追加し、ContentsをRead and writeにしてください。");
    } else {
      statusElement.textContent = "アップロードできませんでした";
      window.alert(error.message || "画像をアップロードできませんでした。通信状況を確認してください。");
    }
  }

  videoUploadButton.addEventListener("click", function () {
    videoUploadInput.click();
  });

  videoUploadInput.addEventListener("change", async function () {
    var file = videoUploadInput.files && videoUploadInput.files[0];
    if (!file) return;
    if (!(file.type === "video/mp4" || (!file.type && /\.mp4$/i.test(file.name))) || !file.size || file.size > 20 * 1024 * 1024) {
      window.alert("20MB以下のMP4動画を選んでください。");
      videoUploadInput.value = "";
      return;
    }
    videoUploadButton.disabled = true;
    uploadButton.disabled = true;
    videoUploadStatus.textContent = "動画をアップロード中…";
    try {
      var uploaded = await uploadNoteImage(file);
      var previousPreview = window.noteVideoPreviews.get(uploaded.markdownPath);
      if (previousPreview) URL.revokeObjectURL(previousPreview);
      window.noteVideoPreviews.set(uploaded.markdownPath, URL.createObjectURL(file));
      var videoDialog = document.getElementById("video-dialog");
      if (videoDialog.open) videoDialog.close();
      var path = uploaded.markdownPath.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      var markup = '\n\n<video controls playsinline preload="metadata" src="' + path + '"></video>\n\n';
      body.setRangeText(markup, body.selectionStart, body.selectionEnd, "end");
      body.dispatchEvent(new Event("input", { bubbles: true }));
      body.focus();
      videoUploadStatus.textContent = "動画を挿入しました：" + uploaded.filename;
    } catch (error) {
      showUploadError(error, videoUploadStatus);
    } finally {
      videoUploadButton.disabled = false;
      uploadButton.disabled = false;
      videoUploadInput.value = "";
    }
  });

  function setDialogPreview(src) {
    if (!dialogPreview || !imageDrop) return;
    if (src) {
      dialogPreview.src = src;
      dialogPreview.hidden = false;
      imageDrop.classList.add("has-image");
    } else {
      dialogPreview.removeAttribute("src");
      dialogPreview.hidden = true;
      imageDrop.classList.remove("has-image");
    }
  }

  function sitePreviewUrl(value) {
    var path = String(value || "").trim();
    if (!path) return "";
    if (window.noteImagePreviews.has(path)) return window.noteImagePreviews.get(path);
    if (window.noteOgpPreviews.has(path)) return window.noteOgpPreviews.get(path);
    path = path.replace(/^https:\/\/4k29\.github\.io\/tecirc\//, "/");
    if (/^\.\.\/images\//.test(path)) return "../../images/" + path.slice("../images/".length);
    if (/^\/images\//.test(path)) return "../../images/" + path.slice("/images/".length);
    if (/^images\//.test(path)) return "../../" + path;
    return "";
  }

  function setImageUploading(busy) {
    uploadingImage = busy;
    uploadButton.disabled = busy;
    if (imageDropChange) imageDropChange.disabled = busy;
    if (insertImageButton) insertImageButton.disabled = busy;
    if (imageDrop) imageDrop.classList.toggle("is-uploading", busy);
  }

  async function startImageUpload(file) {
    if (!file || uploadingImage) return;

    try {
      validateFile(file);
    } catch (error) {
      window.alert(error.message);
      return;
    }

    if (imageDialog && !imageDialog.open && imageToolbarButton) imageToolbarButton.click();

    // Forget any previously uploaded image so a failed replacement cannot insert it.
    imagePathInput.value = "";
    var localPreview = URL.createObjectURL(file);
    setDialogPreview(localPreview);
    setImageUploading(true);
    uploadStatus.textContent = "GitHubへアップロード中…";

    try {
      var uploaded = await uploadNoteImage(file);
      window.noteImagePreviews.set(uploaded.markdownPath, localPreview);
      imagePathInput.value = uploaded.markdownPath;
      uploadStatus.textContent = "✓ アップロードしました：" + uploaded.filename + "。代替テキストを入力して挿入してください。";
      if (imageDialog && imageDialog.open && imageAltInput) imageAltInput.focus();
    } catch (error) {
      URL.revokeObjectURL(localPreview);
      setDialogPreview("");
      imagePathInput.value = "";
      showUploadError(error, uploadStatus);
    } finally {
      setImageUploading(false);
      if (imageDialog && !imageDialog.open) {
        setDialogPreview("");
        uploadStatus.textContent = IMAGE_STATUS_DEFAULT;
      }
    }
  }

  window.NoteImageUpload = { start: startImageUpload };

  uploadButton.addEventListener("click", function () {
    uploadInput.click();
  });

  if (imageDropChange) {
    imageDropChange.addEventListener("click", function () {
      uploadInput.click();
    });
  }

  uploadInput.addEventListener("change", function () {
    var file = uploadInput.files && uploadInput.files[0];
    uploadInput.value = "";
    startImageUpload(file);
  });

  if (imageDrop) {
    ["dragenter", "dragover"].forEach(function (type) {
      imageDrop.addEventListener(type, function (event) {
        if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, "Files") < 0) return;
        event.preventDefault();
        imageDrop.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      imageDrop.addEventListener(type, function () {
        imageDrop.classList.remove("is-dragging");
      });
    });
    imageDrop.addEventListener("drop", function (event) {
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      event.preventDefault();
      startImageUpload(file);
    });
  }

  if (imagePathInput) {
    imagePathInput.addEventListener("input", function () {
      setDialogPreview(sitePreviewUrl(imagePathInput.value));
    });
  }

  if (dialogPreview) {
    dialogPreview.addEventListener("error", function () {
      if (dialogPreview.getAttribute("src")) setDialogPreview("");
    });
  }

  [imageAltInput, imageCaptionInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing || !insertImageButton || insertImageButton.disabled) return;
      event.preventDefault();
      insertImageButton.click();
    });
  });

  if (imageDialog) {
    imageDialog.addEventListener("close", function () {
      if (uploadingImage) return;
      setDialogPreview("");
      uploadStatus.textContent = IMAGE_STATUS_DEFAULT;
    });
  }

  function updateOgpThumb() {
    var image = document.getElementById("ogp-thumb-image");
    if (!image) return;
    var src = sitePreviewUrl(ogpPathInput.value);
    if (src) {
      if (image.getAttribute("src") !== src) image.src = src;
      image.hidden = false;
      ogpUploadButton.classList.add("has-image");
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      ogpUploadButton.classList.remove("has-image");
    }
  }

  var ogpThumbImage = document.getElementById("ogp-thumb-image");
  if (ogpThumbImage) {
    ogpThumbImage.addEventListener("error", function () {
      ogpThumbImage.hidden = true;
      ogpUploadButton.classList.remove("has-image");
    });
  }

  window.NoteOgpPreview = { refresh: updateOgpThumb };

  ogpUploadButton.addEventListener("click", function (event) {
    event.preventDefault();
    ogpUploadInput.click();
  });

  ogpUploadInput.addEventListener("change", function () {
    var file = ogpUploadInput.files && ogpUploadInput.files[0];
    ogpUploadInput.value = "";
    startOgpUpload(file);
  });

  ["dragenter", "dragover"].forEach(function (type) {
    ogpUploadButton.addEventListener(type, function (event) {
      if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types, "Files") < 0) return;
      event.preventDefault();
      ogpUploadButton.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach(function (type) {
    ogpUploadButton.addEventListener(type, function () {
      ogpUploadButton.classList.remove("is-dragging");
    });
  });
  ogpUploadButton.addEventListener("drop", function (event) {
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) return;
    event.preventDefault();
    startOgpUpload(file);
  });

  async function startOgpUpload(file) {
    if (!file || ogpUploadButton.disabled) return;

    try {
      validateFile(file);
    } catch (error) {
      window.alert(error.message);
      return;
    }

    ogpUploadButton.disabled = true;
    ogpUploadButton.classList.add("is-uploading");
    ogpUploadStatus.textContent = "GitHubへアップロード中…";

    try {
      var uploaded = await uploadOgpImage(file);
      var previous = window.noteOgpPreviews.get(uploaded.path);
      if (previous) URL.revokeObjectURL(previous);
      window.noteOgpPreviews.set(uploaded.path, URL.createObjectURL(file));
      ogpPathInput.value = uploaded.path;
      if (ogpAltInput && !ogpAltInput.value.trim()) {
        ogpAltInput.value = titleInput && titleInput.value.trim() ? titleInput.value.trim() : file.name.replace(/\.[^.]+$/, "");
      }
      ogpPathInput.dispatchEvent(new Event("input", { bubbles: true }));
      if (ogpAltInput) ogpAltInput.dispatchEvent(new Event("input", { bubbles: true }));
      ogpUploadStatus.textContent = "✓ アップロードしました：" + uploaded.filename;
    } catch (error) {
      showUploadError(error, ogpUploadStatus);
    } finally {
      ogpUploadButton.disabled = false;
      ogpUploadButton.classList.remove("is-uploading");
      updateOgpThumb();
    }
  }

  ogpPathInput.addEventListener("input", updateOgpThumb);
  updateOgpThumb();
})();

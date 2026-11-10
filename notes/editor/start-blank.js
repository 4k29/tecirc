(function () {
  "use strict";

  var STORAGE_KEY = "4k29-note-editor-v1";

  // The editor must always start as a fresh document. Keep saved drafts available
  // through the draft history UI, but never restore one automatically on page load.
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Continue with an empty editor when local storage is unavailable.
  }

  if (window.EditorGitHub && typeof window.EditorGitHub.loadDraft === "function") {
    var originalLoadDraft = window.EditorGitHub.loadDraft.bind(window.EditorGitHub);
    window.EditorGitHub.loadDraft = function (editor) {
      if (editor === "notes") return Promise.resolve(null);
      return originalLoadDraft(editor);
    };
  }

  function clearInitialFields() {
    var form = document.getElementById("note-form");
    if (!form) return;

    window.NoteDraftIdentity.reset();
    form.reset();

    var ids = ["title", "slug", "date", "description", "image", "image-alt", "body"];
    ids.forEach(function (id) {
      var field = document.getElementById(id);
      if (field) field.value = "";
    });

    var slug = document.getElementById("slug");
    if (slug) slug.readOnly = false;

    window.NotePublishedEdit = null;

    var publishButton = document.getElementById("publish-button");
    if (publishButton) {
      publishButton.textContent = "公開";
      delete publishButton.dataset.mode;
    }

    var descriptionCount = document.getElementById("description-count");
    var bodyCount = document.getElementById("body-count");
    var urlPreview = document.getElementById("url-preview");
    var previewTitle = document.getElementById("preview-title");
    var previewDate = document.getElementById("preview-date");
    var previewDateInline = document.getElementById("preview-date-inline");
    var previewBody = document.getElementById("preview-body");

    if (descriptionCount) descriptionCount.textContent = "0";
    if (bodyCount) bodyCount.textContent = "0";
    if (urlPreview) urlPreview.textContent = "https://4k29.github.io/tecirc/notes/…/";
    if (previewTitle) previewTitle.textContent = "記事のタイトル";
    if (previewDate) previewDate.textContent = "";
    if (previewDateInline) previewDateInline.textContent = "";
    if (previewBody) previewBody.innerHTML = '<p class="preview-placeholder">ここに記事のプレビューが表示されます。</p>';

    var status = document.getElementById("save-status");
    if (status) status.textContent = "新しい記事";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", clearInitialFields, { once: true });
  } else {
    clearInitialFields();
  }

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) window.location.reload();
  });
}());


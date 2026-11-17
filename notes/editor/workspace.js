(function () {
  "use strict";

  var form = document.getElementById("note-form");
  var workspace = document.getElementById("writing-workspace");
  var body = document.getElementById("body");
  var preview = document.querySelector(".preview-article");
  var title = document.getElementById("title");
  var description = document.getElementById("description");
  var cardTitle = document.getElementById("ogp-card-title");
  var cardDescription = document.getElementById("ogp-card-description");
  var accountSlot = document.getElementById("editor-account-slot");
  var saveButton = document.getElementById("save-draft-button");

  if (!form || !workspace || !body) return;

  // Mobile: switch between writing and preview instead of stacking two long panes.
  var viewButtons = Array.prototype.slice.call(document.querySelectorAll(".view-switch button[data-view]"));
  viewButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      workspace.dataset.view = button.dataset.view;
      viewButtons.forEach(function (other) {
        other.setAttribute("aria-pressed", String(other === button));
      });
      if (button.dataset.view === "write") body.focus({ preventScroll: true });
    });
  });

  // Keep the preview near the part of the text being edited.
  var syncFrame = 0;
  body.addEventListener("scroll", function () {
    if (!preview || syncFrame) return;
    syncFrame = window.requestAnimationFrame(function () {
      syncFrame = 0;
      var source = body.scrollHeight - body.clientHeight;
      var target = preview.scrollHeight - preview.clientHeight;
      if (source > 0 && target > 0) preview.scrollTop = Math.round(body.scrollTop / source * target);
    });
  }, { passive: true });

  function updateCard() {
    if (cardTitle) cardTitle.textContent = title.value.trim() || "記事のタイトル";
    if (cardDescription) cardDescription.textContent = description.value.trim() || "概要がここに表示されます。";
    if (window.NoteOgpPreview) window.NoteOgpPreview.refresh();
  }

  function updateCardLater() {
    window.setTimeout(updateCard, 0);
  }

  form.addEventListener("input", updateCard);
  document.addEventListener("notepreviewupdate", updateCard);
  form.addEventListener("reset", updateCardLater);
  window.addEventListener("notedraftdeleted", updateCardLater);
  updateCardLater();

  // Images dropped or pasted into the body go through the same dialog as the toolbar.
  function imageFile(list) {
    var files = Array.prototype.slice.call(list || []);
    for (var index = 0; index < files.length; index += 1) {
      if (/^image\//.test(files[index].type)) return files[index];
    }
    return null;
  }

  function hasFiles(event) {
    return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types, "Files") >= 0;
  }

  var pane = body.closest(".writing-pane");
  var dragDepth = 0;
  pane.addEventListener("dragenter", function (event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    pane.classList.add("is-dragging");
  });
  pane.addEventListener("dragover", function (event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  pane.addEventListener("dragleave", function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) pane.classList.remove("is-dragging");
  });
  pane.addEventListener("drop", function (event) {
    dragDepth = 0;
    pane.classList.remove("is-dragging");
    if (!hasFiles(event)) return;
    event.preventDefault();
    var file = imageFile(event.dataTransfer.files);
    if (!file) {
      window.alert("本文にドロップできるのは画像だけです。動画はツールバーの「動画」から追加してください。");
      return;
    }
    if (window.NoteImageUpload) window.NoteImageUpload.start(file);
  });

  body.addEventListener("paste", function (event) {
    var file = event.clipboardData && imageFile(event.clipboardData.files);
    if (!file || !window.NoteImageUpload) return;
    event.preventDefault();
    window.NoteImageUpload.start(file);
  });

  // Keyboard shortcuts for frequent actions.
  function clickToolbar(action) {
    var button = document.querySelector('.format-toolbar [data-action="' + action + '"]');
    if (button) button.click();
  }

  document.addEventListener("keydown", function (event) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    var key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (saveButton && !saveButton.disabled && !document.querySelector("dialog[open]")) saveButton.click();
      return;
    }
    if (event.target !== body || event.shiftKey) return;
    if (key === "b") {
      event.preventDefault();
      clickToolbar("bold");
    } else if (key === "k") {
      event.preventDefault();
      clickToolbar("link");
    }
  });

  // Show the GitHub account in the header instead of a floating box over the publish bar.
  function placeAccount() {
    var account = document.querySelector("body > .editor-github-account");
    if (account && accountSlot) accountSlot.appendChild(account);
  }
  placeAccount();
  new MutationObserver(placeAccount).observe(document.body, { childList: true });
}());

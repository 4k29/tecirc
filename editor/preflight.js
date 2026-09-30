(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EditorPreflight = Object.freeze(api);
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  var IMAGE_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp|m4v|mov|mp4|webm)(?:[?#]|$)/i;

  function result(errors, warnings) {
    return {
      status: errors.length ? "FAIL" : warnings.length ? "WARN" : "PASS",
      errors: errors,
      warnings: warnings
    };
  }

  function required(errors, value, label) {
    if (value === undefined || value === null || value === "") errors.push(label + "が入力されていません");
  }

  function validSlug(errors, slug) {
    if (!slug) return;
    if (!SLUG_PATTERN.test(slug) || slug.includes("..") || /\.html/i.test(slug)) {
      errors.push("スラッグが正しくありません: " + slug);
    }
  }

  function expectedPermalink(kind, slug) {
    return "/" + (kind === "note" ? "notes" : "memory") + "/" + slug + "/";
  }

  function validPermalink(errors, kind, slug, permalink) {
    var expected = expectedPermalink(kind, slug);
    if (!permalink || permalink !== expected || !permalink.endsWith("/") || permalink.includes("..") || /\.html(?:\/)?$/i.test(permalink)) {
      errors.push("公開URLが正しくありません（予定URL: " + expected + "）");
    }
  }

  function cleanReference(value) {
    var text = String(value || "").split(/[?#]/, 1)[0];
    try { return decodeURIComponent(text); } catch (error) { return text; }
  }

  function localRepositoryPath(value) {
    var clean = cleanReference(value);
    if (!clean || /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\{\{)/i.test(clean)) return "";
    if (clean.startsWith("/images/")) return clean.slice(1);
    if (clean.startsWith("../images/")) return clean.slice(3);
    if (clean.startsWith("images/")) return clean;
    return "";
  }

  function references(text) {
    var found = [];
    var source = String(text || "");
    Array.from(source.matchAll(/!?\[[^\]]*\]\(/g)).forEach(function (match) {
      var start = match.index + match[0].length;
      var angle = source[start] === "<";
      var index = start + (angle ? 1 : 0);
      var depth = 0;
      for (; index < source.length; index += 1) {
        var character = source[index];
        if (character === "\\") { index += 1; continue; }
        if (angle && character === ">") break;
        if (!angle && character === "(") { depth += 1; continue; }
        if (!angle && character === ")") {
          if (depth === 0) break;
          depth -= 1;
          continue;
        }
        if (!angle && depth === 0 && /\s/.test(character)) break;
      }
      var reference = source.slice(start + (angle ? 1 : 0), index);
      if (reference) found.push(reference.replace(/\\([()])/g, "$1"));
    });
    Array.from(source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)).forEach(function (match) {
      found.push(match[1]);
    });
    return found;
  }

  function collectionPath(value) {
    var clean = cleanReference(value);
    var match = clean.match(/^\/(notes|memory)\/([^/]+)\/$/);
    if (!match || match[2].includes("..") || /\.html$/i.test(match[2])) return "";
    return (match[1] === "notes" ? "_notes/" : "_memories/") + match[2] + ".md";
  }

  function hasPath(paths, path) {
    return paths.some(function (candidate) { return String(candidate).toLowerCase() === path.toLowerCase(); });
  }

  function addMissingPath(errors, paths, path, message) {
    if (path && !hasPath(paths, path)) errors.push(message + path.replace(/^images/, "/images"));
  }

  async function note(options) {
    var data = options.data || {};
    var errors = [];
    var warnings = [];
    [
      [data.title, "タイトル"], [data.slug, "スラッグ"], [data.date, "公開日"],
      [data.description, "概要"], [data.image, "OGP画像"], [data.imageAlt, "画像の代替テキスト"],
      [data.tags, "タグ"], [data.body, "本文"]
    ].forEach(function (item) { required(errors, item[0], item[1]); });
    if (!Array.isArray(data.tags)) errors.push("タグの形式が正しくありません");
    validSlug(errors, data.slug);
    var permalink = options.permalink || expectedPermalink("note", data.slug || "");
    validPermalink(errors, "note", data.slug || "", permalink);

    var target = "_notes/" + data.slug + ".md";
    var ownPath = options.editing && options.editing.path ? options.editing.path : "";
    var imagePaths = [];
    var ogpPath = localRepositoryPath(data.image);
    if (ogpPath) imagePaths.push({ path: ogpPath, label: "OGP画像が見つかりません: " });
    var bodyReferences = references(data.body);
    var directories = ["_notes"];
    if (bodyReferences.some(function (reference) { return /^\/memory\//.test(cleanReference(reference)); })) directories.push("_memories");
    bodyReferences.forEach(function (reference) {
      var path = IMAGE_PATTERN.test(reference) ? localRepositoryPath(reference) : "";
      if (path) imagePaths.push({ path: path, label: "本文画像が見つかりません: " });
    });
    var paths;
    try {
      paths = await options.repositoryPaths({
        directories: directories,
        files: imagePaths.map(function (item) { return item.path; })
      });
    } catch (error) {
      errors.push("公開リポジトリを確認できませんでした。通信状況を確認してください");
      return result(errors, warnings);
    }
    if ((!ownPath || ownPath.toLowerCase() !== target.toLowerCase()) && hasPath(paths, target)) {
      errors.push("このURLはすでに使用されています: " + permalink);
    }
    bodyReferences.forEach(function (reference) {
      var linked = collectionPath(reference);
      if (linked && linked.toLowerCase() !== target.toLowerCase() && !hasPath(paths, linked)) {
        errors.push("内部リンク先が見つかりません: " + cleanReference(reference));
      }
    });
    var seen = new Set();
    imagePaths.forEach(function (item) {
      if (seen.has(item.path)) return;
      seen.add(item.path);
      addMissingPath(errors, paths, item.path, item.label);
    });
    return result(errors, warnings);
  }

  async function memory(options) {
    var record = options.record || {};
    var data = record.metadata || {};
    var photos = Array.isArray(record.photos) ? record.photos : [];
    var errors = [];
    var warnings = [];
    [
      [data.title, "場所・タイトル"], [data.slug, "スラッグ"], [data.date, "並び替え用の日付"],
      [data.dateDisplay, "画面に表示する日付"], [data.description, "概要"],
      [options.image, "OGP画像"], [options.imageAlt, "画像の代替テキスト"], [photos.length ? photos : "", "写真"]
    ].forEach(function (item) { required(errors, item[0], item[1]); });
    validSlug(errors, data.slug);
    var permalink = options.permalink || expectedPermalink("memory", data.slug || "");
    validPermalink(errors, "memory", data.slug || "", permalink);

    photos.forEach(function (photo, index) {
      var number = index + 1;
      if (!options.photoPath || !options.photoPath(record, index)) errors.push("写真 " + number + " の公開先がありません");
      if (!String(photo.caption || "").trim()) errors.push("写真 " + number + " のキャプションがありません");
      if (!(photo.blob instanceof Blob)) errors.push("写真 " + number + " の公開用画像データがありません");
    });

    var paths;
    try { paths = await options.repositoryPaths({ directories: ["_memories"], files: [] }); } catch (error) {
      errors.push("公開リポジトリを確認できませんでした。通信状況を確認してください");
      return result(errors, warnings);
    }
    if (hasPath(paths, "_memories/" + data.slug + ".md")) {
      errors.push("このURLはすでに使用されています: " + permalink);
    }
    return result(errors, warnings);
  }

  return {
    note: note,
    memory: memory,
    expectedPermalink: expectedPermalink,
    references: references,
    localRepositoryPath: localRepositoryPath
  };
}));

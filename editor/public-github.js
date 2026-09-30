(function () {
  "use strict";

  var config = window.EDITOR_GITHUB_CONFIG || {};
  var API_ROOT = "https://api.github.com";
  var API_VERSION = "2022-11-28";
  var owner = config.owner || "4k29";
  var repository = config.publicRepository || "tecirc";
  var branch = config.publicBranch || "main";
  var writeQueue = Promise.resolve();

  function readToken() {
    return window.EditorGitHub && window.EditorGitHub.getToken
      ? window.EditorGitHub.getToken() : "";
  }

  function repoPath(suffix) {
    return "/repos/" + encodeURIComponent(owner) + "/" +
      encodeURIComponent(repository) + (suffix || "");
  }

  async function apiRequest(path, options) {
    options = options || {};
    var token = readToken();
    if (!token) throw new Error("GitHubキーが見つかりません");

    var headers = {
      "Accept": options.accept || "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": API_VERSION
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    var response = await window.fetch(API_ROOT + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "omit"
    });

    if (options.allow404 && response.status === 404) return null;
    if (!response.ok) {
      var details = null;
      try {
        details = await response.json();
      } catch (error) {
        details = null;
      }
      var requestError = new Error(
        details && details.message ? details.message : "GitHub API request failed"
      );
      requestError.status = response.status;
      requestError.details = details;
      throw requestError;
    }

    if (response.status === 204) return null;
    return response.json();
  }

  function validatePath(path) {
    var value = String(path || "");
    if (!value || value.includes("..") || value.startsWith("/") ||
        !/^[A-Za-z0-9._/-]+$/.test(value)) {
      throw new Error("公開先のパスが正しくありません");
    }
    return value;
  }

  function encodeContentPath(path) {
    return validatePath(path).split("/").map(encodeURIComponent).join("/");
  }

  function decodeBase64Utf8(value) {
    var binary = window.atob(String(value || "").replace(/\s/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function listDirectory(path) {
    var result = await apiRequest(
      repoPath("/contents/" + encodeContentPath(path) + "?ref=" + encodeURIComponent(branch))
    );
    if (!Array.isArray(result)) throw new Error("公開済み記事の一覧を取得できませんでした");
    return result;
  }

  async function repositoryPaths(request) {
    request = request || {};
    var directories = Array.from(new Set(request.directories || []));
    var files = Array.from(new Set(request.files || []));
    var results = await Promise.all([
      mapWithLimit(directories, 2, async function (directory) {
        return (await listDirectory(directory)).filter(function (item) {
          return item.type === "file";
        }).map(function (item) {
          return item.path;
        });
      }),
      mapWithLimit(files, 3, async function (path) {
        var file = await apiRequest(
          repoPath("/contents/" + encodeContentPath(path) + "?ref=" + encodeURIComponent(branch)),
          { allow404: true }
        );
        return file && file.type === "file" ? path : null;
      })
    ]);
    return results[0].flat().concat(results[1].filter(Boolean));
  }

  async function readText(path) {
    var result = await apiRequest(
      repoPath("/contents/" + encodeContentPath(path) + "?ref=" + encodeURIComponent(branch))
    );
    if (!result || result.type !== "file" || result.encoding !== "base64") {
      throw new Error("記事ファイルを読み込めませんでした");
    }
    return {
      path: result.path,
      sha: result.sha,
      content: decodeBase64Utf8(result.content)
    };
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(reader.error || new Error("ファイルを読み込めませんでした"));
      };
      reader.onload = function () {
        resolve(String(reader.result).split(",")[1] || "");
      };
      reader.readAsDataURL(blob);
    });
  }

  async function mapWithLimit(items, limit, callback) {
    var results = new Array(items.length);
    var nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        var index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(items[index], index);
      }
    }

    var workers = [];
    var count = Math.min(limit, items.length);
    for (var index = 0; index < count; index += 1) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  function validateWritePath(path) {
    var value = validatePath(path);
    if (!/^(?:_notes|_memories)\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(value) &&
        !/^images\/(?:notes|memory|ogp)\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp|gif|avif|mp4)$/i.test(value)) {
      throw new Error("記事とメディア以外のファイルには公開できません");
    }
    return value;
  }

  function conflictError() {
    var error = new Error("公開先の記事がすでに存在するか、読み込み後に変更されています。公開済み記事を読み直してください。");
    error.editorCode = "content-conflict";
    return error;
  }

  async function pathSha(path, ref) {
    var file = await apiRequest(repoPath("/contents/" + encodeContentPath(path) + "?ref=" + encodeURIComponent(ref)), { allow404: true });
    return file ? file.sha : null;
  }

  async function prepareEntries(entries) {
    var unique = new Map();
    entries.forEach(function (entry) {
      unique.set(validateWritePath(entry.path), entry);
    });

    return mapWithLimit(Array.from(unique.values()), 3, async function (entry) {
      var body = entry.blob
        ? { content: await blobToBase64(entry.blob), encoding: "base64" }
        : { content: String(entry.content || ""), encoding: "utf-8" };

      var created = await apiRequest(repoPath("/git/blobs"), {
        method: "POST",
        body: body
      });

      return {
        path: validatePath(entry.path),
        mode: "100644",
        type: "blob",
        sha: created.sha
      };
    });
  }

  async function repositoryState() {
    var reference = await apiRequest(
      repoPath("/git/ref/heads/" + encodeURIComponent(branch))
    );
    var commit = await apiRequest(repoPath("/git/commits/" + reference.object.sha));
    return {
      headSha: reference.object.sha,
      treeSha: commit.tree.sha
    };
  }

  async function commitPreparedEntries(prepared, message, expected) {
    for (var attempt = 0; attempt < 2; attempt += 1) {
      var state = await repositoryState();
      await mapWithLimit(prepared, 4, async function (entry) {
        if (await pathSha(entry.path, state.headSha) !== expected.get(entry.path)) throw conflictError();
      });
      var tree = await apiRequest(repoPath("/git/trees"), {
        method: "POST",
        body: {
          base_tree: state.treeSha,
          tree: prepared
        }
      });

      var commit = await apiRequest(repoPath("/git/commits"), {
        method: "POST",
        body: {
          message: message,
          tree: tree.sha,
          parents: [state.headSha]
        }
      });

      try {
        await apiRequest(
          repoPath("/git/refs/heads/" + encodeURIComponent(branch)),
          {
            method: "PATCH",
            body: { sha: commit.sha, force: false }
          }
        );
        commit.contentShas = Object.fromEntries(prepared.map(function (entry) { return [entry.path, entry.sha]; }));
        return commit;
      } catch (error) {
        if (attempt === 0 && (error.status === 409 || error.status === 422)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("公開処理を完了できませんでした");
  }

  function commit(entries, message) {
    var queued = writeQueue.then(async function () {
      if (!readToken()) throw new Error("GitHubへの接続が完了していません");
      entries.forEach(function (entry) { validateWritePath(entry.path); });
      var initial = await repositoryState();
      var expected = new Map();
      await mapWithLimit(entries, 4, async function (entry) {
        var sha = await pathSha(entry.path, initial.headSha);
        if (Object.prototype.hasOwnProperty.call(entry, "expectedSha") && entry.expectedSha !== sha) throw conflictError();
        expected.set(entry.path, sha);
      });
      var prepared = await prepareEntries(entries);
      return commitPreparedEntries(prepared, message, expected);
    });
    writeQueue = queued.catch(function () {
      return undefined;
    });
    return queued;
  }

  function permissionMessage(error) {
    if (error && error.editorCode === "content-conflict") return error.message;
    if (error && (error.status === 403 || error.status === 404)) {
      return "GitHubキーの対象リポジトリに「" + repository + "」を追加し、ContentsをRead and writeにしてください。";
    }
    return "GitHubへ公開できませんでした。通信状況を確認して、もう一度試してください。";
  }

  window.EditorPublicGitHub = Object.freeze({
    isReady: function () { return Boolean(readToken()); },
    listDirectory: listDirectory,
    repositoryPaths: repositoryPaths,
    readText: readText,
    commit: commit,
    permissionMessage: permissionMessage
  });
}());

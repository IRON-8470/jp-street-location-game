(() => {
  "use strict";

  const el = (id) => document.getElementById(id);
  const state = {
    questionId: null,
    zoomImageUrl: null,
    imageLoaded: false,
    phase: "idle",
    answer: null,
    answerMarker: null,
    resultMap: null,
    resultTargetMarker: null,
    resultAnswerMarker: null,
    resultLine: null,
    stats: { answered: 0, correct: 0, skipped: 0 },
    questionNumber: 0,
    result: null,
    prefetchPromise: null,
    prefetchedQuestion: null
  };

  const answerMap = L.map("answer-map", { zoomControl: true, scrollWheelZoom: true }).setView([36.3, 138.0], 5);
  addBaseLayer(answerMap);
  answerMap.on("click", (event) => {
    if (state.phase !== "active") return;
    setAnswerMarker(event.latlng.lat, event.latlng.lng);
  });

  function addBaseLayer(map) {
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    }).addTo(map);
  }

  function iconFor(type) {
    return L.divIcon({
      className: "custom-pin-wrapper",
      html: `<div class="pin-marker ${type}"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 22]
    });
  }

  function setNotice(message, kind = "info") {
    const notice = el("notice");
    notice.textContent = message;
    notice.className = kind === "error" ? "notice error" : "notice";
    notice.hidden = !message;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `通信に失敗しました（HTTP ${response.status}）。`);
    return data;
  }

  function updateStats() {
    el("stat-answered").textContent = String(state.stats.answered);
    el("stat-correct").textContent = String(state.stats.correct);
    el("stat-skipped").textContent = String(state.stats.skipped);
  }

  function setAnswerMarker(latitude, longitude) {
    state.answer = { latitude, longitude };
    if (state.answerMarker) answerMap.removeLayer(state.answerMarker);
    state.answerMarker = L.marker([latitude, longitude], { icon: iconFor("answer"), keyboard: true, title: "回答地点" }).addTo(answerMap);
    el("selected-position").textContent = `回答地点：${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    el("submit-answer").disabled = false;
    el("clear-pin").disabled = false;
  }

  function clearAnswerMarker() {
    state.answer = null;
    if (state.answerMarker) answerMap.removeLayer(state.answerMarker);
    state.answerMarker = null;
    el("selected-position").textContent = "回答地点：未選択";
    el("submit-answer").disabled = true;
    el("clear-pin").disabled = true;
  }

  function resetResultMap() {
    if (state.resultMap) {
      state.resultMap.remove();
      state.resultMap = null;
    }
    state.resultTargetMarker = null;
    state.resultAnswerMarker = null;
    state.resultLine = null;
  }

  function initResultMap() {
    if (state.resultMap) return state.resultMap;
    state.resultMap = L.map("result-map", { zoomControl: true, scrollWheelZoom: false, dragging: true }).setView([36.3, 138.0], 5);
    addBaseLayer(state.resultMap);
    return state.resultMap;
  }

  function showResultMap(target, answer = null) {
    el("result-map-wrap").hidden = false;
    const map = initResultMap();
    if (state.resultTargetMarker) map.removeLayer(state.resultTargetMarker);
    if (state.resultAnswerMarker) map.removeLayer(state.resultAnswerMarker);
    if (state.resultLine) map.removeLayer(state.resultLine);
    state.resultTargetMarker = L.marker([target.latitude, target.longitude], { icon: iconFor("target"), title: "正解地点" }).addTo(map).bindTooltip("正解地点");
    const bounds = [L.latLng(target.latitude, target.longitude)];
    if (answer) {
      state.resultAnswerMarker = L.marker([answer.latitude, answer.longitude], { icon: iconFor("answer"), title: "回答地点" }).addTo(map).bindTooltip("回答地点");
      state.resultLine = L.polyline([[answer.latitude, answer.longitude], [target.latitude, target.longitude]], { color: "#6b879f", weight: 2, dashArray: "5 6", opacity: 0.9 }).addTo(map);
      bounds.push(L.latLng(answer.latitude, answer.longitude));
    }
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(bounds).pad(answer ? 0.25 : 0.8), { maxZoom: answer ? 17 : 15 });
  }

  function resetForNextQuestion() {
    state.questionId = null;
    state.zoomImageUrl = null;
    state.imageLoaded = false;
    state.phase = "loading";
    state.answer = null;
    state.result = null;
    if (state.answerMarker) answerMap.removeLayer(state.answerMarker);
    state.answerMarker = null;
    el("street-photo").hidden = true;
    el("street-photo").removeAttribute("src");
    el("photo-zoom-open").disabled = true;
    el("photo-placeholder").hidden = false;
    el("photo-loading").hidden = true;
    el("question-status").textContent = "写真を取得中";
    el("question-title").textContent = "街角の写真";
    el("skip-button").disabled = true;
    el("submit-answer").disabled = true;
    el("clear-pin").disabled = true;
    el("selected-position").textContent = "回答地点：未選択";
    el("result-panel").hidden = true;
    el("result-map-wrap").hidden = true;
    el("distance-row").hidden = true;
    el("reveal-button").hidden = true;
    el("reveal-details").hidden = true;
    el("next-button").textContent = "次の問題へ →";
    resetResultMap();
    setNotice("");
    answerMap.setView([36.3, 138.0], 5);
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (loaded) => {
        if (settled) return;
        settled = true;
        resolve({ image, loaded });
      };
      image.decoding = "async";
      image.loading = "eager";
      image.fetchPriority = "low";
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = url;
      if (image.complete) finish(image.naturalWidth > 0);
    });
  }

  function startPrefetchNextQuestion() {
    if (state.phase !== "active" || state.prefetchPromise || state.prefetchedQuestion) return;

    const promise = (async () => {
      // プレイ中に次の問題を取得し、写真もバックグラウンドで先読みする。
      const data = await api("/api/question");
      const preload = await preloadImage(data.imageUrl);
      return { data, preload };
    })();

    state.prefetchPromise = promise;
    promise.then((prepared) => {
      if (state.prefetchPromise === promise) state.prefetchedQuestion = prepared;
    }).catch(() => {
      // 次の問題へ進む操作時に通常の取得処理へフォールバックする。
    });
  }

  async function obtainQuestion() {
    if (state.prefetchedQuestion) {
      const prepared = state.prefetchedQuestion;
      state.prefetchedQuestion = null;
      state.prefetchPromise = null;
      return prepared;
    }

    if (state.prefetchPromise) {
      const pending = state.prefetchPromise;
      try {
        const prepared = await pending;
        if (state.prefetchPromise === pending) {
          state.prefetchedQuestion = null;
          state.prefetchPromise = null;
        }
        return prepared;
      } catch {
        if (state.prefetchPromise === pending) state.prefetchPromise = null;
      }
    }

    // 先読みが失敗した場合も、これまでどおり通常取得で続行する。
    const data = await api("/api/question");
    return { data, preload: null };
  }

  async function loadQuestion() {
    resetForNextQuestion();
    el("photo-loading").hidden = false;
    el("next-button").disabled = true;
    try {
      const prepared = await obtainQuestion();
      const data = prepared.data;
      state.questionId = data.questionId;
      state.zoomImageUrl = data.zoomImageUrl || data.imageUrl;
      state.questionNumber += 1;
      state.phase = "active";
      el("question-title").textContent = `街角の写真 #${String(state.questionNumber).padStart(3, "0")}`;
      el("question-status").textContent = "調査中";
      el("skip-button").disabled = false;

      const existingImage = el("street-photo");
      // 先読み済み画像がある場合は、そのImageオブジェクトをDOMへ移し、二重取得を避ける。
      const reusePreloadedImage = Boolean(prepared.preload && prepared.preload.loaded && prepared.preload.image);
      const image = reusePreloadedImage ? prepared.preload.image : existingImage;
      if (reusePreloadedImage) {
        image.id = "street-photo";
        image.alt = "日本の街角の出題写真";
        image.hidden = true;
        existingImage.replaceWith(image);
      } else {
        image.fetchPriority = "high";
        image.decoding = "async";
      }
      image.onload = () => {
        if (state.questionId !== data.questionId) return;
        state.imageLoaded = true;
        el("photo-zoom-open").disabled = false;
        image.hidden = false;
        el("photo-placeholder").hidden = true;
        el("photo-loading").hidden = true;
        if (state.phase === "active") {
          el("question-status").textContent = "回答待ち";
          startPrefetchNextQuestion();
        }
      };
      image.onerror = () => {
        if (state.questionId !== data.questionId) return;
        el("photo-loading").hidden = true;
        el("photo-zoom-open").disabled = true;
        el("photo-placeholder").hidden = false;
        el("photo-placeholder").querySelector("strong").textContent = "写真を読み込めませんでした";
        el("photo-placeholder").querySelector("span").textContent = "この問題はスキップして、次の写真へ進んでください。";
        setNotice("画像の読み込みに失敗しました。スキップして次の問題へ進めます。", "error");
      };
      if (!reusePreloadedImage) image.src = data.imageUrl;
      // 先読み済み／キャッシュ済み画像ではonloadが既に発火している可能性がある。
      if (image.complete && image.naturalWidth > 0) image.onload();
      setNotice("");
    } catch (error) {
      state.phase = "error";
      el("photo-loading").hidden = true;
      el("photo-placeholder").hidden = false;
      el("photo-placeholder").querySelector("strong").textContent = "問題を取得できませんでした";
      el("photo-placeholder").querySelector("span").textContent = "設定やAPIの状態を確認し、再試行してください。";
      el("question-status").textContent = "取得エラー";
      el("skip-button").disabled = true;
      el("submit-answer").disabled = true;
      setNotice(error.message, "error");
      const next = el("next-button");
      next.textContent = "再試行する ↻";
      el("result-panel").hidden = false;
      el("result-title").textContent = "問題を取得できません";
      el("result-description").textContent = "READMEの設定手順、Mapillary APIトークン、D1接続を確認してください。";
      el("result-badge").textContent = "接続エラー";
      el("result-badge").className = "result-badge incorrect";
      el("credit-text").textContent = "問題を取得できていないため、出典情報はありません。";
      el("source-link").hidden = true;
    } finally {
      el("next-button").disabled = false;
    }
  }

  function makeLink(text, url) {
    const link = document.createElement("a");
    link.textContent = text;
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function renderAttribution(attribution) {
    const credit = el("credit-text");
    credit.replaceChildren();
    credit.append(document.createTextNode("写真："));
    credit.append(makeLink("Mapillary上の元画像", attribution.sourceUrl));
    credit.append(document.createTextNode(" ／ 撮影者："));
    if (attribution.creatorUrl && attribution.creatorName !== "撮影者情報なし") {
      credit.append(makeLink(attribution.creatorName, attribution.creatorUrl));
    } else {
      credit.append(document.createTextNode(attribution.creatorName || "撮影者情報なし"));
    }
    credit.append(document.createTextNode(" ／ ライセンス："));
    credit.append(makeLink(attribution.licenseName || "CC BY-SA 4.0", attribution.licenseUrl));
    if (attribution.capturedAt) {
      const captured = new Date(Number(attribution.capturedAt));
      if (!Number.isNaN(captured.getTime())) {
        const when = document.createElement("span");
        when.textContent = ` ／ 撮影日時：${captured.toLocaleDateString("ja-JP")}`;
        credit.append(when);
      }
    }
    el("source-link").href = attribution.sourceUrl;
    el("source-link").hidden = false;
  }

  function showResultBase(title, description, badge, badgeClass, attribution) {
    el("result-panel").hidden = false;
    el("result-title").textContent = title;
    el("result-description").textContent = description;
    el("result-badge").textContent = badge;
    el("result-badge").className = `result-badge ${badgeClass}`;
    if (attribution) renderAttribution(attribution);
    else {
      el("credit-text").textContent = "出典情報が取得できませんでした。";
      el("source-link").hidden = true;
    }
    requestAnimationFrame(() => {
      if (state.resultMap) state.resultMap.invalidateSize();
    });
  }

  async function submitAnswer() {
    if (state.phase !== "active" || !state.questionId || !state.answer) return;
    const button = el("submit-answer");
    button.disabled = true;
    el("skip-button").disabled = true;
    button.textContent = "判定中…";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const result = await api("/api/answer", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ questionId: state.questionId, latitude: state.answer.latitude, longitude: state.answer.longitude })
      });
      state.phase = "answered";
      button.textContent = "判定完了";
      state.result = result;
      state.stats.answered += 1;
      if (result.isCorrect) state.stats.correct += 1;
      updateStats();
      el("question-status").textContent = "回答済み";
      el("distance-row").hidden = false;
      el("distance-value").textContent = formatDistance(result.distanceMeters);
      el("reveal-button").hidden = true;
      el("reveal-details").hidden = false;
      el("coordinates-text").textContent = `${result.target.latitude.toFixed(6)}, ${result.target.longitude.toFixed(6)}`;
      showResultBase(
        result.isCorrect ? "撮影地点を特定しました" : "正解地点とは異なります",
        result.isCorrect ? `指定地点が正解範囲（半径${result.acceptanceRadiusMeters} m）に入りました。` : "地図や写真を見直し、必要であれば次の問題に進んでください。",
        result.isCorrect ? "正解" : "不正解", result.isCorrect ? "correct" : "incorrect", result.attribution
      );
      showResultMap(result.target, result.answer);
      el("next-button").textContent = "次の問題へ →";
      setNotice("");
    } catch (error) {
      const message = error && error.name === "AbortError"
        ? "判定サーバーから30秒以内に応答がありませんでした。通信状態を確認し、必要ならページを再読み込みしてください。"
        : (error.message || "判定中に予期しないエラーが発生しました。");
      setNotice(message, "error");
      if (state.phase === "active") {
        button.disabled = false;
        el("skip-button").disabled = false;
        button.textContent = "この地点で回答する ↗";
      } else if (state.phase === "answered") {
        // 判定後の画面更新でエラーが発生しても「判定中…」を残さない。
        button.textContent = "判定完了";
      }
    } finally {
      clearTimeout(timeoutId);
      if (state.phase === "active" && button.textContent === "判定中…") {
        button.textContent = "この地点で回答する ↗";
      }
    }
  }

  async function skipQuestion() {
    if (state.phase !== "active" || !state.questionId) return;
    el("skip-button").disabled = true;
    el("submit-answer").disabled = true;
    try {
      const result = await api("/api/skip", {
        method: "POST",
        body: JSON.stringify({ questionId: state.questionId })
      });
      state.phase = "skipped";
      state.result = result;
      state.stats.skipped += 1;
      updateStats();
      el("question-status").textContent = "スキップ済み";
      el("distance-row").hidden = true;
      el("result-map-wrap").hidden = true;
      el("reveal-details").hidden = true;
      el("reveal-button").hidden = false;
      el("reveal-button").textContent = "正解地点を表示";
      el("reveal-button").onclick = revealAnswer;
      showResultBase("この問題をスキップしました", "スキップは不正解に含まれません。写真の出典は以下から確認できます。", "スキップ", "skipped", result.attribution);
      el("next-button").textContent = "次の問題へ →";
      setNotice("");
    } catch (error) {
      setNotice(error.message, "error");
      if (state.phase === "active") el("skip-button").disabled = false;
    }
  }

  async function revealAnswer() {
    if (!state.questionId || (state.phase !== "skipped" && state.phase !== "answered")) return;
    try {
      const result = await api("/api/reveal", { method: "POST", body: JSON.stringify({ questionId: state.questionId }) });
      el("result-map-wrap").hidden = false;
      el("reveal-details").hidden = false;
      el("coordinates-text").textContent = `${result.target.latitude.toFixed(6)}, ${result.target.longitude.toFixed(6)}`;
      el("reveal-button").hidden = true;
      showResultMap(result.target, state.answer);
    } catch (error) {
      setNotice(error.message, "error");
    }
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters).toLocaleString("ja-JP")} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  // 写真拡大ビューアー。ホイール／ピンチで拡大縮小し、ドラッグで移動する。
  const zoomViewer = {
    scale: 1,
    minScale: 1,
    maxScale: 8,
    x: 0,
    y: 0,
    pointers: new Map(),
    dragStart: null,
    pinchStart: null
  };

  function applyZoomTransform() {
    el("photo-zoom-image").style.transform = `translate(${zoomViewer.x}px, ${zoomViewer.y}px) scale(${zoomViewer.scale})`;
    el("photo-zoom-out").disabled = zoomViewer.scale <= zoomViewer.minScale;
    el("photo-zoom-in").disabled = zoomViewer.scale >= zoomViewer.maxScale;
  }

  function setZoomScale(nextScale, anchorX = null, anchorY = null) {
    const oldScale = zoomViewer.scale;
    const newScale = Math.max(zoomViewer.minScale, Math.min(zoomViewer.maxScale, nextScale));
    if (anchorX !== null && anchorY !== null && oldScale !== newScale) {
      const rect = el("photo-zoom-viewport").getBoundingClientRect();
      const cx = anchorX - (rect.left + rect.width / 2);
      const cy = anchorY - (rect.top + rect.height / 2);
      zoomViewer.x = cx - (cx - zoomViewer.x) * (newScale / oldScale);
      zoomViewer.y = cy - (cy - zoomViewer.y) * (newScale / oldScale);
    }
    zoomViewer.scale = newScale;
    applyZoomTransform();
  }

  function resetZoom() {
    zoomViewer.scale = 1;
    zoomViewer.x = 0;
    zoomViewer.y = 0;
    zoomViewer.pointers.clear();
    zoomViewer.dragStart = null;
    zoomViewer.pinchStart = null;
    applyZoomTransform();
  }

  function openPhotoZoom() {
    const source = el("street-photo");
    if (!state.imageLoaded || !source.src) return;
    const questionAtOpen = state.questionId;
    const zoomImage = el("photo-zoom-image");
    zoomImage.src = source.currentSrc || source.src;
    el("photo-zoom-modal").hidden = false;
    document.body.classList.add("photo-zoom-open");
    resetZoom();
    el("photo-zoom-viewport").focus();
    el("photo-zoom-close").focus();
    // 通常表示は軽量画像のままにし、拡大ビューを開いたときだけ高解像度版を取得する。
    if (state.zoomImageUrl && state.zoomImageUrl !== source.src) {
      const highResolution = new Image();
      highResolution.decoding = "async";
      highResolution.onload = () => {
        if (!el("photo-zoom-modal").hidden && state.questionId === questionAtOpen) zoomImage.src = highResolution.src;
      };
      highResolution.onerror = () => { /* 軽量画像をそのまま使う */ };
      highResolution.src = state.zoomImageUrl;
    }
  }

  function closePhotoZoom() {
    el("photo-zoom-modal").hidden = true;
    document.body.classList.remove("photo-zoom-open");
    zoomViewer.pointers.clear();
    zoomViewer.dragStart = null;
    el("photo-zoom-open").focus();
  }

  // ブラウザー標準の画像ドラッグを無効化し、ビューアー内のドラッグをパン操作に統一する。
  el("photo-zoom-image").addEventListener("dragstart", (event) => event.preventDefault());
  el("photo-zoom-viewport").addEventListener("dragstart", (event) => event.preventDefault());

  el("photo-zoom-open").addEventListener("click", openPhotoZoom);
  el("photo-zoom-close").addEventListener("click", closePhotoZoom);
  el("photo-zoom-reset").addEventListener("click", resetZoom);
  el("photo-zoom-in").addEventListener("click", () => setZoomScale(zoomViewer.scale * 1.25));
  el("photo-zoom-out").addEventListener("click", () => setZoomScale(zoomViewer.scale / 1.25));
  el("photo-zoom-modal").addEventListener("click", (event) => {
    if (event.target === el("photo-zoom-modal")) closePhotoZoom();
  });
  document.addEventListener("keydown", (event) => {
    if (el("photo-zoom-modal").hidden) return;
    if (event.key === "Escape") closePhotoZoom();
    if (event.key === "+" || event.key === "=") setZoomScale(zoomViewer.scale * 1.25);
    if (event.key === "-") setZoomScale(zoomViewer.scale / 1.25);
    if (event.key === "0") resetZoom();
  });

  el("photo-zoom-viewport").addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoomScale(zoomViewer.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
  }, { passive: false });

  const zoomViewport = el("photo-zoom-viewport");
  zoomViewport.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try { zoomViewport.setPointerCapture(event.pointerId); } catch { /* captureが利用できない環境では通常のpointerイベントで続行 */ }
    zoomViewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (zoomViewer.pointers.size === 1) {
      zoomViewer.dragStart = { pointerX: event.clientX, pointerY: event.clientY, x: zoomViewer.x, y: zoomViewer.y };
    } else if (zoomViewer.pointers.size === 2) {
      const points = [...zoomViewer.pointers.values()];
      zoomViewer.pinchStart = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), scale: zoomViewer.scale };
      zoomViewer.dragStart = null;
    }
  });
  zoomViewport.addEventListener("pointermove", (event) => {
    if (!zoomViewer.pointers.has(event.pointerId)) return;
    event.preventDefault();
    zoomViewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (zoomViewer.pointers.size >= 2 && zoomViewer.pinchStart) {
      const points = [...zoomViewer.pointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (zoomViewer.pinchStart.distance > 0) setZoomScale(zoomViewer.pinchStart.scale * distance / zoomViewer.pinchStart.distance);
    } else if (zoomViewer.pointers.size === 1 && zoomViewer.dragStart) {
      zoomViewer.x = zoomViewer.dragStart.x + event.clientX - zoomViewer.dragStart.pointerX;
      zoomViewer.y = zoomViewer.dragStart.y + event.clientY - zoomViewer.dragStart.pointerY;
      applyZoomTransform();
    }
  });
  function finishZoomPointer(event) {
    zoomViewer.pointers.delete(event.pointerId);
    zoomViewer.pinchStart = null;
    if (zoomViewer.pointers.size === 1) {
      const [point] = zoomViewer.pointers.values();
      zoomViewer.dragStart = { pointerX: point.x, pointerY: point.y, x: zoomViewer.x, y: zoomViewer.y };
    } else {
      zoomViewer.dragStart = null;
    }
  }
  zoomViewport.addEventListener("pointerup", finishZoomPointer);
  zoomViewport.addEventListener("pointercancel", finishZoomPointer);

  el("skip-button").addEventListener("click", skipQuestion);
  el("submit-answer").addEventListener("click", submitAnswer);
  el("clear-pin").addEventListener("click", clearAnswerMarker);
  el("next-button").addEventListener("click", loadQuestion);

  // Cloudflare側の設定を確認し、問題を取得する。
  api("/api/health")
    .then((health) => {
      if (!health.mapillaryConfigured || !health.databaseConfigured) {
        const missing = [];
        if (!health.mapillaryConfigured) missing.push("Mapillary APIトークン");
        if (!health.databaseConfigured) missing.push("D1データベース");
        setNotice(`初期設定が完了していません（${missing.join("・")}）。READMEの設定手順を実行してください。`, "error");
      }
    })
    .catch(() => { /* question endpoint reports actionable setup diagnostics */ })
    .finally(loadQuestion);
})();

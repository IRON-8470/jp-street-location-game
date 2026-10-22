(() => {
  "use strict";

  const el = (id) => document.getElementById(id);
  const state = {
    questionId: null,
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
    result: null
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
    state.imageLoaded = false;
    state.phase = "loading";
    state.answer = null;
    state.result = null;
    if (state.answerMarker) answerMap.removeLayer(state.answerMarker);
    state.answerMarker = null;
    el("street-photo").hidden = true;
    el("street-photo").removeAttribute("src");
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

  async function loadQuestion() {
    resetForNextQuestion();
    el("photo-loading").hidden = false;
    try {
      const data = await api("/api/question");
      state.questionId = data.questionId;
      state.questionNumber += 1;
      state.phase = "active";
      el("question-title").textContent = `街角の写真 #${String(state.questionNumber).padStart(3, "0")}`;
      el("question-status").textContent = "調査中";
      el("skip-button").disabled = false;

      const image = el("street-photo");
      image.onload = () => {
        if (state.questionId !== data.questionId) return;
        state.imageLoaded = true;
        image.hidden = false;
        el("photo-placeholder").hidden = true;
        el("photo-loading").hidden = true;
      };
      image.onerror = () => {
        if (state.questionId !== data.questionId) return;
        el("photo-loading").hidden = true;
        el("photo-placeholder").hidden = false;
        el("photo-placeholder").querySelector("strong").textContent = "写真を読み込めませんでした";
        el("photo-placeholder").querySelector("span").textContent = "この問題はスキップして、次の写真へ進んでください。";
        setNotice("画像の読み込みに失敗しました。スキップして次の問題へ進めます。", "error");
      };
      image.src = data.imageUrl;
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
    try {
      const result = await api("/api/answer", {
        method: "POST",
        body: JSON.stringify({ questionId: state.questionId, latitude: state.answer.latitude, longitude: state.answer.longitude })
      });
      state.phase = "answered";
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
      setNotice(error.message, "error");
      if (state.phase === "active") {
        button.disabled = false;
        el("skip-button").disabled = false;
      }
    } finally {
      if (state.phase === "active") button.textContent = "この地点で回答する ↗";
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

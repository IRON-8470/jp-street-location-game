const GRAPH_API = "https://graph.mapillary.com/images";
const SOURCE_BASE = "https://www.mapillary.com/app/?pKey=";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
const ACCEPTANCE_RADIUS_METERS = 15;

// 初版では、日本各地の市街地周辺を小さな bbox 単位で検索する。
// 密度が地域により異なるため、出題時には複数回サンプリングする。
const JAPAN_AREAS = [
  [43.0618, 141.3545], [43.7706, 142.3649], [40.8246, 140.7400], [39.7036, 141.1527],
  [38.2682, 140.8694], [37.7503, 140.4676], [36.5613, 136.6562], [36.6953, 137.2113],
  [37.9161, 139.0364], [36.6513, 138.1810], [36.5551, 139.8828], [35.6812, 139.7671],
  [35.8617, 139.6455], [35.6074, 140.1065], [35.4478, 139.6425], [35.4437, 139.6380],
  [35.0116, 135.7681], [34.6937, 135.5023], [34.6901, 135.1955], [35.1815, 136.9066],
  [34.9769, 138.3831], [34.7108, 137.7261], [35.4233, 136.7607], [36.0652, 136.2216],
  [34.7025, 135.4959], [34.6618, 133.9344], [34.3853, 132.4553], [35.5039, 134.2377],
  [34.3428, 134.0466], [34.0703, 134.5548], [33.8416, 132.7657], [33.5597, 133.5311],
  [33.5902, 130.4017], [33.2494, 130.2988], [32.7503, 129.8777], [32.8031, 130.7079],
  [33.2382, 131.6126], [31.5966, 130.5571], [31.9077, 131.4202], [26.2124, 127.6809],
  [26.3344, 127.8056], [35.6640, 138.5684], [34.7303, 136.5086], [33.9573, 130.9415],
  [35.3676, 132.7547], [34.2260, 135.1675], [32.7898, 130.7417], [35.1815, 136.9066]
];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (n) => n * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCoordinates(image) {
  const geometry = image.computed_geometry || image.geometry;
  const coords = geometry && geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const longitude = Number(coords[0]);
  const latitude = Number(coords[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // 日本国内の撮影写真に限定する。
  if (latitude < 24 || latitude > 46.5 || longitude < 122 || longitude > 154) return null;
  return { latitude, longitude };
}

function normalizeImage(image) {
  const coords = getCoordinates(image);
  const imageUrl = image.thumb_2048_url || image.thumb_1024_url;
  if (!coords || !image.id || !imageUrl) return null;
  let parsed;
  try { parsed = new URL(imageUrl); } catch { return null; }
  const trustedImageHost = parsed.hostname === "images.mapillary.com" || parsed.hostname.endsWith(".fbcdn.net") || parsed.hostname.endsWith(".fbsbx.com") || parsed.hostname.endsWith(".mapillary.com");
  if (parsed.protocol !== "https:" || !trustedImageHost) return null;
  if (image.camera_type === "spherical") return null;

  const creator = image.creator && typeof image.creator === "object" ? image.creator : {};
  return {
    imageId: String(image.id),
    imageUrl: parsed.toString(),
    sourceUrl: `${SOURCE_BASE}${encodeURIComponent(String(image.id))}`,
    creatorId: creator.id ? String(creator.id) : null,
    creatorUsername: typeof creator.username === "string" ? creator.username : "撮影者情報なし",
    capturedAt: Number.isFinite(Number(image.captured_at)) ? Number(image.captured_at) : null,
    sequenceId: image.sequence ? String(image.sequence) : null,
    latitude: coords.latitude,
    longitude: coords.longitude
  };
}

async function fetchImagesInArea(env, lat, lon) {
  // 中心点を少し揺らして、都市中心部の同じ画像ばかり取得することを避ける。
  const jitterLat = (Math.random() - 0.5) * 0.12;
  const jitterLon = (Math.random() - 0.5) * 0.16;
  const centerLat = lat + jitterLat;
  const centerLon = lon + jitterLon;
  const halfLat = 0.018;
  const halfLon = 0.023;
  const bbox = [centerLon - halfLon, centerLat - halfLat, centerLon + halfLon, centerLat + halfLat].join(",");
  const url = new URL(GRAPH_API);
  url.searchParams.set("fields", "id,thumb_2048_url,thumb_1024_url,computed_geometry,geometry,captured_at,creator,sequence,camera_type");
  url.searchParams.set("bbox", bbox);
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    headers: { authorization: `OAuth ${env.MAPILLARY_ACCESS_TOKEN}`, accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Mapillary API returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return Array.isArray(body.data) ? body.data.map(normalizeImage).filter(Boolean) : [];
}

async function getUsedImageIds(env, candidateIds) {
  if (!candidateIds.length) return new Set();
  const ids = [...new Set(candidateIds)].slice(0, 90);
  const marks = ids.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT image_id FROM game_questions WHERE created_at > ? AND image_id IN (${marks})`
  ).bind(Math.floor(Date.now() / 1000) - 30 * 86400, ...ids).all();
  return new Set((result.results || []).map((row) => String(row.image_id)));
}

function attributionFor(row) {
  const creatorName = row.creator_username || "撮影者情報なし";
  const creatorUrl = row.creator_id ? `https://www.mapillary.com/app/user/${encodeURIComponent(row.creator_id)}` : "https://www.mapillary.com/";
  return {
    sourceName: "Mapillary",
    sourceUrl: row.source_url,
    imageId: row.image_id,
    creatorName,
    creatorUrl,
    licenseName: "CC BY-SA 4.0",
    licenseUrl: LICENSE_URL,
    capturedAt: row.captured_at || null
  };
}

async function handleQuestion(env) {
  if (!env.MAPILLARY_ACCESS_TOKEN) return json({ error: "Mapillary APIトークンが未設定です。READMEの設定手順を確認してください。" }, 503);
  if (!env.DB) return json({ error: "D1データベースが未接続です。READMEの設定手順を確認してください。" }, 503);

  try {
    // 古い一時セッションを整理する。問題履歴は30日分のみ保持する。
    await env.DB.prepare("DELETE FROM game_questions WHERE created_at < ?").bind(Math.floor(Date.now() / 1000) - 30 * 86400).run();
    let chosen = null;
    let lastError = null;
    for (let attempt = 0; attempt < 9 && !chosen; attempt++) {
      const [lat, lon] = JAPAN_AREAS[Math.floor(Math.random() * JAPAN_AREAS.length)];
      let images;
      try {
        images = await fetchImagesInArea(env, lat, lon);
      } catch (error) {
        lastError = error;
        continue;
      }
      if (!images.length) continue;
      const used = await getUsedImageIds(env, images.map((image) => image.imageId));
      const available = images.filter((image) => !used.has(image.imageId));
      if (available.length) chosen = available[Math.floor(Math.random() * available.length)];
    }
    if (!chosen) {
      const message = lastError ? `Mapillary APIへの接続に失敗しました: ${lastError.message}` : "画像が見つかりませんでした。しばらくしてから再試行してください。";
      return json({ error: message }, lastError ? 502 : 404);
    }

    const questionId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO game_questions
        (question_id, image_id, image_url, source_url, creator_id, creator_username, captured_at,
         latitude, longitude, acceptance_radius_m, sequence_id, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).bind(
      questionId, chosen.imageId, chosen.imageUrl, chosen.sourceUrl, chosen.creatorId,
      chosen.creatorUsername, chosen.capturedAt, chosen.latitude, chosen.longitude,
      ACCEPTANCE_RADIUS_METERS, chosen.sequenceId, Math.floor(Date.now() / 1000)
    ).run();

    // 正解座標・画像ID・撮影者情報は回答/スキップ前にブラウザーへ返さない。
    return json({ questionId, imageUrl: chosen.imageUrl });
  } catch (error) {
    return json({ error: `問題の準備に失敗しました: ${error.message || "不明なエラー"}` }, 500);
  }
}

async function getQuestion(env, questionId) {
  if (typeof questionId !== "string" || questionId.length > 80) return null;
  return env.DB.prepare("SELECT * FROM game_questions WHERE question_id = ?").bind(questionId).first();
}

async function handleAnswer(request, env) {
  if (!env.DB) return json({ error: "D1データベースが未接続です。" }, 503);
  const body = await request.json().catch(() => null);
  const question = body && await getQuestion(env, body.questionId);
  if (!question) return json({ error: "問題が見つかりません。新しい問題を取得してください。" }, 404);
  if (question.status !== "active") return json({ error: "この問題はすでに回答またはスキップされています。" }, 409);
  const lat = Number(body.latitude);
  const lon = Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return json({ error: "回答地点の座標が正しくありません。" }, 400);
  }
  const distance = haversineMeters(lat, lon, question.latitude, question.longitude);
  const isCorrect = distance <= question.acceptance_radius_m;
  await env.DB.prepare(`UPDATE game_questions SET status = 'answered', answer_latitude = ?, answer_longitude = ?, distance_m = ? WHERE question_id = ? AND status = 'active'`)
    .bind(lat, lon, distance, question.question_id).run();
  return json({
    status: "answered",
    isCorrect,
    distanceMeters: Math.round(distance),
    acceptanceRadiusMeters: question.acceptance_radius_m,
    answer: { latitude: lat, longitude: lon },
    target: { latitude: question.latitude, longitude: question.longitude },
    attribution: attributionFor(question)
  });
}

async function handleSkip(request, env) {
  if (!env.DB) return json({ error: "D1データベースが未接続です。" }, 503);
  const body = await request.json().catch(() => null);
  const question = body && await getQuestion(env, body.questionId);
  if (!question) return json({ error: "問題が見つかりません。" }, 404);
  if (question.status !== "active") return json({ error: "この問題はすでに回答またはスキップされています。" }, 409);
  await env.DB.prepare("UPDATE game_questions SET status = 'skipped' WHERE question_id = ? AND status = 'active'").bind(question.question_id).run();
  // スキップ時はクレジットを返す。正解座標は「正解地点を表示」を押すまで開示しない。
  return json({ status: "skipped", attribution: attributionFor(question) });
}

async function handleReveal(request, env) {
  if (!env.DB) return json({ error: "D1データベースが未接続です。" }, 503);
  const body = await request.json().catch(() => null);
  const question = body && await getQuestion(env, body.questionId);
  if (!question) return json({ error: "問題が見つかりません。" }, 404);
  if (question.status !== "skipped" && question.status !== "answered") return json({ error: "回答またはスキップ後に正解地点を確認できます。" }, 409);
  return json({ target: { latitude: question.latitude, longitude: question.longitude } });
}

async function handleHealth(env) {
  return json({
    ok: Boolean(env.MAPILLARY_ACCESS_TOKEN && env.DB),
    mapillaryConfigured: Boolean(env.MAPILLARY_ACCESS_TOKEN),
    databaseConfigured: Boolean(env.DB)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
    }
    try {
      if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(env);
      if (url.pathname === "/api/question" && request.method === "GET") return handleQuestion(env);
      if (url.pathname === "/api/answer" && request.method === "POST") return handleAnswer(request, env);
      if (url.pathname === "/api/skip" && request.method === "POST") return handleSkip(request, env);
      if (url.pathname === "/api/reveal" && request.method === "POST") return handleReveal(request, env);
      return json({ error: "API endpoint not found." }, 404);
    } catch (error) {
      return json({ error: `サーバー側でエラーが発生しました: ${error.message || "不明なエラー"}` }, 500);
    }
  }
};

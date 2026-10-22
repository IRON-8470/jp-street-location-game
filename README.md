# 街角特定 — 初版プロトタイプ

Mapillaryの街路写真1枚から撮影地点を特定する、ブラウザー向けゲームのMVPです。

## 実装済み機能

- Mapillary APIから日本国内の画像を取得し、1問につき静止画1枚を表示
- 時間制限なし、外部検索を妨げない設計
- Leaflet + OpenStreetMap上で回答地点を指定
- サーバー側で距離を判定（初期設定は撮影地点から半径15 m以内）
- 回答またはスキップ後に写真の出典・撮影者・CC BY-SAライセンスを表示
- スキップ回数制限なし。スキップだけでは正解座標を開示しない
- 「正解地点を表示」を押すとスキップ済み問題の正解地点を確認可能
- 過去30日間で出題した同一画像を避ける
- セッション中の回答数・正解数・スキップ数を表示
- APIトークンと正解座標は、回答前のレスポンスに含めない（表示用画像URL自体に画像識別子が含まれる場合はあります）

## 必要なもの

- Node.js（現行のLTS推奨）
- Cloudflareアカウント
- Wrangler CLI
- Mapillary Developer Dashboardで取得したAPI Client Token
- Cloudflare D1データベース

APIトークンはブラウザーに埋め込まず、WorkerのSecretとして設定します。

## デプロイ手順（Cloudflare Workers）

### 1. Wranglerを準備

```bash
npm install -g wrangler
wrangler login
```

### 2. D1データベースを作成

```bash
wrangler d1 create machikado-tokutei-db
```

表示された `database_id` を `wrangler.toml` の `database_id` に設定してください。`REPLACE_WITH_YOUR_D1_DATABASE_ID` のままではデプロイできません。

### 3. テーブルを作成

```bash
wrangler d1 execute machikado-tokutei-db --remote --file=./schema.sql
```

ローカルでテストするときは `--remote` を外します。

### 4. Mapillaryトークンを登録

```bash
wrangler secret put MAPILLARY_ACCESS_TOKEN
```

プロンプトが出たらMapillary Developer DashboardのClient Tokenを入力してください。トークンはソースコードや `wrangler.toml` に書かないでください。

### 5. ローカルで起動

`.dev.vars.example` を `.dev.vars` にコピーし、`MAPILLARY_ACCESS_TOKEN` に実際のトークンを設定します。このファイルは `.gitignore` 対象です。

```bash
wrangler dev
```

ローカル用D1にスキーマが必要な場合：

```bash
wrangler d1 execute machikado-tokutei-db --local --file=./schema.sql
```

ブラウザーでWranglerが表示したローカルURLを開きます。ローカルD1とリモートD1は別のデータベースです。

### 6. 公開

```bash
wrangler deploy
```

デプロイ後、以下のURLで設定状態を確認できます。

```text
https://<デプロイ先>/api/health
```

`ok: true`、`mapillaryConfigured: true`、`databaseConfigured: true` になれば初期設定は完了です。

## 技術構成

- Frontend: HTML / CSS / JavaScript
- 地図: Leaflet 1.9.4、OpenStreetMapタイル
- Backend: Cloudflare Workers
- セッション/回答データ: Cloudflare D1
- 写真: Mapillary Graph API（画像URLから直接表示。画像ファイルは自前のサーバーにコピーしない）

## Mapillaryの出題範囲と候補抽出について

初版では、国内の都市周辺の候補座標から小さなbboxをランダムに選び、画像がある範囲を複数回検索します。Mapillaryの日本国内カバレッジは地域差が大きいため、初期版では画像が必ず取得できることを保証しません。取得に失敗した場合は画面にエラーを表示し、再試行できます。

公開運用前に、Mapillary Developer Terms / API usage limits / attribution requirementsを改めて確認してください。写真の利用条件はMapillaryのAPI利用条件と個々の画像のライセンスの両方に従います。

## 初版の既知の制約

1. 問題地域は日本の都市中心部周辺を中心とした候補地点から抽出しており、全国を均等に網羅していません。
2. 正解判定半径は初版では15 m固定です。位置精度の個体差を踏まえ、運用データを見て調整する必要があります。
3. APIから返る撮影者名が取得できない場合は「撮影者情報なし」と表示します。
4. セッション中の統計はブラウザー上だけで管理し、ユーザーアカウントや永続ランキングはありません。
5. 解説文、管理画面、投稿機能、位置密度を確認する問題審査画面は未実装です。
6. 問題の取得はMapillary APIの応答速度・制限・検索範囲に左右されます。

## Mapillaryのクレジット

回答後またはスキップ後に、出典画像へのリンク、取得できる場合は撮影者のリンク、CC BY-SA 4.0へのリンクを表示します。一般的なMapillaryロゴはフッターから常に公式サイトへリンクし、個別画像の出典・撮影者情報は回答またはスキップ後に表示します。ライセンス表記の例と条件はMapillaryの説明を参照してください。

- https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data
- https://www.mapillary.com/terms

## ライセンス

このリポジトリ内の独自コードは、特段の記載がない限りMIT Licenseとして扱える構成です。ただし、Mapillaryの写真・Mapillaryの商標・OpenStreetMapの地図タイルはそれぞれの提供元の条件に従います。このリポジトリのライセンスが外部データの権利を変更するものではありません。

## GitHubから自動デプロイ（ローカルPCを使わない運用）

1. このフォルダーの内容をGitHubリポジトリのルートにアップロードしてください（ZIPファイルそのものではなく、展開後のファイルとフォルダー）。
2. CloudflareでD1データベースを作成し、`schema.sql` のSQLをD1のConsoleで実行します。
3. `wrangler.toml` の `database_id` を実際のD1 IDに変更してコミットします。
4. GitHubリポジトリの **Settings → Secrets and variables → Actions** で、次のRepository secretsを追加します。
   - `CLOUDFLARE_API_TOKEN`: Workersをデプロイできる権限に絞ったCloudflare API Token
   - `CLOUDFLARE_ACCOUNT_ID`: CloudflareのAccount ID
   - `MAPILLARY_ACCESS_TOKEN`: MapillaryのAPI Client Token
5. GitHubの **Settings → Actions → General** で、Actionsが許可されていることを確認します。
6. `main` ブランチにコミットをpushすると、`.github/workflows/deploy.yml` が実行され、Cloudflare Workersへ自動デプロイします。手動実行は **Actions → Deploy to Cloudflare Workers → Run workflow** から行えます。

### GitHub Actionsで使う秘密情報について

- APIトークンをソースコード、`wrangler.toml`、READMEに書かないでください。
- `MAPILLARY_ACCESS_TOKEN` はCloudflare Worker側のSecretとして登録する必要もあります。初回デプロイ後、Cloudflare DashboardのWorker → Settings → Variables and Secretsで登録してください。GitHub SecretはGitHub Actionsのみに渡され、Cloudflare Workerの実行環境へ自動では引き継がれません。
- D1のスキーマは初回にCloudflare Dashboard → D1 → 対象DB → Consoleで `schema.sql` の内容を実行します。スキーマ変更時も、内容を確認してからSQLを適用してください。
- `database_id` は公開してもよい識別子ですが、APIトークンは秘密にしてください。

### ブラウザーだけで開発する方法

GitHubリポジトリの **Code → Codespaces → Create codespace on main** からブラウザー版VS Codeを開けます。編集したファイルをコミット・プッシュすると、GitHub Actionsがデプロイします。Codespacesの利用にはアカウントごとの利用枠・課金条件が適用されます。

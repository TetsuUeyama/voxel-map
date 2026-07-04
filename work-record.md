# 作業記録

## 2026-05-05
### プロジェクト現状確認
- `voxel-map` は Next.js 15 + Babylon.js 8 で初期化済みだが、`src/app/page.tsx` は未実装（"Voxel Map" のテキストのみ）
- `src/GamePlay/FightGame/Stage/` に StageBuilder / TerrainBuilder / TerrainObjectRegistry が既に存在
- `.vox` 資産は `C:\Users\user\developsecond\game-assets\field\` にあり、`/api/game-assets/[...path]` 経由で配信
- `fighting-game` / `battle-game` 共に `src/GamePlay/FightGame/Stage/` は未作成

### 計画策定
- `workPlan.md` 作成（Phase 1〜4）
- 4フェーズに分割: プレビュー UI → 描画最適化 → 共通化 → エディタ

### Phase 1 完了内容
- `src/components/VoxelMapViewer.tsx` 新規作成
  - Babylon Engine + ArcRotateCamera（マウス: ドラッグ=回転, ホイール=ズーム, 右ドラッグ=パン）
  - 既存 `buildStage()` を呼んでフィールドを描画
  - HUD: FPS / メッシュ数（active 含む） / アクティブ三角形数
- `src/app/page.tsx`: ビューアを表示するだけのシンプル構成
- `src/app/layout.tsx`: body の margin/padding をリセット、overflow:hidden で全画面化
- 確認結果: `npx tsc --noEmit` 通過、`next dev --turbopack` で `GET /` が HTTP 200。**ブラウザでの目視確認はユーザー側で実施が必要**

### Phase 1 で判明した残課題（Phase 2 で対応）
- TerrainBuilder が配置1個ごとに個別メッシュを生成 → 描画コール過多が予想される（HUD で確認）
- `createUnlitMaterial` がオブジェクトごとに別の ShaderMaterial を生成（重複登録）
- 同一 `.vox` の複数配置をインスタンシング化していない

### Phase 1.5 - terrain モード追加
- `STAGE_CONFIG.terrain: 'flat' | 'village' | 'park'` で切替（mutually exclusive）
- `flat` → 既存の平面 + 散布オブジェクト
- `village` → village/tiles の起伏付きタイル
- `park` → park の field + 手動配置の遊具

### village 起伏フィールド（参考実装）
- 既存資産調査: `village/tiles/tile_X_Y.vox` (16タイル, 各 201×201×143 voxel, 約 200K voxel/tile) は元から起伏を含む地形データ
- `src/GamePlay/FightGame/Stage/VillageTerrain.ts` 新規作成
  - `layout.json` 経由でタイルメタを取得
  - `voxelScale 0.05` で 4×4 タイル全体が 40×40 viewer 単位（既存フィールドと一致）
  - `buildVoxelObjectMesh` 再利用で exposed-face culling 適用
- `STAGE_CONFIG.village = { enabled, maxTiles, voxelScale }` を追加
- `StageBuilder` 修正:
  - `village.enabled` のとき平面地面・散布オブジェクトをスキップ
  - 戦闘エリアの `arenaFloor` とライト・ゾーンマーカーは保持
- 初回テストは `maxTiles: 1`（tile_0_0 のみ）
- 確認: tsc 通過、`/api/game-assets/field/village/layout.json` と `tile_0_0.vox` (828KB) が 200 応答

### park フィールド
- park は完全に平面（field tile が 2 voxel 高さ） — 高低差なし
- `ParkTerrain.ts` 新規作成
  - field 配置: `field_grass_001.vox` (中央 +X 寄り) と `field_water_002.vox` (左側) を `fieldScale 0.2` で配置
  - object 配置: bench×2 / picnic table / tennis / basketball / swings×2 / sand / bridge / line / park_tree×4 を `objectScale 0.05` で配置
  - 各メッシュは (x, z) 中心に配置、Y は field 上面 (groundY + 2 × fieldScale) に設置
- `STAGE_CONFIG.terrain = 'park'` に切替
- 確認: tsc 通過、各 park アセット (`field_grass_001.vox` 30KB, `obj_bench_011.vox` 27KB, `park_tree.vox` 15KB 等) が 200 応答
- 結果: サイズ感・配置が不適切（ユーザー報告）→ Phase 1.6 の voxelSize 統一案へ

### warehouse6.blend → voxel パイプライン
- 入力: `F:/MAP/uploads_files_2883707_warehouse6.blend` (140MB, 28メッシュ, 1.04M頂点, 31マテリアル, テクスチャなし)
- 倉庫サイズ: 17.32 × 31.32 × 5.09 m
- 新規スクリプト:
  - `scripts/warehouse-inspect.py` — Blender でメッシュ統計と全体寸法を確認
  - `scripts/warehouse-export.py` — 全メッシュを単一 OBJ + MTL でエクスポート (74MB OBJ)
  - `scripts/warehouse-export-colors.py` — Principled BSDF base_color を JSON 抽出（MTL の Kd は不正確なため）
  - `scripts/warehouse-to-vox.mjs` — OBJ + colors.json → VOX 変換 (voxelSize 0.20m, 内部充填なし)
- 出力: `game-assets/field/warehouse/warehouse6.vox` (355KB), `_meta.json`, `_colors.json`
- 結果: 88×158×27 voxel grid, 90,530 voxels, 19色パレット, 変換時間 2.0秒
- 設計: 1 viewer unit = 1 m に固定。.vox は voxelSize 0.20 で読み込み時にスケール適用 → 元の物理サイズで描画
- StageBuilder: `terrain: 'warehouse'` モード追加、`WarehouseTerrain.ts` でフィールド中央に配置
- 確認: tsc 通過、`warehouse6.vox` (363KB) と `_meta.json` が 200 応答

### voxelSize 半減 (0.20 → 0.10m) + チャンク分割対応
- 0.10m だと Y 軸が 315 voxel → VOX format 256 制限超過
- 解決: `warehouse-to-vox.mjs` に **自動チャンク分割** 機能追加
  - 256 を超える次元を割って複数 .vox に出力
  - マスター `_meta.json` に `chunks: [{ file, offset, grid }]` を記録
- 0.10m 再変換結果:
  - 全体 grid: 175 × 315 × 52 (Y軸のみ分割: 256 + 59)
  - 総 voxels: **422,724** (旧 90,530 比 4.7倍)
  - パレット: 19色（変わらず）
  - 出力: `warehouse6_chunk_0_0_0.vox` (1263KB) + `warehouse6_chunk_0_1_0.vox` (391KB)
  - 変換時間: 6.6 秒
- `WarehouseTerrain.ts`: meta.chunks をループしてチャンク毎に offset 計算 + 配置
- 確認: tsc 通過、両チャンクと meta が 200 応答 (1.3MB + 0.4MB + meta)

### voxelSize 更に半減 (0.10 → 0.05m)
- 全体 grid: **348 × 628 × 103** (X 2分割 + Y 3分割 = 6 チャンク)
- 総 voxels: **1,999,795** (0.10m の 4.7倍, 0.20m の 22倍)
- パレット: 19色（変わらず）
- 出力: 6 ファイル合計 約 7.8MB
  - chunk_0_0_0: 256×256×103 / 518K voxels / 2028KB
  - chunk_0_1_0: 256×256×103 / 572K voxels / 2237KB
  - chunk_0_2_0: 256×116×103 / 314K voxels / 1229KB
  - chunk_1_0_0: 92×256×103 / 199K voxels / 779KB
  - chunk_1_1_0: 92×256×103 / 250K voxels / 981KB
  - chunk_1_2_0: 92×116×103 / 144K voxels / 565KB
- 変換時間: 23.8 秒
- 確認: 全6チャンクと meta が 200 応答 (合計 約 8MB)

### ロード途中で表示が切れる問題 → 並列化対応
- ユーザー報告: 0.05m 化後、X+ と Y+ 方向で建物が途中で切れて見える
- 原因推定: チャンク逐次ロード中の中間状態を見ている可能性 (6チャンクを直列に download + mesh build → 完了まで数秒〜十数秒)
- 対応:
  - `WarehouseTerrain.ts`: 全チャンクを `Promise.all` で**並列ダウンロード** → 完了後に逐次 mesh 構築（メインスレッド単一）
  - `WarehouseProgress` 型を追加し、stage='meta'|'download'|'mesh'|'done' / done/total を通知
  - `StageBuilder` に `onWarehouseProgress` コールバック引数を追加
  - `VoxelMapViewer` の HUD で `Loading: download 4/6` のように進捗表示
  - 各チャンクで `console.log` 出力（DevTools で確認可能）
- 確認: tsc 通過、page 200

### 真の原因: meta.json のブラウザキャッシュ
- API ルート (`src/app/api/game-assets/[...path]/route.ts`) が `Cache-Control: public, max-age=3600` を返す
- `loadVoxFile` (vox-parser.ts) は URL に `?v=${Date.now()}` を付けキャッシュバスト
- だが `WarehouseTerrain` の `fetch(META_URL)` と `VillageTerrain` の `fetch(VILLAGE_LAYOUT_URL)` には**キャッシュバスターが無かった**
- 結果のシナリオ:
  1. 0.10m 化時: meta.json は 2 チャンク + voxel_size 0.10 でブラウザキャッシュされる
  2. 0.05m 化（同じファイル名で 6 チャンク + voxel_size 0.05 を出力）
  3. ブラウザは古い meta を 1 時間返し続ける → コードは 2 チャンクしか参照せず、X+/Y+ 側のチャンクが読まれない
- 同一ファイル名 `warehouse6_chunk_0_0_0.vox` 等が grid 175→256 voxel に変わっており、古い meta + 新しい chunk の組み合わせで scale ミスマッチも発生
- **修正**: `WarehouseTerrain` と `VillageTerrain` の meta/layout fetch にも `?v=${Date.now()}` を付加

### city.blend → 別ページ /city
- 入力: `C:/Users/user/Downloads/uploads_files_4731107_NEW+CİTY.1blend.blend` (95MB, 894 メッシュ, 547K頂点)
- bbox: 24.71 × 32.43 × 5.83 m, 275 マテリアル, 34 テクスチャ
- 新規スクリプト:
  - `scripts/city-inspect.py` — 構造調査
  - `scripts/city-export.py` — OBJ + MTL + colors.json 一括エクスポート (OBJ 42.9MB)
  - `scripts/city-to-vox.mjs` — voxelizer (warehouse の clone, paths 差替え)
- 出力: `game-assets/field/city/city_chunk_0_0_0.vox` + `city_chunk_0_1_0.vox` + `city_meta.json` + `city_colors.json`
- 結果: 0.10m で 249×326×60 grid, **344,719 voxels**, 84色, 2チャンク (Y軸分割), 変換 1.0秒
- アーキテクチャ整理:
  - `VoxelModelLoader.ts` 新設 — 汎用チャンクモデルローダー (meta + chunks + merge)
  - `WarehouseTerrain.ts` / `CityTerrain.ts` を thin wrapper に整理
  - `BuildStageOptions.terrain` で terrain mode 上書き可能
  - `VoxelMapViewer` が `terrain?: TerrainKind` prop を受け取る
- 新ページ: `src/app/city/page.tsx` → `<VoxelMapViewer terrain="city" />`
- 確認: tsc 通過、`/` (warehouse) と `/city` 両方 200, city チャンク全 200
- ハード再読み込みで両ページが正しく表示されること

### city voxelSize 半減 (0.10 → 0.05m)
- 全体 grid: **496 × 650 × 118** (X 2 + Y 3 + Z 1 = 6 チャンク)
- 総 voxels: **1,601,197** (0.10m の 4.6倍)
- パレット: 87色
- 出力: 6 ファイル合計 約 6.3MB
  - chunk_0_0_0: 256×256×118 / 260K voxels / 1019KB
  - chunk_0_1_0: 256×256×118 / 252K voxels / 987KB
  - chunk_0_2_0: 256×138×118 / 150K voxels / 586KB
  - chunk_1_0_0: 240×256×118 / 238K voxels / 931KB
  - chunk_1_1_0: 240×256×118 / 452K voxels / 1765KB (最大)
  - chunk_1_2_0: 240×138×118 / 249K voxels / 973KB
- 変換時間: 4.6 秒
- 確認: 全 6 チャンクと meta が 200 応答 (合計約 6.4MB)

### city voxelSize さらに半減 (0.05 → 0.025m)
- 全体 grid: **990 × 1299 × 235**
- チャンク計画: X=4, Y=6, Z=1 = 24 チャンク予定 / 出力 **16 チャンク** (Y 後半 8 チャンクは voxel 無しでスキップ)
- 総 voxels: **6,931,702** (0.05m の 4.3倍, 0.10m の 20倍)
- パレット: 88色
- 出力: 16 ファイル合計 **約 26MB**
  - 最大 chunk: city_chunk_3_0_0 (963K voxels / 3.7MB)
  - 最小 chunk: city_chunk_0_1_0 (203K voxels / 0.8MB)
- 変換時間: 15.4 秒
- ブラウザでのロード予測: download 並列で速い (~5秒)、mesh 構築逐次で 16×~2秒 = 約 30秒、merge 5-10秒。**初回ロード合計 30〜45秒** 想定
- merged mesh は ~10M faces 想定、メモリ ~1.5GB 予想（PC のスペック次第）

### 最適化: Greedy Meshing
- ユーザー報告: 0.025m のロード/描画が重い
- `buildVoxelObjectMesh` を **greedy meshing** に置換 (TerrainBuilder.ts)
  - 同色隣接面を 1 つの矩形 quad に結合
  - Set<string> → Uint16Array 色インデックス grid (lookup 高速化)
  - 6 軸スイープでマスクから矩形を貪欲抽出
  - 期待効果: 平坦な壁/床は 50-100倍, 複雑な葉/装飾は 5-10倍の面数削減
- `VoxelModelLoader` 改善:
  - チャンク間で `await setTimeout(0)` で yield → UI/HUD 進捗更新が走る
  - 各チャンクの voxel 数 / tri 数 / vert 数をログ出力
  - 全チャンク合計の verts/tris をログ出力
- API は変更なし、既存の Park/Village/Warehouse/City すべてに自動適用
- 確認: tsc 通過、page 200

### city モデル不一致の調査と Y軸反転修正
- ユーザー報告: 「建物の中に木/車」「線路を中心線として上下反転」
- 原因究明:
  - 元 blend を Blender でレンダリング (`scripts/_renders/city_topdown.png` 等) → 元データは正常 (車・木は屋外)
  - OBJ 頂点座標と Blender world location は一致 (位置データは正しい)
  - 794 メッシュ全部 hide_render=False、collection instance/particle なし
  - 真因: `buildVoxelObjectMesh` の `viewer.z = -voxel.y` (RH→LH 変換) が前後反転を生む
    - 対称的な warehouse 等では気付かないが、city は非対称のため明確に出た
- 修正: `city-to-vox.mjs` の OBJ パース時に Y を反転 (`+p[2]` → `-(+p[2])`)
  - mesh-builder の `-voxel.y` と相殺 → Blender Y を viewer Z に正しくマップ
  - 局所修正 (city のみ) — warehouse/village/park は既存挙動維持
- 再 voxel 化: 6,864,258 voxels, 16 chunks, 12.1 秒
- 検証用スクリプト: `city-verify.py` (構造調査), `city-verify2.py` (visibility調査), `city-render.py` (元 blend 3角度レンダリング)

### voxelizer の bit-pack 制限バグ発覚と修正
- ユーザー報告: Y 反転後、片側半分が生成されていない
- 根本原因: `key = gx + gy * 1024 + gz * 1048576` (10bit per axis) の制限
  - 0.025m city は Y=1299 voxel → gy > 1023 の voxel が消失または別位置に重なる
  - 0.20m〜0.05m では grid 全軸 1024 未満で問題なし → 顕在化しなかった
  - 抽出側 `key & 1023` / `(key >> 10) & 1023` は **bitwise なので 32bit 制限**, 大きい key で破綻
- 修正: `STRIDE = 4096` のかけ算ベースに変更 (city-to-vox.mjs)
  - `key = gx + gy * 4096 + gz * 16777216` (16M ≒ 4096²)
  - 抽出は `gx = key % 4096; tmp = floor(key/4096); gy = tmp % 4096; gz = floor(tmp/4096)`
  - 4095×4095×... の grid まで対応 (将来 0.0125m で 2580×2598×466 までカバー)
- 再 voxel 化結果:
  - Voxels: **7,076,775** (前 6.86M、欠損していた **213K voxels** が復活)
  - Chunks: **24** (前 16) — Y 軸全 6 チャンクが正しく出力
  - 各 cy=4, cy=5 のチャンクが新たに生成 (2,535〜377,253 voxels)
- 確認: city 200, meta 24 チャンク反映

## 2026-05-09
### Cafe.fbx → voxel パイプライン (/cafe ページ)
- 入力: `C:/Users/user/Downloads/uploads_files_6212131_Cafe/Cafe.fbx` (3ds Max 由来, 11.3MB)
- 同梱の `Cafe.obj` (25.9MB) と `Cafe.mtl` (3KB, Kd 直書き、テクスチャなし) は使わず、city/warehouse と同じ Blender 経由で OBJ + colors.json を生成
- 新規スクリプト:
  - `scripts/cafe-export.py` — Blender 5.0 で FBX をインポート → 全メッシュ単一 OBJ + Principled BSDF base_color の JSON
  - `scripts/cafe-to-vox.mjs` — OBJ + colors.json → 自動チャンク分割 .vox + meta.json (city-to-vox の clone, NAME='cafe', STRIDE=4096)
- Blender 出力結果:
  - 452 メッシュ / 29 マテリアル / OBJ 13.04 MB
  - **bbox: 88.93 × 93.06 × 14.72 m** (city 24×32×6m の約 4 倍 — 巨大な周辺地面プレーンを含む可能性高)
  - FBX に埋め込みテクスチャ参照あり (Map #0/1/2) → ファイルパス無しで警告 (色は Principled BSDF base_color から取得しているので影響なし)
- voxelize 結果 (voxelSize 0.05m):
  - 全体 grid: 1780 × 1863 × 279
  - 総 voxels: **8,244,085** (city 0.025m と同等の巨大さ)
  - パレット: 22 色 (city 88色 比でかなり少ない — 単純なマテリアル構成)
  - チャンク: **57 個** (X=7 × Y=8 × Z=2)
  - 出力サイズ合計: 約 30 MB
  - 変換時間: 30.6 秒
  - エッジチャンク多数が均一 65,536 voxels (256²) → 全体に薄い地面プレーンが敷かれている兆候
- 新規ファイル:
  - `src/GamePlay/FightGame/Stage/CafeTerrain.ts` — `loadChunkedVoxelModel` の thin wrapper (warehouse/city と同形)
  - `src/app/cafe/page.tsx` — `<VoxelMapViewer terrain="cafe" />`
- 既存ファイル変更:
  - `src/GamePlay/FightGame/Config/FighterConfig.ts` — `TerrainKind` に `'cafe'` 追加
  - `src/GamePlay/FightGame/Stage/StageBuilder.ts` — `terrain === 'cafe'` の分岐を追加
  - `workPlan.md` — Phase 1.7 として記録
- 確認: `npx tsc --noEmit` 通過、dev server 起動後 `/cafe` (200) / `cafe_meta.json` (200) / `cafe_chunk_3_2_0.vox` (200) / `cafe_chunk_0_0_0.vox` (200) すべて応答
- **要ブラウザ確認**: 57 チャンク・8.2M voxels はかなり重い見込み (city 0.025m の 16 チャンク・7M に近い規模)。マージ後のメッシュサイズ次第で voxelSize 粗化 (0.10m) や地面プレーン除去の検討が必要

### city: 一番南側のビル (z.002) を更地化 — バックアップ＆復元手順
- 要望: 戻せる状態を確保しつつ最南端のビルをオフにできるか確認
- 方針: フロント側は触らず、ソース OBJ から該当オブジェクトを除外して再 voxel 化
- バックアップ: `C:/Users/user/developsecond/game-assets/field/city/` を `field/city_backup_20260509/` に丸ごとコピー (28 ファイル / 70.03 MB)
- 南端候補特定: `scripts/city-find-south.mjs` を新規作成
  - OBJ の `o` グループごとに bbox を計算、Blender Y 中心が小さい (= 南) かつ高さ ≥ 1.5m を抽出
  - 結果: `z.002` (中心 Y=-22.30, 平面 ~3×4m, 高さ 2.25m) が「最南端の単体ビル」
  - 補足: より南に Plane.112 があるが 1×1m 未満で看板/小物と判断し除外
- 再 voxel 化: `scripts/city-revoxelize-excluding.mjs` を新規作成 (city-to-vox.mjs ベース)
  - OBJ パース時に `o` 名トラッキングを追加し、引数の除外名と一致するグループの face を捨てる
  - 全頂点はそのまま読み込むので bbox / 全体 grid (990×1299×235) は変化せず、チャンク座標が一致 → フロント変更不要
  - 実行: `node scripts/city-revoxelize-excluding.mjs 0.025 z.002`
  - 結果: 18,956 faces 除外、voxels 7,076,775 → **7,008,778** (差 ~68K), 18.8 秒, 24 チャンク (元と同レイアウト)
  - 影響チャンク: `city_chunk_3_4_0.vox` 993KB → 705KB (z.002 は cy=4 cx=3 に収まる)
  - meta に `excluded_objects: ["z.002"]` を追加記録
- 確認: tsc 通過 (フロント無変更)、`/city` 200 / `city_meta.json` 200 / `city_chunk_3_4_0.vox` 200 すべて応答
- **復元コマンド** (戻したい場合):
  ```powershell
  # PowerShell
  Remove-Item 'C:\Users\user\developsecond\game-assets\field\city\*' -Force
  Copy-Item -Path 'C:\Users\user\developsecond\game-assets\field\city_backup_20260509\*' `
    -Destination 'C:\Users\user\developsecond\game-assets\field\city\' -Recurse
  ```
  もしくは元 .blend から再 voxel 化: `node scripts/city-to-vox.mjs 0.025`
- **結論**: バックアップ → 再 voxel 化(除外) → ブラウザ確認 → 復元の流れは安全に運用可能。任意の OBJ オブジェクト名を除外引数に追加するだけで他のビルや小物にも適用できる

### city: AB17 ビル1 (南端商業ビル) を更地化、z.002 を復元
- 前回 z.002 を非表示にしたが、ユーザー確認の結果 z.002 は「家」だった
- 新たな対象: 「z.002 の上の区画にあるビル3軒+ショップが並んでいる箇所の一番南のビル」
- 解析: `scripts/city-list-row.mjs` 新規作成 (パターン一致 'o' グループの bbox 一括出力)
  - AB17 系列を確認: `AB17_OBJ_02 / 07 / 12 / 13` の 4 部品 1 セットで 1 棟、3 セット (suffix なし / .001 / .002) が東側に縦に並ぶ商業ビル
  - 南端 = AB17 ビル1 = `AB17_OBJ_02.001 / 07.001 / 12.001 / 13.001` 4 部品 (Y center -8.4, X[15.88, 20.07], 高さ 5.85m)
- 候補ハイライト用に `scripts/city-highlight-candidate.mjs` 新規作成 (指定オブジェクト群を赤塗りで表示)
- 高解像度トップダウンレンダーも追加: `scripts/city-render-topdown-hires.py` (1600×1600)
  - blend を引数指定して `blender --background <blend> --python ...` で実行
  - 注釈用: `scripts/city-annotate-topdown.mjs` (高さ ≥ 1.5m の bbox+名前を SVG オーバーレイ、sharp で合成)
- 再 voxel 化: `node scripts/city-revoxelize-excluding.mjs 0.025 AB17_OBJ_02.001 AB17_OBJ_07.001 AB17_OBJ_12.001 AB17_OBJ_13.001`
  - z.002 は除外リストから外したので自動復元
  - voxels 7,076,775 → **6,538,442** (-538K, AB17 ビル1 のサイズ感に合致)
  - 主な影響: `city_chunk_3_2_0.vox` 642K → 142K voxels (-500K, 該当ビルがこのチャンクに収まる)
  - `city_chunk_3_4_0.vox` 180K → 248K voxels (z.002 復元分)
- 確認: `/city` 200 / 関連チャンク全て 200
- 復元コマンドは前回と同じ (`city_backup_20260509/` から戻すか `node scripts/city-to-vox.mjs 0.025` で素 city を再生成)

### 更地区画に Cafe ボクセルをオーバーレイ配置
- 要望: city の更地化した区画 (旧 AB17 ビル1) に /cafe で作成したボクセルを置く、床は不要
- Cafe 床調査 (`scripts/cafe-find-floor.mjs` 新規):
  - 床メッシュ = `Plane011` 1 つだけ (88.9×93.1m, Z=0, 100% カバレッジ, わずか 2 face)
  - 建物本体 bbox (床抜き): X 47.76m × Y 60.98m × Z 13.86m
- Cafe 再 voxel 化 (`scripts/cafe-revoxelize-excluding.mjs` 新規, city-revoxelize の cafe 版):
  - 使われた頂点だけから bbox を再計算するので、床除外で bbox がタイトに縮む
  - 実行: `node scripts/cafe-revoxelize-excluding.mjs 0.05 Plane011`
  - 結果: voxels **8,244,085 → 4,890,925** (-3.35M, -40%)、grid 1780×1863×279 → **957×1221×279**、チャンク 57 → **21**
  - palette 22 色は変わらず
- フロント実装 (`src/GamePlay/FightGame/Stage/CityTerrain.ts` 改修):
  - `loadChunkedVoxelModel` で cafe を別マテリアル (`cafeOverlay`) で 2 回目ロード
  - 戻り値の merged mesh に `scaling.setAll(0.074)` + `position(9.54, groundY, 1.93)`
    - 区画中心: viewer X = 9.54 / Z = 1.93 (= 旧 AB17 ビル1 の中心)
    - スケール 0.074 で cafe 47.76×60.98×13.86m → 約 3.53×4.51×1.03m (区画 4.2×4.5m に収まる)
  - cafe ロード時の onProgress は city と被るので渡さない
- 確認: tsc 通過、`/city` (200) / `/cafe` (200, 床抜きの新版) / cafe_meta + cafe_chunk_0_0_0 (200)
- 副作用: `/cafe` ページも床なし版になる (ユーザー要件「床部分は不要」に合致)
- バックアップ: 元 cafe (床あり) を保存していないため、必要なら `node scripts/cafe-to-vox.mjs 0.05` (cafe-to-vox.mjs の元のフルバージョン) で再生成可能 — ただし cafe-to-vox.mjs は前バージョンと同じく Plane011 を含むのでそのまま戻る

### city 東側に床拡張 (5.11m, N-S 全幅)
- 要望: 「町の面積を増やしたい。床を東に増やしたい。SE の家4件 (z.001/002/003/019) の真ん中の縦道路までの距離を E 方向に追加」
- 解析: `scripts/city-mark-east-extension.mjs` で候補をトップダウンに重畳して可視化
  - SE 4 家 bbox 全体: Blender X[11.34, 20.02] / Y[-24.38, -15.78]
  - 候補A (縦の中央道路, z.001/019 と z.002/003 の間): Blender X = 15.68
  - 候補B (横の中央道路): Blender Y = -20.03
  - 現 city 東端 Blender X = 20.79 (= viewer X 12.355)
- ユーザー選択: 候補A をミラー → 拡張量 +5.11m (= 20.79 - 15.68)、新東端 X=25.90 (viewer X=17.465)
- 実装: `CityTerrain.ts` に `createEastFloorExtension(scene)` 追加
  - `MeshBuilder.CreateGround` で viewer X[12.355, 17.465] × Z[-16.215, 16.215] (city Z 全幅) の平面
  - 高さ y = 0.215 (city 道路上面 Plane.031 と同じ)
  - 道路色 `Color3(0.42, 0.42, 0.46)` の StandardMaterial
- 確認: tsc 通過

### city 東床拡張の整合修正
- ユーザー報告: 追加した地面が city とつながっていない、N-S の直線距離が city と異なる
- 原因 3 件:
  - **Y 不一致**: city road top face は voxel 量子化で **y=0.225** (Plane.031 が voxel gz=8 を占め、上面 = 9*0.025=0.225)。当初 0.215 だったため 0.01m の段差
  - **N-S 長不足**: city grid Z extent は **±16.2375 (32.475m)** だが ±16.215 (32.43m) と 0.045m 短く設定
  - **X 接続位置**: city grid 東端は viewer **X = 12.375** (= cx = 990*0.025/2) だが 12.355 (bbox 東端) と 0.02m ずれ
- 修正:
  - `FLOOR_Y` 0.215 → **0.225**
  - `Z_MIN/MAX` ±16.215 → **±16.2375** (city grid 完全一致)
  - `X_MIN` 12.355 → **12.350** (`cx - 0.025`、1 voxel 分 city と重ねて hairline seam 回避)
  - `X_MAX` 17.465 → **17.485** (cx + 5.11)
  - StandardMaterial に `backFaceCulling = false` 追加 (下から覗いた時の貫通防止)

### city 東床拡張: 道路スラブとして 3D 化 + 正確 bbox 合わせ
- ユーザー再報告: ずれ・高さ・厚み・サイズが本来の地面と違う
- `scripts/city-find-road-exact.mjs` 新規 — Plane.031 / TABAN 等の voxel-quantized bbox を抽出
  - **Plane.031 (道路面)**: viewer X[-11.286, **12.301**] / Z[**-16.191, 16.115**] / Y[0.125, 0.225]
  - **TABAN (基礎)**: viewer X[-12.375, **12.301**] / Z[-15.851, 16.109] / Y[**0.075**, 0.200]
  - 合体スラブ: top=0.225 / bottom=0.075 / 厚み **0.150m**
  - 東端の真値 = viewer X **12.301** (= grid 12.375 より 0.074m 内側 / 空きエッジあり)
  - Z 範囲は **非対称** [-16.191, 16.115] (中心 Z=-0.038)
- 修正 (CityTerrain.ts):
  - `MeshBuilder.CreateGround` → **`CreateBox`** (3D スラブ化)
  - `width=5.11, height=0.150, depth=32.306`
  - 中心位置 (14.856, 0.150, -0.038)
  - X_MIN 12.350 → **12.301** (Plane.031 の実東端)
  - Z [-16.2375, 16.2375] → **[-16.191, 16.115]** (Plane.031 の実 N-S)
  - Y [0.215〜0.225 の薄板] → **[0.075, 0.225]** (TABAN底〜Plane.031上面、厚み 0.150m)
  - `backFaceCulling=false` 削除 (Box は元から両面鎖閉)

### city 東床拡張 再々調整: 厚み薄く + N-S は grid 全幅
- ユーザー再々報告: 厚すぎる、長さも変わっていない
- 厚みの解釈訂正: city の見える道路スラブは Plane.031 + TABAN 全合体 (0.150m) ではなく、地表近くの 1〜2 voxel 層 (0.050m) のみが視認でき、TABAN 下部は周辺の grass / 建物で隠れている
- 長さの解釈訂正: ユーザーは city 全体 (grid 範囲 ±16.2375 = 32.475m) と比較していた。Plane.031 の voxel-aligned 範囲 32.306m では足りない
- X 接続点訂正: Plane.031 の最東 voxel (gx=987) の東面は viewer X = **12.325** (= 988*0.025 - 12.375)。前回の 12.301 はその voxel 内側で 0.024m 重複していた
- 修正:
  - 厚み 0.150m → **0.050m** (Y 0.175〜0.225)
  - Z 範囲 [-16.191, 16.115] → **±16.2375** (city grid 全幅 = 32.475m)
  - X_MIN 12.301 → **12.325** (Plane.031 最東 voxel 東面、no overlap)
  - X_MAX 17.411 → **17.435** (= 12.325 + 5.11)

### city 東床拡張 さらに調整: N-S を 4 家範囲だけ + 高さ 0.275 にリフト
- ユーザー再々々報告: 厚みは合った、高さがまだ低い (床が沈んで見える)、地面のサイズが変わっていない
- ユーザー意図確認:
  - **N-S 範囲**: city 全幅ではなく **4 家のN-S範囲だけ** (~8.6m, viewer Z[-14.087, -5.487])
  - **Y_TOP**: city 道路より低く沈んで見える → **0.275** に上げる (AB17_OBJ_13 系の slab top と同じ層)
- 修正:
  - Z 範囲 ±16.2375 (32.475m) → **viewer Z[-14.087, -5.487]** (8.6m, 4 家ブロックと同じ)
  - Y_BOTTOM 0.175 → **0.225** / Y_TOP 0.225 → **0.275** (厚み 0.050m は維持)
  - X_MIN/MAX は 12.325〜17.435 維持 (5.11m E 拡張)

### city 東床拡張: 意図変更 — city 全体を正方形に揃える
- ユーザー意図訂正: 4 SE 家ブロックの拡張ではなく、**city 全体を正方形にするための地面拡張**
- city voxel grid 24.75m × 32.475m → **正方形 32.475m × 32.475m** に揃える東拡張
- 拡張幅: 32.475 - 24.75 = **7.725m**
- 修正:
  - X_MAX: 17.435 → **20.10** (= -12.375 + 32.475 で正方形成立)
  - X_MIN: 12.325 維持 (Plane.031 最東 voxel 東面)
  - Z 範囲: 4 家範囲 [-14.087, -5.487] → **±16.2375** (city grid 全幅)
  - Y / 厚みは 0.225〜0.275 / 0.050m を維持

### city 東床拡張: 解釈リセット — voxelスタイル + 正方形 + 高さ完全一致
- ユーザー指示確定: voxelスタイル(city と同じ)、city + 拡張で 32.475m × 32.475m 正方形、高さは city 道路面と完全一致
- city 道路色を実データから特定: `Plane.031` → `Material.031` → 色 **(0.8, 0.8, 0.8)** (light gray)。私はずっと暗すぎる (0.42, 0.42, 0.46) を使っていた
- city loader と同じ unlit shader (`createUnlitMaterial`) を使うよう変更
- 修正:
  - マテリアル: `StandardMaterial` (lit, グレー) → **`createUnlitMaterial`** (unlit, vertex color)
  - 頂点色: (0.8, 0.8, 0.8) ← Plane.031 voxel と完全同色
  - Y_TOP: 0.275 → **0.225** (Plane.031 voxel 上面と完全一致)
  - Y_BOTTOM: 0.225 → **0.175** (厚み 0.050m = 2 voxel 層維持)
  - X_MAX: 17.435 → **20.10** (= -12.375 + 32.475 = 正方形成立)
  - Z 範囲: 4 家範囲 → **±16.2375** (city grid 全幅)

### Cafe オーバーレイ調整: スケール拡大 + 道路面リフト
- ユーザー報告: 高さが低い (1.03m) / 床にめり込む
- 原因 1 (低い): 当初スケール 0.074 では cafe 高さが 1.03m しかない
- 原因 2 (めり込み): city の地面/道路面が world y = 0 ではなく **0.215 (Plane.031 の上面)** にあるため、cafe を y=0 で置くと city 道路下に潜る
- 調査スクリプト: `scripts/city-find-ground.mjs` 新規 (lot bbox に重なる薄い flat メッシュを抽出)
  - 地面候補 lot 周辺: TABAN (y=0.186, 788.6m²) / Plane.031 (y=0.215, 762m²) → 道路上面 = 0.215
- 対応:
  - スケール 0.074 → **0.15** (ユーザー選択)。cafe フットプリント 7.2×9.2m (区画 4.2×4.5m を少しはみ出す)、高さ 2.08m
  - Y オフセット 0 → **0.19** (= 0.215 - 0.0225, cafe の本来の地面 (Blender Z=0) を city 道路上面に揃える)
  - cafe の本来床下にあった部品 (Blender Z=-0.15〜0, scale 後 0.0225m 厚) は city 道路に埋没して見えなくなる
- 確認: tsc 通過 (フロント `CityTerrain.ts` のみ修正)

### city ページに東西南北ラベル追加
- 要望: city の方位を視認したい
- 採用: 3D シーン内ラベル方式 / `+Z = 北` (viewer 空間)
- 実装: `CityTerrain.ts` に `createCompassLabels` を追加
  - `DynamicTexture` (256×256) に `drawText` で黒縁＋色文字を描画 (N は赤、S/E/W は白)
  - `MeshBuilder.CreatePlane` (4×4m) に貼り、`billboardMode = BILLBOARDMODE_ALL` で常にカメラ正対
  - 配置半径 22m (city bbox ~25×33m の外側), 高さ groundY+3m
  - city ページのみ反映 (warehouse 等は変更なし)
- 確認: tsc 通過, `/city` 200 応答
- 注意: Babylon の `ICanvasRenderingContext` には `textAlign/textBaseline` が型定義されていないため、`tex.drawText(text, null, null, ...)` で自動センタリングを利用

### テクスチャ未同梱問題の調査
- 「細部が抜けている」報告を受け配布物を確認
- `Cafe.mtl` 内に `map_Kd Map__0_Checker.tga` が 1 件存在するが、画像本体は同梱されていない (Downloads 配下にも無し)
- `Cafe.fbx` の Properties70 に `Map #0/1/2` (3ds Max プロシージャル Checker と推定) があるがファイルパス空 → Blender が "could not find any file path" 警告
- 結論: 元 3ds Max シーンには UV テクスチャ付きマテリアルがあったが、配布されていない。テクスチャ復元は不能
- 対応: ユーザー判断によりマテリアル別のフラット色 (Principled BSDF base_color, 22 色) のままで進行

## 2026-05-13
### city: 主要建物を個別パーツ化してオンオフ可能に
- 要望: cityの各建物を別パーツとしてMAP上に配置してオンオフできるようにしたい
- 方針確定 (ユーザー選択):
  - 粒度: 主要建物だけ手動選定 (複数 'o' を 1 棟にグループ化, 約 20-40 部品)
  - 方式: 事前に建物ごとの .vox を作りランタイムで `mesh.setEnabled` 切替
  - UI: `/city` ページのサイドパネル
- 新規ファイル:
  - `scripts/city-buildings-catalog.json` — 9 棟のカタログ (AB17 北/中/南、中央キオスク、SE 住宅 4 軒、西側建物)
  - `scripts/city-build-toggleable.mjs` — 1 パスで base + 各建物を別バケットにvoxelize
    - city.obj 全頂点から global bbox を計算 → どのバケットも同じワールド座標系
    - 各 face は所属する 'o' 名から bucket (base / 建物ID) を引いて、その bucket の voxelMap に書き込み
    - palette は全バケット共通 (各建物の色が base と完全一致)
    - 出力: `field/city/city_meta.json` + base chunks, `field/city/buildings/<id>/*.vox` + `<id>_meta.json`, `field/city/buildings_manifest.json`
  - `src/components/CityBuildingsPanel.tsx` — 右サイドパネル UI
    - カテゴリ別 (商業/住宅/キオスク/オーバーレイ) 折り畳み一覧
    - 全 ON / 全 OFF ボタン、各建物のチェックボックス
    - 折りたたみボタンで非表示も可
- 既存ファイル変更:
  - `src/GamePlay/FightGame/Stage/CityTerrain.ts` — `buildCityTerrain` の戻り値を `{meshes, buildings}` に変更
    - manifest を fetch → 各建物を `loadChunkedVoxelModel` で個別 merged mesh としてロード
    - `DEFAULT_DISABLED = {'ab17_south'}` (Cafe オーバーレイ区画なので default OFF)
    - Cafe オーバーレイも `cafe` ID として buildings に追加 (UI で切替可能)
  - `src/GamePlay/FightGame/Stage/StageBuilder.ts` — `StageElements.cityBuildings` 追加
  - `src/components/VoxelMapViewer.tsx` — `cityBuildings` state + `<CityBuildingsPanel/>` 表示
- voxelize 実行結果:
  - 全 1,170,770 triangles を 10 バケットに振り分け (base 887K + 建物計 283K faces)
  - 総 voxels 7,300,030 (元 7,076,775 比 +223K) — 境界面で base/building 両方に書かれる voxels (重複あり、視覚的には問題なし)
  - base: 4,591,710 voxels / 24 chunks
  - 各建物: 72K-580K voxels / 1-5 chunks (`AB17 系=570K、中央キオスク=261K、住宅=72-78K、西側=424K`)
  - 変換時間 22.9 秒
- 動作確認:
  - `npx tsc --noEmit` 通過
  - dev server で `/city` (200)、`buildings_manifest.json` (200)、全 9 棟の meta (200) 確認済み
  - 個別 chunk (例: `ab17_north_chunk_3_0_0.vox`) も 200 応答
- ブラウザ目視確認は未実施 (ユーザー側で確認が必要)

### city: カタログ修正 — キオスク柱追加 + 西側建物を 2 棟に分割
- ユーザー報告:
  - 中央キオスクの柱などが同じ建物と認識されていない
  - 西側建物は実は別の 2 棟だった (1 つにまとめてしまっていた)
- 対応 (`scripts/city-buildings-catalog.json` 更新):
  - **kiosk_center に 13 部品追加**: Cube.001/.002/.003/.004/.005/.006/.007/.009/.012/.013 (10 本の柱, h=2.16-2.50m), Cube.043 (h=0.71m カウンター), Plane.002/.047 (両側のディスプレイ壁)
  - **west_building を west_south / west_north に分割**:
    - `west_south`: Plane.107 (cx=3.70, cy=-19.85, 大きい南建物)
    - `west_north`: Cube.153 / Cube.154 / Cube.155 / Cube.156 (cx=0.21, cy=-13.38 周辺の小さい北建物)
- スクリプト改善: `city-build-toggleable.mjs` に **孤立 building ディレクトリの自動削除** を追加 — カタログにない `buildings/<id>/` を実行前にクリーンアップ (リネーム/分割で残骸が出るのを防止)
- 再 voxelize 結果:
  - 総 voxels 7,299,112 (前 7,300,030 とほぼ同じ)
  - kiosk_center: 261K → 336K voxels (+75K, 柱が反映)
  - west_south: 380K voxels, west_north: 50K voxels (合計 430K, 元 west_building 424K と整合)
  - buildings ディレクトリから古い `west_building/` を削除済み
- tsc 通過 (フロント無変更, JSON とスクリプトのみ)

### city: カタログ追補 — キオスク柵/内部、西北の屋根/床/看板
- ユーザー報告:
  - キオスクの**柱の根元の柵**と**中のパーツ**が認識されていない
  - 西側建物(北)の**屋根の上の部品**が残る
- 調査: cz (Y軸) も含めた全パーツリストで再点検 → 多数の小さい付帯物を発見
- kiosk_center に **45 部品追加**:
  - 内部テーブル/カウンター: `Cube.008`, `Cube.010` (cz≈1.33, 0.67×1.12-1.26×0.15)
  - 東側ロングレール: `Cube.014` (5.15m 長)
  - 周囲の柵セグメント 32 個: `Cube.015`〜`Cube.036`, `Cube.064`〜`Cube.073` (cz=0.24, 0.14×0.53 タイプ)
  - 庇の縁 8 個: `Plane.022`〜`Plane.029` (cz=1.34, 0.19×0.13×0.12)
  - 装飾: `Circle`
- west_north に **6 部品追加**:
  - 屋根の上: `Plane.127`, `Plane.128`, `Plane.138` (cz=1.58)
  - 床/プラザ: `Plane.143`, `Plane.153`
  - 看板: `mcdonalds.001` (cz=1.37)
- 再 voxelize:
  - kiosk_center: 336K → 357K voxels (+21K)
  - west_north: 50K → 58K voxels (+8K)
- 学び: 単一の `o` 名前ではなく **同じ XY フットプリント内の全パーツを cz 含めて点検** すべき。次回は cz を含む 3D 範囲で自動グループ化する方が安全

### city: 追加で 3 棟 — キオスク南隣 2 件 + 線路東のアーケード
- ユーザー報告: 「キオスクの隣に 2 つ、線路を挟んで逆サイドに 1 つ建物がある」
- 調査: 全 `o` の bbox を XY 範囲で照合する一括抽出スクリプトで特定
  - キオスク南西 (`Cube.254` 中心) — Cube.254 + 周辺の小さな posts/seats 53 部品
  - キオスク南東 (`Cube.080` 中心) — Cube.080 + 屋根 `Cube.079` + 4 つの壁/角 + 床 plane で計 10 部品
  - 線路東 (`Cube.096` 中心) — 16m 長アーケード市場、内部に多数の chair/display 含み **293 部品** (Cube.096/132/137 + Plane.139/011 + 各種小物)
- 追加した建物 3 棟:
  - `kiosk_south_west`: 49,134 voxels, 1 chunk
  - `kiosk_south_east`: 94,086 voxels, 1 chunk
  - `east_arcade`: 548,647 voxels, 6 chunks (city 内最大級)
- 結果: 合計 **12 建物 + Cafe = 13 トグル** に
- 抽出時の除外パターン: `^(car|wheel_fr|Tree_|Bush_|Cylinder|z\.047|TABAN|Plane\.031)` および lamp post (Cube.087/088/090/093/094/159) — これらは「base」扱いを維持

### city: east_arcade と west_south のパネル残り解消
- ユーザー報告: 「東側アーケードと西側建物(南)をオフにしてもパネルの残りがある」
- 原因: 初回 bbox 抽出で
  - east_arcade: 西端を cx=12.0 で切ったが、実際は cx=11.4 まで延びる (西側パネル列を取り損ねた)
  - west_south: Plane.107 1 件しか登録していなかった (周辺の display/chair 群を抜かしていた)
- 追加:
  - west_south +30 部品: Cube.135-152 / Cube.182-191 (display chairs), Plane.112/113/129-131/148-150 (signs), nike_logo_text
  - east_arcade +108 部品: 西側カラム Cube.246/247/249/301-323/344-358/384-407/426-447/470-473/490-516/520/548-549, パネル Plane.008/012/017/019/187-191/202-217/224-275, 装飾 Cylinder.029/030
- voxel 増分:
  - west_south: 380K → 383K (+3K)
  - east_arcade: 549K → 568K (+19K)
- Cylinder.029/030 はアーケード屋根の小さな装飾柱で、デフォルトの Cylinder 除外パターンに当たって落ちていたため明示的に追加 — 一律パターン除外より位置ベースで判断する方が安全

### city: Cafe オーバーレイを非表示化
- ユーザー要望: 「Cafe オーバーレイはもう表示しないようにしてください」
- `CityTerrain.ts` から cafe ロードコードを削除 (`loadChunkedVoxelModel(.../cafe...)` + scale/position + buildings.push)
- `DEFAULT_DISABLED` を空に変更 — cafe 区画を覆っていた制約がなくなったので `ab17_south` も default ON に戻す
- 建物トグル一覧: cafe エントリが消えて **12 棟** に
- `/cafe` ページ自体は別ルートで存続 (CafeTerrain は変更なし)
- tsc 通過、フロント挙動以外は無変更

### city: 東側拡張マップ (床) も削除
- ユーザー要望: 「E側にある拡張したマップも削除してください」
- `CityTerrain.ts` から `createEastFloorExtension` 関数と呼び出しを削除
- 未使用になった import (`VertexBuffer`, `createUnlitMaterial`) も削除
- city の voxel grid は元の 24.75m × 32.475m に戻る (拡張前)
- これまでの東床調整履歴 (5月初旬の複数回の高さ/長さ調整) は全て巻き戻り
- tsc 通過

### city: 木と街灯を共通パーツ化（thin instancing 対応）
- ユーザー要望: 「同じものを何度も作成・描写ではなく 1 つのモデルを描写するように」
- `city-buildings-catalog.json` に **`prototypes` セクション** 追加
  - 名前 prefix と幾何パターン (size + vertCount) のハイブリッド照合
  - `tree_spruce` (Tree_Spruce_tiny_01) / `bush_average` / `bush_big` / `streetlamp` (Cube 0.51×0.51×0.92 76 verts)
- `city-build-toggleable.mjs` 全面改修:
  - **2 パス構成** に変更: Pass1=グループ毎の bbox/頂点数を計算してプロトタイプ照合、Pass2=face を bucket に振り分けて voxelize
  - 各プロトタイプは **OBJ 順で最初の 1 つを canonical** に選定、他はオフセットだけ記録
  - canonical のみを通常のバケットとして voxelize、他のインスタンスは "skip" バケット → 完全に除外（重複描画を防止）
  - 旧 base の重複木/街灯/茂み voxels が消える
  - 出力: `field/city/prototypes/<id>/` + `prototypes_manifest.json`
    - manifest の `instances[].offset` は **viewer 空間** に変換済み (ΔviewerX=Δbx, ΔviewerY=Δbz, ΔviewerZ=-Δby)
  - 既存 building の o_groups に含まれるオブジェクトはプロトタイプ照合から除外（kiosk の Cube.038/040/042 は streetlamp 候補だが kiosk_center として保持）
- `CityTerrain.ts`:
  - prototypes_manifest を fetch → 各 proto を `loadChunkedVoxelModel` で 1 メッシュ取得
  - `Matrix.Translation(dx, dy, dz).copyToArray(buffer, i*16)` で 16-float 行列バッファを作成
  - `mesh.thinInstanceSetBuffer('matrix', buffer, 16, false)` で GPU インスタンス化
  - buildings 配列にも追加 → サイドパネルから「全ての木」「全ての街灯」等を一括 ON/OFF できる
- `CityBuildingsPanel.tsx`: カテゴリラベルに `vegetation`/`infrastructure` を追加
- voxelize 結果:
  - tree_spruce: 1 chunk, 2,083 voxels, **5 instances**
  - bush_average: 1 chunk, 382 voxels, **13 instances**
  - bush_big: 1 chunk, 912 voxels, **5 instances**
  - streetlamp: 1 chunk, 319 voxels, **18 instances** (kiosk 内 3 個は除外)
- 効果: 木 5 本分 + 茂み 18 個分 + 街灯 18 個分 = 41 インスタンスのジオメトリが 4 メッシュに圧縮。GPU 描画は drawn-call 4 で済む
- tsc 通過、全エンドポイント (manifest/meta/chunk) 200 確認
- サイドパネル合計: 12 棟 + 4 プロトタイプ = **16 トグル**
- 既存の `city-revoxelize-excluding.mjs` は残してある (後方互換) — 完全再生成したい場合は `node scripts/city-build-toggleable.mjs 0.025` で実行
- 復元: `city_backup_20260509/` に元データのフルバックアップあり

### 並列ロード + メッシュ統合（中間対応）
- ユーザー再報告: ロード待ってもなお縦横途中で建物が切れる
- 推定原因候補: 複数メッシュ間の frustum culling, 大きい position offset でのカリング判定不具合, または GPU リソース管理問題
- 対応:
  - **チャンクをマージして単一メッシュ化** — `Mesh.MergeMeshes(meshes, true, true)` (disposeSource=true, allow32BitsIndices=true)
  - 全チャンクで **共有 ShaderMaterial** を使用（マージのため）
  - 各チャンクの `bakeCurrentTransformIntoVertices()` で position を vertex data に焼き込み → マージ後も world layout 保持
  - `mesh.alwaysSelectAsActiveMesh = true` (frustum culling 完全バイパス) を `buildVoxelObjectMesh` 全体に適用
  - 各チャンクの bounding box, vertex count をコンソール出力
  - `WarehouseProgress` に 'merge' ステージ追加
- 確認: tsc 通過、page 200

## 2026-06-14
### NewCity エディタ: レイヤー切替（地面/建物）+ 配置後の回転
- ユーザー要望: ①「地面・道路」と「その上に建物」を置くかの UI 切替、②配置の前後どちらでも 90° 回転して向きを変えられるように
- 対象は `/newcity` の配置エディタ (`NewCityEditorViewer` → `NewCityEditor` controller + `NewCityEditorPanel`)。読み取り専用ビューア `buildNewCityTerrain` 経路は今回未使用 (到達ページなし) のまま。
- **レイヤー概念を導入** (`NewCityEditor.ts`):
  - `type Layer = 'ground' | 'building'` を追加。`layerOfCategory(category)` で振り分け (`GROUND_CATEGORIES = {'road'}`、他はすべて building)。変更が必要なら定数1か所で調整可能。
  - 旧 `cellOwner` (単一 Map) を **レイヤー別 `owners: Record<Layer, Map>`** に置換 → 建物を道路の上に置いても互いを evict しない (当たり判定が独立)。
  - `place()` に `layer` 引数追加、`PlacementInstance`/`Placement` に `layer` フィールド追加。インスタンスキーを `${layer}:${anchorKey}` にして同一 proto が両レイヤーで衝突しないよう防御。
  - `removeAt(i,j,layer)` / `disposeInstance` (inst.layer から正しい owner map を引く) / `clear()` を全レイヤー対応に。
  - Y オフセットは付けず各 proto のベイク済み Y を保持 (元シーンが ground=0 基準で建っている前提) — 道路と建物の高さは元データ依存。**要ブラウザ確認**。
- **配置後の回転** (`NewCityEditor.ts`):
  - `rotatePlacementAt(i,j,layer)` 追加 — クリックセルの owner を引き、同アンカー+同レイヤーで `rotation+1` を再 `place()`。place の overlap 評価が旧インスタンスを検出→破棄して新クローンを生成する流れを再利用。回転はアンカー(NW角)基準。
  - 配置前の回転は既存の R キー (place tool で有効) を維持。
- **UI** (`NewCityEditorPanel.tsx`):
  - レイヤートグル (🛣 地面・道路 / 🏢 建物) を追加。パーツ一覧を `layerOfCategory` で選択中レイヤーに絞り込み。
  - ツール選択を `eraseMode` ブール → **`Tool = 'place' | 'rotate' | 'erase'`** の3択セグメントに刷新。未使用だった `saveBarStyle` を削除し `segmentRowStyle`/`segmentButtonStyle` を追加。
- **ビューア** (`NewCityEditorViewer.tsx`):
  - state を `tool`/`layer` 化 (+ refs)。レイヤー切替で選択リセット、パーツ選択で自動的に place tool へ。
  - ポインタ処理を tool/layer で分岐 (右クリックは常に消去)。hover カーソルをツール別に色分け (place=黄/rotate=青/erase=赤)、footprint プレビューは place 時のみ選択 proto のサイズ。
  - ステータスバー文言を tool/layer 反映に更新。
- 確認: `npx tsc --noEmit` 通過。`eraseMode`/`cellOwner`/`saveBarStyle` の残存参照なし。**ブラウザ目視確認は未実施** (特に回転配置の着地位置と、道路/建物のレイヤー間の高さ整合)。
- 未対応 (前回からの持ち越し): レイアウト保存/読込 (`/api/layouts` はバックエンドのみ、UI 未接続)。`Placement.layer` は将来の保存に備えて追加済み。

### NewCity エディタ: 配置プレビューを実形状ゴースト化
- ユーザー報告: 配置時に黄色いハイライト箱だけで、置くタイル/建物の向きや形が分からない
- 対応 (`NewCityEditor.ts` にゴースト機能追加):
  - `updatePreview(id,i,j,rotation)` — canonical メッシュを clone した**半透明シルエット** (StandardMaterial 青系 alpha 0.55, 両面表示) を `place()` と同一トランスフォームでマウスセルに表示。実モデルの形状と向きが見える。
  - 再 clone は proto か rotation が変わったときだけ (`ghostKey = id:rotation`)、移動中は position 更新のみで軽量。
  - `hidePreview()` で非表示。ジオメトリは clone 共有なのでコスト小。
- `NewCityEditorViewer.tsx`:
  - place ツール+パーツ選択中のみ `updatePreview` を呼びゴースト表示。ゴースト表示時は黄色い箱を alpha 0.12 の薄い footprint アウトラインに落としてシルエットと競合させない。
  - rotate/erase ツールやグリッド外、非選択時は `hidePreview()`。
- 既知の小制約: R キーでの回転はマウス静止中だと次のポインタ移動までゴーストに反映されない (pointer observer 駆動のため)。
- 確認: `npx tsc --noEmit` 通過。**ブラウザ目視確認は未実施** (ゴーストの色・半透明・回転シルエットの見え方)。

### NewCity エディタ: 読込中ロック + 右クリック操作へ刷新（モードレス化）
- ユーザー報告: ①読み込み中でも小さいパーツが配置できてしまう ②ツール切替での回転がやりにくい
- ①読込ガード (`NewCityEditorViewer.tsx`): `readyRef`/`loadingRef` を追加し、`!ready` または `loadingId != null` の間はクリック操作(配置/回転/消去)を無視。ステータスバーにも「完了まで操作できません」と明記。
- ②操作体系をモードレス化（配置/回転/消去ツールを廃止）:
  - 左クリック: 空きセル=配置 / 配置物の上=そのパーツを 90° 回転（配置後回転）
  - 右クリック: 空きセル=これから置く向きを 90° 回転（ゴースト即更新）/ 配置物の上=消去
  - R キーも向き変更として残す
  - `NewCityEditor.ts` に `isOccupied(i,j,layer)` 追加（セル占有判定）。
  - `NewCityEditorPanel.tsx` から `Tool` 型・ツールボタン (place/rotate/erase) を削除。レイヤートグルと全消去は維持。操作説明を右/左クリックの内容に更新。
- ドラッグ暴発の修正: アクション発火を `POINTERDOWN` → **`POINTERTAP`** に変更。これで右ドラッグ=パン / 左ドラッグ=カメラ回転の開始時にアクションが暴発しない（押下即発火だった既存の問題も解消）。
- 確認: `npx tsc --noEmit` 通過。`tool`/`POINTERDOWN` 参照の残存なし。**ブラウザ目視確認は未実施**（特に右クリックタップが ArcRotateCamera のパン操作と両立して POINTERTAP が発火するか、読込ロックの体感）。

### NewCity エディタ: 芝生タイルを地面・道路レイヤーへ
- ユーザー要望: Grass_tile を地面・道路レイヤーに分類
- manifest 確認: 該当は `Natures_Grass_Tile` / `Natures_Grass_Tile_Small`（category=`nature`）。`Natures_Grass_Fence` / `Natures_Grass_Bar` は装飾なので建物側のまま。
- `layerOfCategory(category)` → `layerOfCategory(id, category)` に変更。`GROUND_IDS = {Natures_Grass_Tile, Natures_Grass_Tile_Small}` を category 判定より優先。
- `NewCityEditorPanel.tsx` の呼び出しを `layerOfCategory(p.id, p.category)` に更新。
- 確認: `npx tsc --noEmit` 通過。

### NewCity エディタ: 建物レイヤーのグリッドを 1/4 細分化
- ユーザー要望: 地面グリッドは現状維持、建物グリッドだけ 1/2・1/2 = 1/4 サイズにして細かい位置指定を可能に
- レイヤー別タイルサイズを導入 (`NewCityEditor.ts`):
  - `BUILDING_TILE_DIVISOR = 4` / `tileSizeForLayer(layer)` → ground=`TILE_SIZE_M`(≈4.92m), building=`TILE_SIZE_M/4`(≈1.23m)
  - owners マップはレイヤー別なので、各レイヤーが独立した (i,j) 整数グリッドを持てる (セル座標の衝突なし)
  - `cellsForSize(sizeM, tileM)` に tileM 引数追加。footprint をロード時固定セル数 (`sizeCellsBaseW/D`) ではなく **生メートル (`sizeMW/sizeMD`)** で保持し、配置レイヤーのタイルでオンデマンド計算に変更 (proto は分類により単一レイヤーだが汎用化)。
  - `getCellFootprint` / `place` / `updatePreview` に `layer` を渡してタイルサイズを反映。位置 = `(i + w/2) * tile - canonicalCenter`。
- ビューア (`NewCityEditorViewer.tsx`):
  - スナップ `i,j = floor(p / tile)` をレイヤー別タイルに変更。hover 箱は base=TILE_SIZE_M なので `scaleUnit = tile/TILE_SIZE_M` で縮小。
  - 建物レイヤー時のみ表示する **細グリッド (1/4 ピッチ)** を追加。coarse グリッドを正確に4分割。`useEffect([layer])` で表示切替。
- 確認: `npx tsc --noEmit` 通過。**ブラウザ目視確認は未実施** (建物の 1.23m スナップ・細グリッド表示・複数セル footprint の中心合わせ)。

### NewCity エディタ: 建物グリッド細分化をリバート
- ユーザー指摘: 意図が伝わっていなかったため、直前の「建物グリッド 1/4 細分化」を全て戻す
- `NewCityEditor.ts`: `BUILDING_TILE_DIVISOR`/`tileSizeForLayer` 削除、`cellsForSize(sizeM)` を単一引数に復帰、`ProtoState` を `sizeCellsBaseW/D` に戻す、`getCellFootprint`/`place`/`updatePreview` の `layer` 引数・tile 参照を撤去。
- `NewCityEditorViewer.tsx`: import・`fineGridRef`・細グリッド生成・`useEffect([layer])` トグル・hover の `scaleUnit`・スナップの tile 化を全て撤去し `TILE_SIZE_M` 基準に復帰。
- 地面・建物とも同一グリッド (TILE_SIZE_M ≈ 4.92m) に。grass タイル分類などそれ以前の変更は維持。
- 確認: `npx tsc --noEmit` 通過、関連シンボルの残存参照なし。
- ※グリッド粒度に関する正しい意図は次の指示待ち。

### NewCity エディタ: 建物は道路（地面タイル）の上にのみ配置可能に
- ユーザー指示（意図確定）: 道路は現状のまま。建物などは道路の上にしか配置できないように
- `NewCityEditor.ts`:
  - `hasGroundUnder(i,j,w,d)` 追加 — footprint の全セルが ground レイヤー（道路/grass）で覆われているか判定。
  - `place()` で `layer === 'building'` のとき `hasGroundUnder` が false なら配置を拒否（eviction/clone より前にリターン）。地面レイヤー（道路）は従来どおり自由配置。
- `NewCityEditorViewer.tsx`:
  - hover プレビュー時、建物レイヤーで足元に地面が無いセルは `hasGroundUnder` で判定し hover を赤くして配置不可を表示。
  - ステータスバーに「（道路の上のみ・赤=不可）」を追記。
- 確認: `npx tsc --noEmit` 通過。**ブラウザ目視確認は未実施**（道路の上だけ建物が置けるか、赤ハイライトの挙動）。
- 補足: grass タイルは ground レイヤーに分類済みのため、grass の上にも建物可。道路のみに限定したい場合は `hasGroundUnder` を road 限定に変更可能（要指示）。

### NewCity エディタ: グリッド粒度の試行錯誤 → 最終: 道路4.92m / 建物2.46m
- 経緯: 一度「全体を1/2(2.46m)に」実装 (TILE_SIZE_M=19.685/8) したが、ユーザー意図確認の結果 **道路・地面=4.92m / 建物=2.46m**（建物は道路の半分グリッド）に確定。AskUserQuestion で 3 択提示し「道路4.92 / 建物2.46」を選択。
- 実装（レイヤー別タイルを分割数2で導入）:
  - `NewCityEditor.ts`: `TILE_SIZE_M` を `19.685/4`(≈4.92m) に戻す。`BUILDING_TILE_DIVISOR = 2` / `tileSizeForLayer(layer)` 追加 → ground=4.92m, building=2.46m。
  - footprint をロード時固定セル数ではなく生メートル (`sizeMW/sizeMD`) で保持し、`cellsForSize(sizeM, tileM)` で配置レイヤーのタイルから都度計算。`getCellFootprint`/`place`/`updatePreview` に `layer` を渡す。
  - `hasGroundUnder`: 建物グリッドが地面より細かいので、建物セル (bi,bj) → 地面セル (floor(bi/R), floor(bj/R)) に変換して道路被覆を判定。
  - `NewCityEditorViewer.tsx`: `GRID_CELLS_RADIUS` を 60 に戻す。建物レイヤー時のみ表示する細グリッド (½ピッチ=2.46m) を追加し `useEffect([layer])` で切替。スナップ/hover/footprint をレイヤー別タイルに対応 (hover は `scaleUnit=tile/TILE_SIZE_M`)。
- 確認: `npx tsc --noEmit` 通過。**ブラウザ目視確認は未実施**（道路は4.92m・建物は2.46mでスナップするか、細グリッド表示、道路の上のみ判定がグリッド差をまたいで正しいか）。

### NewCity エディタ: グリッド細分化を全リバート（位置合わせ仕様が不可解との指摘）
- ユーザー指摘: 「配置方法の位置合わせが意味の分からない仕様になっている」→ 戻す
- 上記2エントリ（全体1/2、道路4.92/建物2.46 のレイヤー別グリッド）は全てコミット `caefdfc` 以降の未コミット変更だったため、`git restore --source=HEAD` で **`NewCityEditor.ts` と `NewCityEditorViewer.tsx` をコミット時点に復元**。
- 復元後の状態: 地面・建物とも単一 4.92m グリッド、レイヤー別タイル/細グリッド/全体1/2 は無し。「建物は道路の上のみ」制約 (`hasGroundUnder`、同一グリッド) は維持。modeless 操作・ゴーストプレビューも維持。
- 確認: `npx tsc --noEmit` 通過。
- ※グリッド粒度・位置合わせの正しい仕様は次の指示待ち（これまでの 1/4・全体1/2・レイヤー別 はいずれも不採用）。

### NewCity エディタ: 建物グリッドのみ縦横半分 + 枠を実物サイズに（混乱解消）
- ユーザー指示（確定・最小要件）: 道路・地面は現状(4.92m)のまま、建物などは縦横半分(≈2.46m)グリッド。それだけ。余計なことで分かりにくくしない
- 前回「枠が実物より広い」と指摘された点が混乱の原因 → 今回は**枠を実物に合わせる**ことで解消:
  - `NewCityEditor.ts`: `BUILDING_TILE_DIVISOR=2` / `tileSizeForLayer` 再導入（ground=4.92m, building=2.46m）。footprint は生メートル(`sizeMW/sizeMD`)保持で `cellsForSize(sizeM,tileM)` 都度計算。`getCellFootprint`/`place`/`updatePreview` に layer。`hasGroundUnder` は建物セル→地面セル(`floor(/R)`)変換で道路被覆判定。
  - **`getModelMeterSize(id,rotation)` 追加** — proto の実 bbox(メートル)を返す。
  - `NewCityEditorViewer.tsx`: 建物レイヤー時のみ半分グリッド線表示。配置プレビューの hover 枠を**予約セルではなくモデル実寸(メートル)**でスケール（道路は実寸=セル一致なので見た目不変、建物だけ枠が実物ぴったりに）。スナップ/位置はレイヤー別タイル。
- 確認: `npx tsc --noEmit` 通過。**ブラウザ目視確認は未実施**（建物が2.46m刻みでスナップ・枠が実物大か、道路は従来通りか、道路の上のみ判定）。
- → ユーザーより「同じことをしている」と再度不採用。`git restore --source=HEAD` で `NewCityEditor.ts`/`NewCityEditorViewer.tsx` を再度コミット時点（単一 4.92m グリッド）に戻した。建物グリッド半分の件は**保留**（要件の取り違えが続いており、次回は実装前に実機挙動を確認するか、ユーザーの具体イメージを得てから着手する）。

### /city ページ: キャラクターを歩かせる三人称ウォークモード（VoxelMapViewer）
- ユーザー要望: `Downloads/walk-3d-map.html`（Babylon一人称街歩き）参照で、/cityの街を「歩ける」ように。続けて「実際にキャラクターを歩かせて、その視線に町を移す」＝見えるキャラ＋三人称追従カメラへ。
- `src/components/VoxelMapViewer.tsx` のみ変更（/cityはこのコンポーネント使用）:
  - `scene.collisionsEnabled=true` / `scene.gravity` を有効化。buildStage完了後、`result.meshes` の地面・建物に `checkCollisions=true`（thin-instanceのproto と compass板は除外）。
  - 可視アバター（capsule胴＋頭＋+Zバイザー＋腕）を空Meshルートに親子付け。ルートに ellipsoid/ellipsoidOffset で衝突。歩行中のみ表示。
  - チェイス用 `ArcRotateCamera`（`lockedTarget`=頭付近のTransformNode）。俯瞰オービットcamと右下ボタンで切替、Escで俯瞰復帰。
  - `onBeforeRenderObservable` で WASD/矢印移動。移動方向は `chaseCam.getDirection(Forward/Right)` を水平射影（利き手非依存）。`player.lookAt` で進行方向を向く（シーンは既定左手系=`useRightHandedSystem`未設定 → +Z前方・yawCor0で正）。Shiftダッシュ、簡易重力＋接地判定、腕振りアニメ。
- 確認: `npx tsc --noEmit` 通過。**ブラウザ目視確認は未実施**。要検証: ①スポーン位置(z=-12付近)が建物にめり込まないか ②ボクセル建物メッシュへの衝突判定のFPS影響 ③`lockedTarget`にTransformNodeを渡した追従挙動 ④初期alpha(-π/2)でキャラ背後から北向きになるか。

## 2026-06-25
### ウォークモード: 高架線路の上にワープするバグ修正
- ユーザー報告: 三人称で道路を歩いていると急に高架線路の上を歩いている
- 原因: `groundYAt(x,z)` が接地面レイを常に `groundLevel + 200`（=空の高所）から真下に撃ち、`pickWithRay` が最初に当たる面（=最上面）を返していた。高架線路はベース city メッシュの一部で `groundMeshes` に登録されているため、線路下の道路を歩くとレイが頭上の線路天面に先に当たり、その高い Y を返す。クランプ処理 `player.y <= gy → player.y = gy` が道路高(低) ≤ 線路天面(高) を満たし、無条件で線路の上へ持ち上げていた。
- 修正 (`VoxelMapViewer.tsx`):
  - `STEP_UP = 0.5`（world m）を追加。段差/縁石ノイズ(~0.1-0.2m)より上、高架線路(数m上)より十分下、という閾値。
  - `groundYAt(x, z, fromY?)` に始点 `fromY` 引数を追加。歩行中は `player.position.y + STEP_UP` を渡し、足元のすぐ上からレイを撃つ → 頭上の構造物（高架線路/橋）はレイ始点より上なので拾われない。レイ長も `fromY - groundLevel + 500` に調整。
  - スポーン時 (`enterWalk`) は従来通り高所からの既定値（最上面に着地）。
- 効果（理論上）: 線路の下の道路ではレイが道路天面だけを拾い、ワープしなくなる。段差/坂は STEP_UP 範囲で登坂可。線路の縁から外れた場合は gy が下の道路になり else 分岐で落下。
- 確認: `npx tsc --noEmit` 通過。**ブラウザ目視確認は未実施**（実際にワープが止まるか、坂/縁石の登坂感、線路へ意図的に上がるランプがある場合の挙動は要確認）。

## 2026-07-04
### NewCity エディタ: 建物レイヤーを 2.46m グリッドにスナップ（道路は 4.92m 据え置き）
- ユーザー要望: 道路の上に置く建物は、道路グリッドの縦横1/2（=各セルを2×2に分割）の細かいグリッドで配置したい
- 経緯注意: 同要件は過去2回（案B=占有マスを小マスでカウント / 案A=実寸枠+半グリッド）実装して両方却下・リバート済み。今回は「実装→実機で見て詰める」方針をユーザーが選択（案1）。座標系の不一致が過去の「位置が意味不明」の原因と推測し、スナップ/ゴースト/hover枠/着地/道路上判定を全て同一のレイヤー別タイル式に統一。
- `NewCityEditor.ts`:
  - `BUILDING_TILE_DIVISOR=2` / `tileForLayer(layer)`（ground=4.92m, building=2.46m）追加。
  - `ProtoState` を `sizeCellsBaseW/D`（固定セル）→ `sizeMW/sizeMD`（実寸メートル）保持に変更。`getCellFootprint`/`place`/`updatePreview` に `layer` 引数を渡し、配置レイヤーのタイルで footprint を都度算出。
  - `hasGroundUnder(i,j,w,d,layer)`: 建物セル→道路セル(`floor(cell/DIVISOR)`)へ変換して道路被覆を判定。
- `NewCityEditorViewer.tsx`: レイヤー別タイルでスナップ、hover枠は `scaleUnit=tile/TILE_SIZE_M` で縮小、建物レイヤー時のみ½ピッチ細グリッド表示（`useEffect([layer])` で切替）。
- 確認: `npx tsc --noEmit` 通過。dev server 3003 で `/newcity` 200。

### NewCity エディタ: footprint セル数を切り上げ→四捨五入に（1マスで済むのに4マス問題）
- ユーザー報告: 地面の上に置く物が、1マスで足りるのに4マス使う
- 原因: `cellsForSize` が「5%許容超で ceil」。2.46mタイルを少し超える小物（例 chair 2.61m 比1.06）が 2×2 に膨張。
- 修正: `cellsForSize(sizeM, tileM)` を `Math.max(1, Math.round(sizeM/tileM))`（四捨五入・最小1）に。chair/roof_prop/cube_tree 等が 2×2→1×1 に。道路は実寸整数倍(19.68m=4.0)なので不変。
- データ根拠: 各 proto の実寸は meta の `canonical_size_meters`（`total_grid` は都市全体の共有グリッドなので proto サイズには使えない点に注意）。
- 確認: tsc 通過。1×1 が 15→25 個に。

### NewCity: 特定建物が192m離れて分断される bug の根本修正（bit-pack STRIDE）
- ユーザー報告: `Building_House_01_color02` が崩れる/分割されて配置がうまくいかない
- 3仮説を検証: ①proto内 `_NNN` 欠け=否（メンバー同サイズの真の複製）②チャンク合成崩れ=否（ローダーは offset を頂点にベイク済み）③別名プロトタイプへの分離（屋上プロップ Props_Roof_* が別proto）=別問題。
- 真因（算数で確定）: `scripts/newcity-build.mjs` の **bit-pack `STRIDE=4096` が grid(5907×5120×646) に対し小さすぎ**。`key=gx+gy*4096+gz*4096²`。color02 は gx 4096–4607 / gy 4064–4312 に位置し、gx・gy とも 4096 以上が抽出時に `%4096` で 0 側へラップ → 家が cx16/cy16 の正しい位置と cx0/cy0 のラップ先に分断（保存 .vox の 600k@cx0/cy0 + 77k@cy15 と一致）。city の 1024→4096 と同種で、newcity では 4096 でもまだ不足だった。
- 修正: STRIDE を `maxGridDim` を超える最小の2冪（今回 8192）に自動設定。pack/unpack 両方を `STRIDE`/`STRIDE²` 化。`8192²*646≈4.3e10` で JS 安全整数内。
- 再ビルド: `node scripts/newcity-build.mjs 0.05`（37.5s, 111 proto, 28.97M voxels）。バックアップ `field/newcity_backup_stride_20260704/` を作成済み。
- 検証: color02 は cy15,16 の連続チャンク（cx16,17）に修正。**全111 proto で非連続チャンク=0**（gy/gx≥4096 に位置する他の建物も一括修正）。dev server 3003 で manifest/meta/新チャンク 200。
- **ブラウザ目視確認は未実施**（実際に color02 が1棟として綺麗に配置されるか要確認）。

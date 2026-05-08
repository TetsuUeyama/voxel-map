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

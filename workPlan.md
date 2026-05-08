# Voxel Map - 作業計画

## プロジェクトの目的
`fighting-game` / `battle-game` で使用するボクセルベースの共通ゲームフィールドを作成する。

### 要件
1. **世界観統一** — フィールド・オブジェクト共にボクセル
2. **動作軽量化** — 数百〜数千の `.vox` オブジェクト配置に耐える描画パフォーマンス
3. **共通モジュール化** — `fighting-game` / `battle-game` 両方から利用可能

## 既存資産
- `src/GamePlay/FightGame/Stage/StageBuilder.ts` — 地面 + ライト + ゾーンマーカー
- `src/GamePlay/FightGame/Stage/TerrainBuilder.ts` — `.vox` ロード + 散布配置 + メッシュ生成
- `src/GamePlay/FightGame/Stage/TerrainObjectRegistry.ts` — オブジェクト登録/レイアウト型
- `src/lib/vox-parser.ts` — VOX パーサ + face culling 用定数
- `src/lib/voxel-skeleton.ts` — `createUnlitMaterial` のみフィールドで使用
- `src/app/api/game-assets/[...path]/route.ts` — `C:\Users\user\developsecond\game-assets\field\` を配信

## フェーズ

### Phase 1: プレビュー UI ※現在着手中
- [ ] `VoxelMapViewer` クライアントコンポーネント (Babylon Engine + ArcRotateCamera)
- [ ] `page.tsx` でフィールドをフルスクリーン表示
- [ ] `layout.tsx` に全画面化スタイル
- [ ] FPS / メッシュ数 / アクティブメッシュ数の HUD 表示
- [ ] dev server 起動 + ブラウザで動作確認

### Phase 1.5: terrain モード切替（flat / village / park）
- `STAGE_CONFIG.terrain` で切替可能（'flat' | 'village' | 'park'）
- [x] `VillageTerrain.ts` — village/layout.json ベースのタイル配置（高低差あり）
- [x] `ParkTerrain.ts` — park の field タイル + 手動配置の遊具・ベンチ・木
- [ ] 各モードで全タイル表示時の FPS 計測 → 重ければ Phase 2 を前倒し
- [ ] オブジェクト配置時の地形高さサンプリング（village 用）

### Phase 1.7: Cafe モデルの voxel 化（/cafe ページ）
- 入力: `C:/Users/user/Downloads/uploads_files_6212131_Cafe/Cafe.fbx` (FBX) + `Cafe.obj/.mtl` (3ds Max 由来)
- 採用パイプライン: city/warehouse と同じ Blender 経由（Principled BSDF base_color → JSON）
- 初回 voxelSize: **0.05m**
- [ ] `scripts/cafe-export.py` — Blender で FBX をインポート → OBJ + colors.json
- [ ] `scripts/cafe-to-vox.mjs` — OBJ → 自動チャンク分割 .vox + meta.json (city-to-vox の clone, NAME='cafe')
- [ ] `src/GamePlay/FightGame/Stage/CafeTerrain.ts` — `loadChunkedVoxelModel` の thin wrapper
- [ ] `TerrainKind` に `'cafe'` 追加 / `StageBuilder.ts` に分岐追加
- [ ] `src/app/cafe/page.tsx` — `<VoxelMapViewer terrain="cafe" />`
- [ ] tsc 通過 + `/cafe` と meta/chunks が 200 応答すること確認

### Phase 2: 描画最適化
- [ ] `createUnlitMaterial` のシェーダ重複登録解消（共通シェーダ名 + マテリアルキャッシュ）
- [ ] 同一 `.vox` の複数配置をインスタンシング（`createInstance`）化
- [ ] 静的オブジェクトの `MergeMeshes` 検討（種類別／タイル別）
- [ ] 草・花など微小オブジェクトの密度調整
- [ ] 視錐台外カリング（Babylon 標準で有効化されているか確認）
- [ ] LOD（距離による簡略化）検討

### Phase 3: 共通化（配布方法は未決定）
- 候補: シンボリックリンク / npm link / `file:` 依存 / 単純コピー
- 共通化スコープ: `src/GamePlay/FightGame/Stage/*` + `src/lib/vox-parser.ts` + `createUnlitMaterial`
- 決定後、`fighting-game` / `battle-game` の `src/GamePlay/FightGame/Stage/` から参照

### Phase 4: フィールドエディタ（将来検討）
- ブラウザ上で `ObjectPlacement` を視覚的に編集
- レイアウト JSON エクスポート

## 未決事項
- **Phase 3 の配布方法** — Phase 2 完了後にユーザーと相談

# 精靈幻境 2026

繁體中文 3D 無網格戰術 RPG，使用 Three.js、Blender 模型及 Effekseer 即時特效。

- [直接試玩](https://a1593711534-droid.github.io/Fairyland-2026/)
- [新版需求逐條驗收](docs/v1-audit.md)

## 遊玩

1. 選莉歐並從月泉營地出發。到微光林地可測試戰鬥、收服及練等。
2. 點戰場角色或「指令」打開情境選單。將滑鼠移到地面可查看路線與借機攻擊提示，點可達區域即移動。
3. 莉歐開局已有六種精靈。開啟召喚欄並為每隻精靈選點，最後「確定召喚」。低於 5 點魔力時，仍在場的夥伴會變回野生。
4. 打倒練習精靈快速取得經驗。Lv. 3 後回大地圖，打開精靈手冊進化。
5. 各角色有三格物品欄。可到蘑菇小攤購買消耗品、裝備和特殊道具。月泉可治療隊伍。

遊戲需要 WebGL 2。自動存檔和三個手動欄位保存在目前瀏覽器。

## 開發

需要 Node.js 24。使用 `npm ci` 安裝，`npm run dev` 開發，`npm test` 驗證，`npm run build` 取得 `dist/`。正式站由 GitHub Actions 部署。

`src/game/content.js` 集中管理內容和主要平衡參數。`combat.js`、`summoning.js`、`inventory.js`、`ai.js`、`world.js` 及 `save.js` 處理相應規則。`src/interface.js` 定義共用面板，`src/render/` 處理 3D、特效和音訊。

### 美術素材

- 安裝 Blender 4.3 後，以 `npm run art` 重建模型及動畫。設定 `FAIRYLAND_INSTANT_MESHES` 為 Instant Meshes 執行檔的路徑，可重建精靈的重拓撲版本。莉歐的頭部以 MPFB 2.0.18 的 CC0 基礎網格為起點，已裁切並納入 `tools/reference/lio-head.obj`。
- 安裝 Python 的 NumPy 與 Pillow 後，執行 `python tools/create-surface-maps.py /path/to/Rock030` 重建材質。路徑需包含解壓後的 1K JPG 素材。石材採用 [ambientCG Rock030](https://ambientcg.com/view?id=Rock030)，授權為 CC0。
- 執行 `python tools/author-effects.py /path/to/Effekseer` 以 Effekseer 1.80.8 匯出 30 組特效。可在 `.art-cache/effects/` 開啟編輯專案。網頁播放器附帶 [Effekseer 授權](public/art/fx/effekseer-LICENSE.txt)。
- 火屬召喚使用 `src/render/fire-summon.js` 的即時火焰和煙霧材質。舞台渲染火焰到現身時點後，才顯示精靈。

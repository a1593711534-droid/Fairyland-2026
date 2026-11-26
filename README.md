# 精靈幻境 2026

繁體中文 3D 無網格戰術 RPG，使用 Three.js 與原創 Blender 模型。

- [直接試玩](https://a1593711534-droid.github.io/Fairyland-2026/)
- [新版需求逐條驗收](docs/v1-audit.md)

## 遊玩

1. 選莉歐並從月泉營地出發。到微光林地可測試戰鬥、收服及練等。
2. 點戰場角色或「指令」打開情境選單。點地面規劃路徑，再「確認移動」。Esc 可取消。
3. 莉歐開局已有六種精靈。開啟召喚欄並為每隻精靈選點，最後「確定召喚」。低於 5 點魔力時，仍在場的夥伴會變回野生。
4. 打倒練習精靈快速取得經驗。Lv. 3 後回大地圖，打開精靈手冊進化。
5. 各角色有三格物品欄。可到蘑菇小攤購買消耗品、裝備和特殊道具。月泉可治療隊伍。

遊戲需要 WebGL 2。自動存檔和三個手動欄位保存在目前瀏覽器。

## 開發

需要 Node.js 24。使用 `npm ci` 安裝，`npm run dev` 開發，`npm test` 驗證，`npm run build` 取得 `dist/`。正式站由 GitHub Actions 部署。安裝 Blender 4.3 後，`npm run art` 可重建模型及動畫。

`src/game/content.js` 集中管理內容和主要平衡參數。`combat.js`、`summoning.js`、`inventory.js`、`ai.js`、`world.js` 及 `save.js` 處理相應規則。`src/interface.js` 定義共用面板，`src/render/` 處理 3D、特效和音訊。

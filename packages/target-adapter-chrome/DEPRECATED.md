# DEPRECATED — 此目录已停止演化

> 裁定 (C1)，DCF 正式实施计划 v1.0 阶段 3。

`packages/target-adapter-chrome/` 不再作为独立产品演化。

## 现状

- **唯一 Target Adapter：`seed/adapters/chrome/`**。用户只需安装该一个扩展。
- 本目录的读写能力已并入 seed adapter：
  - `read-conversation` → seed `content.js` 的 `dcf-read-conversation` 消息
    （按 `[data-message-author-role]` / `data-message-id` 契约返回最近 N 条）；
  - `send-card` → seed `content.js` 的 `dcf-send-card` 消息，`setNativeValue`
    注入策略（contenteditable 优先 `execCommand('insertText')`，降级
    InputEvent / 原型链 value setter）即源自本目录的 `content.js`；
    只写入不自动发送，`payload.auto_send === true` 才点击发送。
- Surface↔Adapter 通信按裁定 (C3) 走 Companion 持久命令队列
  （`/rpc/adapter/command*`）+ 窄 WebSocket 唤醒（`/ws/adapter-wake`）+
  `chrome.alarms` 恢复安全网，由 seed adapter 的 `background.js` 实现。

## 本目录的处置

- 保留代码仅作历史参考，不接受功能性改动；
- 不要在浏览器中与 seed adapter 同时安装本扩展（会重复采集）。

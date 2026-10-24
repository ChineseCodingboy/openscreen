# 本地备份说明（2026-10-24）

这个分支是删除本地副本前，对 `~/Documents/Playground/openscreen` 工作区的原样快照。

- 本地改动（v1.5.2，之前从未提交）全部在这次提交里。
- `electron/` 目录在本地工作区里早已丢失（约 2026 年 8 月），这次提交如实记录了这一点；原版 electron 代码仍在 main 分支和 git 历史里。
- `recovered-20260728-163223/`、`recovered-20260728-192647/`：2026-07-28 两次恢复时留下的副本，里面有改过的 electron 源码（比 main 上的新，但比 8 月的旧）。
- `dist-electron-20260810/`：2026-08-10 编译出的 electron 主进程和 preload，是 8 月最新 electron 代码仅存的版本（编译后的 JS）。

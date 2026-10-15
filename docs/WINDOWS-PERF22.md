# Windows Perf22 · 封面图集上传合批

基线：538f96d（Perf21 · no-Kugou 修正）。本轮是"面向所有设备的性能优化"第一项，只改封面图集的上传路径，不改变任何像素、画质档位或公开行为。

## 问题

实测诊断（`设置 → 开发者设置 → 复制性能诊断`，RX 580 2048SP · 1920×1032 · dpr 1）显示：整帧 P95 为 26.8ms，而 GPU 分段计时里 `coverUploads` 的 P95 是 **23.43ms**——一次帧尖峰几乎全部来自封面上传；同期 `sceneWithShadowsAndTransmission` P95 7.89ms、`aoWithNormalsAndDepth` P95 4.82ms。整机 56.3 FPS、无 >50ms 卡顿，说明这不是算力不足，而是**上传调用本身的同步代价**。

原因是逐块上传的写法：每块封面各自一次 `clearRect` + `drawImage` + `copyTextureToTexture`，而目标图集是 **4096×6912 = 113 MiB** 的单张纹理，正被上一帧采样。每次拷贝都要等上一帧读完才能落笔（写后读冒险），于是每块封面都在驱动里换一次同步。会话统计 764 块 / 762 批，即平均每批只走 1 块。

## 实现

`src/cover-atlas.ts` 的 `flushUploads` 现在先把脏槽按**图集行**分组、再切成**列方向连续段**，每段只做一次拷贝：

- 暂存画布从"一格"改为"一整行"（`columns × tileWidth` × `tileHeight`，4096×256 = 4 MiB），仍然是纯 CPU 源、从不初始化为 GPU 纹理。
- 上传时传入 `srcRegion`（`Box2`）：three.js 的 CPU 分支会据此设置 `UNPACK_SKIP_PIXELS` / `UNPACK_ROW_LENGTH` 并调用带显式宽高的 `texSubImage2D`，因此可以从行带里只上传该段的子矩形。
- 每段的源矩形、目标位置与逐块写法完全一致：源 y 恒为 0、高恒等于一格（因此垂直翻转的作用范围与单块上传时完全相同），只有水平偏移由 `region.min.x` 表达。

**逐块像素不变**，只是把 N 次驱动拷贝合并成 1 次；连续段有多长就传多少字节，不做补白、不重复、不遗漏。诊断新增 `uploadCalls` 与 `uploadedTilesPerCall`，可直接观察合批倍数。

## 效果

在本机以 Playwright 启动构建产物、合成 96 专辑曲库（`scripts/windows-fixture.mjs`）实测：

| 指标 | 值 |
| --- | --- |
| 首次铺满图集 | `uploadedTiles` 432，`uploadCalls` **27**，`uploadedTilesPerCall` **16** |
| 旧实现 | 按构造为每块一次拷贝，即 432 次 |

即初次铺满的 `texSubImage2D` 调用数从 432 降到 27（−94%），字节数不变（每次正好一整行的连续段）。浏览时产生的零散脏块仍逐段合并；仅当同一行内列不连续时才退回多次拷贝，不会比原实现更差。

## 验证

| 项目 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `npm run build`（tsc + vite + PWA） | 通过 |
| `npm run check:music` | 通过（17 + 73 + 25 项） |
| `check-music-cover.mjs` | 通过；契约扩展为：相邻列 1 次拷贝、散列列各自 1 次、**覆盖集合与脏槽集合精确相等**、每段的源矩形/目标位置逐项校验、诊断计数可见 |
| `check-music-renderer-startup.mjs` / `check-quality.mjs` | 通过 |
| `npm run check:gpu-budget` | 通过 |

**未验证**：未在真实独显 / 核显上测帧时间（本机无可用 GPU 加速的无头浏览器）；未用 96 张**各不相同**的封面压测（夹具只有 3 张演示封面，故 `cachedImages` 为 3）；未跑账号与音频回归（本轮不涉及）。`benchmark:windows` 在本机无法完成：纯软件光栅器下 1920×1080 就绪需 67.8 秒，且后续场景渲染极慢，因此上面用的是等价的最小实测脚本。

## 顺带修复的脚本缺陷

`scripts/benchmark-windows.mjs` 在本仓库状态下无法运行，三处均已修正（与性能改动无关，独立可回退）：

1. fixture 的 url 末尾带 `/`，脚本又拼一个 `/`，请求变成 `//` 而 404；
2. `page.waitForFunction(fn, { timeout: 60000 })` 把选项当成了函数入参，60 秒超时实际未生效（回落到 30 秒）；
3. 当前 Chromium 默认禁止软件光栅器上的 WebGL，未加开关时基准根本到不了应用；现默认附加 `--enable-unsafe-swiftshader`，可用 `RHINE_BROWSER_ARGS` 覆盖。

`scripts/check-music-startup.mjs` 在本仓库状态下报 `ReferenceError: tryEnterPlaylistOverview is not defined`，在未改动的纯净树上同样复现，属既有问题，本轮未改动。

## 后续（全设备优化候选）

按"感知损失从小到大"排序，均为设备无关项：

1. 阴影按需更新（相机/阵列/选中/主题都没变时完全跳过）。
2. 遮挡分析的 8.6ms CPU 尖峰摊到多帧（现在每 256 帧一次）。
3. 透射降到 0.5 并改用深度感知上采样（观感≈当前 0.75）。
4. 解码缓存分档（高配 20–24M 像素、低配维持 12M），减少"淘汰→重解码→重上传"。
5. 图集按档定尺寸与双缓冲，进一步消除写后读停顿。
6. 遮蔽 AO 的时间复用 + 蓝噪声（观感不降反升）。
7. 闭环自适应画质：用现有 `gpuTiming` 朝 16.7ms 逐项调节，替代纯静态的显卡字符串启发式。

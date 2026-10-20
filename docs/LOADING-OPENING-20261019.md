# 可选加载开场

设置 → 个性化 → 启动体验 → “启动时展示开场动画”，默认开启，下次启动生效。关闭时显示原加载界面并直接进入模型浏览，不播放二维片头或三维波浪。“减少动态效果”优先，跳过两段动画。

开场来自 Twilight Echo 的 Rhine Lab 扩展。入口仓库为 https://github.com/Px-asen/Twilight_Echo ，实现位于 https://github.com/Px-asen/Twilight-Echo-plugins/tree/d1c4b201daec7ac1fe88d8901952ed1a27f1e6d1/plugins/rhine-lab/src/loading-opening 。后者 NOTICE 标注动画来自 LBEILC/RhineLabUI `12cc5e4`。来源、许可和本版修改见 `src/loading-opening/SOURCE.md` 与 `public/licenses/loading-opening-mit.txt`；不加入参考视频、原 PV 录音或外部字体。三条几何轨迹未改。

启动时先绘制二维 SVG 片头，然后在原有异步链中读取曲库、加载模型、准备材质/渲染器和选定的音频设备。片头与资源准备并行，模型准备工作没有移到独立线程，因此仍可能受到主线程编译等工作的短暂影响；不能以界面测试保证实际播放全程流畅。

二维片头约 21.92 秒。模型先准备好时，等待片头结束；片头先结束时，显示静态等待画面，不出现转盘，也不重新播放。点击“跳过开场”或按 Escape / Enter 跳过当前片头；资源未好时继续等待，准备好后衔接已接回的约 5.2 秒三维阵列波浪，后者也可单独跳过。两段动画采用原有独立时间轴。

原生窗口按钮位于片头上方，保持可用。窗口隐藏时暂停片头 RAF，恢复后不追赶隐藏期间时间。低帧率下每帧最多推进 50 ms，避免资源准备阻塞吞掉片头。启动失败立即移除片头并恢复既有错误、重试与设置入口。页面销毁取消动画、ResizeObserver 和等待任务，片头完成后释放 SVG DOM。

验证：TypeScript 和生产构建；开场往返波浪 CPU 检查；生产启动控制流回归；禁用 GPU 的生产应用合成界面回归，检查模型在片头后方开始准备、转盘隐藏、跳过后仍等待模型、结束衔接、设置开关保存、减少动态效果、失败恢复与隐藏窗口。独立 SVG 虚拟时钟测试覆盖自然播放、快/慢资源双向等待、暂停/恢复、销毁解除等待、超宽与竖屏；截图在本机忽略的 artifacts/loading-opening 目录。未执行真实 WebGL / GPU 性能、账号或音频测试，未原生重编译。

回退基线 `8cdc375`；原 QueueWave1 与 Queue2 预览目录保留。未推送或发布 GitHub。

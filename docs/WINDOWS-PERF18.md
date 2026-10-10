# Perf18 / Perf18a · 我的歌单抽屉

Perf18a 按用户反馈加长名称卡片、缩短箭头伸出区：列表宽度不变，名称区为列表宽度减 52px，通常 278px + 52px，箭头居中；窄屏沿用同样比例规则。投影锚点和碰撞计算同步，其他抽屉交互保留。改前 fb557c5，检查点 `checkpoint/windows-perf18-before-drawer-proportion-2026-10-09`，完整历史 `artifacts/rollback/windows-perf18-fb557c5.bundle`。独立交付 `release/Rhine-Music-Windows-0.1.0-perf18a-preview-x64.zip`，入口 `Rhine-Music-Windows-Perf18a/Rhine Music.exe`，诊断 `0.4.1-perf18a`；旧 Perf18 保留。仅代码 / 构建 / 包静态检查，没有运行应用或回归测试。以下为 Perf18 初始实现记录，尺寸以本段为准。

分支 `ui/windows-playlist-drawer`，改前 `f86d3e7`。回退检查点 `checkpoint/windows-perf17-before-playlist-drawer-2026-10-09`；完整历史 `artifacts/rollback/windows-perf17-f86d3e7.bundle` 已验证。独立交付 Perf18，保留 Perf17 目录和 ZIP，诊断版本 `0.4.1-perf18`。

## 交互

- 悬停歌单名称，右侧伸出向下箭头区。名称宽度加伸出宽度等于列表宽度：横屏名称 160px，窄屏 116px，列表 `min(330px, 100vw - 48px)`。
- 点击箭头，名称仍在上方，列表像抽屉一样从其下方拉开，箭头翻转向上。名称点击不再替换为列表。
- 再次点击箭头、鼠标移出列表或移出整张卡片，抽屉收起。鼠标从名称移入已打开的列表时，保留完整标题条，避免中途误关；鼠标离开整卡后箭头区缩回。
- 键盘焦点进入名称时展开箭头区；Tab 到箭头后用 Enter / Space 开关。Escape 先关抽屉，保留总览。触摸设备直接显示箭头入口。

## 实现与边界

标题条使用宽度过渡，列表用网格行裁剪过渡，独立箭头旋转。快速开关反向承接当前 CSS 状态，文字与行高保持原尺寸；旧整卡 FLIP 不再应用于歌单抽屉，原辅助源文件保留。开关不改变名称投影位置，卡片出现时提前预留列表边界；碰撞规划使用相同坐标，并优先保留当前交互的卡片。

名称与抽屉继续使用主题色和毛玻璃；两种主题、动效速度、减少动态效果继续适配。关闭即将列表设为 inert / aria-hidden，先把其中的焦点返回标题按钮，退出视觉完成前不会误点到歌曲。只保留一个展开歌单，加载回调仍检查当前歌单 / 账号 / 总览状态与请求代次；异步歌曲更新仅恢复自身列表内的焦点。

保留 56px 虚拟行、滚动窗口、透明轨道及无上下箭头，无分页按钮；点击歌曲继续退出总览并定位歌曲模型。错误信息在固定高度内显示，避免下方超出窗口。不增加 Three.js 渲染通道、封面上传或每帧 DOM 尺寸读取；毛玻璃及二维过渡仍有合成成本，没有运行性能测试，不能量化本轮帧率。

## 检查与使用

按照用户持续要求，只做 TypeScript、相关 JavaScript 语法、diff、生产构建与包文件静态校验。更新悬停只展开箭头、单独点击开关、移出、键盘 / 触摸状态、焦点返回、位置 / 屏幕边界、快速切换和减少动态效果的合成用例，仅检查语法，没有执行。没有启动 EXE / 浏览器 / WebView / GL / 音频 / 登录，也没有请求真实平台账号或接口，实际动效待用户在新包确认。

使用 `release/Rhine-Music-Windows-0.1.0-perf18-preview-x64.zip`，完整退出旧版再启动 `Rhine-Music-Windows-Perf18/Rhine Music.exe`；保留整个 runtime。宿主 EXE 沿用 Perf17，网页重新构建。沿用本机加密账号，无需主动退出重登。

生产构建通过：143 模块，离线构建 `0c5551f54b8f741f`，77 文件。既有大于 500kB 的 chunk 警告仍存在，本轮没有扩大三维渲染逻辑。

程序回退直接运行保留的 Perf17。源码回退先保存当前改动，再 `git switch --detach checkpoint/windows-perf17-before-playlist-drawer-2026-10-09`；返回使用 `git switch ui/windows-playlist-drawer`。没有覆盖旧包、改写历史、推送或公开发布。

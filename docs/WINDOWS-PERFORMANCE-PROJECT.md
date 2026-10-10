# Windows 性能优化项目 · 2026-10-10

## 2026-10-10 · Perf21 · IPv4、分类设置与反馈

开始前清洁提交 8c1d46f；分支 feat/windows-perf21-settings-ipv4-feedback。回退标签 checkpoint/windows-perf20a-before-settings-ipv4-2026-10-10，完整历史备份 artifacts/rollback/windows-perf20a-8c1d46f.bundle。旧 Perf20a Debug 便携包保留。

网易云 API 采用 Undici 7.28.0 独立 IPv4 连接池；设置全窗口分类；深层错误浮层增加持久开关；反馈自动采集已有安全诊断并生成固定收件人的邮件草稿。范围、验证与交付见 WINDOWS-PERF21.md。未推送、未发布。

实现 1e05a17，标签 preview/windows-perf21-2026-10-10；生产 / 原生构建和源码 / 图标 / PE / 全包哈希静态检查通过。便携目录已复制至用户桌面 artifacts/Rhine-Music-Windows-Perf21，4879 文件 / 690895525 字节；EXE SHA-256 5d67afd330be3a731f82f23280fe655e753413d6797b9a7215627c4710ea9a51。完整交付证据见 WINDOWS-VALIDATION.md，runtimeChecked=false。

## Perf20a Debug · 深层错误与圆角白底图标 · 2026-10-10

分支 debug/windows-perf20a-deep-errors-icon；改前 0451018，检查点 checkpoint/windows-perf20-before-rounded-icon-2026-10-10，完整历史 artifacts/rollback/windows-perf20-0451018.bundle 已验证。独立交付 Perf20a Debug，保留 Perf20 Debug。

原始 cause / AggregateError 链保留 errno / syscall / 安全消息 / 文件名行列；网易云增加只读 Undici 请求阶段和 socket / TLS 观测。请求按对象身份关联，连接事件明确为共享同域连接池时间窗口证据。前端二次筛选后可复制，20 条内存上限，链和事件有界，不导出凭据、请求参数、音源或私人路径。接口 / 重试 / 登录策略不变，不宣称解决断连。恢复圆角暖白图标，保留放大标志并重编宿主。仅代码 / 构建 / 包静态检查，不执行合成用例或应用 / 平台测试；runtimeChecked=false。详见 WINDOWS-PERF20A-DEBUG.md。

实现 97b39dc，标签 preview/windows-perf20a-debug-2026-10-10。类型 / 相关语法 / diff、146 模块生产构建（离线 75695e7804e1099e / 77 文件）、locked 原生 release 通过。图标七种 RT_ICON 逐字节匹配，x64 / NvOptimusEnablement / WebView GPU 偏好保留；包源文件与产物匹配打包时源码，EXE SHA-256 36405d10b312e33dad61fe20402b750d47d648a130c3f5769656b4671f0de066。ZIP 4666 文件逐一 SHA-256 校验，310090515 字节，SHA-256 8a8dc55b0352159991d03e23d86d626355e4b9434aa970523528bd2aaab6f3c0。旧 Perf20 Debug ZIP 哈希保持 c6c77d902743cb9eb6d09dc4e7a83e97fb83cf67745c9a1553057c51a1759cf8，回退 bundle 完整历史验证通过。交付记录在打包后仅补记源码文档，不重写已校验包；runtimeChecked=false。

## Perf20 Debug · 在线错误诊断与透明图标 · 2026-10-10

分支 debug/windows-perf20-online-errors-icon；改前 0e42e8a，检查点 checkpoint/windows-perf19-before-debug-icon-2026-10-10，完整历史 artifacts/rollback/windows-perf19-0e42e8a.bundle 验证通过。独立调试包，保留 Perf19。

用户要求暂不追查网易云连接错误。增加可复制报错：安全固定代码、上游 / 本地 HTTP 与业务状态、网络嵌套原因和播放尝试次数，20 条内存上限；不包含凭据 / 原始消息 / URL。原请求 / 三次重试 / 登录协议保持。左上角文字不再跳转页面，图标去浅色背景、主体放大并重编原生 EXE。仅代码 / 构建 / 包与图标 PE 静态检查；合成用例只检查语法，不运行应用、音频、真实登录 / API，runtimeChecked=false。详见 WINDOWS-PERF20-DEBUG.md。

实现 da25b98，标签 preview/windows-perf20-debug-2026-10-10。类型 / 相关语法 / diff 与生产构建通过：145 模块，离线构建 7cd8fe5207491af7，77 文件。locked 原生 release 重编通过；RT_ICON 七尺寸透明图标逐字节核对，x64 / NvOptimusEnablement / WebView GPU 偏好仍在。包入口、资源、协议、诊断脚本、图标与文档匹配打包时源码；EXE SHA-256 67a42b0f3ebf84a815f73d57a9ad37b3976db5cb503681d71acbde37774276f0。ZIP 4663 文件逐一 SHA-256 校验，310028667 字节，SHA-256 c6c77d902743cb9eb6d09dc4e7a83e97fb83cf67745c9a1553057c51a1759cf8。Perf19 ZIP 哈希保持 0f0879a1f409401986ee2fb6ba0105046253dd4c9abb556ebfe0bb43a692efbe，回退 bundle 已验证。交付记录仅在打包后补记源码，不重写包；runtimeChecked=false。

## Perf19 · 在线重试与紧凑歌单 · 2026-10-10

分支 fix/windows-online-retry-compact-playlists；改前 2b47d94，检查点 checkpoint/windows-perf18a-before-online-retry-2026-10-10，完整历史 artifacts/rollback/windows-perf18a-2b47d94.bundle。独立交付 Perf19，旧 Perf18a 保留。

音源请求与媒体地址加载失败共享三次延迟恢复，自动下一首适用；重获地址、保留时间、重复错误去重，用户操作取消等待与旧请求。HTTP 401 / 403 等、手势 / 解码错误不重试；网易云 301 映射 401，QQ 曲库网络失败用准确提示。歌单标题与列表宽 280px，名称 240px / 固定箭头 40px，列表最高 260px；只显隐箭头，无宽度动画，抽屉与模型定位保留。没有新增三维渲染通道。

仅代码 / 构建 / 包静态检查；合成用例更新但不执行，不运行应用 / 音频 / 登录 / 真实平台请求，runtimeChecked=false。详见 WINDOWS-PERF19.md。

实现 e916ba8，标签 preview/windows-perf19-2026-10-10。TypeScript、相关脚本语法、diff、生产构建与包静态检查通过；143 模块，离线构建 fed0e13a7add6ace，77 文件。包网页 / 服务 / 协议 / 许可 / 文档逐字节核对，重试与固定 40px 箭头标记存在；宿主 EXE 与 Perf18a 一致。ZIP 4660 文件逐一 SHA-256 校验，309982697 字节，SHA-256 0f0879a1f409401986ee2fb6ba0105046253dd4c9abb556ebfe0bb43a692efbe。旧 Perf18a ZIP 哈希保持 6d34cd1592525519146970058ff086066202caa9e07c49078f0a183d9014b8ed，回退 bundle 已验证。交付记录打包后补记源码，不重写已校验包；runtimeChecked=false。

## Perf18a · 歌单卡片比例调整 · 2026-10-09

用户反馈箭头区域过长。名称区从 160px 加宽至通常 278px，箭头区从 170px 缩至固定 52px，列表总宽 330px 保持；窄屏按列表实际宽度减 52px 得到名称宽度。箭头居中，CSS 与投影 / 碰撞同步更新，原抽屉行为保留。检查点 checkpoint/windows-perf18-before-drawer-proportion-2026-10-09，完整历史 artifacts/rollback/windows-perf18-fb557c5.bundle；独立交付 Perf18a，不覆盖 Perf18。仅代码 / 构建 / 包静态检查，没有运行应用或回归测试。

实现 627c171，标签 preview/windows-perf18a-2026-10-09。类型、相关脚本语法、diff、生产构建和包静态检查通过；143 模块，离线构建 160cd22cebfaa5cf，77 文件。包说明 / 服务 / 协议 / 入口 / 许可与打包时源码逐字节一致，宿主 EXE 沿用 Perf18。ZIP 4659 文件逐一 SHA-256 校验，309985765 字节，SHA-256 6d34cd1592525519146970058ff086066202caa9e07c49078f0a183d9014b8ed。旧 Perf18 ZIP 哈希保持 0cbc1dde08d7780026bbe1f5f3317890ea660eeca246645f3846abfda3ffa98f，bundle 验证通过。交付记录打包后补记源码，已校验包不重写；runtimeChecked=false。

## Perf18 · 歌单抽屉交互 · 2026-10-09

分支 ui/windows-playlist-drawer；改前 f86d3e7，检查点 checkpoint/windows-perf17-before-playlist-drawer-2026-10-09，完整历史 artifacts/rollback/windows-perf17-f86d3e7.bundle 已验证。Perf17 目录与 ZIP 保留。

名称卡片保持显示与位置；悬停向右扩展箭头区至列表宽度，点击后列表从下方裁剪展开，箭头反转，移出列表或再次点击收起。名称到打开列表的指针路径连续，整卡移出收起入口。CSS 反向过渡承接快速开关，不缩放文本，不增加三维渲染通道或每帧布局测量。保留虚拟列表、账号曲库和歌曲模型定位、主题 / 速度 / 减少动态效果；键盘 / 触摸入口、关闭焦点和过期加载边界适配。详见 WINDOWS-PERF18.md。

仅类型 / 语法、diff、生产构建与包文件静态检查；交互合成用例只检查语法，不执行回归。没有运行程序 / 浏览器 / GL / 登录 / 音频或真实平台请求，runtimeChecked=false，动效效果由用户实机确认。宿主沿用 Perf17 EXE。

Perf18 实现 9936908，标签 preview/windows-perf18-2026-10-09。构建 143 模块，离线版本 0c5551f54b8f741f，77 文件。包内网页含抽屉 / 独立开关 / 触摸与双向裁剪样式，旧返回动作与 FLIP 样式退出生产入口；服务 / 协议、锁文件、许可、README 和随包说明逐字节核对。宿主 EXE SHA-256 92d9cd545e5e13f8bf9ef737846369bf84bf05ac51f9d143c4873a250ad241f3，与 Perf17 相同。ZIP 4659 文件逐一 SHA-256 校验，309975189 字节，SHA-256 0cbc1dde08d7780026bbe1f5f3317890ea660eeca246645f3846abfda3ffa98f。旧 Perf17 ZIP 哈希保持 12f8e4b0fcf3bab640f0e8ca5d9967ee12c54ea170f1f158c6302c5349d56fe6，完整历史 bundle 再次验证。交付哈希在打包后补记源码，不重写已校验包。

## Perf17 · 波点空歌单响应兼容 · 2026-10-09

分支 fix/windows-bodian-playlist-response；改前 ce6ffdf，检查点 checkpoint/windows-perf16-before-bodian-list-fix-2026-10-09，完整历史 artifacts/rollback/windows-perf16-ce6ffdf.bundle 已验证。Perf16 目录与 ZIP 保留。

修正空自建 / 收藏歌单容器的错误拒绝；未知非空结构继续报错且注明来源 / 安全字段类型，不暴露响应值。null / 缺失总量使用未知语义，保留收藏页推进、歌单已知歌曲数和搜索下一页。仅核对公开协议数据形状，没有读取私有账号响应。实现、来源、检查边界和回退见 WINDOWS-PERF17.md。

仅类型 / JavaScript 语法、diff、生产构建与包静态检查，合成用例更新但不执行；没有程序 / 浏览器 / GL / 登录 / 音频 / 真实平台请求，runtimeChecked=false。宿主沿用 Perf16 EXE。

Perf17 实现 12af0ae，标签 preview/windows-perf17-2026-10-09。TypeScript、三个相关 JS 语法、diff 和生产构建通过；144 模块，离线构建 5a61850cae6fbd72，77 文件。包内服务 / 协议脚本、构建入口、锁文件、许可、README 和随包说明逐字节核对，诊断版本与既有歌单形变标记存在。宿主 EXE SHA-256 92d9cd545e5e13f8bf9ef737846369bf84bf05ac51f9d143c4873a250ad241f3，与 Perf16 相同。ZIP 4658 文件逐一 SHA-256 校验，309970235 字节，SHA-256 12f8e4b0fcf3bab640f0e8ca5d9967ee12c54ea170f1f158c6302c5349d56fe6。旧 Perf16 ZIP 哈希保持 e16678d9d08431427bf14d2e8f7502b4dc773ac69605ac755d9288175476d7df，完整历史 bundle 再次验证。交付哈希仅打包后补记源码，不重写已校验包。

## Perf16 · 歌单卡片形变与波点音乐 · 2026-10-09

分支 ui/windows-playlist-morph-bodian；改前 7b04b29，检查点 checkpoint/windows-perf15-before-playlist-morph-2026-10-09，完整历史 artifacts/rollback/windows-perf15-7b04b29.bundle 已验证。保留 Perf15 目录和 ZIP 回退。

总览毛玻璃歌单名称通过内层 FLIP 拉伸为歌曲列表，返回反向收回；只在状态切换读取布局，三维锚点持续投影，支持快速打断、两种主题、速度与减少动态效果。加入独立波点 App 扫码 / DPAPI 会话、活动平台搜索、自己的歌单 / 我喜欢、封面、歌曲资料、行歌词与权限约束播放。协议参考 PyBodian MIT 并保留许可，不使用客户端凭据提取、AGPL 实现或外部账号代理。详细边界见 WINDOWS-PERF16.md。

仅类型、JavaScript 语法、diff、生产构建与静态包检查；补充合成用例但不执行。144 模块，离线构建 953f8fa16854bbea，77 文件。没有启动应用 / 浏览器 / GL / 登录 / 音频或请求真实平台 API；runtimeChecked=false，实际动画和账号可用性待用户确认。宿主沿用 Perf15 EXE。

Perf16 实现 ac845d6，标签 preview/windows-perf16-2026-10-09。11 个相关 JavaScript 文件语法、TypeScript、diff 与生产构建通过；包内动画、波点入口、服务脚本、锁文件、许可、构建入口和随包说明逐项 / 逐字节核对。qrcode 依赖存在，宿主 EXE SHA-256 92d9cd545e5e13f8bf9ef737846369bf84bf05ac51f9d143c4873a250ad241f3，与 Perf15 相同。ZIP 4657 文件逐一 SHA-256 校验，309965375 字节，SHA-256 e16678d9d08431427bf14d2e8f7502b4dc773ac69605ac755d9288175476d7df。旧 Perf15 ZIP 哈希仍为 113f066e176112d9ca1838a52e1da0280232662c23582044145f60750f644a0a，完整历史 bundle 再次验证。交付哈希仅在打包后补记源码文档，不改写已校验包。

## 回退基线

- 源码提交：`a736941`，标签 `checkpoint/windows-bars-2026-10-09`。
- 基线分支 `master` 保留；优化在 `perf/windows-playlist-switch` 独立分支进行。
- 可运行旧版：`release/Rhine-Music-Windows-Bars/Rhine Music.exe`。
- 完整旧包：`release/Rhine-Music-Windows-0.1.0-bars-preview-x64.zip`，SHA-256 `ae3a1b4fc3a3e9065146b95ac1322199f0d7874460a7b31c1e600555e2018ec8`。
- 独立 Git 历史备份：`artifacts/rollback/windows-bars-a736941.bundle`，不随产品分发。

关闭新版、打开 Bars 旧版即可回退运行版本，两套包不互相覆盖。源码回退前先提交或保存当前改动，再执行 `git switch --detach checkpoint/windows-bars-2026-10-09`；返回优化分支执行 `git switch perf/windows-playlist-switch`。不使用强制重置、清理工作区或改写已有历史。

## Perf1 范围与验收

保持玻璃材质、光照、景深、画质、模型尺寸及切换动效参数，优先减少重复数据准备、等待和界面布局。每项优化独立提交，可分别 `git revert`。根据用户最近的验证要求，本轮仅静态检查与编译，不启动程序或运行性能 / 交互检查；不能宣称帧率提高或切换卡顿已实机解决。

| 工作项 | 代码依据 | 状态 |
| --- | --- | --- |
| 歌单视图数据缓存 | 按 revision 复用视图数组；已准备曲目复用对象，一次分组缓存页，清除退出 / 淘汰数据 | 已实现，类型检查通过，运行待验收 |
| 动画与封面读取解耦 | 已加载歌曲直接提交选择；增量刷新不等待封面解码；避免重复触发同一导航预读 | 已实现，类型检查通过，运行待验收 |
| 有限歌曲柱节点 | 每首歌保留独立滚动位置；复用最多 32 个可见及预留按钮，长歌单切换不按总数建立 DOM | 已实现，类型检查通过，运行待验收 |
| 重复封面准备合并 | 复用最多 16 张已绘制小图，避免相同封面重复缩放；最大新增 RGBA 像素预算 4 MiB，退出清理 | 已实现，类型检查通过，运行待验收 |

## Perf1 后续性能验收（本轮不执行）

已补充准备视图缓存的回归用例，覆盖同一 revision 复用、缓存命中、新页保留旧曲目对象、退出清理；遵照验证要求尚未执行。导航 / 可见柱池 / 封面缓存仍需浏览器和原生窗口复核。下一里程碑再评估背景材质、阴影按变化更新和后处理预算，须先有实际耗时与视觉对照，不在未验收情况下替换玻璃效果或烘焙动态光影。

同一设备、窗口尺寸和原始画质，对比基线与新版：冷封面 / 热缓存、120 / 3000 首歌单、快速左右切换、首尾循环、暖昼 / 深夜。记录帧间隔 P95、超过 50 ms 的主线程长任务、输入到模型起动延迟、解码 / 绘制 / 元数据准备耗时、按钮节点数量和内存。功能复核须使用合成歌单、零音量，覆盖歌名悬停、点击、滚轮、焦点、登录退出竞态和播放保持；集显仍需实机验收。

## 独立提交与交付

| 提交 | 内容 | 单项撤回 |
| --- | --- | --- |
| `3b0de3f` | 数据准备缓存、热缓存直接导航、封面解码与增量刷新解耦 | `git revert 3b0de3f` |
| `5906f68` | 可见歌曲柱池，最多 32 个按钮 | `git revert 5906f68` |
| `b294801` | 已绘制封面小图缓存，最多 16 张 | `git revert b294801` |

工作区有未保存改动时先保存；若多项一起撤回，按提交逆序执行。完整退回基线使用前述标签，不删除优化分支。准备视图用例及交付说明是后续独立提交。Perf1 预览使用 `release/Rhine-Music-Windows-Perf1` 和独立 ZIP，源码交付标签 `preview/windows-perf1-2026-10-09`，本轮仅静态验收。

## Perf2：UHD 核显渲染预算 · 2026-10-09

用户设备：i5-12450H、UHD Graphics、2K 屏幕，用户观察到 MX550 未参与渲染。用户反馈旧版默认画质常态约 10 FPS、切换歌单约 8 FPS；这属于用户实机反馈，尚未拿到实际 GPU 计时和绘制尺寸。此轮不调整显卡选择、Windows 显卡偏好或 Rust 宿主。

- 优化前源码：`e04b143`，检查点 `checkpoint/windows-perf1-before-gpu-2026-10-09`；独立历史备份 `artifacts/rollback/windows-perf1-e04b143.bundle`。
- 新分支：`perf/windows-integrated-gpu`；Perf1 分支和目录继续保留。
- 核显预算实现提交：`848f1ef`，可用 `git revert 848f1ef` 单独撤回；回退前先保存工作区改动。
- 独立目录：`release/Rhine-Music-Windows-Perf2`，ZIP：`release/Rhine-Music-Windows-0.1.0-perf2-preview-x64.zip`。
- 源码回退：保存改动后 `git switch --detach checkpoint/windows-perf1-before-gpu-2026-10-09`；返回 `git switch perf/windows-integrated-gpu`。

| 工作项 | 实现 | 验收边界 |
| --- | --- | --- |
| 核显适配预设 | 主画面 100%，透射内部宽高各 50%；AO 16 采样、内部宽高各 50%；景深强度 100%、虚化内部宽高各 50%；阴影 1024、过滤 8× | 保留玻璃材质、模型、灯光布局及动效；细节与原始画质会有差异，需视觉验收 |
| AO 与深度分离 | 单次完整分辨率法线 / 深度绘制，小分辨率 AO；深度加权模糊及四邻点合成 | 降低 AO 分辨率不再额外触发景深几何绘制；薄边暗部优先避免错误覆盖 |
| 景深预算 | 原 41 采样虚化 shader 在小缓冲绘制，再按完整深度合成；焦点处使用完整主画面 | 关闭 AO 保留独立深度回退；100% 景深分辨率保留原共享 shader |
| 相机与资源 | 绘制前更新 AO 投影矩阵；切换 AO 采样数清理材质和噪声纹理；虚化缓冲随 resize 更新、退出释放 | 快速切换画质、窗口尺寸、AO / 景深开关需运行复核 |
| 诊断 | 缓存 renderer / vendor，记录完整及效果尺寸、共享深度次数、虚化预算和异步 GPU 计时 | 不主动切换显卡；扩展不可用时如实记录 |

首次进入桌面版，未自定义的旧“原始”配置迁移为“核显适配”；自定义及其他预设保留。新增偏好版本避免之后手动选择“原始”又被重置。浏览器原版默认保留“原始”。旧包与新包可能共用界面偏好，因此回退旧包或做对照时，在设置中明确选择“原始”；新版测试明确选择“核显适配”。关闭当前版本再打开另一目录，避免单实例唤回旧窗口。

本轮沿用用户只做代码检查的要求：类型检查、脚本语法检查、构建及包内容校验；不启动程序，不执行 `check:gpu-budget`、浏览器 / 原生检查或性能测试。新增纯逻辑回归用例覆盖偏好迁移、独立 AO 尺寸、共享深度、小尺寸景深、关闭 AO 的回退、100% 原始路径与资源释放；已做语法检查，尚未运行。不得将缓冲像素或采样预算减少称为整机帧率倍数。

背景玻璃 LOD、烘焙替代及阴影停止更新留待本包实机反馈之后；动态阴影和呼吸动画仍按原逻辑更新。下一验收使用同一窗口尺寸、主题和歌曲区域，分别记录常态、连续切歌单、首次封面加载及热缓存帧率，附设置中的“复制性能诊断”。重点观察玻璃边缘、选中封面文字、近远景交界、暖昼 / 深夜、横竖窗口与滚轮循环。

## Perf3：阵列分级、裁剪与切换预算 · 2026-10-09

用户明确要求将距离材质、视野外实例、阴影更新和切换开销一起实现。以下范围已在源码完成，运行验收仍待用户核显测试；上一节是 Perf2 交付时的记录。

- 新分支：`perf/windows-scene-budget`，实现提交 `71ca8fb`，可单独 `git revert 71ca8fb`。
- 优化前 Perf2：`f1daed3` / `checkpoint/windows-perf2-before-scene-budget-2026-10-09`；完整历史备份 `artifacts/rollback/windows-perf2-f1daed3.bundle` 已验证。
- 新包：`release/Rhine-Music-Windows-Perf3` 及独立 perf3 ZIP，Perf2 / Perf1 / Bars 均保留。
- 源码回退前保存改动，再 `git switch --detach checkpoint/windows-perf2-before-scene-budget-2026-10-09`；返回 `git switch perf/windows-scene-budget`。

| 范围 | 最终实现 | 实机待验收 |
| --- | --- | --- |
| 远处玻璃 | 原物理材质近景批次 + MeshStandardMaterial 远景批次；保留环境反射、主题和引导光，用透明度近似透射；按景深模糊像素及焦点距离分级、互补覆盖渐变 | 玻璃密度、边缘和虚化交界可能有差异；远景 alpha 不等于物理透射 |
| 可见实例 | 按整个卡片保守包围球与镜头视锥筛选，压紧实例提交；保留逻辑槽位供点击、循环和图集映射 | 快速导航、窗口缩放、首尾循环、空歌单、点击远景卡片 |
| 阴影 | 独立按灯光视锥筛选投射体，公开 onBeforeShadow / onAfterShadow 仅在阴影通道提交；画面外仍可能投影的卡片保留 | 屏幕边缘地面投影、选中抬升及返回、暖昼 / 深夜 |
| 阴影更新 | 比较累计的模型变换、拓扑、灯光 / 阴影相机与尺寸；动画期间持续更新，静置跳过不超过四分之一阴影 texel 的变化；画质切换强制失效 | 小幅呼吸的软阴影近似、快速操作和过渡终止；不能称为完全静态烘焙 |
| 切换期间准备 | 只安排可见歌曲封面，焦点优先；动画每帧最多 2 项 / 约 1 ms，静置 6 项 / 约 2 ms；解码完成将绘制排队，不立即集中绘制 | 冷封面显示延迟、连续快切、异步过期、退出登录 |
| 切换期间上传 | 动画最多 1 个图集 tile / 约 0.75 ms，静置 4 个 / 约 1.5 ms；优先可见封面，不上传隐藏旧槽位；单次调用允许完成后再让出 | 时间预算属于调用间让出，不能中断单次 Canvas / WebGL 调用 |

新增“阵列渲染：完整材质 / 距离分级”，核显适配及性能预设启用分级，原始 / 高 / 极高保留完整路径。旧 Perf2 偏好只补齐缺失的新控制，不覆盖已保存的选择。关闭景深时保留完整玻璃，仍可裁剪和分帧更新。选中模型和返回中的模型始终使用完整材质；两种批次预创建并在加载阶段预编译，切换歌单不创建新的分级材质。封面图集仍按逻辑槽位持有纹理，压紧提交时重排 UV 和 ready 状态，排队任务不额外持有超出原 16 MiB LRU 的解码像素。

诊断增加可见 / 近景 / 远景 / 阴影实例数、阴影更新 / 跳过次数、待准备封面数、每帧准备 / 上传耗时和上传数量上限。只测量 CPU 调用耗时，GPU 时间仍由原异步计时单独提供。

本轮 TypeScript、JavaScript 语法、diff 格式及生产构建通过；新增逻辑回归覆盖裁剪后逻辑索引、独立阴影范围、互补覆盖、关闭景深、累计阴影位移、偏好补齐及图集映射 / 延迟准备 / 过期覆盖。遵照用户此前要求，这些用例仅检查语法，未运行；没有启动播放器、浏览器、GL 上下文或实机性能测试。GLSL 编译、实际透明排序 / 边缘及 FPS 改善尚未验收。未修改显卡选择或 Windows 图形设置。
## Perf4 · UHD GPU 工作量削减 · 2026-10-09

用户提供的 Perf3 诊断确认了 ANGLE Intel UHD / D3D11、距离分级和共享深度已启用。该次采样平均 13.8 FPS，CPU 提交 P95 2.7 ms，GPU P50 65.92 ms / P95 79.08 ms；可见 214 张、完整玻璃 184 张、远处玻璃 127 张，97 张同时进入两组提交。阴影累计更新 2956 / 跳过 701。上述是用户采样，不能作为新版本的性能成绩，也不是同条件前后对照。

- 分支：`perf/windows-gpu-workload`。改前检查点：`checkpoint/windows-perf3-before-gpu-work-2026-10-09` → `10d9026`，完整 Git 历史备份：`artifacts/rollback/windows-perf3-10d9026.bundle`（已验证）。Perf3 目录、ZIP 和旧检查点保留。
- 核显预设默认开启全部本轮预算：DPR 上限 1、三维主画面上限 1.44 MP、透射尺寸比例 0.25、AO 8 采样 / 半分辨率、景深 13 次颜色采样 / 半分辨率、距离分级。Windows 原生界面文字分辨率不变。旧 Perf2/3 完整核显预设自动迁移一次到版本 4；自定义参数和主动选择的原始画质保留。
- 阵列完整物理玻璃最多 12 张，按焦平面和画面中心排序并用排名滞回减少边界闪烁；近远列表互斥，没有长期双材质几何提交。当前选中及切换残留模型继续保留原始物理材质。
- 远处玻璃改为 Lambert 漫反射 + 环境反射近似 + 原有光带，不计算完整物理透射 / 清漆，不接收逐像素阴影，双面透明材质使用一次提交。阵列形状和封面仍保留，阴影及景深不关闭。
- 阵列软阴影使用预先生成的包围盒投影体（每个实例 12 个三角形），阴影变化阈值放宽到约一纹素，静置最多 8 Hz、显著运动最多 30 Hz；显式质量 / 灯光 / 重建失效立即刷新。颜色与卡片动画仍按原帧循环更新。
- 核显预算启动时，背景图集 tile 从 256 降到 128，RGBA 存储从 108 MiB 降到 27 MiB，单 tile 上传从 256 KiB 降到 64 KiB；选中封面继续 1024。图集规格在场景创建时确定，场景内切到原始画质不会重建已创建的图集；需要重启并选择原始画质做严格对照。
- 完整分辨率景深继续 41 次颜色采样，预算路径改为 13 次并对清晰像素提前返回；共享深度 / 清晰主画面重建 / AO 关闭后的独立深度回退保留。
- 诊断标记 `0.4.1-perf4`。每 32 帧异步计时各后处理阶段，场景阶段包括阴影和透射；不嵌套 GPU 查询，不调用 `gl.finish`。封面上传无工作时清零当前耗时，避免历史 68 ms 被当作当前每帧开销。

这版采用渲染近似和三维分辨率预算，不能承诺与原始逐像素一致。代码检查和打包不验证 GLSL 在 UHD 驱动上的实际编译、视觉或 FPS；没有启动浏览器 / EXE / 音频 / 登录，也没有执行回归脚本。新增或更新的纯逻辑回归用例仅做语法检查。

便携包：`release/Rhine-Music-Windows-Perf4`，ZIP：`release/Rhine-Music-Windows-0.1.0-perf4-preview-x64.zip`。先完整退出旧版，再从新目录启动。回退时完整退出新版本并打开保留的 Perf3；为匹配其旧核显设置，可在旧版选择核显适配预设（两个版本共享用户偏好）。

交付代码提交 `1ba9423`（主体实现 `a081e91`），离线构建 `ada11d870eefb47c`。生产构建、TypeScript、两个变更检查脚本的语法与 diff 格式检查通过。便携 ZIP 内 4633 个文件逐一通过 SHA-256 校验，ZIP 309771196 字节，SHA-256 `ce260e2aca98c411e1f21911b5a6a1e29369be544de3fdb45cda0732123beb9c`。再次核对 Perf1 / Perf2 / Perf3 的原 ZIP 哈希均未改变。实现标签 `preview/windows-perf4-2026-10-09` 保存这版代码。上述打包校验没有运行程序或 GPU 着色器。

## Perf5 · 原生清晰封面与 SMAA · 2026-10-09

用户 Perf4 采样为 29.7 FPS / GPU P50 26.52 ms / P95 30.5 ms，场景阶段 P50 20.93 ms、AO 3.78 ms、景深 1.56 ms、输出 0.49 ms；SMAA 关闭，三维 1553×927 放大到约 2K 屏幕。截图显示斜边锯齿与封面模糊。这些是用户提供的采样，不能视为新版本成绩或严格同条件对照。

- 回退检查点 `checkpoint/windows-perf4-before-cover-clarity-2026-10-09` → `72dda5d`，完整备份 `artifacts/rollback/windows-perf4-72dda5d.bundle` 已验证。分支 `fix/windows-cover-clarity`。保留 Perf4 目录 / ZIP。
- 核显主画面预算仍为 1.44 MP、12 张近处完整玻璃、互斥近远提交、简化 / 限频阴影、8 采样 AO 和半尺寸 13 采样景深。默认启用 SMAA。精确旧核显预设一次性迁移到偏好版本 5，用户自定义 / 原始选项保留。
- 只将呈现画布升级到屏幕分辨率，复杂模型和后处理继续在预算分辨率运行。OutputPass 输出后，将已有场景颜色复制到画布，再单独绘制封面；封面不受玻璃透射或景深模糊影响。画布抗锯齿沿用原 WebGL context 的 MSAA（驱动支持时），模型使用预算分辨率 SMAA。
- 封面层共享 AO 法线深度，AO 关闭时复用景深深度；两者都关闭时才补充独立廉价深度回退。允许自身盖板 0.16 世界单位深度间隙，避免将封面直接置顶或透过其他模型；遮挡边缘和间隙值尚需实际视觉验收。
- 原 print 材质 / 光带及纹理复用，当前卡片、阵列和切换残留封面均支持；清晰阶段临时更改深度测试 / 曝光及模型可见性，finally 全部恢复。深度采样状态在普通绘制中关闭并解绑，避免 framebuffer feedback；不重复更新阴影 / 玻璃透射。
- 用户提供的 Perf4 图集实际上是 256px / 108 MiB。此前文档称核显启动为 128px，但场景先 load 后 setQuality，因此该条件没有在默认启动生效；本轮明确保留 256px 背景图集和 1024px 选中封面以保清晰度，不将 27 MiB 当作已测收益。
- 诊断标记 `0.4.1-perf5`，新增原生画布尺寸、context 抗锯齿信息、清晰封面状态及 `nativeClearCovers` 阶段 GPU 耗时。原生封面、SMAA 和额外输出复制有成本，不能保证保持原 FPS。

仅类型 / 语法 / 差异检查、生产构建和打包，不启动程序、浏览器、GL 或音频，不执行回归脚本。新增用例仅语法检查，涉及偏好迁移、场景 / 材质恢复和故障清理；遮挡、图像、MSAA / SMAA 以及 UHD 性能待用户实机检查。便携目录 `release/Rhine-Music-Windows-Perf5`，ZIP `release/Rhine-Music-Windows-0.1.0-perf5-preview-x64.zip`。

交付代码 `113243a`，标签 `preview/windows-perf5-2026-10-09`，离线构建 `8d04df274e4ba1bc`。TypeScript、相关脚本语法、diff 和生产构建通过；ZIP 内 4633 个文件逐一哈希验证，大小 309775362 字节，SHA-256 `78a314dfc5d5938a708306f7c5cd9922a711883ec3e3ff29328a15263a81de39`。再次确认 Perf4 原 ZIP 哈希不变。本轮没有运行或测量新版本。

## Perf6 · 可见卡片全部完整玻璃对照 · 2026-10-09

用户要求恢复屏幕内所有卡片的完整玻璃以比较帧率。本轮只改变阵列材质策略，其他渲染预算沿用 Perf5；完整物理着色不代表原始分辨率和所有效果预算也恢复。

- 独立分支 `perf/windows-visible-full-glass`。修改前检查点 `checkpoint/windows-perf5-before-visible-glass-2026-10-09` → `116422b`，完整 Git 历史备份 `artifacts/rollback/windows-perf5-116422b.bundle` 已验证。Perf5 运行目录与 ZIP 保留。
- 所有保守视锥内的卡片都用原阵列 MeshPhysicalMaterial，取消近景排名、12 张上限、远景 Lambert 网格以及覆盖 discard。完整玻璃仍接收阴影；选中和返回模型的材质沿用原实现。
- 非玻璃与玻璃表面共同使用单个可见变换缓冲，保留逻辑槽位、点击映射、独立画外阴影投射范围与简化 / 限频阴影。清晰封面、SMAA、主画面像素预算、透射尺寸、AO / 景深以及封面上传预算不变。
- 设置中 `arrayBudget: 1` 改名“可见完整玻璃”，`0` 为“全阵列完整玻璃”；偏好数值和迁移版本不变。前者保留裁剪与预算，后者沿用原完整阵列路径。核显适配继续默认启用前者。
- 诊断版本 `0.4.1-perf6`，策略 `all-visible-physical`；开启可见模式时 `nearGlass === visible`、`farGlass === 0`、`nearLimit === null`、`overlappingGlass === 0`。nearGlass 是兼容旧版诊断的完整玻璃数量名称，不再代表距离分级。

此前用户采样约 211 个可见实例，恢复完整玻璃涉及大量重叠透射表面，帧率可能降低。包只用于本地对照；仍按用户要求仅类型 / 脚本语法 / 差异检查、生产构建和包校验，不运行播放器或测量 FPS。更新的纯逻辑回归覆盖失焦可见卡片完整材质、密集阵列无数量上限、景深开关独立、逻辑点击及画外投影，仅作语法检查。

便携目录 `release/Rhine-Music-Windows-Perf6`，ZIP `release/Rhine-Music-Windows-0.1.0-perf6-preview-x64.zip`。同一电脑、窗口尺寸、主题、歌曲区域和“核显适配”预设下对照 Perf5 / Perf6，分别记录静置、连续切歌单和热缓存场景的 FPS / GPU 阶段耗时；单实例机制要求先完全退出另一版本。源码回退前保存当前改动，再 `git switch --detach checkpoint/windows-perf5-before-visible-glass-2026-10-09`，返回 `git switch perf/windows-visible-full-glass`。

交付实现 `5a05cf7`，标签 `preview/windows-perf6-2026-10-09`，离线构建 `8222758e04c6260c`。TypeScript、相关脚本语法、diff 格式和生产构建通过；打包资源的 Perf6 版本 / 完整玻璃策略标记已核对。ZIP 内 4633 个文件逐一通过 SHA-256 校验，大小 309776212 字节，SHA-256 `5f1ee8b8e2b496d9b40d99f2860b9f526fe3b6281da34c9d7fd261b59d471411`。Perf5 原 ZIP 哈希未改变，回退 bundle 再次验证通过。没有启动程序、执行回归用例或测量新帧率。

## Perf7 · 完整玻璃的区域遮挡 · 2026-10-09

用户反馈 Perf6 约 17 FPS，要求减少板面中被遮挡部分的工作，同时保留完整玻璃。17 FPS 是用户反馈，不是本轮测量，也未提供同次 GPU 分段数据。

- 分支 `perf/windows-glass-occlusion`。改前检查点 `checkpoint/windows-perf6-before-glass-occlusion-2026-10-09` → `77b23e6`；完整历史备份 `artifacts/rollback/windows-perf6-77b23e6.bundle` 已验证。Perf6 目录、ZIP 与旧检查点保留。
- 新 `GlassVisibilityRenderPass` 每帧重建主画面廉价深度，再绘制原物理材质。深度代理选择原玻璃正面平坦三角形的精确子集，保留顶点、深度、绕序、圆角和孔洞；排除侧面 / 背面 / 倒角以降低辅助通道的几何成本。用向后的微小 polygon offset 保守保留浮点差异处工作，不改变原模型或创建填实的包围盒。硬件深度测试在昂贵玻璃着色之前拒绝后方片段，优化单位是板面中的像素区域，主场景三角形没有按遮挡永久删除。
- 适用条件限定为三种已知音乐外壳、最终颜色不混合且写入深度的 FrontSide / LessEqualDepth 物理材质；普通 alpha、透明混合、裁剪、变形、wireframe、未知自定义外壳均不使用。当前 Three 先独立捕获 opaque 透射背景，最终主画面里的较近外壳覆盖较远外壳颜色；深度代理只用于主颜色目标，不用于透射背景。该推理针对本项目渲染近似，不是一般透明层的遮挡规则。
- 真实材质、逻辑池 / 点击、独立阴影投射体、AO / 景深场景、清晰封面、SMAA 与 Perf6 像素预算保持原实现。深度阶段不消费阴影失效标记；主颜色阶段仍允许透射目标清除自己的深度。仅暂时移除强制清屏的 Color 背景，保留相同清屏颜色，finally 恢复状态。
- 三类调试按当前姿态分类：深处遮挡（红）、边界 / 动效不确定（黄）、当前露出核心（绿）。动效中全部归不确定，不声称采样能证明全局永久隐藏或永久露出。分类是诊断可视化，实际剔除来自每帧同分辨率深度，不由低分辨率分类掩码控制；小采样误差不能裁掉模型。重叠层按各类计数比例混色。
- 设置添加开启 / 关闭对照 / 三类调试，默认开启、会话内即时切换，不变更已保存画质。关闭恢复新增预绘制前的颜色流程，保留同一主画面尺寸与材质，适合同窗口对照；重启恢复开启。
- 正常模式每 256 帧、首个第 64 帧才做低分辨率投影层面积估计，最多一项异步回读。统计与调试依赖 EXT_color_buffer_float / EXT_float_blend；缺失或诊断失败时记录 unavailable，不阻断优化。深度采样从独立快照获取，避免 framebuffer feedback。面积按重叠层计数，不能当作屏幕面积精确值或 FPS 比率。调试每帧额外绘制且覆盖画面，仅用于判断区域，不用于对比性能。
- 诊断版本 `0.4.1-perf7`。`optimization.glassVisibility` 记录当前是否启用、深度绘制 / 原玻璃三角形、CPU 提交耗时、面积样本、扩展 / 错误状态；GPU 分别记录 `glassVisibilityDepth`、`sceneWithShadowsAndTransmission` 和可用的统计 / 调试阶段，避免查询嵌套。比较整帧及深度 + 主场景合计，不能只看主场景减少。

检查范围仍遵从用户此前要求：类型、脚本语法、差异、生产构建及便携包完整性，不执行回归脚本、不启动 EXE / 浏览器 / GL / 账号 / 音频，也不测量 FPS。新增纯合成用例覆盖精确三角形子集、不透明深度资格、矩阵 / 世界变换共享、隐藏父节点、关闭对照、异常状态恢复、阴影更新归属、诊断扩展缺失、有界异步统计与过期结果丢弃；仅作语法检查。GLSL 实际编译、depth offset、接缝与 UHD 成本待用户同条件实机验收。

包目录 `release/Rhine-Music-Windows-Perf7`，ZIP `release/Rhine-Music-Windows-0.1.0-perf7-preview-x64.zip`。先完整退出旧版本，再启动新 EXE；同一歌曲位置、主题、窗口大小和核显预设下即时开 / 关对比，观察常态、抬升、详情旋转、连续切歌单与冷 / 热封面。回退源码前保存改动，再 `git switch --detach checkpoint/windows-perf6-before-glass-occlusion-2026-10-09`，返回 `git switch perf/windows-glass-occlusion`；回退程序则关闭新包并启动原 Perf6。

实现提交 `32283a7`，标签 `preview/windows-perf7-2026-10-09`，离线构建 `a32c3a955ae5adcd`。TypeScript、相关脚本语法、差异检查和生产构建通过，打包资产版本、深度算法、精确前盖子集、GPU 阶段与设置标记已核对。ZIP 4634 个文件逐一通过 SHA-256 校验，大小 309791137 字节，SHA-256 `075a8b669490d146d46405eee809d342e29136e3161f8ffa0a30caad79844758`。Perf6 原 ZIP 哈希保持不变，完整回退 bundle 已验证。未运行新增用例、播放器或 GPU shader，不宣称实机视觉 / FPS 已通过。

## Perf8 · 独显偏好、自动画质与提前准备 · 2026-10-09

用户认可 Perf7 效果，授权优先使用 MX550 并在无独显时保留核显，默认按电脑配置选择画质，同时提前准备封面及悬停歌名。

- 分支 perf/windows-gpu-autoconfig-prefetch。修改前检查点 checkpoint/windows-perf7-before-gpu-prefetch-2026-10-09 → 243b5ba，完整历史 artifacts/rollback/windows-perf7-243b5ba.bundle 验证通过。Perf7 EXE 目录及 ZIP 保留。
- Windows 宿主导出 NVIDIA 文档指定的 NvOptimusEnablement DWORD=1，MSVC 显式 DATA 导出保留 LTO / stripping 后符号；在创建 Tauri / WebView2 之前向已有 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 追加 Chromium 的 --force_high_performance_gpu，保留 Wry 默认与已有外部参数。WebGL high-performance 原有偏好保留。不硬编码适配器编号，不关闭 GPU blocklist / sandbox，不改系统注册表或用户显卡设置。Chromium 的适配器枚举和单 GPU 默认路径处理无独显情况；OS / 驱动 / 外部配置仍可能覆盖请求。
- 通过顶层初始化脚本记录请求策略，设置与诊断用创建 WebGL 后的真实 renderer 显示实际使用显卡；请求与实际结果分开。静态 PE 检查验证 x64、导出 DWORD 值和 WebView2 标志存在，不将静态检查当作实机 MX550 已调用。
- 新自动 / 手动画质偏好。实际 GPU 字符串、是否允许 unmask、窗口原生像素以及 CPU / memory 提示共同用于保守预设；未知 / 隐藏型号使用核显预算，软件渲染 / 低资源使用性能预设。MX 系列、老入门显卡使用独显适配 207 万像素 / SMAA / 半分辨率透射；较强已识别独显使用增强适配 369 万 / SMAA / 75% 透射。UHD 使用已有 144 万核显预设。两种独显预设保留可见完整玻璃、阴影预算、区域遮挡、半分辨率 AO / 景深；没有直接自动使用昂贵的“高 / 极高”。型号策略属于启发式默认值，不是完整硬件性能排名或帧率承诺。
- pixelBudget 与 arrayBudget 分开，像素上限不再依赖是否使用可见裁剪。旧偏好回填原先预算，原始 / 高 / 极高仍为 829 万上限；清晰封面原生呈现显式保留 829 万独立上限，避免随 MX / 核显主缓冲降分辨率。自动配置在 scene.load 前应用，避免先按旧默认准备昂贵资源。既有明确手动 / 自定义 / 原始或高画质保持，旧精确 balanced 默认和首次桌面用户转自动；调整任何画质控制后转手动，每次启动自动模式重新识别本机。
- 封面预加载采用现有 CoverAtlas 去重 / 缓存 / 解码，当前与相邻歌曲先保留 1024px，其余可见候选保留 256px，最多扫描 192 个候选。待解码计划上限 32，换区域取消旧的未开始后台任务；实际可见与选中请求可提升优先级。后台仅占两个解码通道，第三通道留给前台请求。图像 LRU 增至 48 MiB / 192 条，绘制缓存为 32 个小 tile（8 MiB）；聚焦候选在背景扫描后重新置为近期。增加缓存会增加内存，未增加 108 MiB 图集尺寸或整图 GPU 上传。预载不绘制 / 上传所有纹理，已有动效 2 项 / 1ms 与静置 6 项 / 2ms 的准备、局部上传和 stale-slot 保护继续使用。
- 可见柱子及前后相邻 50 首分页提前准备，元数据 HTTP 保持两并发和 96 页 LRU；当前选中 / 悬停优先，快速滚动的后台 admission 限制为 8 项 pending（必要前台请求不受此限制）。旧账号 / 新视口 epoch 防止预载继续遍历；后台失败允许后续重试，不覆盖播放错误。已缓存歌名同步显示，不经过 120ms debounce，也不先写“读取歌名”；冷请求保留歌曲编号再更新实际标题。冷网络 / 刚跳至远处仍可能等待，不宣称离线全歌单即时可见。
- 诊断版本 0.4.1-perf8，记录 GPU 请求、实际 renderer、自动 / 手动策略及预载请求、缓存命中、内存 / 队列上限；不包含歌曲名、封面 URL、目录、账号凭据。

检查仅类型 / JavaScript 语法 / Rust 编译、发布 EXE 静态 PE 导出、生产构建及 ZIP 哈希，遵从此前不运行检查的要求。新增自动画质用例与扩展的封面 / 歌名纯合成用例仅语法检查，涵盖 MX / UHD / 软件 / 型号隐藏、手动偏好迁移、解码预载的内存 / 并发 / 优先级 / 取消、预热后的即时选中和相邻歌名页去重；没有执行回归、EXE、GL、账号或音频，不报告实测 FPS / 视觉 / 显卡切换通过。

交付目录 release/Rhine-Music-Windows-Perf8，ZIP release/Rhine-Music-Windows-0.1.0-perf8-preview-x64.zip。完整退出旧版后启动新的 EXE，设置检查实际显卡与画质模式，并对比静置 / 连续切歌单 / 冷热封面与悬停文字；复制诊断可复核是否实际 MX550 或 UHD。程序回退使用保留 Perf7 包并重新选择核显适配；源码回退前保存改动，然后 git switch --detach checkpoint/windows-perf7-before-gpu-prefetch-2026-10-09，返回 git switch perf/windows-gpu-autoconfig-prefetch。

参考来源：NVIDIA [Optimus Rendering Policies](https://developer.download.nvidia.com/devzone/devcenter/gamegraphics/files/OptimusRenderingPolicies.pdf)，Microsoft [WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)，Chromium [GPU init / preference selection](https://chromium.googlesource.com/chromium/src/gpu/+/8aad0322f22b8d8f95c0763974a0bf226fd60de4/ipc/service/gpu_init.cc) 与 [high-performance GPU test configuration](https://chromium.googlesource.com/chromium/src/+/699e7897d58cdf7c76c4ed6ecc1b97f3e6ef5683/infra/config/generated/testing/mixins.pyl)。直接使用本地 Tauri 2.12.1 / Wry 0.57.0 实际接口；环境变量保留 Wry 默认参数与 WebView 用户数据目录，未替换 profile 或读取私人曲库。

交付实现 3891edd，标签 preview/windows-perf8-2026-10-09，离线前端构建 6e4660fa885e8297。发布 EXE 为本轮新编译，38155776 字节，SHA-256 256862c9fc5d5601e1d510140eefc7a588c3004a841d57ff2a954fdbcf098578；静态 PE 导出与偏好标志通过。最终 ZIP 4636 个文件逐一通过 SHA-256 校验，309826813 字节，SHA-256 670741faeec006020173b91e415254a25e2015685e34763a5915cda50cd1cce9。包中 perf8、自动画质及封面 / 歌名预载标记已核对；Perf7 ZIP 保持原哈希 075a8b669490d146d46405eee809d342e29136e3161f8ffa0a30caad79844758。没有启动播放器或执行新增回归，实际显卡、帧率、视觉与冷网络表现仍待用户实机确认。

## Perf9 · 我的歌单整体展示与界面提示清理 · 2026-10-09

用户要求点击“我的歌单”直接进入原版已有的整体展示视角，并删除软件中的操作提示文字。

- 独立分支 ui/windows-playlist-overview；改前检查点 checkpoint/windows-perf8-before-playlist-overview-2026-10-09 → 1d3bf96；完整 Git 历史 artifacts/rollback/windows-perf8-1d3bf96.bundle 验证通过。保留 Perf8 原 EXE 目录和 ZIP。
- “我的歌单”不再打开列表弹层，复用现有 MusicOverviewMotion / MusicOverviewUI 镜头与投影标签。已有歌单无需重新登录或整库刷新；从详情进入时通过原 presentation 返回流程，等待安全的 archive 阶段再进入总览。空账号允许进入空白模型总览；打开其他面板、Escape、账号变化会取消尚未完成的总览请求。
- 去掉歌单模式的 overview 禁用条件与切换按钮隐藏，修复元数据刷新无条件退出总览。歌单总览的标题、入口、方向导航、回到近景均使用现有交互；从总览点模型 / 歌单入口先回到近景，近景再次点选中模型继续进入详情并播放。歌曲播放不因进入总览停止。
- 歌单物理位置有 +2 偏移，循环周期是歌单数而非含两个占位列的 archiveColumns.length。总览投影与邻近列位置改用正确周期，当前高亮按同一偏移还原；标签计数使用 playlistCell.total，而非当前已加载页的数量，显示“首歌曲”和从 01 开始的歌单序号，零歌曲歌单仍有入口。
- 删除主界面方向键 / Enter / Space / V / Escape 快捷键说明、总览教学文案、拖动封面与 360° 查看器手势说明；去掉窗口按钮、播放按钮、登录按钮与调试面板关闭按钮的操作 tooltip。歌名 / 歌单名等内容 tooltip、柱子悬停歌名及无障碍 aria 名称保留。
- 设置、画质精细控件、音乐库、分类规则、登录二维码、搜索及调试面板的操作说明段落清理；删除常规保存 / 复制 / 开始扫描的成功提示弹条。实际加载 / 登录 / 播放状态、错误、曲目资料、版权与按钮名称保留。移除说明的同时清理代码里对应 DOM 查询，避免删元素后运行时空引用；快捷键和鼠标操作本身保留。
- Perf8 显卡请求 / 自动画质 / 封面与歌名预载、完整玻璃和区域遮挡保留。无 Rust 源码变更，沿用已编译并静态验证过的 Perf8 NVIDIA / WebView2 宿主 EXE，更新外置前端资源；诊断版本 0.4.1-perf9。

按用户此前要求，仅进行 TypeScript、相关 JavaScript 语法、diff、生产构建、EXE 静态信息和便携包哈希校验，不执行回归脚本、不运行播放器 / WebView / GL / 账号 / 音频。现有 UI 合成用例增加歌单总数与空歌单标签，浏览器回归改为验证“我的歌单”进入总览且无弹层、返回近景后仍可通过歌单名打开管理列表；这些用例仅语法检查，不能视作实机交互通过。

包目录 release/Rhine-Music-Windows-Perf9，ZIP release/Rhine-Music-Windows-0.1.0-perf9-preview-x64.zip。关闭旧版后运行新包，确认我的歌单直接整体展示、分页 / 封面补齐不退出总览、长短 / 空歌单标签及入口、近景再次点击播放，并检查操作提示已移除。程序回退启动保留 Perf8；源码回退前保存改动，再 git switch --detach checkpoint/windows-perf8-before-playlist-overview-2026-10-09，返回 git switch ui/windows-playlist-overview。

交付实现 c15f1b6，标签 preview/windows-perf9-2026-10-09，离线前端构建 51f465b44f4afd9a。TypeScript / 生产构建、相关回归文件 JavaScript 语法与 diff 检查通过；包内前端版本、歌单总览标题及已删除提示标记静态核对通过。宿主沿用 Perf8 的 x64 EXE，SHA-256 256862c9fc5d5601e1d510140eefc7a588c3004a841d57ff2a954fdbcf098578；静态 PE 检查确认 NvOptimusEnablement=1 和 WebView2 偏好标志，runtimeChecked=false。ZIP 4636 个文件逐一通过 SHA-256 校验，309824918 字节，SHA-256 ea8efe2f92a1008fefdc9830b30b6dfec63a9f99e6cf4b31961c1df719d5a4eb。Perf8 ZIP 哈希仍为 670741faeec006020173b91e415254a25e2015685e34763a5915cda50cd1cce9。没有启动播放器或执行回归，实际交互与视觉效果待用户实机确认。

## Perf10 · 歌词播放、歌曲资料与毛玻璃歌单 · 2026-10-09

详细范围、资源上限、验证边界与回退方法见 [WINDOWS-PERF10.md](WINDOWS-PERF10.md)。分支 ui/windows-lyrics-playlist-cards；检查点 checkpoint/windows-perf9-before-lyrics-playlists-2026-10-09 → e1c6350，完整历史 bundle 已验证，Perf9 程序与 ZIP 保留。歌曲详情接上播放，单一开始 / 停止按钮及歌词切换、歌词内控制与详情外顶部进度；网易云歌曲 / 专辑 / 歌词资料由现有第三方 SDK 读取，缺失值不伪造。总览歌单名称点击变为毛玻璃分页歌曲列表，返回箭头和歌曲直接播放复用原播放器。抽出封面去除自身玻璃实体阴影、清晰呈现提升；深度预绘制限定阵列实例，原自动画质与阵列遮挡保留。上游四并发和有限等待队列优先播放，资料 / 歌词有界缓存与账号失效保护。

本轮仅类型、JavaScript 语法、生产构建、静态 PE 与包哈希检查，没有启动 EXE / 浏览器 / GL / 账号 / 音频，没有执行新增或更新回归，也不将代码检查当成实机视觉与交互通过。离线前端构建 230f262a15369481，141 模块、77 离线文件。交付目录 release/Rhine-Music-Windows-Perf10，压缩包 release/Rhine-Music-Windows-0.1.0-perf10-preview-x64.zip。

交付实现 f7c40a2，标签 preview/windows-perf10-2026-10-09。TypeScript / 生产构建、更新的本地服务与相关回归脚本语法及 diff 检查通过；包内 perf10、歌词 / 进度 / 合并按钮 / 歌单列表标记和资料服务路由已静态核对，旧详情控件已移除。沿用 x64 宿主，静态 PE 确认 NVIDIA DWORD=1 与 WebView2 偏好标志，runtimeChecked=false。ZIP 4638 个文件逐一通过 SHA-256 校验，309846879 字节，SHA-256 f71fdfdcc37315ecd4f453671a136aa1c20bbd7706c8899f6805bac93d0292cf。Perf9 原 ZIP 保持 ea8efe2f92a1008fefdc9830b30b6dfec63a9f99e6cf4b31961c1df719d5a4eb。未执行测试 / 应用 / 在线资料调用，实际视觉及交互仍待用户确认。

## Perf11 · 当前平台曲库与账号歌单 · 2026-10-09

新分支 ui/windows-song-navigation-platforms；改前源码 a293401，检查点 rollback/windows-before-perf11-2026-10-09，artifacts/rollback/windows-perf10-a293401.bundle 已验证。Perf10 EXE 目录和 ZIP 保留，未修改原生宿主。

完成三平台登录选择、当前平台搜索和个人歌单、对应歌曲播放 / 资料 / 歌词；平台切换清理旧账号缓存及队列，DPAPI 独立保存会话，取消 / 过期 / 退出与落盘串行保护。歌曲列表连续虚拟滚动，点歌退出总览定位模型，去掉分页、轨道背景及箭头。详情右侧中文上一首 / 下一首，进度条附近删除重复按钮和状态字样；完整歌词文档可滚动和点击 seek，原播放器负责播放状态。实现、资源上限和公开协议来源见 WINDOWS-PERF11.md。

新增 / 扩展纯合成平台、账号切换和浏览器交互用例，只语法检查，不执行测试。只进行 TypeScript、JS 语法、生产构建与 EXE / ZIP 静态检查；未运行应用、浏览器、GL、账号、在线接口或音频。第三方平台端点及真实账号歌单 / 权限 / 音源需要用户实机确认，不能将静态构建通过当成三平台实测通过。

Perf11 交付实现 4356130，标签 preview/windows-perf11-2026-10-09。TypeScript、相关服务 / 用例 JavaScript 语法、diff 与生产构建通过；142 模块，离线构建 da79886dadcce7e7，77 文件。包内 perf11、三平台入口、连续列表、歌词时间按钮及重复控件移除已静态核对；原生 x64 宿主 SHA-256 256862c9fc5d5601e1d510140eefc7a588c3004a841d57ff2a954fdbcf098578，NvOptimusEnablement=1 / WebView2 偏好标志通过，runtimeChecked=false。ZIP 4645 个文件逐一通过 SHA-256，309876364 字节，SHA-256 8ecbd58b70f4f18a391c63c948c93521e6c09b1a0a78ce02f109f24555562856；无个人会话 / 数据 / 研究仓库。Perf10 ZIP 保持 f71fdfdcc37315ecd4f453671a136aa1c20bbd7706c8899f6805bac93d0292cf。未执行应用、测试或真实平台访问。以上包哈希指已生成本地预览，后补交付记录仅进源码文档，不重写该已校验包。

用户随后提出公开开源时的接口授权问题。当前三平台适配不具有已确认的平台接入 / 曲库授权，现有代码与本地预览不等于通过公开发行合规审查。协议、用户个人信息处理、音乐 / 封面 / 歌词版权及原作资产需要分别核对；没有自动发布、推送或更改用户已授权的功能。正式发行边界待用户决定。

## Perf12 · QQ 会话修复、主题与歌曲遮罩 · 2026-10-09

分支 fix/windows-qq-login-detail-reveal；改前 cd972fd，检查点 checkpoint/windows-perf11-before-login-reveal-2026-10-09，完整 artifacts/rollback/windows-perf11-cd972fd.bundle 验证通过。Perf11 EXE 目录和 ZIP 保留。

按用户要求移除扫码页取消按钮、酷狗登录入口及运行服务路由，两个平台各自曲库 / 歌单绑定保留。QQ 授权改为有界、按域 / 路径管理的每挑战 Cookie 会话，保留原回调参数、确认 / 授权阶段和中途重试状态，校验授权 state；不可恢复的缺失会话结束挑战，不继续无限重试。下拉控件与展开选项按主题设置颜色及原生 color-scheme。歌曲详情及异步资料加入遮罩揭示，歌词按可见区域启动，切换当前行单独揭示并取消旧行动画；减少动态效果直接显示。完整说明见 WINDOWS-PERF12.md。

验证范围仅类型、语法、差异、生产构建及包静态检查，不执行新增合成用例，不运行 EXE / 浏览器 / GL / 登录 / 在线 API / 音频。没有真实 QQ 响应，修复代码缺口不代表已确认平台实机根因或实测成功。沿用现有 x64 原生宿主，独立 Perf12 预览保留 Perf11 可回退。

Perf12 交付实现 8f8b0aa，标签 preview/windows-perf12-2026-10-09。TypeScript、8 个相关 JS 文件语法、diff 与生产构建通过；143 模块，离线构建 8c7ce39097e14341，77 文件。包内 perf12、仅网易云 / QQ 入口、取消按钮移除、下拉主题、可见歌词遮罩及分阶段 QQ 会话标记已静态核对；原生 x64 宿主 SHA-256 256862c9fc5d5601e1d510140eefc7a588c3004a841d57ff2a954fdbcf098578，NvOptimusEnablement=1 / WebView2 偏好通过，runtimeChecked=false。最终 ZIP 4648 个文件逐一 SHA-256 校验，309885735 字节，SHA-256 c02a1082ddb0ecf59c1898e92f3ec694c92e955c22ef3d6200cd85d4994d99a5。Perf11 原 ZIP 保持 8ecbd58b70f4f18a391c63c948c93521e6c09b1a0a78ce02f109f24555562856。没有执行回归、应用或真实平台请求；包哈希记录为打包后的源码文档补记，不重写已校验的包。

## Perf13 · 可见文字遮罩、QQ 曲库与圆角图标 · 2026-10-09

分支 fix/windows-reveal-qq-catalog-icon；改前 879ca77，检查点 checkpoint/windows-perf12-before-reveal-catalog-2026-10-09，完整 artifacts/rollback/windows-perf12-879ca77.bundle 验证通过。Perf12 EXE 目录和 ZIP 保留。

针对用户实测遮罩未出现，消除软件与系统减少动画开关的样式冲突，并将正文 / 歌词改为复用标题的实体 DOM 逐行遮罩。详情面板真正 open 且未被遮挡后才开始，标题隐藏期间暂停，正文关闭 / 最小化撤下动画；仅可见歌词测量与揭示，未同步歌词也逐行观察。修复 inline 来源标签 clientWidth 为零时的遮罩宽度。正文仅一个观察器、一个按需 RAF；减少动态效果直接显示。

QQ 搜索修正请求信封与蛇形分页字段；账号业务使用 Web 鉴权，补齐 qqmusic_uin、g_tk 与独立音乐账号 ID。自建 / 收藏歌单各自有界分页合并，私有喜欢歌单的 encrypt_uin 查询携带会话。失败显示错误，不缓存成空账号。真实平台协议有变动可能，升级后建议重新登录 QQ；没有用真实账户访问平台，实测待用户确认。图标保留原标志，生成透明圆角和七尺寸 ICO，原生 EXE 重新编译并保留 GPU 偏好。实现与协议来源见 [WINDOWS-PERF13.md](WINDOWS-PERF13.md)。

遵从只检查代码的要求，仅类型 / JS 语法、生产构建、原生编译、静态 PE / 图标和便携包完整性检查。QQ 请求形状、两源分页、错误处理、长 ID 合成用例只语法检查，不执行回归或应用 / 浏览器 / GL / 登录 / 音频。独立 Perf13 预览保留 Perf12 回退，实际动效、账号曲库和性能不作为已验收。

Perf13 交付实现 3d4778f，标签 preview/windows-perf13-2026-10-09。TypeScript、7 个改动 JS 文件语法、diff、生产构建与 Rust 发布编译通过；143 模块，离线构建 b49f09924c715973，77 文件。新 EXE 38188544 字节，SHA-256 92d9cd545e5e13f8bf9ef737846369bf84bf05ac51f9d143c4873a250ad241f3；静态 PE 验证 x64、NvOptimusEnablement=1 / WebView2 偏好，七尺寸 PNG 与 ICO 内容逐一匹配 RT_ICON、存在 RT_GROUP_ICON 且四角 alpha 为零。包内 Perf13 版本、实体遮罩共享模块 / 可见门控样式、QQ 搜索与歌单请求标记已核对，runtimeChecked=false。最终 ZIP 4650 个文件逐一 SHA-256 校验，309937216 字节，SHA-256 df96a0f54805955d5bf06049c2867ea64393769e205d4ed1f2e8202bcfd37594。Perf12 ZIP 保持 c02a1082ddb0ecf59c1898e92f3ec694c92e955c22ef3d6200cd85d4994d99a5。没有执行回归、应用或真实平台请求；交付哈希仅在打包后补记源码文档，不重写已校验包。

## Perf14 · QQ 喜欢歌单与音源请求 · 2026-10-09

分支 fix/windows-qq-preview-identity；改前 9740a48，检查点 checkpoint/windows-perf13-before-qq-preview-2026-10-09，完整历史 artifacts/rollback/windows-perf13-9740a48.bundle 已验证。Perf13 目录与 ZIP 保留，程序及源码均可回退。

移除喜欢歌单的强制 encrypt_uin / 主页查询前置条件；使用带会话的 disstid 0 / dirid 201。播放改为官方 Web CgiGetVkey 自动选择音源，完整 uin / loginflag / platform 参数与 req_0 信封；必要时仅一批实际 media_mid 普通 MP3 / AAC 兼容请求。空地址不能证明会员状态，未实现虚构的试听 API，平台返回可播放片段时沿用。账号代数、请求 / 缓存边界与 CDN 白名单保留。具体说明和公开参考见 WINDOWS-PERF14.md。

按用户要求只检查代码、构建和包文件，不执行新增合成用例或播放器 / 浏览器 / GL / 登录 / 音频 / 真实平台 API。宿主沿用 Perf13 已验证 EXE，前端与服务重新构建；真实账号的喜欢歌单、整曲及试听仍待用户确认。

Perf14 实现提交 12dab4002a0169f1f87b7a7220086601dc5a2652，标签 preview/windows-perf14-2026-10-09。四个改动 JavaScript 文件语法、TypeScript、diff 和生产构建通过；143 模块、离线构建 9a2658ecb720fe18、77 文件。便携包内服务脚本与生产入口逐字节匹配源码 / 构建产物，诊断版本和遮罩标记存在，随包文档与 README 匹配；runtimeChecked=false。EXE 保持 38188544 字节，SHA-256 92d9cd545e5e13f8bf9ef737846369bf84bf05ac51f9d143c4873a250ad241f3。ZIP 4651 个文件逐一 SHA-256 校验，309943339 字节，SHA-256 ac1ef0705c9214aa2b8689d77424401529a745273827026376319ebe78f620d1。Perf13 ZIP SHA-256 仍为 df96a0f54805955d5bf06049c2867ea64393769e205d4ed1f2e8202bcfd37594，完整历史 bundle 再次验证通过。交付哈希在打包后补记源码文档，不改写已校验包。

## Perf15 · 详情背景、歌词与控件 · 2026-10-09

分支 fix/windows-detail-background-lyrics；改前 9160085，检查点 checkpoint/windows-perf14-before-detail-fix-2026-10-09，完整历史 artifacts/rollback/windows-perf14-9160085.bundle 已验证。Perf14 目录与 ZIP 保留，源码 / 运行版本均可回退。

调整可能产生远处锐利横条的景深失配回退和后置清晰封面路径，详情背景遵循景深，抽出封面保持清晰；不删背景模型，不关闭完整玻璃 / 面积遮挡。歌词只在进入页面时揭示初始可见行，切句 / 滚动直接显示，内容不变的缓存刷新不重建歌词。无边框播放按钮、SVG 中文切歌和悬停进度圆点支持两种主题及减少动态效果。说明见 WINDOWS-PERF15.md。

仅 TypeScript / JavaScript 语法、diff、生产构建与包校验，状态恢复和控件用例只更新 / 语法检查，不执行。宿主沿用 Perf13 / Perf14 已验证 EXE；没有应用 / GL / 登录 / 音频实测，不宣称条纹或视觉已实机验收。

Perf15 实现 78f2e9fc8cb47fb9165b32d8388dadd443b89fb4，标签 preview/windows-perf15-2026-10-09。TypeScript、三个改动 JS 文件语法、diff 和生产构建通过；143 模块，离线构建 008cef74724b0f07，77 文件。包内诊断版本、歌词 entry 标记、详情清晰层控制、景深回退和悬停圆点 / SVG 控件样式静态检查通过；服务脚本、构建入口、随包文档及 README 逐字节一致。宿主 EXE 38188544 字节，SHA-256 92d9cd545e5e13f8bf9ef737846369bf84bf05ac51f9d143c4873a250ad241f3，与 Perf14 相同。ZIP 4652 文件逐一 SHA-256 校验，309947595 字节，SHA-256 113f066e176112d9ca1838a52e1da0280232662c23582044145f60750f644a0a。旧 Perf14 ZIP 哈希 ac1ef0705c9214aa2b8689d77424401529a745273827026376319ebe78f620d1 保持不变，完整历史备份验证通过。runtimeChecked=false；交付哈希仅在打包后补记源码文档，不改写已校验包。

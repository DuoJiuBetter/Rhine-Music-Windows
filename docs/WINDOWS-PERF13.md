# Perf13 · 文字遮罩修复、QQ 曲库与圆角图标

分支 `fix/windows-reveal-qq-catalog-icon`。改前源码 `879ca77`，检查点 `checkpoint/windows-perf12-before-reveal-catalog-2026-10-09`；完整历史 `artifacts/rollback/windows-perf12-879ca77.bundle` 已验证。Perf12 程序目录和 ZIP 保留，诊断版本改为 `0.4.1-perf13`。

## 文字遮罩

用户实测 Perf12 未出现文字遮罩。本轮发现两个确定的代码缺口：系统 prefers-reduced-motion 样式无条件隐藏遮罩，与软件自己的“减少动态效果”设置不一致；IntersectionObserver 可能在详情面板仍淡入时启动歌词动画。没有读取测试电脑的系统设置，不能断言其中哪一个是用户机器上的实际触发条件。

正文及歌词改为复用标题的 DocumentDecryption 实体 DOM 逐行遮罩，去掉伪元素 CSS 动画及 pseudoElement WAAPI 路径。只有详情面板进入 open、未被其他面板或查看器遮住时才启动；标题暂停期间保留揭示进度，正文隐藏时撤下活动动画、再显示时重新排队。音乐模式由软件自己的减少动态效果设置控制，原版演示入口保留其系统偏好行为。

标题、来源、歌手、资料与按钮文字、异步资料和歌词均可揭示；切歌、资料 / 歌词互换、当前歌词变化重置对应文字。歌词用一个观察器、一个按需 RAF 时钟，仅可见文本测量布局并创建遮罩；离开滚动视口的未完成动画撤下并等待下次出现，完成后释放遮罩，隐藏 / 最小化停止正文动画。最多 4,000 行歌词的原有上限保留，不逐帧查询全篇布局，滚动及点击歌词跳转沿用播放器。

## QQ 曲库

- 搜索修正为 `page_num` / `num_per_page`，使用与 module 同名的请求 / 响应 key，不附加顶层 comm。仍携带登录 Cookie，只有搜索业务码 2001 最多额外重试两次，各等待 250ms，其他错误立即上报。
- 账号业务 RPC 使用 Web comm（ct 24、cv 4747474、uin、g_tk / g_tk_new_20200303、authst）；不再使用缺失设备标识的 Android 业务请求。扫码授权的 code 交换保留单独协议与原有会话边界。
- Cookie 补上 qqmusic_uin；保存独立的 musicid、str_musicid 和可用 encrypt_uin。长账号 ID 始终保存为字符串，不把不安全的数值转换成错误账号。QQ / 微信音乐会话继续分别使用正确登录类型。
- 自建和收藏歌单分别调用固定的 `fcg_user_created_diss` 与 `fcg_get_profile_order_asset.fcg`，每源每页 50 项，合并去重，不截断另一源尚未消费的页。识别 diss_name、diss_cover、logo、picurl、songnum 等实际字段；喜欢歌单使用 dirid 201 和私有账号标识。需要补查 encrypt_uin 时使用携带登录 Cookie 的个人资料接口。
- 请求失败、非零业务码与不兼容格式显示错误，不把失败缓存为“账号无歌单”。四并发、16 等待任务 / 12 秒超时、账号 epoch 失效、缓存和本地 Host / Origin 边界保留；不新增任意 URL 代理，不向前端返回凭据或上游原始错误。

公开协议核对使用仓库已有 QQ 资料查询代码，以及 [simple-music QQ API 说明](https://github.com/Yyyangshenghao/simple-music/blob/master/docs/qq-music-api.md)、[请求实现](https://github.com/Yyyangshenghao/simple-music/blob/master/server/lib/qq-client.ts) 和既有 QQMusicapi 的凭据 / Web 通道结构。仅参考协议字段和响应形状，不复制账号数据或整段第三方实现；没有用真实会话请求 QQ 服务。旧版保存会话缺少的新字段无法凭空恢复，建议升级后退出 QQ 音乐并重新扫码一次。

## 图标与检查

保留 Rhine Lab 原矢量标志，背景改成透明圆角。生成 16 / 24 / 32 / 48 / 64 / 128 / 256px 的原生 ICO，更新普通网页图标和 Apple 图标；maskable 图标保留完整底色供系统裁切。原生构建显式跟踪 ICO 修改，重新编译 EXE；NVIDIA / WebView2 显卡偏好保留。静态检查 PNG 透明角和 EXE 资源，不启动程序。

按用户“检测代码即可，不用运行检查”约束：仅 TypeScript、JavaScript 语法、diff、生产构建、原生编译与 PE / 图标 / 包哈希静态检查。新增或更新 QQ 搜索信封、分页不丢收藏歌单、失败不缓存为空、长账号 ID 与错误脱敏的合成用例，只语法检查，不执行测试。没有启动 EXE、浏览器、WebView、GL、登录账号、播放音频或访问真实平台接口。遮罩观感、QQ 真账号歌单 / 音源和帧率仍待用户实机验证，不把构建通过当成实测通过。

独立交付 `release/Rhine-Music-Windows-Perf13/Rhine Music.exe` 与 `release/Rhine-Music-Windows-0.1.0-perf13-preview-x64.zip`。完整退出旧版本再运行，保留整个 runtime。程序回退直接运行 Perf12；源码回退前保存新改动，再 `git switch --detach checkpoint/windows-perf12-before-reveal-catalog-2026-10-09`，返回 `git switch fix/windows-reveal-qq-catalog-icon`。最终构建 / 包哈希记于项目管理文档。

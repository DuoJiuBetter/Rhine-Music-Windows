# Perf11 · 平台账号、连续歌单与可滚动歌词 · 2026-10-09

本轮将网络搜索与“我的歌单”绑定到当前登录的平台，支持网易云音乐、QQ 音乐、酷狗音乐；同时调整总览歌曲选择、连续列表、详情切歌及歌词交互。

## 交互

- 右上角“登录”面板包含三个平台。网易云和酷狗使用各自手机 App 扫码；QQ 音乐可选 QQ / 微信扫码。登录成功或选中已保存且核对成功的账号后，平台成为当前来源，记住平台选择。三个平台分别保存登录状态，退出只清除对应平台，当前来源退出后恢复本地模式；未登录首次网络搜索沿用网易云。
- 搜索默认“网络搜索”，搜索框和来源链接标明当前平台；本地搜索仍可切换。当前平台的搜索、个人创建 / 收藏歌单、歌曲资料、歌词和播放地址使用对应接口。会员、购买、地区、平台风控或服务变化可能导致失败，不能保证搜索到的歌都有完整音源。不进行跨平台音源替换。
- “我的歌单”沿用整体展示及毛玻璃卡片。点击列表歌曲退出总览，定位对应模型，不强制开始播放。再次点击突出模型仍进入详情并播放。歌单列表连续滚动，移除翻页按钮，透明滚动条轨道且隐藏上下箭头。每次仅绘制附近 32 行，后台复用 50 首元数据页，并非一次建立整个长歌单 DOM。
- 歌曲详情保留开始 / 停止共用按钮；右侧加入“← 上一首”“下一首 →”。歌词下方只保留进度条与时间，删除三枚重复控件和正在播放 / 已暂停字样；顶部原有播放 / 暂停继续可用。
- 歌词文档每首只创建一次，播放更新当前句；可上下滚动，手动查看后暂停自动跟随 8 秒，随后恢复。点击带时间的歌词使用原播放器 seek，保留播放 / 暂停状态。无时间轴歌词只展示文字，不伪造时间。详情外仍在顶部控件下展示当前歌词及进度。

## 平台实现与边界

复用已有本地 HTTP 服务、MusicPlayer、歌单缓存、封面图集与前端登录控制器。网易云继续使用锁定的 NeteaseCloudMusicApi 4.32.0；QQ 和酷狗增加服务端适配，未引入整个第三方 SDK 或新的常驻服务。

QQ 协议查阅 [ylw1997/qqmusic-api 的接口示例](https://github.com/ylw1997/qqmusic-api/blob/master/tests/qqmusic_api_test.py) 及 [Suxiaoqinx/QQMusicapi 登录实现](https://github.com/Suxiaoqinx/QQMusicapi/blob/main/src/modules/login.js)。代码独立实现固定端点请求、JSON / 回调数据解析，不执行上游 JavaScript，不复制整个 SDK。QQ 搜索用 SearchCgiService，账号歌单用 PlaylistBaseRead，分页歌曲用 DissInfo，播放用 music.vkey.GetVkey / UrlGetVkey，详情及歌词使用对应平台服务。

酷狗协议参考 [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)，包括二维码、签名参数、设备 MID、账号云歌单、搜索、播放地址、专辑和 LRC。保留 [MIT 原文](../third-party/KuGouMusicApi-LICENSE.txt)。本地实现仅包含所需协议适配；额外验证码 / 风控挑战不自动绕过，失败会返回真实错误。二维码生成复用锁文件已有的 qrcode 依赖。

这些是基于第三方协议的适配，不是平台官方合作 SDK。本轮没有真实账号和上游服务调用，端点、字段、私有歌单范围、音源可用性仍须实际确认。字段结构不符会报错；平台未提供的公司、发行资料及歌词保持缺失状态，不编造信息。

账号凭据各自通过 Windows DPAPI 保存于本机 music-data 内的 netease-session.dpapi / qq-session.dpapi / kugou-session.dpapi，不返回前端、不进入 localStorage / 日志或运行包。账号和平台切换清理旧搜索结果、队列及私人歌单 / 资料缓存；登录代数和串行落盘防止取消、过期或退出期间的响应重新激活旧账号。

新增路由保留 loopback Host / 同源 Origin 约束、JSON 请求体及固定 HTTPS 上游主机限制；音频和封面校验平台 CDN 域名。封面通过本地代理供 WebGL 使用，保持 64 项 / 32 MiB 缓存、4 个下载、最多 32 个等待任务及超时，不附带登录凭据。目录请求 4 并发 / 最多 16 等待、有限响应大小与超时；播放优先，账号代数阻止旧响应回填。元数据缓存 128 项 / 5 分钟，歌曲索引 6000 项；歌词上限与前端两请求、48 项缓存沿用 Perf10。没有改动原有玻璃、区域遮挡、清晰封面、预载或 GPU 自动画质流程。

## 项目管理及验证

修改前源码 a293401938ca3df04956948fa34590ee02e5ec24，检查点 rollback/windows-before-perf11-2026-10-09，完整历史 artifacts/rollback/windows-perf10-a293401.bundle 已验证。独立分支 ui/windows-song-navigation-platforms；Perf10 程序目录和 ZIP 原样保留。

遵从用户“只检查代码，不运行检查”的要求：只做 TypeScript、JavaScript 语法、生产构建、EXE 静态 PE 和包内 SHA-256 校验。新增平台授权取消 / 过期、分页及账号隔离、播放地址域名、签名、封面并发和旧响应失效用例；更新歌单连续滚动、定位模型、歌词点击和界面按钮回归。用例仅语法检查，没有执行。未启动 EXE、浏览器、GL、真实登录、在线搜索或音频，不将静态检查描述为功能或视觉实测通过。

独立交付 release/Rhine-Music-Windows-Perf11 和 release/Rhine-Music-Windows-0.1.0-perf11-preview-x64.zip。退出旧程序再运行新目录中的 EXE，保留 runtime 文件夹。诊断版本应为 0.4.1-perf11。沿用先前已静态核验的高性能 GPU 宿主，实际 GPU 仍以 renderer 为准。

回退可直接运行保留的 Perf10 包。源码回退前保存未提交修改，再 git switch --detach rollback/windows-before-perf11-2026-10-09；返回当前分支使用 git switch ui/windows-song-navigation-platforms。包哈希及最终构建记录见 WINDOWS-PERFORMANCE-PROJECT.md。

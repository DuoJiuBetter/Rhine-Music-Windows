# Rhine Music · Windows

把音乐放进三维玻璃专辑架，浏览自己的收藏。

这是 [RonaldDeng/Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo) V0.4.1 的 Windows 社区衍生版，由 [DuoJiuBetter](https://github.com/DuoJiuBetter) 独立维护；视觉与渲染基础来自 [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI)。本仓库与上游作者、音乐平台及原作品牌方没有官方合作关系。

**[下载 Windows x64 安装包](https://github.com/DuoJiuBetter/Rhine-Music-Windows/releases/download/v0.2.0-public-preview/Rhine-Music-Windows-0.2.0-public-preview-x64-Setup.exe)** · [版本更新与其他下载](https://github.com/DuoJiuBetter/Rhine-Music-Windows/releases/tag/v0.2.0-public-preview) · [使用说明](README.windows.md) · [平台与权利说明](PLATFORM-NOTICE.md) · [隐私说明](PRIVACY.md) · [资源来源](NOTICE.md)

## 当前版本

**0.2.0 Public Preview · 2026-10-20**，应用内诊断版本为 0.4.1-preview-model-loop-1-public。这是开发预览版，平台接口、网络、账号权限和显卡驱动会影响实际表现，尚未完成所有电脑的兼容性验收。

- 三维玻璃专辑架、浅色／深色主题、封面、歌词、开场动画。
- 登录网易云音乐、QQ 音乐或波点音乐，从当前平台曲库搜索歌曲，读取该账号可访问的歌单；音源、试听片段和完整播放权限由平台返回结果决定。
- 歌单抽屉、歌曲详情、歌词滚动与点击定位，搜索结果支持下一首播放和添加到自己的歌单。
- 临时播放队列独立于原歌单，提供对应模型行、顺序／随机／单曲循环、音量控制。
- 新增“模型循环”开关，默认开启；关闭后仅按实际数量显示模型，浏览到首尾停止。
- 音浪开关、位置、样式和颜色设置；歌词区域高度、帧数上限、自定义快捷键、最大化／全屏选项。
- 模型可见区域裁剪、封面准备 Worker、上传合并与有界缓存，持续改善快速浏览时的资源开销；不承诺固定帧率。
- 全窗口分类设置，详细报错可选，反馈邮件生成诊断草稿。

### 登录音乐平台，搜索曲库并浏览歌单

在顶部账号入口选择网易云音乐、QQ 音乐或波点音乐。登录后，网络搜索和“我的歌单”跟随当前平台切换。登录不代表获取了平台授权或所有歌曲的完整播放权限，平台风控、地区与会员限制仍然适用。

![歌单总览](docs/media/windows-preview/playlist-overview.png)

![音乐账号登录界面](docs/media/windows-preview/account-login.png)

![网络曲库搜索界面](docs/media/windows-preview/network-search.png)

## 下载与安装

普通用户请下载 **[Rhine-Music-Windows-0.2.0-public-preview-x64-Setup.exe](https://github.com/DuoJiuBetter/Rhine-Music-Windows/releases/download/v0.2.0-public-preview/Rhine-Music-Windows-0.2.0-public-preview-x64-Setup.exe)**，双击安装，不需要下载 GitHub 自动生成的 Source code 压缩包。

默认安装到当前用户目录，无需另装 Node.js、npm 或 Rust，可创建开始菜单和桌面快捷方式。安装前退出旧版播放器。已有 WebView2 可离线安装播放器；缺少时，安装器会提示通过 Microsoft 官方引导程序联网安装。安装界面使用 Unicode 简体中文，卸载保留音乐文件、登录状态和设置。EXE 暂未签名。

公开安装包不捆绑 FFmpeg／ffprobe。需要这些解码工具时请自行安装，通过 PATH 或 FFMPEG_PATH、FFPROBE_PATH 指定。当前公开包也不包含许可尚未核实的云信原生聊天组件，因此暂不提供“一起听”；本地开发体验版的该功能不代表公开包已提供。

本地音乐目录在“设置 → 本地歌单设置”添加；模型循环在“设置 → 画面显示设置 → 模型排列”调整。

## 本次更新

- 修复大型网易云歌单因响应大小限制无法读取的问题，减少不需要的内嵌曲目详情。
- 已知歌曲资料未就绪时保留模型外壳，修正播放列表加入后的循环列映射和空白缝隙。
- 加入模型循环开关和对应浏览边界，改善队列、音量、单曲循环图标与歌曲选择栏。
- 汇总近期播放队列、歌单整理、歌词、音浪、快捷键和启动体验更新。
- 软件分发入口改为中文安装 EXE，旧版 Release 保留供回退。

完整范围和验证边界见 [更新说明](docs/RELEASE-0.2.0-PREVIEW.md)。

## 隐私与反馈

音乐文件与标签只读；用户数据保存在 %LOCALAPPDATA%\local.rhine.music.windows\music-data。登录会话由当前 Windows 用户的 DPAPI 分平台加密，不包含在下载包中。歌曲加入、移除或歌单编辑会按用户操作同步到对应平台，详情见 [隐私说明](PRIVACY.md)。

反馈与权利联系：**2228396737@qq.com**。软件中的反馈功能只生成邮件草稿，不自动发送。发送前请检查内容，不要公开 Cookie、令牌、私人歌单导出或原始网络抓包。

如涉及版权、商标、账号接入或平台协议，请联系并提供具体文件／功能、权利依据及必要说明，维护者会核实并视情况停止适配、删除相关内容或下架受影响版本。**免责声明不构成平台授权，也不免除依法应承担的责任。**

## 从源码构建

需要 Node.js ≥ 22.12.0；Windows 原生宿主另需 Rust、Visual Studio C++ 构建工具和 Windows SDK。

```powershell
npm ci --ignore-scripts
npm run build
npm run desktop:build
```

公开版前端构建设置 VITE_PUBLIC_RELEASE=1，禁用未分发组件的入口；安装打包流程见 [安装包说明](docs/WINDOWS-INSTALLER.md)。源码未附带 node-nim；本地一起听研究代码保留，公开安装包不会加载该 SDK。

## 许可与致谢

有权授权的代码、脚本和技术文档使用 [MIT License](LICENSE)，保留 LBEILC、RonaldDeng 等原作者署名。模型、图片、字体、标志、声音与音乐内容按各自权利边界使用，不能一概视为 MIT 或已获商业授权。原说明保留在 [README.upstream.md](README.upstream.md) 和 [README.original.md](README.original.md)。

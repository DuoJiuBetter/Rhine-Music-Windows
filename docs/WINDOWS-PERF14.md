# Perf14 · QQ 喜欢歌单与播放音源请求

分支 `fix/windows-qq-preview-identity`。改前源码 `9740a48`，检查点 `checkpoint/windows-perf13-before-qq-preview-2026-10-09`；完整历史 `artifacts/rollback/windows-perf13-9740a48.bundle` 已验证。Perf13 程序目录和 ZIP 保留，诊断版本为 `0.4.1-perf14`。

## 两条错误的区别

“无法读取 QQ 音乐的私有歌单账号标识”来自程序自己设置的前置条件。旧实现先查询个人主页的 creator.encrypt_uin，缺失就中止，未真正尝试读取喜欢歌单。公开请求实现使用携带登录 Cookie 的 CgiGetDiss、disstid 0 / dirid 201 发起读取；本轮去掉可选字段的强制依赖及额外个人主页查询。歌曲数量同时识别 dirinfo.songnum。平台真实会话是否具有读取权限仍以其响应为准。

“未提供播放地址”来自空 purl 或地址未通过 CDN 白名单。旧实现只请求 M500 + songmid + songmid 的文件名，缺少播放器的 uin / loginflag / platform 参数，也没有保留可能不同于 songmid 的 file.media_mid。因此这条提示不能证明用户没有会员。

## 音源选择

- 使用 QQ 官方网页播放器的 vkey.GetVkeyServer / CgiGetVkey、req_0 信封和 ct 24 / cv 0；保留登录 Cookie，uin 始终是字符串，guid 为八位十进制值。
- 首次不指定 filename，由平台选择可用资源。有合法 purl 就使用，包括平台实际返回的可播放片段；不根据付费标识自行拒绝播放。
- 首次没有地址时，使用已缓存的实际文件 ID；缺失则通过有界、按账号失效的资料缓存补查一次。随后最多一批请求普通 MP3 / AAC 两种文件，使用 media_mid。没有实际文件 ID 时才使用 songmid 作为兼容候选。
- 只接受对应 songmid 的资源；尝试有限的合法 sip，保留 qqmusic.qq.com 的 HTTPS CDN 白名单，不拼造音源地址，不替换为其他歌曲或其他平台。
- 账号 epoch 在自动请求、资料补查及兼容请求之间均检查；四并发、有限队列 / 超时、曲目与资料缓存上限保持原有边界。业务错误和格式错误独立上报，空地址提示改为“不能据此判断会员状态”。

QQ 的试听能力并不意味着当前网页通道为每首受限歌曲都返回片段。没有查到可在此会话中保证获取试听地址的独立公开 Web 协议；本轮没有虚构试听 endpoint 或把整曲地址强行标记为试听，也没有宣称所有会员歌曲已可试听。腾讯物联网 SDK 的 Try30SUrl / TryBegin / TryEnd 属于另一个接入通道，仅用于核实平台有试听能力，未接入它的权限。

公开协议核对来源为 [QQ 官方网页播放器](https://y.qq.com/portal/player.html)、其引用的 [webplayer_0c489f1.js](https://y.gtimg.cn/music/portal/js/common/module/webplayer_0c489f1.js)、[simple-music QQ 请求实现](https://github.com/Yyyangshenghao/simple-music/blob/master/server/lib/qq-client.ts)，及 [腾讯物联网 H5 SDK QQ 音乐说明](https://cloud.tencent.com/document/product/1081/67456)。只读取公共代码和文档、核对字段，不请求用户数据或真实音乐接口，不复制第三方凭据或整个实现。

## 检查与交付

遵从“检测代码即可，不用运行检查”：只做 TypeScript、JavaScript 语法、diff、生产构建和 EXE / 包文件静态校验。新增喜欢歌单无可选字段、自动音源参数、返回片段地址、media_mid 兼容请求、其他歌曲 / 非法 CDN 拒绝、账号切换失效与 Web 信封合成用例，仅语法检查，不执行它们。没有启动 EXE、浏览器、WebView、GL、登录、音频或真实平台 API。账号歌单、整曲与试听可用性需用户实机确认，构建通过不等于播放实测通过。

宿主 EXE 沿用 Perf13 的已验证产物，保留圆角图标和 NVIDIA / WebView2 偏好；前端与服务重新构建。独立交付 `release/Rhine-Music-Windows-Perf14/Rhine Music.exe` 与 `release/Rhine-Music-Windows-0.1.0-perf14-preview-x64.zip`，保留整个 runtime。检查及最终哈希补记于 WINDOWS-PERFORMANCE-PROJECT.md。

程序回退直接关闭新版并运行 Perf13。源码回退前保存新改动，再 `git switch --detach checkpoint/windows-perf13-before-qq-preview-2026-10-09`；返回 `git switch fix/windows-qq-preview-identity`。不覆盖旧包，不重写历史，不推送或发布。

# Perf12 · QQ 授权会话、主题与歌曲文字遮罩

分支 `fix/windows-qq-login-detail-reveal`。改前源码 `cd972fd`，检查点 `checkpoint/windows-perf11-before-login-reveal-2026-10-09`，完整历史 `artifacts/rollback/windows-perf11-cd972fd.bundle` 已验证；Perf11 原程序及 ZIP 保留。诊断版本 `0.4.1-perf12`。

## 改动

- 扫码页去掉“取消登录”按钮。关闭面板、切换平台或扫码方式、刷新二维码仍取消旧挑战和过期请求，保留退出账号功能。
- QQ 登录不再只读取单次 check_sig 响应：每个挑战独立保存内存 Cookie，按 host/domain/path/过期时间发送。保留二维码、轮询和跳转的 Set-Cookie，使用扫码返回的完整 check_sig 地址，最多六次固定 QQ 授权路径跳转；禁止外域、任意路径和循环跳转，不执行响应脚本。
- 手机确认、音乐授权、换取音乐会话分阶段保存。网络重试保留当前阶段，不反复消费已确认二维码；音乐授权回调核对域名、路径、code 与 state。缺少有效音乐授权会话时结束挑战，显示刷新二维码重试，不继续显示“正在重试”。手机确认不等同于音乐账号已登录，不用 ptsigx 冒充 p_skey。
- 原错误可由单次响应 / Cookie 丢失或缺失回调字段触发，本轮修复这些确定的代码缺口；没有真实账号响应，不能断言已确认实机根因或所有账号均可登录。QQ 公共协议参考沿用 [Perf11 文档](WINDOWS-PERF11.md) 的源项目及其登录实现。
- 移除酷狗登录入口、前端平台类型及本地服务认证 / 曲库路由，启动不再创建酷狗服务或读取其保存会话。旧平台偏好回到网易云，不删除用户磁盘上的历史会话文件。上游本地歌曲资料能力、第三方历史署名和许可保留。
- 登录方式、画质与其他原生下拉框使用主题 color-scheme；关闭控件及 option / optgroup 均沿用当前 ink / surface / line / accent，适配暖昼、深夜和暮色。
- 详情标题、来源、歌手和专辑文字沿用 DocumentDecryption；切歌不再因场景已经 clear 而跳过文字揭示。资料、播放按钮、异步补齐的文本与歌词加入同风格遮罩；进入详情、资料 / 歌词互换和当前歌词变化均揭示文字。一个 IntersectionObserver 管理可见歌词，滚动到尚未展示的文字才开始动画；不为整篇最多 4,000 行歌词同时执行动画，不逐帧重建歌词或查询全部文字布局。当前行单独使用最多两个伪元素动画，切行取消旧动画。减少动态效果直接显示文字，滚动和点击歌词跳转保持。

## 检查与交付边界

遵从用户“检测代码即可，不用运行检查”的要求：仅 TypeScript、JS 语法、diff、生产构建及便携包静态完整性检查。新增纯合成用例记录 Cookie 隔离、跳转与缺失会话、授权后重试阶段，更新移除按钮及平台切换的现有用例；这些回归不执行。没有启动 EXE、浏览器、GL、登录账号、音频或在线平台 API，实际 QQ 登录和主题 / 动画效果需用户实机确认。

独立交付 `release/Rhine-Music-Windows-Perf12/Rhine Music.exe` 及 `release/Rhine-Music-Windows-0.1.0-perf12-preview-x64.zip`，保留整个 runtime。沿用未改动、先前静态核验过的 x64 / NVIDIA 偏好宿主，不重新编译原生逻辑。

程序回退直接运行保留 Perf11 包。源码回退前保存后续改动，再 `git switch --detach checkpoint/windows-perf11-before-login-reveal-2026-10-09`；返回 `git switch fix/windows-qq-login-detail-reveal`。构建及包哈希完成后记于项目管理文档，不将代码检查视为登录实测通过。

# Windows Perf21 · IPv4、分类设置与反馈

基线：8c1d46f / Perf20a Debug。诊断版本：0.4.1-perf21。沿用圆角白底图标、显卡偏好、玻璃可见区域绘制及当前播放器功能。

## 网易云 IPv4

用户说明故障测试环境是手机热点，当前开发机是路由器 / 光猫。先前两份用户测试报告合计 IPv4 10 次均成功、IPv6 43 次中 9 次 ECONNRESET；部分匿名 API 和无 Cookie 的根路径也断开，不能仅归为会员或账号问题。当前开发机原有 32 次探测均成功。证据支持环境相关的 IPv6 路径 / 服务节点问题，不能定位是运营商、中间设备还是服务端。

网易云 sdkCall 的两个固定 API 来源（music.163.com 和 interface.music.163.com）现在使用独立 Undici Agent，connect.family=4 且 autoSelectFamily=false。没有 IPv6 回退。保留 Node 内置 fetch、SDK 协议与加密、TLS 验证、重定向拒绝、10 秒超时、响应大小上限、队列、缓存与既有播放重试。独立池不改变全局 dispatcher、系统 DNS / IPv6、QQ / 波点、封面或媒体 CDN 的连接策略。依赖固定为 Undici 7.28.0，许可证保留在 third-party/Undici-LICENSE.txt。

参考：[Node fetch 自定义 dispatcher](https://nodejs.org/api/globals.html#custom-dispatcher)、[Undici Client connect 选项](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md)。安装版本的 lib/core/connect.js 将连接选项传给 Node tls.connect / net.connect，family=4 限定 IPv4。

## 全窗口设置

覆盖整个内容窗口，顶部仍可拖动，窗口控制保留；左侧分类导航、右侧独立滚动内容。沿用暖昼 / 深夜主题及减少动态效果，窄屏有横向分类导航。

- 本地歌单设置：音乐库目录与扫描入口、排序、专辑列、列浏览记忆、音频输出、专辑介绍、制作信息和 MusicBrainz。
- 个性化：主题、减少动态效果、歌曲音量、歌曲衔接、界面音效及 BGM。
- 画面显示设置：自动 / 手动画质、实际渲染显卡、细分画质、玻璃遮挡优化和最大化 / 还原。
- 开发者设置：详细报错展示开关、查看 / 复制报错、性能诊断、已有光照 / 动画调试、重播开场和重载界面。
- 反馈：问题描述、邮件草稿、完整诊断查看 / 复制 / 保存、原作者和资源许可。

分类切换移动原有控件节点并显隐内容页，不重建控件；保留原设置事件和异步任务引用。音乐库管理和流派规则编辑也在全窗口设置壳中，其他登录、搜索浮层保持现有布局。Escape、关闭按钮、Tab 焦点限制和返回焦点沿用原逻辑。

## 报错与反馈

“显示详细报错”默认关闭并保存偏好。打开后错误浮层按现有逻辑显示，可手动再次打开；关闭立即隐藏。开关只控制展示，已有允许列表过滤和最多 20 条本次运行内存记录保持，退出清除。

反馈收件人固定为 2228396737@qq.com。填写说明后，自动捕获最新安全错误记录并加入版本、画质预设和窗口尺寸。草稿带最近最多 5 条错误摘要（操作、代码、状态、尝试序号、深层 errno / syscall、连接阶段 / 地址族 / 耗时等），完整 JSON 可预览、复制或保存。为适配 Windows 邮件协议，mailto 长度不超过 7500 个 ASCII 字符，必要时减少邮件说明和摘要数量；完整 JSON 仍保留本次最多 20 条记录及完整说明。不会自动附加文件，也不会自动发送。

桌面使用专用原生命令打开草稿，只允许固定收件人以及 subject / body 两个唯一查询字段，拒绝额外收件人 / 头字段、主题换行、片段与超长 URL。普通外部链接仍只允许 HTTP(S)。未配置邮件客户端时可手动复制 / 保存诊断发送至邮箱。

自动采集内容来自已有二次过滤的诊断，不读取 Cookie、令牌、账号、私人曲库、请求参数、响应正文、音源 URL 或磁盘日志。用户自行填写的问题描述按其输入保留；发送前由用户检查。

## 验证与回退

按用户此前限定，执行类型 / 语法、源代码结构静态核验、生产构建、locked 原生编译、图标 / PE 及便携包一致性 / SHA-256 检查。不启动播放器、浏览器、WebView、GL、音频或登录，不执行运行回归。本版在热点上的连接稳定性、设置实际观感、邮件客户端行为需用户确认，runtimeChecked=false。

回退标签 checkpoint/windows-perf20a-before-settings-ipv4-2026-10-10，完整历史备份 artifacts/rollback/windows-perf20a-8c1d46f.bundle；旧 release/Rhine-Music-Windows-Perf20a-Debug 保留。新版输出独立 release/Rhine-Music-Windows-Perf21 目录，便携运行需保留整个目录，不只复制 EXE。

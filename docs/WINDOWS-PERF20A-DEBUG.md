# Perf20a Debug · 深层错误与圆角图标 · 2026-10-10

本版用于补充用户反馈的网易云 ECONNRESET 诊断。旧报告中的本地 HTTP 502 是服务包装结果；没有上游状态时不能据此认定网易云返回了 502，也不能认定风控、会员或某个中间节点是根因。本次增加观测信息，不调整请求接口、登录、代理、TLS 校验、并发和三次重试策略。

## 运行和反馈

完整退出旧版本，运行独立目录 `release/Rhine-Music-Windows-Perf20a-Debug/Rhine Music.exe`，保留旁边的 runtime。压缩包为 `release/Rhine-Music-Windows-0.1.0-perf20a-debug-preview-x64.zip`。诊断版本应为 `0.4.1-perf20a-debug`。失败时点“复制报错”，也可在设置打开“查看 / 复制报错”。浮层显示最深层异常摘要，文本框保留完整 JSON，可选中后 Ctrl+C。

## 新增字段

- `chain.nodes`：从原始异常递归读取 cause 与 AggregateError.errors，记录 path、depth、异常名称、已识别 code、数值 errno、系统调用 syscall、安全消息和调用位置 frames。NetEase 服务包装继续传递原始链；响应 JSON 解析错误也保留 SyntaxError cause。QQ 通用请求包装保留网络 cause。
- `messageRedacted` / `codeUnrecognized`：原消息被处理或代码未识别时明确标记；不把未知代码编造成已知原因。堆栈只保留 Node 内部或允许的项目文件名和行列号，移除函数名、绝对路径和原始堆栈头。
- `transport.requestEvents`：网易云请求创建、发送头、发送体、收到响应头、响应完成及错误的单调时间线。按实际 request 对象关联，避免同域并发请求相互混淆。`lastRequestPhase` 保留报错前最后观测阶段；缺少事件时明确为 `no-request-event`。
- `transport`：记录请求耗时、配置超时、可观测 socket 的收发字节数、IPv4 / IPv6、TLS 版本、证书授权布尔值和销毁状态。`previousObservedRequestsOnSocket` 为该 socket 先前被本诊断观察到的发头次数；零不等于已证明新建连接，字节计数为 socket 累计值，不是本歌曲字节量。
- `transport.connectionEvents`：连接开始、连接成功 / 失败及其安全错误链。Undici 的连接事件属于同一域名共享连接池，不能严格归属某一个请求；字段 `connectionEventScope: shared-origin-pool-time-window` 明确表示同域、同时间窗口的辅助证据。
- Node / 内置 Undici 版本、原有操作、播放尝试次数、本地 / 上游 HTTP 状态和平台业务码仍保留。上游未返回的信息不补造。

事件订阅使用 Node / Undici 现有 diagnostics_channel，只读观察，回调防止抛错，不额外发请求、不抓取数据包。当前分阶段观测覆盖网易云两个固定 HTTPS 域；其他平台可携带原有错误链，不宣称具有相同传输阶段信息。DNS 细分耗时、远端内部处理过程和具体重置连接的主体不可由这些事件直接得出。

## 边界和开销

异常链最多 32 个节点 / 32 层，每个 AggregateError 最多 8 个子错误，每节点最多 6 个安全调用位置；超限标记 truncated。单次请求最多 16 个事件，连接池环形记录最多 64 项，报告仅取窗口内最近 12 项。前端最近 20 条错误只在内存保存，退出清除。请求 / 结果 / socket 关联使用 WeakMap，不保留全部历史请求。

不记录请求路径和参数、搜索词、歌曲或账号 ID、Cookie、令牌、原始请求头、响应体、音源 URL、IP 地址或私人路径。消息和代码通过允许列表，前端二次筛选；仅两个固定服务 origin 可输出。未知消息可被省略，因此这是可分享的深层结构化诊断，不是无限制原始日志。

## 图标

按用户要求恢复圆角暖白底 `#e8e5e1`，512 画布上的底板为 x/y=8、496×496、rx=110，外侧角落透明。继续复用共享 labelMarkSvg，保留 Perf20 的 1.5 倍主体和约 459px 标志宽度。SVG、favicon、PNG、ICO 同步；宿主重新编译更新七种 RT_ICON。manifest 沿用 any，避免裁掉放大的标志。Windows 已固定快捷方式可能保留旧图标缓存。

## 验证与回退

分支 `debug/windows-perf20a-deep-errors-icon`，修改前提交 `0451018`，检查点 `checkpoint/windows-perf20-before-rounded-icon-2026-10-10`，完整历史备份 `artifacts/rollback/windows-perf20-0451018.bundle`。保留 Perf20 Debug 程序和 ZIP，不覆盖旧版本，不改写历史，不推送或公开发布。回退运行旧目录即可；源码先保存改动，再切到检查点，返回使用当前分支。

本轮遵循仅代码检查的持续约束：TypeScript、脚本语法、生产构建、locked 原生编译及包 / PNG / ICO / PE 字节静态检查。新增深层链、隐私过滤、循环和深度上限、连接事件、并发身份关联等合成用例，仅检查语法，不执行。没有启动程序 / 浏览器 / WebView / GL / 音频 / 登录，不访问真实平台或私人账号；runtimeChecked=false。实际错误字段是否出现及断连根因，需要新调试包反馈确认。

类型 / 相关脚本语法 / diff 检查通过，生产构建 146 模块、离线版本 75695e7804e1099e / 77 文件；locked 原生 release 编译通过。七尺寸 ICO 的圆角白底 / 透明角落 / 放大主体与 PE RT_ICON 逐字节核对通过，x64 / NvOptimusEnablement=1 / WebView GPU 偏好保留。包入口、资源、诊断与协议脚本、图标、许可、文档和 EXE 与打包时源码 / 构建产物匹配。EXE SHA-256 为 36405d10b312e33dad61fe20402b750d47d648a130c3f5769656b4671f0de066。旧 Perf20 Debug ZIP 哈希仍为 c6c77d902743cb9eb6d09dc4e7a83e97fb83cf67745c9a1553057c51a1759cf8。既有大 chunk 和 crypto-js 停止维护提示仍存在，不将构建成功等同于平台实测。

协议依据：[Undici Diagnostics Channel](https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md)、[Node errors](https://nodejs.org/api/errors.html)、[Node diagnostics_channel](https://nodejs.org/api/diagnostics_channel.html)。

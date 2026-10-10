# Perf20 Debug · 可复制在线报错与透明图标

分支 `debug/windows-perf20-online-errors-icon`，改前 `0e42e8a`。检查点 `checkpoint/windows-perf19-before-debug-icon-2026-10-10`，完整历史 bundle `artifacts/rollback/windows-perf19-0e42e8a.bundle` 已验证。独立交付 `Rhine-Music-Windows-Perf20-Debug`，保留 Perf19 目录与 ZIP。

## 调试操作

完全退出旧版后运行新目录中的 `Rhine Music.exe`，诊断版本应为 `0.4.1-perf20-debug`。在线操作失败时右下方出现“在线请求报错”，点击“复制报错”，或选中文本按 Ctrl+C。关闭详情不清除记录；设置中的“查看 / 复制报错”可再次打开，清空按钮删除当前记录。最近 20 条记录仅在内存中保存，退出后清除，不写入日志或上传到外部服务。

覆盖在线播放音源请求、音频错误、搜索、登录、个人歌单和歌曲资料。失败的重试也保留，播放请求记录 `attempt`（1 为初次，2–4 为三次重试）。继承 Perf19 的次数、时序、取消和权限处理，不更换接口、代理或登录协议，也不宣称解决网易云连接失败。用户本次明确要求先不追查根因；此前一句笼统错误不能判断是否限流、风控或本机连接问题。

记录包含时间戳、平台、固定操作名称、出错阶段、诊断码、本地 HTTP 状态、已获得的上游 HTTP 状态 / 业务码、已识别的底层错误代码、Node 版本和随机关联 ID。例：`NETEASE_NETWORK_ECONNRESET`、`NETEASE_HTTP_429`、`NETEASE_BUSINESS_405`、`NETEASE_MEDIA_2`。上游 HTTP 与平台业务码分别记录；前端无法连接本地服务使用 `FRONTEND_FETCH_FAILED`。未知原因保留 UNKNOWN / 类型名称，不猜测原始代码。HTTP 成功但音源缺失和媒体错误独立标记。

只采集允许的字段和已识别代码；不导出原始异常消息 / 堆栈、请求 URL / 搜索词 / 歌曲 ID、Cookie / 令牌 / 用户名、原始请求头 / 响应体。后端用 WeakMap 保存诊断元数据，前端再次筛选字段；解析诊断只读取失败响应的克隆，不消费调用方响应。取消操作不会产生新的网络错误记录。浮层使用主题变量，键盘 / 滚轮在浮层内操作，不触发模型导航；复制 API 不可用时选中只读文本以手动复制。

QQ / 波点暂以本地服务 HTTP 或前端媒体代码为主；网易云额外采集当前传输实现的嵌套 cause / AggregateError 网络代码与业务码。不是抓包工具，不会凭空返回未收到的上游信息。歌曲资料的部分子请求如被已有逻辑降级为可用结果，仍沿用原资料提示。

## 品牌与图标

左上角 RHINE LAB 从链接改成纯展示元素，不再导航到 `/` 导致重播模型开场。设置中显式的“重播开场”和“重新载入界面”保留。

继续使用共享 `labelMarkSvg` 路径，不更换标志。去掉浅色矩形背景；主体缩放从 1.0645 到 1.5，绘制宽约从 326px 增至 459px。普通 PNG、SVG、favicon、原生 ICO 全透明底，ICO 保留 16 / 24 / 32 / 48 / 64 / 128 / 256 七种尺寸。原 maskable 文件名为兼容保留，但 manifest 改为 `any`，避免将超出安全区的放大标志当作可裁剪图标。宿主重新编译以更新嵌入图标，不能仅复制网页资源。Windows 已固定的旧快捷方式可能保留图标缓存。

## 检查和回退

按持续约束仅类型、脚本语法、diff、生产构建与包 / 图标 / PE 字节静态检查；新增诊断代码、错误原因链、字段过滤、20 条上限和失败响应不消费的合成用例，仅检查语法，不执行回归测试。不运行 EXE、浏览器、WebView、GL、音频、登录或真实平台请求；实际报错与界面效果由用户确认。图标只读取静态文件检查，没有启动程序。

回退程序直接运行 Perf19。源码回退先保存当前改动，再 `git switch --detach checkpoint/windows-perf19-before-debug-icon-2026-10-10`；返回使用 `git switch debug/windows-perf20-online-errors-icon`。未覆盖旧包、改写历史、推送或公开发布。

类型 / 相关脚本语法 / diff 检查通过，生产构建 145 模块，离线构建 `7cd8fe5207491af7`，77 文件。原生 release 编译通过（locked 依赖）；静态解析 PE 的 RT_ICON 资源，七种透明图标逐字节匹配 ICO，无浅色底板，放大宽度符合预期。x64 / NvOptimusEnablement=1 / WebView GPU 偏好标记仍在。旧版 Perf19 ZIP 的 SHA-256 保持 `0f0879a1f409401986ee2fb6ba0105046253dd4c9abb556ebfe0bb43a692efbe`。既有大 chunk 与 crypto-js 停止维护提示仍存在，不将构建成功当作实机或真实平台验收。

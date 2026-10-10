# Windows Perf21 首次公开发布准备

目标仓库：https://github.com/DuoJiuBetter/Rhine-Music-Windows 。Fork 保留 RonaldDeng/Rhine-Music-Demo 的上游历史，公开初始 Windows 提交由当前开发源码快照导入；本机的独立开发历史不推送，完整历史 bundle 与原有标签留作回退。

发布材料包含 Windows README、保留的上游 README、贡献指南、平台与权利说明、隐私说明、反馈邮箱及第三方许可。保留原版权署名并添加 Windows 社区修改署名。移除一处文档中的开发机个人路径，不包含账号会话、私人音乐、缓存或诊断报告。

首个 Public 包排除原本地测试包中的可选 GPL FFmpeg 二进制。Node.js 许可与生产依赖原文保留，原生依赖按锁定 Windows x64 元数据收集通知，MPL-2.0 依赖附上未修改的对应源码。许可文件缺失的 crate 从其 cargo_vcs_info 所示上游提交获取原文，来源保存在 third-party/native-supplements。

原生发布编译启用与 Tauri CLI 一致的 tauri/custom-protocol 生产上下文，避免裸 cargo release 嵌入开发配置目录；并以动态 remap-path-prefix 映射工作区、Cargo / Rust 缓存与用户目录；release 不再包含 CARGO_MANIFEST_DIR 开发回退，缺失 runtime 时给出完整解压提示。补齐 desktop_open_feedback 的生成权限及能力声明，命令内固定收件人和字段校验保留。网页和平台服务沿用 Perf21。

打包脚本独立创建 Public 目录，保留输入测试包；ZIP 兼容依赖中早于 1980 年的时间戳，保留隐藏文件并生成源码 ZIP 与 SHA-256 清单。先前失败的中间包只保存在忽略目录中，不对外发布。

验证仅类型 / 语法、locked 原生编译、权限结构、图标 / PE、源码与包隐私路径检查、依赖通知、ZIP / 逐文件哈希与旧包哈希；不运行播放器 / WebView / GL / 音频 / 登录回归，runtimeChecked=false。最终远端提交、标签、下载链接与哈希以实际发布验收记录为准，不能把本文件准备状态视为发布完成。

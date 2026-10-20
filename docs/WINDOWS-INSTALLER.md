> 公开版本提示（2026-10-20）：0.2.0 安装包不包含 node-nim／云信原生 SDK，暂不提供一起听。以下本地开发体验记录不代表公开包功能或验收结果。当前下载见仓库 README。

# Windows 安装包

## ModelLoop1 · 2026-10-20

本次从 `release/Rhine-Music-Windows-Preview-20261020-ModelLoop1` 制作安装包，应用源码为 b58373e，包含默认开启的模型循环开关。复用已打包的播放器宿主与前端，不重新编译 Rust，不启动播放器，不读取真实账号。

为避免安装中文乱码，保留 `Unicode true` 和简体中文语言包，并固定编译输入 `/INPUTCHARSET UTF8`、日志输出 `/OUTPUTCHARSET UTF8`。自动生成的安装／卸载清单和说明页均写入带 BOM 的 UTF-8，说明页及文本使用 CRLF。更新说明去除过期的 Together1 专属版本描述，平台及隐私边界保持不变。

来源依据：[NSIS 编译命令与编码参数](https://nsis.sourceforge.io/Docs/Chapter3.html)、[NSIS LicenseData 文本格式](https://nsis.sourceforge.io/Reference/LicenseData)。

本轮安装构建执行负载 SHA-256 清单校验和 Microsoft WebView2 引导程序签名校验；编码核对仅针对生成文本、编译日志和 EXE 中文版本资源。不运行安装／卸载流程、播放器、音频或 GPU 测试，安装器运行验证仍记为 false，不沿用下方旧版的验收结论。

旧安装包和 QueueSeam1／ModelLoop1 便携版保留。本次仅生成本地安装包，不发布 GitHub。

## Together1 · 2026-10-17（历史记录）

安装负载来自已保留的 `0.4.1-preview-together-1` 便携版，应用源码提交 c1cb70f。仅增加安装器，不重新编译 Rust 宿主、不重建前端、不改变播放器功能，不推送 GitHub。

## 安装行为

- 中文 NSIS 安装向导，仅支持 Windows 10/11 x64；默认当前用户安装，不请求管理员权限。
- 默认目录 `%LOCALAPPDATA%\Programs\Rhine Music Preview`，可选空目录或此前由本安装器管理的目录。拒绝覆盖非空的其他目录及便携包。
- 创建开始菜单入口，可选择桌面快捷方式，在 Windows 设置中注册 `Rhine Music (Preview)` 和卸载入口。
- 检查该安装目录的播放器和 Node 是否正在运行；占用时终止本次安装／卸载，不结束其他应用或强制关机。
- 使用 Microsoft 官方记录的注册表位置检查 WebView2，已安装则跳过。缺少时提示使用打包的 Microsoft 官方引导程序联网安装，取消则停止安装。构建时验证其 Authenticode 签名属于 Microsoft Corporation；已有 WebView2 的机器可离线安装播放器。
- 不开启开机启动，不自动播放。安装完成页的「打开 Rhine Music」默认不勾选。

## 数据与卸载

音乐文件只读；会话、设置、索引仍使用原有用户数据目录。卸载不删除 `%LOCALAPPDATA%\local.rhine.music.windows`，不删除 WebView2，不改变音频设备和显卡设置。

卸载前核对安装标识，只删除构建清单中的相对文件、自己的快捷方式和注册项。没有递归清空安装目录，用户自行放入的其他文件保留。覆盖安装更新当前负载，旧版本已不再使用且不在当前清单中的文件可能留存；没有对未知文件做通配清理。

## 构建与来源

工具是 NSIS 3.13，从 Tauri 官方维护的镜像取得，zip SHA-256：

`ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8`

- 镜像与摘要：https://github.com/tauri-apps/binary-releases/releases/tag/nsis-3.13
- NSIS：https://nsis.sourceforge.io/Download
- Microsoft WebView2 分发、检测和引导程序说明：https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
- Microsoft 引导程序：https://go.microsoft.com/fwlink/p/?LinkId=2124703

使用单任务 zlib 压缩，避免大字典压缩带来额外内存和等待。安装后附带 NSIS 原始 COPYING；没有修改 NSIS 源码。工具链仅解压到忽略的 artifacts，不安装到系统。

```powershell
npm run installer:build -- --source release/Rhine-Music-Windows-Preview-20261017-Together1 --compiler artifacts/installer-tools/nsis-3.13/makensis.exe --webview2 artifacts/installer-tools/MicrosoftEdgeWebview2Setup.exe
```

构建逐项核对便携版 SHA-256 清单，拒绝清单外文件、符号链接或不一致的负载。输出 EXE、SHA-256 和 JSON 构建信息，已有结果不会覆盖。

## 验证范围

在独立中文路径静默安装，校验负载哈希、快捷方式、卸载注册项及覆盖安装；使用临时数据目录只启动本机 HTTP 服务，不打开原生三维窗口、不读取真实账号、不播放音频。卸载验证保留额外放入的文件、清除程序文件与测试快捷方式和注册项。验证结果保存在忽略的 artifacts/installer-validation/result.json。

本轮以上验证全部通过：拒绝已有内容的其他目录、中文路径安装、5642 个便携负载文件哈希、桌面及开始菜单快捷方式、Windows 卸载注册项、覆盖安装、本地服务 HTTP 200、卸载成功且额外文件保留。生成安装器 327532339 字节，SHA-256 为 `7bf9d83218f4b4105c1dbe16e64b5d64f7f6e86ddbde65ddbf7acfd92e7a18be`。安装器另安装 NSIS-LICENSE.txt 和卸载标识／程序。

本机已有 WebView2，不通过删除系统运行时或修改系统注册表模拟缺失分支；该联网安装分支仍需干净机器验收。安装器与应用目前未做代码签名。当前包仍是本地体验用途，新增云信原生 SDK 的公开再分发许可未核实，安装格式不改变该状态，见 LISTEN-TOGETHER.md。

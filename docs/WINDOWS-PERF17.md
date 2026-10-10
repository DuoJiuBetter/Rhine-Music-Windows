# Perf17 · 波点空歌单响应兼容修复

分支 `fix/windows-bodian-playlist-response`，改前 `ce6ffdf`。回退检查点 `checkpoint/windows-perf16-before-bodian-list-fix-2026-10-09`；完整历史备份 `artifacts/rollback/windows-perf16-ce6ffdf.bundle` 已验证。Perf16 目录与 ZIP 保留，独立交付 Perf17，诊断版本 `0.4.1-perf17`。

## 问题与修复

用户在波点账号模式看到“波点音乐歌单列表格式发生变化”。原实现强制要求自建、收藏两个响应都包含 `playLists` 数组；任一来源返回空对象或空数组，就整页失败，阻断其他有效来源与“我喜欢”歌单。

公开参考的 [PyBodian](https://github.com/MoeclubM/PyBodian/blob/ceb7e4f62b2ebd0248300d43fa422e2bf11ee00c/bodian_toolkit.py) 对缺失列表提供空集合默认值。[波点客户端公开协议样例](https://github.com/Mintcolour/bodian-music-api/blob/main/test/bodianLibrary.test.ts) 明确记录空容器 `{}`、`[]`；只核对协议数据形状，没有引入或复制 AGPL 库代码 / 测试实现。

新增独立集合归一化：正常 `playLists` 数组保留；空对象、空数组以及只含列表 / 分页元数据且明确为空的形式归一化为空来源。自建为空仍展示收藏和喜欢，收藏为空仍展示自建和喜欢。正数总量却没有列表、错误字段类型和未知非空容器继续报错，不把接口错误吞成空曲库。错误注明自建 / 收藏来源，并附最多六个安全字段名称和类型；不输出值、令牌、用户身份或完整响应。

同时修正 `Number(null)`、空串、布尔值被当成已报告的零总数：仅非负安全整数与整数文本认作有效 total。未知收藏总数按原始服务页长度决定继续分页；未知歌曲总数保留已知歌单数量，避免将三维行置空；搜索满页也不会因 null 总数隐藏下一页。收藏混合列表仍过滤专辑，游标继续依据过滤前的原始页。

没有读取用户的真实账号或平台响应，截图只能定位到旧格式判断分支，不能确认这次真实返回的具体容器。修复涵盖已核实的兼容缺口；若有其他未见响应，新错误可区分来源和结构，实际结果由用户在新包确认。

## 检查与交付

按照用户持续要求，仅做 TypeScript、相关 JavaScript 语法、diff、生产构建和包文件静态校验。补充自建 / 收藏分别为空、保留喜欢歌单、未知非空容器拒绝、错误文本不泄漏值、null 总量分页与歌曲数量保留的合成用例，只检查语法，不执行回归。

没有运行 EXE / 浏览器 / WebView / GL / 登录 / 音频，没有调用真实平台 API。协议研究只读取公开源代码。宿主沿用 Perf16 EXE，歌单形变和其他平台行为保留，网页与服务重新构建。

解压 `release/Rhine-Music-Windows-0.1.0-perf17-preview-x64.zip`，完整退出旧版后启动 `Rhine-Music-Windows-Perf17/Rhine Music.exe`，保留整个 runtime。程序沿用本机分平台加密账号，无需主动退出重登。回退程序直接运行保留的 Perf16；回退源码先保存当前改动，再 `git switch --detach checkpoint/windows-perf16-before-bodian-list-fix-2026-10-09`，返回使用 `git switch fix/windows-bodian-playlist-response`。没有覆盖旧包、改写历史或推送发布。

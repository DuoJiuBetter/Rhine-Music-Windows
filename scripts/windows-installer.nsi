; -*- coding: utf-8 -*-
Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID zlib
SetDatablockOptimize on
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!define APPID "local.rhine.music.windows.preview"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RhineMusicWindowsPreview"
Name "Rhine Music 体验版"
OutFile "${SETUP_OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Rhine Music Preview"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
BrandingText "Rhine Music · Windows 社区版"
VIProductVersion "0.4.1.0"
VIAddVersionKey /LANG=2052 "ProductName" "Rhine Music Windows Preview"
VIAddVersionKey /LANG=2052 "FileDescription" "Rhine Music ${APP_VERSION} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "0.4.1.0"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Rhine Music contributors; see bundled notices"
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 Rhine Music 体验版"
!define MUI_WELCOMEPAGE_TEXT "将安装 ${APP_VERSION}。$\r$\n$\r$\n包含播放器和本机运行环境，无需另装 Node.js。缺少 WebView2 时会提示安装 Microsoft 官方运行时。$\r$\n$\r$\n安装前请退出正在运行的 Rhine Music。个人音乐、登录状态与设置保留在原来的用户数据目录。"
!insertmacro MUI_PAGE_WELCOME
!define MUI_LICENSEPAGE_TEXT_TOP "请阅读本地体验版说明、平台适配范围及隐私信息。"
!insertmacro MUI_PAGE_LICENSE "${INSTALL_NOTES}"
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Rhine Music.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_RUN_TEXT "打开 Rhine Music"
!define MUI_FINISHPAGE_TEXT "Rhine Music 已安装。可从开始菜单打开，或在 Windows 设置 → 应用中卸载。$\r$\n$\r$\n卸载只移除程序文件，保留音乐、账号和设置。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
Var WebViewReady

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_OK|MB_ICONSTOP "此安装包适用于 Windows x64。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "需要 Windows 10 或更新系统。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
FunctionEnd

; Refuse a nonempty foreign directory. No recursive uninstall deletion is used.
Function ValidateDirectory
  StrCmp $INSTDIR "" invalid
  StrLen $0 $INSTDIR
  IntCmp $0 4 invalid invalid +1
  IfFileExists "$INSTDIR\.rhine-installer.ini" owned
  IfFileExists "$INSTDIR\*.*" invalid valid
  owned:
    ReadINIStr $0 "$INSTDIR\.rhine-installer.ini" "Application" "Id"
    StrCmp $0 "${APPID}" valid invalid
  invalid:
    MessageBox MB_OK|MB_ICONSTOP "请选择空文件夹，或已由此安装包安装的 Rhine Music Preview 文件夹。不能覆盖其他程序或便携包。" /SD IDOK
    SetErrorLevel 2
    Abort
  valid:
FunctionEnd

!macro CheckNotRunning PREFIX
  IfFileExists "$INSTDIR\Rhine Music.exe" 0 ${PREFIX}node
  ClearErrors
  FileOpen $0 "$INSTDIR\Rhine Music.exe" a
  IfErrors ${PREFIX}busy
  FileClose $0
  ${PREFIX}node:
  IfFileExists "$INSTDIR\runtime\node.exe" 0 ${PREFIX}ready
  ClearErrors
  FileOpen $0 "$INSTDIR\runtime\node.exe" a
  IfErrors ${PREFIX}busy
  FileClose $0
  Goto ${PREFIX}ready
  ${PREFIX}busy:
    MessageBox MB_OK|MB_ICONSTOP "程序仍在运行。请先退出此安装目录中的 Rhine Music，再重试。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${PREFIX}ready:
!macroend

; Microsoft's documented Evergreen detection, machine/user and both views.
Function DetectWebView
  StrCpy $WebViewReady 0
  !macro CheckWebView ROOT VIEW
    SetRegView ${VIEW}
    ReadRegStr $0 ${ROOT} "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $0 != ""
    ${AndIf} $0 != "0.0.0.0"
      StrCpy $WebViewReady 1
    ${EndIf}
  !macroend
  !insertmacro CheckWebView HKLM 32
  !insertmacro CheckWebView HKCU 32
  !insertmacro CheckWebView HKLM 64
  !insertmacro CheckWebView HKCU 64
  SetRegView 64
FunctionEnd

Section "播放器及运行环境（必需）" MainSection
  SectionIn RO
  Call ValidateDirectory
  !insertmacro CheckNotRunning install_
  Call DetectWebView
  ${If} $WebViewReady != 1
    IfSilent webview_install
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "此电脑缺少 WebView2。接下来将通过 Microsoft 官方安装程序联网安装。取消将停止本次安装。" IDOK webview_install
    SetErrorLevel 2
    Abort
    webview_install:
    InitPluginsDir
    File /oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe "${WEBVIEW_BOOTSTRAPPER}"
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $0
    Call DetectWebView
    ${If} $WebViewReady != 1
      MessageBox MB_OK|MB_ICONSTOP "未检测到 WebView2。请检查网络，或从 Microsoft 官网安装 WebView2 后重试。程序尚未安装。" /SD IDOK
      SetErrorLevel 3
      Abort
    ${EndIf}
  ${EndIf}
  SetOverwrite on
  !include "${PAYLOAD_INSTALL}"
  SetOutPath "$INSTDIR"
  File /oname=NSIS-LICENSE.txt "${COMPILER_LICENSE}"
  WriteINIStr "$INSTDIR\.rhine-installer.ini" "Application" "Id" "${APPID}"
  WriteINIStr "$INSTDIR\.rhine-installer.ini" "Application" "Build" "${APP_VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Rhine Music (Preview)"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "DuoJiuBetter / Rhine Music contributors"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Rhine Music.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/DuoJiuBetter/Rhine-Music-Windows"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${ESTIMATED_KIB}
  CreateDirectory "$SMPROGRAMS\Rhine Music Preview"
  CreateShortcut "$SMPROGRAMS\Rhine Music Preview\Rhine Music.lnk" "$INSTDIR\Rhine Music.exe"
  CreateShortcut "$SMPROGRAMS\Rhine Music Preview\卸载 Rhine Music.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "创建桌面快捷方式" DesktopSection
  CreateShortcut "$DESKTOP\Rhine Music Preview.lnk" "$INSTDIR\Rhine Music.exe"
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ReadINIStr $0 "$INSTDIR\.rhine-installer.ini" "Application" "Id"
  StrCmp $0 "${APPID}" +4
    MessageBox MB_OK|MB_ICONSTOP "安装标识不匹配，已停止卸载。" /SD IDOK
    SetErrorLevel 2
    Abort
  !insertmacro CheckNotRunning uninstall_
FunctionEnd

Section "Uninstall"
  ; Explicit build-time inventory; never RMDir /r or touch app-data/music.
  !include "${PAYLOAD_UNINSTALL}"
  Delete "$INSTDIR\NSIS-LICENSE.txt"
  Delete "$INSTDIR\.rhine-installer.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\Rhine Music Preview.lnk"
  Delete "$SMPROGRAMS\Rhine Music Preview\Rhine Music.lnk"
  Delete "$SMPROGRAMS\Rhine Music Preview\卸载 Rhine Music.lnk"
  RMDir "$SMPROGRAMS\Rhine Music Preview"
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ${EndIf}
SectionEnd

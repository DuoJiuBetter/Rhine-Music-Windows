param([Parameter(Mandatory=$true)][int]$PlayerProcessId)
$ErrorActionPreference='Stop'
$taskPlayer=Get-Process -Id $PlayerProcessId
if($taskPlayer.ProcessName -notin @('Rhine Music','rhine-music-windows')){throw 'Only the requested player window may be inspected.'}
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class PlayerWindowArea {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public uint Size;public Rect Monitor,Work;public uint Flags; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
$taskHandle=$taskPlayer.MainWindowHandle
if($taskHandle -eq [IntPtr]::Zero){throw 'Player has no visible main window.'}
$taskPreviousDpi=[PlayerWindowArea]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
  $taskWindow=New-Object PlayerWindowArea+Rect;$taskClient=New-Object PlayerWindowArea+Rect
  if(-not [PlayerWindowArea]::GetWindowRect($taskHandle,[ref]$taskWindow)){throw 'Window bounds unavailable'}
  if(-not [PlayerWindowArea]::GetClientRect($taskHandle,[ref]$taskClient)){throw 'Client bounds unavailable'}
  $taskMonitor=New-Object PlayerWindowArea+MonitorInfo;$taskMonitor.Size=[Runtime.InteropServices.Marshal]::SizeOf($taskMonitor)
  if(-not [PlayerWindowArea]::GetMonitorInfo([PlayerWindowArea]::MonitorFromWindow($taskHandle,2),[ref]$taskMonitor)){throw 'Monitor bounds unavailable'}
  [ordered]@{processId=$PlayerProcessId;maximized=[PlayerWindowArea]::IsZoomed($taskHandle);minimized=[PlayerWindowArea]::IsIconic($taskHandle);foreground=([PlayerWindowArea]::GetForegroundWindow() -eq $taskHandle);window=$taskWindow;client=$taskClient;monitor=$taskMonitor.Monitor;workArea=$taskMonitor.Work;readOnly=$true} | ConvertTo-Json -Depth 3
} finally { [void][PlayerWindowArea]::SetThreadDpiAwarenessContext($taskPreviousDpi) }

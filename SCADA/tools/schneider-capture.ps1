param([int]$X=-1,[int]$Y=-1,[string]$Keys='',[string]$Text='', [int]$TargetProcessId=0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class SimCapture {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder text,int max);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
$app=Get-Process | Where-Object {$_.ProcessName -eq 'SchneiderElectric.SoMachineBasic.MainApplication'} | Select-Object -First 1
if($TargetProcessId){$app=Get-Process -Id $TargetProcessId; if($app.ProcessName -ne 'SchneiderElectric.SoMachineBasic.MainApplication'){throw 'Not a Schneider process'}}
$script:windows=@()
$callback=[SimCapture+EnumProc]{param($h,$p)
 [uint32]$owner=0; [void][SimCapture]::GetWindowThreadProcessId($h,[ref]$owner)
 if($owner -eq $app.Id -and [SimCapture]::IsWindowVisible($h)){
  $text=New-Object Text.StringBuilder 1024; [void][SimCapture]::GetWindowText($h,$text,1024)
  $script:windows += [pscustomobject]@{Handle=$h.ToInt64();Title=$text.ToString()}
 }
 return $true
}
[void][SimCapture]::EnumWindows($callback,[IntPtr]::Zero)
$script:windows | ConvertTo-Json
$main=$script:windows | Where-Object {$_.Title -match 'EcoStruxure Machine Expert'} | Select-Object -First 1
[uint32]$foregroundOwner=0
[void][SimCapture]::GetWindowThreadProcessId([SimCapture]::GetForegroundWindow(),[ref]$foregroundOwner)
if($main -and $foregroundOwner -ne $app.Id){[void][SimCapture]::SetForegroundWindow([IntPtr]$main.Handle)}
if($X -ge 0 -and $Y -ge 0){
 [System.Windows.Forms.Cursor]::Position=New-Object Drawing.Point($X,$Y)
 [SimCapture]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [SimCapture]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
if($Keys){[System.Windows.Forms.SendKeys]::SendWait($Keys)}
if($Text){[System.Windows.Forms.SendKeys]::SendWait($Text)}
Start-Sleep -Milliseconds 300
$rect=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object Drawing.Bitmap $rect.Width,$rect.Height
$g=[Drawing.Graphics]::FromImage($bmp)
try{$g.CopyFromScreen($rect.Left,$rect.Top,0,0,$bmp.Size); $bmp.Save((Join-Path $PSScriptRoot 'schneider-current.png'))}finally{$g.Dispose();$bmp.Dispose()}

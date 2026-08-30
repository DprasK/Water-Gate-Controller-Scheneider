param([string]$OutputDir = $PSScriptRoot, [string]$Keys = '')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class SchneiderWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
'@
$app=Get-Process | Where-Object {$_.ProcessName -eq 'SchneiderElectric.SoMachineBasic.MainApplication'} | Select-Object -First 1
if (!$app -or $app.MainWindowHandle -eq 0) {throw 'Main Schneider window not available'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
if($Keys){
 [void][SchneiderWindow]::ShowWindow($app.MainWindowHandle,3)
 [void][SchneiderWindow]::SetForegroundWindow($app.MainWindowHandle)
 Start-Sleep -Milliseconds 400
 [System.Windows.Forms.SendKeys]::SendWait($Keys)
 Start-Sleep -Milliseconds 500
}
$all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$items=@()
foreach($el in $all){
 try{$c=$el.Current; if($c.Name -or $c.AutomationId){$items += [pscustomobject]@{Name=$c.Name;Id=$c.AutomationId;Type=$c.ControlType.ProgrammaticName;Enabled=$c.IsEnabled;Rect=$c.BoundingRectangle.ToString()}}}catch{}
}
$items | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputDir 'schneider-ui.json') -Encoding UTF8
Write-Output $root.Current.Name
$items | Where-Object { $_.Rect -ne 'Empty' -and $_.Type -match 'Button|MenuItem|TabItem|Window|Edit' -and ($_.Name -or $_.Id -in @('1001','1148','FileNameControlHost')) } | ConvertTo-Json -Depth 3

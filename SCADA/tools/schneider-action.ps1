param([string]$Name='', [string]$Id='', [string]$Type='Button', [ValidateSet('Invoke','Expand','Value','Keys','List')][string]$Action='Invoke', [string]$Value='', [string]$WindowTitle='', [int]$TargetProcessId=0, [long]$DialogHandle=0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$app=Get-Process | Where-Object {$_.ProcessName -eq 'SchneiderElectric.SoMachineBasic.MainApplication'} | Select-Object -First 1
if($TargetProcessId){$app=Get-Process -Id $TargetProcessId; if($app.ProcessName -ne 'SchneiderElectric.SoMachineBasic.MainApplication'){throw 'Not a Schneider process'}}
if(!$app -or !$app.MainWindowHandle){throw 'Schneider main window unavailable'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
if($DialogHandle){
 $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$DialogHandle)
 if($root.Current.ProcessId -ne $app.Id){throw 'Dialog does not belong to selected Schneider process'}
}
if($WindowTitle){
 $ownerCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,[int]$app.Id)
 $titleCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$WindowTitle)
 $root=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,(New-Object System.Windows.Automation.AndCondition($ownerCondition,$titleCondition)))
 if(!$root){throw 'Requested Schneider dialog not found'}
}
if($Action -eq 'Keys') { $root.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait($Value); Write-Output 'Shortcut sent to Schneider'; exit }
$conditions=New-Object 'System.Collections.Generic.List[System.Windows.Automation.Condition]'
$conditions.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::$Type)))
if($Name){$conditions.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$Name)))}
if($Id){$conditions.Add((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$Id)))}
$condition=if($conditions.Count -eq 1){$conditions[0]}else{New-Object System.Windows.Automation.AndCondition($conditions.ToArray())}
if($Action -eq 'List'){
  $found=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
  foreach($entry in $found){$c=$entry.Current; [pscustomobject]@{Name=$c.Name;Id=$c.AutomationId;Enabled=$c.IsEnabled;Rect=$c.BoundingRectangle.ToString()}}
  exit
}
$element=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
if(!$element){throw 'Specified control not found'}
if(!$element.Current.IsEnabled){throw 'Control is disabled'}
switch($Action){
 'Invoke' {([System.Windows.Automation.InvokePattern]$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()}
 'Expand' {([System.Windows.Automation.ExpandCollapsePattern]$element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Expand()}
 'Value' {([System.Windows.Automation.ValuePattern]$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($Value)}
}
Write-Output "Schneider $Action completed: $Name $Id"

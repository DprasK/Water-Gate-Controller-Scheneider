param(
  [string]$Source = (Join-Path $PSScriptRoot '..\..\AWGC_3_Pintu_TM221CE24R_REV3.smbp'),
  [string]$Output = (Join-Path $PSScriptRoot '..\AWGC_SIM_INPUTS_ONLY.smbp'),
  [string]$ProjectName = 'AWGC_SIM_INPUTS_ONLY'
)
$ErrorActionPreference = 'Stop'
[xml]$project = Get-Content -Raw -LiteralPath $Source
$project.ProjectDescriptor.Name = $ProjectName
$project.ProjectDescriptor.FullName = [IO.Path]::GetFullPath($Output)
$rungs = $project.SelectSingleNode('//ProgramOrganizationUnits/Rungs')
$template = $rungs.FirstChild.CloneNode($true)
function Make-Rung([string]$name, [string[]]$lines) {
  $rung = $template.CloneNode($true)
  $rung.SelectSingleNode('LadderElements').RemoveAll()
  $rung.SelectSingleNode('InstructionLines').RemoveAll()
  $rung.Name = $name
  $rung.MainComment = 'SIMULATOR ONLY. Physical outputs forced OFF. Do not use for plant operation.'
  $rung.IsLadderSelected = 'false'
  foreach ($line in $lines) {
    $entity = $project.CreateElement('InstructionLineEntity')
    $instruction = $project.CreateElement('InstructionLine'); $instruction.InnerText = $line
    [void]$entity.AppendChild($instruction)
    [void]$entity.AppendChild($project.CreateElement('Comment'))
    [void]$rung.SelectSingleNode('InstructionLines').AppendChild($entity)
  }
  return $rung
}
function Map-Sim-Address([string]$text) {
  $mapped = [regex]::Replace($text, '%I0\.(\d+)', { param($m) '%M' + (300 + [int]$m.Groups[1].Value) })
  $mapped = [regex]::Replace($mapped, '%I1\.(\d+)', { param($m) '%M' + (320 + [int]$m.Groups[1].Value) })
  return [regex]::Replace($mapped, '%Q0\.(\d+)', { param($m) '%M' + (360 + [int]$m.Groups[1].Value) })
}
foreach ($rung in $rungs.SelectNodes('RungEntity')) {
  $rung.IsLadderSelected = 'false'
  foreach ($textNode in $rung.SelectNodes('.//text()')) {
    if ($null -ne $textNode.Value) { $textNode.Value = Map-Sim-Address $textNode.Value }
  }
}
$permissive = $rungs.SelectSingleNode('RungEntity[Name="SYSTEM_PERMISSIVE"]')
$replacement = Make-Rung 'SYSTEM_PERMISSIVE_SIM' @('LD    %M300','AND   %M307','AND   %M308','AND   %M309','AND   %M5','AND   %M370','ST    %M0')
[void]$rungs.ReplaceChild($replacement, $permissive)

# Separate compatibility marker; not an authentication credential.
[void]$rungs.PrependChild((Make-Rung 'SIM_PROFILE_VERSION' @('LD    1','[ %MW111 := 4001 ]')))
[void]$rungs.PrependChild((Make-Rung 'SIM_PROFILE_ID' @('LD    1','[ %MW110 := 221 ]')))
foreach ($bit in (@(5,370) + (300..313) + (320..351) + (360..369))) {
  [void]$rungs.PrependChild((Make-Rung "SIM_COLD_RESET_M$bit" @('LD    %S13',"R     %M$bit")))
}
# Even accidental loading on hardware cannot energize the ten relay outputs.
foreach ($q in 0..9) {
  [void]$rungs.AppendChild((Make-Rung "PHYSICAL_OUTPUT_${q}_LOCKED_OFF" @('LD    0',"ST    %Q0.$q")))
}
function Add-Symbol([string]$parentName,[string]$nodeName,[int]$index,[string]$symbol,[string]$comment) {
  $parent = $project.SelectSingleNode("//SoftwareConfiguration/$parentName")
  $prefix = if ($nodeName -eq 'MemoryBit') { '%M' } else { '%MW' }
  $address = "$prefix$index"
  $item = $parent.SelectSingleNode("$nodeName[Address='$address']")
  if ($item -ne $null) {
    if ($null -eq $item.SelectSingleNode('Symbol')) { [void]$item.AppendChild($project.CreateElement('Symbol')) }
    if ($null -eq $item.SelectSingleNode('Comment')) { [void]$item.AppendChild($project.CreateElement('Comment')) }
    $item.SelectSingleNode('Symbol').InnerText = $symbol
    $item.SelectSingleNode('Comment').InnerText = $comment
    return
  }
  $item = $project.CreateElement($nodeName)
  foreach ($pair in @(@('Address',"$prefix$index"),@('Index',"$index"),@('Symbol',$symbol),@('Comment',$comment))) {
    $node = $project.CreateElement($pair[0]); $node.InnerText = $pair[1]; [void]$item.AppendChild($node)
  }
  [void]$parent.AppendChild($item)
}
function Set-WatchList([string]$name, [string[]]$addresses) {
  $watchLists = $project.SelectSingleNode('//SoftwareConfiguration/WatchLists')
  if ($null -eq $watchLists) { throw 'WatchLists node not found' }
  foreach ($old in @($watchLists.SelectNodes("WatchListEntity[Name='$name']"))) {
    [void]$watchLists.RemoveChild($old)
  }
  $list = $project.CreateElement('WatchListEntity')
  $nameNode = $project.CreateElement('Name'); $nameNode.InnerText = $name; [void]$list.AppendChild($nameNode)
  $items = $project.CreateElement('WatchListItemEntities')
  foreach ($address in $addresses) {
    $item = $project.CreateElement('WatchListItemEntity')
    $addressNode = $project.CreateElement('Address'); $addressNode.InnerText = $address; [void]$item.AppendChild($addressNode)
    $traceNode = $project.CreateElement('IsTraced'); $traceNode.InnerText = 'false'; [void]$item.AppendChild($traceNode)
    $reprNode = $project.CreateElement('ValueRepresentation')
    $reprNode.InnerText = if ($address -match '^%M(?!W|F)') { 'BoolNumeric' } else { 'Decimal' }
    [void]$item.AppendChild($reprNode)
    [void]$items.AppendChild($item)
  }
  [void]$list.AppendChild($items)
  [void]$watchLists.AppendChild($list)
}
foreach ($i in 0..13) { Add-Symbol 'MemoryBits' 'MemoryBit' (300+$i) "SIM_I0_$i" "SIM ONLY virtual physical input I0.$i" }
foreach ($i in 0..31) { Add-Symbol 'MemoryBits' 'MemoryBit' (320+$i) "SIM_I1_$i" "SIM ONLY virtual physical input I1.$i" }
foreach ($i in 0..9) { Add-Symbol 'MemoryBits' 'MemoryBit' (360+$i) "SIM_Q0_$i" "SIM ONLY output mirror Q0.$i; actual output always OFF" }
Add-Symbol 'MemoryBits' 'MemoryBit' 370 'SIM_RUN_REQUEST' 'SCADA simulation enable request, default false'
Add-Symbol 'MemoryBits' 'MemoryBit' 5 'SCADA_COMMISSIONING_OK' 'Tombol SCADA commissioning OK'
Add-Symbol 'MemoryBits' 'MemoryBit' 300 'SCADA_SAFETY_OK' 'Virtual input Safety OK dari SCADA'
Add-Symbol 'MemoryBits' 'MemoryBit' 301 'SCADA_LS_CLOSE_G1' 'Virtual limit close gate 1'
Add-Symbol 'MemoryBits' 'MemoryBit' 302 'SCADA_LS_OPEN_G1' 'Virtual limit open gate 1'
Add-Symbol 'MemoryBits' 'MemoryBit' 303 'SCADA_LS_CLOSE_G2' 'Virtual limit close gate 2'
Add-Symbol 'MemoryBits' 'MemoryBit' 304 'SCADA_LS_OPEN_G2' 'Virtual limit open gate 2'
Add-Symbol 'MemoryBits' 'MemoryBit' 305 'SCADA_LS_CLOSE_G3' 'Virtual limit close gate 3'
Add-Symbol 'MemoryBits' 'MemoryBit' 306 'SCADA_LS_OPEN_G3' 'Virtual limit open gate 3'
Add-Symbol 'MemoryBits' 'MemoryBit' 307 'SCADA_OL_G1_OK' 'Virtual overload gate 1 OK'
Add-Symbol 'MemoryBits' 'MemoryBit' 308 'SCADA_OL_G2_OK' 'Virtual overload gate 2 OK'
Add-Symbol 'MemoryBits' 'MemoryBit' 309 'SCADA_OL_G3_OK' 'Virtual overload gate 3 OK'
Add-Symbol 'MemoryBits' 'MemoryBit' 344 'SCADA_MODE_AUTO' 'Virtual mode AUTO dari SCADA'
Add-Symbol 'MemoryBits' 'MemoryBit' 351 'SCADA_RESET_FAULT' 'Virtual reset fault dari SCADA'
Add-Symbol 'MemoryBits' 'MemoryBit' 370 'SCADA_ENABLE_SIM' 'Virtual enable simulator dari SCADA'
Add-Symbol 'MemoryWords' 'MemoryWord' 110 'SIM_PROFILE_ID' '221 identifies simulation-only project'
Add-Symbol 'MemoryWords' 'MemoryWord' 111 'SIM_PROFILE_VERSION' '4001 identifies simulation input mapping'
Set-WatchList 'SCADA_COMMISSIONING_INPUTS' @(
  '%M0','%M5',
  '%M300','%M301','%M302','%M303','%M304','%M305','%M306','%M307','%M308','%M309',
  '%M344','%M351','%M370',
  '%MW30','%MW31','%MW32',
  '%MW50','%MW51','%MW52',
  '%MF60','%MF62','%MF64',
  '%M360','%M361','%M362','%M363','%M364','%M365'
)

# Verify the only remaining physical output references are unconditional OFF rungs.
foreach ($rung in $rungs.SelectNodes('RungEntity')) {
  $lines = @($rung.SelectNodes('InstructionLines/InstructionLineEntity/InstructionLine') | ForEach-Object InnerText)
  if (($lines -join ' ') -match '%Q') {
    if ($rung.Name -notlike 'PHYSICAL_OUTPUT_*_LOCKED_OFF' -or $lines[0] -ne 'LD    0') { throw 'Unsafe physical output instruction detected' }
  }
  if (($lines -join ' ') -match '%I[01]\.') { throw 'Unmapped simulated input detected' }
}
$settings = New-Object System.Xml.XmlWriterSettings
$settings.Indent = $true
$settings.Encoding = New-Object System.Text.UTF8Encoding($false)
$writer = [System.Xml.XmlWriter]::Create([IO.Path]::GetFullPath($Output), $settings)
try { $project.Save($writer) } finally { $writer.Dispose() }
Write-Output "Created SIM ONLY project: $([IO.Path]::GetFullPath($Output))"
Write-Output "Rungs: $($rungs.ChildNodes.Count); physical relay outputs: locked OFF"

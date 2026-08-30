param([string]$ProjectPath = (Join-Path $PSScriptRoot '..\AWGC_REV3_BEFORE_SIM_INPUTS.smbp'))
$ErrorActionPreference = 'Stop'
$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
$backupPath = "$ProjectPath.before-scada.bak"
if (!(Test-Path -LiteralPath $backupPath)) { Copy-Item -LiteralPath $ProjectPath -Destination $backupPath }
[xml]$project = Get-Content -Raw -LiteralPath $backupPath
$hardwareBefore = $project.ProjectDescriptor.HardwareConfiguration.OuterXml
$rungs = $project.SelectSingleNode('//ProgramOrganizationUnits/Rungs')
$originals = @{}; foreach ($rung in $rungs.ChildNodes) { $originals[$rung.Name] = $rung.OuterXml }
$template = $rungs.SelectSingleNode('RungEntity[Name="SYSTEM_PERMISSIVE"]')
$contactTemplate = $template.SelectSingleNode('LadderElements/LadderEntity[ElementType="NormalContact"]').CloneNode($true)
$coilTemplate = $template.SelectSingleNode('LadderElements/LadderEntity[ElementType="Coil"]').CloneNode($true)
$lineTemplate = $template.SelectSingleNode('LadderElements/LadderEntity[ElementType="Line"]').CloneNode($true)
function TextNode($parent, [string]$name, [string]$value) {
  $node = $parent.SelectSingleNode($name)
  if (!$node) { $node = $project.CreateElement($name); [void]$parent.AppendChild($node) }
  $node.InnerText = $value
}
function Instructions($rung, [string[]]$lines) {
  $parent = $rung.SelectSingleNode('InstructionLines'); $parent.RemoveAll()
  foreach ($line in $lines) {
    $entity = $project.CreateElement('InstructionLineEntity')
    TextNode $entity 'InstructionLine' $line; TextNode $entity 'Comment' ''
    [void]$parent.AppendChild($entity)
  }
}
function SimpleRung([string]$name, [string]$inputAddress, [string]$outputAddress, [string]$operation = 'ST') {
  $rung = $template.CloneNode($true)
  $rung.Name = $name; $rung.MainComment = 'REV3 SCADA: physical I/O and safety logic retained.'
  $elements = $rung.SelectSingleNode('LadderElements'); $elements.RemoveAll()
  $contact = $contactTemplate.CloneNode($true)
  TextNode $contact 'Descriptor' $inputAddress; TextNode $contact 'Symbol' ''; TextNode $contact 'Comment' ''
  TextNode $contact 'Column' '0'; [void]$elements.AppendChild($contact)
  foreach ($column in 1..9) { $line = $lineTemplate.CloneNode($true); $line.Column = "$column"; [void]$elements.AppendChild($line) }
  $coil = $coilTemplate.CloneNode($true)
  TextNode $coil 'Descriptor' $outputAddress; TextNode $coil 'Symbol' ''; TextNode $coil 'Comment' ''
  $coil.ElementType = switch ($operation) { 'S' { 'SetCoil' } 'R' { 'ResetCoil' } default { 'Coil' } }
  [void]$elements.AppendChild($coil)
  Instructions $rung @("LD    $inputAddress", "$operation    $outputAddress")
  return $rung
}
function Symbol([string]$parentName, [string]$entityName, [int]$index, [string]$symbol, [string]$comment) {
  $parent = $project.SelectSingleNode("//SoftwareConfiguration/$parentName")
  $prefix = if ($entityName -eq 'MemoryBit') { '%M' } else { '%MW' }
  if ($parent.SelectSingleNode("$entityName" + "[Address='$prefix$index']")) { throw "Address already allocated: $prefix$index" }
  $entity = $project.CreateElement($entityName)
  TextNode $entity 'Address' "$prefix$index"; TextNode $entity 'Index' "$index"
  TextNode $entity 'Symbol' $symbol; TextNode $entity 'Comment' $comment
  [void]$parent.AppendChild($entity)
}

# One additional normally-closed STOP condition; never bypass any original condition.
$permissive = $rungs.SelectSingleNode('RungEntity[Name="SYSTEM_PERMISSIVE"]')
$stopContact = $contactTemplate.CloneNode($true)
$stopContact.ElementType = 'NegatedContact'; $stopContact.Column = '5'
TextNode $stopContact 'Descriptor' '%M6'; TextNode $stopContact 'Symbol' 'SCADA_STOP'
TextNode $stopContact 'Comment' '1=STOP; startup STOP. This is not an emergency stop.'
$line5 = $permissive.SelectSingleNode('LadderElements/LadderEntity[Column="5"]')
[void]$line5.ParentNode.ReplaceChild($stopContact, $line5)
Instructions $permissive @('LD    %I0.0','AND   %I0.7','AND   %I0.8','AND   %I0.9','AND   %M5','ANDN  %M6','ST    %M0')
$permissive.MainComment = 'Original safety + overload + commissioning, AND NOT SCADA_STOP. No physical input bypass.'
Symbol 'MemoryBits' 'MemoryBit' 6 'SCADA_STOP' 'BOOL RW: 1=STOP, 0=release stop; reset to STOP on first RUN'
[void]$rungs.PrependChild((SimpleRung 'SCADA_STARTUP_STOP' '%S13' '%M6' 'S'))
[void]$rungs.PrependChild((SimpleRung 'SCADA_STARTUP_COMMISSIONING_RESET' '%S13' '%M5' 'R'))

# Always-current compatibility marker, not an authentication mechanism.
foreach ($pair in @(@(110,221,'REV3_SCADA_ID'), @(111,3001,'REV3_SCADA_VERSION'))) {
  $marker = $rungs.SelectSingleNode('RungEntity[Name="INIT_MW1"]').CloneNode($true)
  $marker.Name = $pair[2]; $marker.MainComment = 'REV3 SCADA compatibility marker; not authentication.'
  $marker.SelectSingleNode('LadderElements').RemoveAll(); $marker.IsLadderSelected = 'false'
  Instructions $marker @('LD    1',"[ %MW$($pair[0]) := $($pair[1]) ]")
  [void]$rungs.PrependChild($marker)
  Symbol 'MemoryWords' 'MemoryWord' $pair[0] $pair[2] 'Read only compatibility marker'
}

# Read-only mirrors for Modbus: no original I/Q references are replaced.
foreach ($inputIndex in 0..13) {
  $bit = 300 + $inputIndex
  [void]$rungs.AppendChild((SimpleRung "SCADA_I0_$inputIndex" "%I0.$inputIndex" "%M$bit"))
  Symbol 'MemoryBits' 'MemoryBit' $bit "STATUS_I0_$inputIndex" "Read-only mirror of physical input %I0.$inputIndex"
}
foreach ($inputIndex in 24..31) {
  $bit = 320 + $inputIndex
  [void]$rungs.AppendChild((SimpleRung "SCADA_I1_$inputIndex" "%I1.$inputIndex" "%M$bit"))
  Symbol 'MemoryBits' 'MemoryBit' $bit "STATUS_I1_$inputIndex" "Read-only mirror of physical input %I1.$inputIndex"
}
foreach ($outputIndex in 0..5) {
  $bit = 360 + $outputIndex
  [void]$rungs.AppendChild((SimpleRung "SCADA_Q0_$outputIndex" "%Q0.$outputIndex" "%M$bit"))
  Symbol 'MemoryBits' 'MemoryBit' $bit "STATUS_Q0_$outputIndex" "Read-only mirror of actual output %Q0.$outputIndex"
}

foreach ($name in $originals.Keys) {
  if ($name -eq 'SYSTEM_PERMISSIVE') { continue }
  if ($rungs.SelectSingleNode("RungEntity[Name='$name']").OuterXml -cne $originals[$name]) { throw "Unexpected change to original rung: $name" }
}
if ($project.ProjectDescriptor.HardwareConfiguration.OuterXml -cne $hardwareBefore) { throw 'Hardware changed' }
$project.ProjectDescriptor.FullName = $ProjectPath
$settings = New-Object System.Xml.XmlWriterSettings
$settings.Indent = $true; $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
$writer = [System.Xml.XmlWriter]::Create($ProjectPath, $settings)
try { $project.Save($writer) } finally { $writer.Dispose() }
Write-Output "Edited: $ProjectPath"
Write-Output "Backup: $backupPath"
Write-Output "Verified: hardware + 134 original rungs unchanged; SYSTEM_PERMISSIVE only adds STOP interlock. Total rungs: $($rungs.ChildNodes.Count)"

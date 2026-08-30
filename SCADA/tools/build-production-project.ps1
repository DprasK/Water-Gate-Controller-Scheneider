param(
  [string]$Source = (Join-Path $PSScriptRoot '..\AWGC_REV3_BEFORE_SIM_INPUTS.smbp'),
  [string]$Output = (Join-Path $PSScriptRoot '..\AWGC_PRODUKSI_TM221CE24R.smbp'),
  [string]$ProjectName = 'AWGC_PRODUKSI_TM221CE24R'
)
$ErrorActionPreference = 'Stop'

[xml]$project = Get-Content -Raw -LiteralPath $Source
$project.ProjectDescriptor.Name = $ProjectName
$project.ProjectDescriptor.FullName = [IO.Path]::GetFullPath($Output)

function Set-Rung-Lines([System.Xml.XmlElement]$rung, [string[]]$lines) {
  $instructionLines = $rung.SelectSingleNode('InstructionLines')
  $instructionLines.RemoveAll()
  foreach ($line in $lines) {
    $entity = $project.CreateElement('InstructionLineEntity')
    $instruction = $project.CreateElement('InstructionLine')
    $instruction.InnerText = $line
    [void]$entity.AppendChild($instruction)
    [void]$entity.AppendChild($project.CreateElement('Comment'))
    [void]$instructionLines.AppendChild($entity)
  }
}

function Ensure-Rung([string]$name, [string[]]$lines) {
  $rungs = $project.SelectSingleNode('//ProgramOrganizationUnits/Rungs')
  $rung = $rungs.SelectSingleNode("RungEntity[Name='$name']")
  if ($null -eq $rung) {
    $rung = $rungs.FirstChild.CloneNode($true)
    $rung.Name = $name
    $rung.SelectSingleNode('LadderElements').RemoveAll()
    $rung.IsLadderSelected = 'false'
    [void]$rungs.PrependChild($rung)
  }
  $rung.MainComment = 'SCADA compatibility marker for production profile.'
  Set-Rung-Lines $rung $lines
}

function Add-Symbol([string]$parentName, [string]$nodeName, [string]$address, [string]$index, [string]$symbol, [string]$comment) {
  $parent = $project.SelectSingleNode("//SoftwareConfiguration/$parentName")
  $item = $parent.SelectSingleNode("$nodeName[Address='$address']")
  if ($item -eq $null) {
    $item = $project.CreateElement($nodeName)
    foreach ($pair in @(@('Address',$address),@('Index',$index),@('Symbol',$symbol),@('Comment',$comment))) {
      $node = $project.CreateElement($pair[0])
      $node.InnerText = $pair[1]
      [void]$item.AppendChild($node)
    }
    [void]$parent.AppendChild($item)
    return
  }
  foreach ($name in @('Symbol','Comment')) {
    if ($null -eq $item.SelectSingleNode($name)) { [void]$item.AppendChild($project.CreateElement($name)) }
  }
  $item.SelectSingleNode('Symbol').InnerText = $symbol
  $item.SelectSingleNode('Comment').InnerText = $comment
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
    $reprNode.InnerText = if ($address -match '^%(M|I|Q)(?!W|F)') { 'BoolNumeric' } else { 'Decimal' }
    [void]$item.AppendChild($reprNode)
    [void]$items.AppendChild($item)
  }
  [void]$list.AppendChild($items)
  [void]$watchLists.AppendChild($list)
}

Ensure-Rung 'REV3_SCADA_ID' @('LD    1','[ %MW110 := 221 ]')
Ensure-Rung 'REV3_SCADA_VERSION' @('LD    1','[ %MW111 := 3001 ]')

Add-Symbol 'MemoryWords' 'MemoryWord' '%MW110' '110' 'SCADA_PROFILE_ID' '221 identifies AWGC SCADA map'
Add-Symbol 'MemoryWords' 'MemoryWord' '%MW111' '111' 'SCADA_PROFILE_VERSION' '3001 production profile: physical inputs and relay outputs'

Set-WatchList 'PRODUKSI_IO_MONITOR' @(
  '%M0','%M5','%M6',
  '%I0.0','%I0.1','%I0.2','%I0.3','%I0.4','%I0.5','%I0.6','%I0.7','%I0.8','%I0.9',
  '%I1.0','%I1.1','%I1.2','%I1.3','%I1.4','%I1.5','%I1.6','%I1.7',
  '%I1.8','%I1.9','%I1.10','%I1.11','%I1.12','%I1.13','%I1.14','%I1.15',
  '%I1.16','%I1.17','%I1.18','%I1.19','%I1.20','%I1.21','%I1.22','%I1.23',
  '%I1.24','%I1.31',
  '%MW30','%MW31','%MW32',
  '%MW50','%MW51','%MW52',
  '%MF60','%MF62','%MF64','%MF66','%MF68','%MF70','%MF72','%MF74',
  '%Q0.0','%Q0.1','%Q0.2','%Q0.3','%Q0.4','%Q0.5'
)

$rungsXml = $project.SelectSingleNode('//ProgramOrganizationUnits/Rungs').OuterXml
if ($rungsXml -notmatch '%I0\.0' -or $rungsXml -notmatch '%Q0\.0') {
  throw 'Production project validation failed: physical input/output references are missing'
}
if ($rungsXml -match 'PHYSICAL_OUTPUT_.*LOCKED_OFF|SIM_RUN_REQUEST|SYSTEM_PERMISSIVE_SIM') {
  throw 'Production project validation failed: simulator-only logic detected'
}

$settings = New-Object System.Xml.XmlWriterSettings
$settings.Indent = $true
$settings.Encoding = New-Object Text.UTF8Encoding($false)
$writer = [System.Xml.XmlWriter]::Create([IO.Path]::GetFullPath($Output), $settings)
try { $project.Save($writer) } finally { $writer.Dispose() }

Write-Output "Created production project: $([IO.Path]::GetFullPath($Output))"

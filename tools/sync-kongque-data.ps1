param(
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$sourcePath = Join-Path $RepositoryRoot "src\assets\data\kongque-cards.json"
$targetPath = Join-Path $RepositoryRoot "src\assets\data\kongque-cards.js"
$json = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8

# 先解析一次，避免把损坏的 JSON 同步到浏览器脚本。
$null = $json | ConvertFrom-Json

$header = @'
// 此文件由 tools/sync-kongque-data.ps1 从 kongque-cards.json 自动生成。
// 请修改 JSON 源文件后重新运行同步脚本，不要直接编辑本文件。
window.KONGQUE_DATA =
'@

$content = $header + "`r`n" + $json.Trim() + ";`r`n"
[System.IO.File]::WriteAllText($targetPath, $content, [System.Text.UTF8Encoding]::new($false))

Write-Output "已同步：$targetPath"

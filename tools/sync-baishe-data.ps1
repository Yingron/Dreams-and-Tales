param(
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$items = @(
  @{
    Source = "src\assets\data\baishe-cards.json"
    Target = "src\assets\data\baishe-cards.js"
    Global = "BAISHE_CARDS"
  },
  @{
    Source = "src\assets\data\baishe-stories.json"
    Target = "src\assets\data\baishe-stories.js"
    Global = "BAISHE_STORIES"
  }
)

foreach ($item in $items) {
  $sourcePath = Join-Path $RepositoryRoot $item.Source
  $targetPath = Join-Path $RepositoryRoot $item.Target
  $json = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8

  # 先解析一次，避免把损坏的 JSON 同步到浏览器脚本。
  $null = $json | ConvertFrom-Json

  $header = "// 此文件由 tools/sync-baishe-data.ps1 自动生成，请修改 JSON 后重新同步。`r`n"
  $content = $header + "window.$($item.Global) =`r`n" + $json.Trim() + ";`r`n"
  [System.IO.File]::WriteAllText($targetPath, $content, [System.Text.UTF8Encoding]::new($false))

  Write-Output "已同步：$targetPath"
}

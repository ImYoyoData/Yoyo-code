<#
.SYNOPSIS
  Yoyo Code 桌面端一键打包脚本（Windows）。

.DESCRIPTION
  依次执行：依赖检查 → 构建各 workspace 包 → electron-builder 打包 → 列出产物。
  脚本无论成功或失败都会停在窗口等回车，不会自动关闭。

.PARAMETER Os
  目标平台：win（默认）/ mac / linux。

.PARAMETER Arch
  目标架构：x64（默认）/ arm64。

.PARAMETER Preview
  打 Preview 身份包（应用名 "Yoyo Code Preview"，可与正式版并排安装）。
  不加此开关时打正式身份 "Yoyo Code"。

.PARAMETER SkipBootstrap
  跳过 pnpm bootstrap。仅在依赖与各包产物都已就绪、只重打安装包时使用。

.PARAMETER NoPause
  结束后不等待回车（供 CI 或自动化调用）。

.EXAMPLE
  .\build.ps1
  打 Windows x64 正式包。

.EXAMPLE
  .\build.ps1 -Arch arm64 -Preview
  打 Windows arm64 的 Preview 包。
#>
[CmdletBinding()]
param(
  [ValidateSet('win', 'mac', 'linux')]
  [string]$Os = 'win',

  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',

  [switch]$Preview,
  [switch]$SkipBootstrap,
  [switch]$NoPause
)

# 用 Continue 而非 Stop：原生命令（pnpm 等）把小节标题写到 stderr 时，
# Stop 会让 PowerShell 把它们当成终止性错误，构建会在无关紧要的输出上中断。
$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

function Write-Step {
  param([string]$Text)
  Write-Host ''
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Assert-Command {
  param([string]$Name, [string]$Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "找不到 $Name。$Hint"
  }
  return $true
}

function Invoke-Pnpm {
  param([string[]]$Arguments, [string]$FailMessage)
  & pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailMessage（pnpm 退出码 $LASTEXITCODE）"
  }
}

# electron-builder 在 Windows 上需要 winCodeSign 缓存里的 signtool.exe。
# 它自带的解压会在无特权时失败：该包内含 macOS 的符号链接，而创建符号链接需要
# 「开发者模式」或管理员权限，报错是 "Cannot create symbolic link ... 客户端没有所需的特权"，
# 而且要到打包末尾才报，白等十几分钟。这里提前用 7za 解压（符号链接按普通文件处理），
# 只校验 Windows 侧真正需要的文件是否就位。
function Initialize-WinCodeSignCache {
  $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
  $targetDir = Join-Path $cacheRoot 'winCodeSign-2.6.0'
  $signtool = Join-Path $targetDir 'windows-10\x64\signtool.exe'

  if (Test-Path $signtool) {
    Write-Host 'winCodeSign 缓存已就绪' -ForegroundColor DarkGray
    return
  }

  $sevenZip = Join-Path $repoRoot 'node_modules\7zip-bin\win\x64\7za.exe'
  if (-not (Test-Path $sevenZip)) {
    Write-Host '未找到 7za.exe（node_modules/7zip-bin），跳过 winCodeSign 预解压' -ForegroundColor Yellow
    return
  }

  Write-Host 'winCodeSign 缓存缺失，正在预解压（包内 macOS 符号链接在 Windows 上解不出来，属预期）' -ForegroundColor Yellow
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

  $archive = Get-ChildItem -Path $cacheRoot -Filter '*.7z' -ErrorAction SilentlyContinue |
    Sort-Object -Property LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $archive) {
    $archivePath = Join-Path $cacheRoot 'winCodeSign-2.6.0.7z'
    $url = 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z'
    Write-Host "下载 $url" -ForegroundColor DarkGray
    try {
      Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing
    } catch {
      Write-Host "下载失败: $($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host '若随后报符号链接错误，请开启 Windows 开发者模式，或以管理员身份重跑本脚本。' -ForegroundColor Yellow
      return
    }
    $archive = Get-Item $archivePath
  }

  if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
  # -snl 让 7-Zip 把符号链接当普通条目处理。无特权时它仍可能以退出码 2 结束，
  # 只要 Windows 侧文件解出来就可以继续，因此这里不因退出码中断。
  & $sevenZip x -y -snl -bd "-o$targetDir" $archive.FullName | Out-Null

  if (Test-Path $signtool) {
    Write-Host 'winCodeSign 预解压完成（已忽略 macOS 符号链接）' -ForegroundColor Green
  } else {
    Write-Host '预解压后仍未找到 signtool.exe；请开启 Windows 开发者模式，或以管理员身份重跑本脚本。' -ForegroundColor Yellow
  }
}

$exitCode = 0

try {
  Write-Host 'Yoyo Code 打包' -ForegroundColor Green
  Write-Host "仓库目录: $repoRoot"
  Write-Host "目标平台: $Os/$Arch"
  Write-Host "产品身份: $(if ($Preview) { 'Preview' } else { 'Production' })"

  Assert-Command -Name 'pnpm' -Hint '请先安装 pnpm（版本见 mise.toml），并确保它在 PATH 中。' | Out-Null
  Assert-Command -Name 'node' -Hint '请先安装 Node.js（版本见 mise.toml）。' | Out-Null

  # 内置 Provider 目录只认仓库里的 config/provider/zcode-builtin.json。
  # 从 ZCode 终端启动时，应用会往子进程注入这两个变量，指向另一套安装的物化目录；
  # 不清掉的话，打包进去的是那套目录而不是本仓库的，账号套餐类 Provider 会一起被打包。
  foreach ($name in @('ZCODE_BUILTIN_PROVIDER_CONFIG_FILE', 'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE')) {
    if (Test-Path "Env:$name") {
      Remove-Item "Env:$name"
      Write-Host "已清除继承的环境变量 $name" -ForegroundColor Yellow
    }
  }

  # ZCODE_ENV 决定产品身份：未设置时按 test 处理，产物会变成 "Yoyo Code Preview"。
  # 这里显式设定，保证默认打出的是正式身份。
  $env:ZCODE_ENV = if ($Preview) { 'test' } else { 'production' }

  # electron / electron-builder 二进制走国内镜像，与 mise.toml 的默认值一致。
  if (-not $env:ELECTRON_MIRROR) {
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  }
  # 非交互环境下跳过 husky 的 git hooks 安装。
  $env:HUSKY = '0'

  if (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    Write-Step '安装依赖 (pnpm install)'
    Invoke-Pnpm -Arguments @('install') -FailMessage '依赖安装失败'
  } else {
    Write-Host 'node_modules 已存在，跳过依赖安装' -ForegroundColor DarkGray
  }

  if ($SkipBootstrap) {
    Write-Host '按参数要求跳过 pnpm bootstrap' -ForegroundColor Yellow
  } else {
    Write-Step '构建各 workspace 包 (pnpm bootstrap)'
    Write-Host '这一步会准备桌面运行时资源并构建所有包，首次执行需要几分钟。' -ForegroundColor DarkGray
    Invoke-Pnpm -Arguments @('bootstrap') -FailMessage 'workspace 构建失败'
  }

  Write-Step "打包桌面应用 (bundle:desktop --os $Os --arch $Arch)"
  if ($Os -eq 'win') {
    Initialize-WinCodeSignCache
  }
  Invoke-Pnpm -Arguments @('bundle:desktop', '--', '--os', $Os, '--arch', $Arch) -FailMessage '桌面打包失败'

  Write-Step '打包产物'
  $distDir = Join-Path $repoRoot 'packages/desktop/dist'
  if (Test-Path $distDir) {
    Get-ChildItem -Path $distDir -File |
      Sort-Object -Property Length -Descending |
      Select-Object -First 15 Name, @{ Name = '大小(MB)'; Expression = { [math]::Round($_.Length / 1MB, 1) } }, LastWriteTime |
      Format-Table -AutoSize
    Write-Host "产物目录: $distDir" -ForegroundColor Green
  } else {
    Write-Host "未找到产物目录: $distDir" -ForegroundColor Yellow
  }

  Write-Host ''
  Write-Host '打包完成。' -ForegroundColor Green
} catch {
  $exitCode = 1
  Write-Host ''
  Write-Host "构建失败: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '完整报错请向上翻阅本窗口的输出。' -ForegroundColor Red
} finally {
  if (-not $NoPause) {
    Write-Host ''
    Read-Host '按回车键关闭此窗口' | Out-Null
  }
}

exit $exitCode

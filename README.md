# 古河渚桌宠

Windows 桌宠的第一次开发。启动后，古河渚会出现在主屏工作区右下角。按住角色即可拖动，右击系统托盘中的「古河渚桌宠」图标并选择「退出桌宠」即可关闭。图标也可能出现在托盘的折叠菜单里。

## 本地运行

在 Windows 上安装 Git 和 Node.js LTS，然后从仓库根目录运行：

```powershell
Set-Location '.\nagisa-app'
npm.cmd start
```

新克隆仓库后，在 `nagisa-app` 里先运行一次 `npm.cmd ci`。首次启动会下载 Electron 运行环境。

仓库已包含运行所需的角色图。开发顺序和验收步骤见[第一次开发指南](docs/01-第一次开发指南.md)。

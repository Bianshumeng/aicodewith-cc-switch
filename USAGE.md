# CC-Switch for AiCodeWith 使用指南

## 快速开始

### 1. 安装应用

从 [Releases页面](https://github.com/Bianshumeng/aicodewith-cc-switch/releases) 下载对应系统的安装包：

- **Windows**: `CC-Switch-Setup.msi`（安装版）或 `CC-Switch-Windows-Portable.zip`（绿色版）
- **macOS**: `CC-Switch-macOS.zip`（解压即用）
- **Linux**: `CC-Switch-Linux.deb`（DEB包）或 `CC-Switch-Linux.AppImage`（通用格式）

### 2. 获取AiCodeWith API Token

1. 访问 [AiCodeWith中转站](https://aicodewith.com/)
2. 注册/登录账号
3. 获取你的API Token

### 3. 配置AiCodeWith供应商

1. 启动CC-Switch应用
2. 点击"添加供应商"
3. 在预设列表中选择"AiCodeWith"
4. 填入你的API Token
5. 保存配置

### 4. 切换到AiCodeWith

1. 在供应商列表中选择"AiCodeWith"
2. 点击"切换"按钮
3. 重启终端或VS Code
4. 开始使用Claude Code！

## 高级功能

### 系统托盘（菜单栏）快速切换

应用支持系统托盘功能，可以：
- 快速查看当前使用的供应商
- 一键切换不同供应商
- 无需打开主界面

### 支持多个应用

CC-Switch支持同时管理：
- **Claude Code**: `~/.claude/settings.json`
- **Codex**: `~/.codex/auth.json` + `config.toml`

### 自定义供应商

除了预置的供应商，你还可以：
1. 添加自定义API端点
2. 配置专用的API Key
3. 设置特殊参数

## 常见问题

### macOS安全提示

如果macOS提示应用"已损坏"，请在终端执行：
```bash
xattr -cr "/Applications/CC Switch.app"
```

### Claude Code无法连接

1. 确认已重启终端
2. 检查 `~/.claude/settings.json` 是否正确更新
3. 尝试运行 `claude auth status`

### API配置错误

1. 检查API Token是否正确
2. 确认API端点URL格式正确
3. 查看网络连接是否正常

## 技术支持

- **项目地址**: https://github.com/Bianshumeng/aicodewith-cc-switch
- **AiCodeWith官网**: https://aicodewith.com/
- **原项目**: https://github.com/farion1231/cc-switch

## 许可证

本项目基于MIT许可证，Fork自原始CC-Switch项目。
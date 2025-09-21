# CC-Switch for AiCodeWith

[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/farion1231/cc-switch/releases)

> **注意**：这是 [原始CC-Switch项目](https://github.com/farion1231/cc-switch) 的fork版本，专为AiCodeWith中转站服务定制。

基于MIT许可证，原作者：Jason Young

一个用于管理和切换 Claude Code 与 Codex 不同供应商配置的桌面应用。已预置 [AiCodeWith](https://aicodewith.com/) 供应商配置，为国内用户提供稳定的Claude API中转服务。

## AiCodeWith 中转站服务

本项目专为 [AiCodeWith中转站](https://aicodewith.com/) 定制，提供：

- 🚀 **开箱即用** - 预置AiCodeWith供应商配置，无需手动添加
- 🌐 **稳定服务** - 专为国内用户优化的Claude API中转服务
- ⚡ **快速切换** - 支持在官方登录和AiCodeWith服务间一键切换
- 🔒 **安全可靠** - 基于成熟的CC-Switch架构，保障配置安全

## 功能特性（v3.2.0）

- **全新 UI**：感谢 [TinsFox](https://github.com/TinsFox) 大佬设计的全新 UI
- **系统托盘（菜单栏）快速切换**：按应用分组（Claude / Codex），勾选态展示当前供应商
- **内置更新器**：集成 Tauri Updater，支持检测/下载/安装与一键重启
- **单一事实源（SSOT）**：不再写每个供应商的“副本文件”，统一存于 `~/.cc-switch/config.json`
- **一次性迁移/归档**：首次升级自动导入旧副本并归档原文件，之后不再持续归档
- **原子写入与回滚**：写入 `auth.json`/`config.toml`/`settings.json` 时避免半写状态
- **深色模式优化**：Tailwind v4 适配与选择器修正
- **丰富预设与自定义**：预置 AiCodeWith、Qwen coder、Kimi、GLM、DeepSeek 等；可自定义 Base URL
- **本地优先与隐私**：全部信息存储在本地 `~/.cc-switch/config.json`

## 系统要求

- **Windows**: Windows 10 及以上
- **macOS**: macOS 10.15 (Catalina) 及以上
- **Linux**: Ubuntu 20.04+ / Debian 11+ / Fedora 34+ 等主流发行版

## 使用说明

### 使用AiCodeWith中转站服务

1. **直接使用预置配置**：应用已预置AiCodeWith供应商，可直接选择切换
2. **获取API Token**：访问 [AiCodeWith](https://aicodewith.com/) 获取你的API Token
3. **配置API Key**：在预置的AiCodeWith供应商中填入你的API Token
4. **一键切换**：选择AiCodeWith供应商并点击切换即可使用

### 通用使用流程

1. 点击"添加供应商"添加你的 API 配置（或使用预置的AiCodeWith配置）
2. 切换方式：
   - 在主界面选择供应商后点击切换
   - 或通过"系统托盘（菜单栏）"直接选择目标供应商，立即生效
3. 切换会写入对应应用的"live 配置文件"（Claude：`settings.json`；Codex：`auth.json` + `config.toml`）
4. 重启或新开终端以确保生效
5. 若需切回官方登录，在预设中选择"官方登录"并切换即可；重启终端后按官方流程登录

### 配置说明

#### Claude Code
- 配置目录：`~/.claude/`
- 配置文件：`settings.json`
- API Key 字段：`env.ANTHROPIC_AUTH_TOKEN`

#### Codex
- 配置目录：`~/.codex/`
- 配置文件：`auth.json`、`config.toml`
- API Key 字段：`auth.json` 中的 `OPENAI_API_KEY`

## 开发

### 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建应用
pnpm build
```

## 技术栈

- **Tauri 2** - 跨平台桌面应用框架
- **React 18 + TypeScript** - 前端框架
- **Rust** - 后端语言

## 许可证和致谢

本项目基于 MIT 许可证进行分发，fork自 [farion1231/cc-switch](https://github.com/farion1231/cc-switch)。

### MIT许可证要求

本软件基于MIT许可证分发。使用、修改或分发本软件时，请保留以下版权声明：

```
MIT License

Copyright (c) 2025 Jason Young

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

### 致谢

- 原项目作者：[Jason Young](https://github.com/farion1231)
- UI设计：[TinsFox](https://github.com/TinsFox)
- 基于开源项目：[farion1231/cc-switch](https://github.com/farion1231/cc-switch)

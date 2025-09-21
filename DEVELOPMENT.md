# 开发指南

## 环境要求

- **Node.js**: 18.0+
- **pnpm**: 8.0+
- **Rust**: 1.75+
- **Tauri CLI**: 2.0+

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/Bianshumeng/aicodewith-cc-switch.git
cd aicodewith-cc-switch
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 开发模式

```bash
# 启动开发环境（热重载）
pnpm dev

# 仅启动前端开发服务器
pnpm dev:renderer

# 类型检查
pnpm typecheck
```

### 4. 构建应用

```bash
# 构建生产版本
pnpm build

# 构建调试版本
pnpm tauri build --debug
```

## 项目结构

```
├── src/                   # 前端代码 (React + TypeScript)
│   ├── components/       # React 组件
│   ├── config/          # 预设供应商配置
│   ├── lib/             # Tauri API 封装
│   └── utils/           # 工具函数
├── src-tauri/            # 后端代码 (Rust)
│   ├── src/             # Rust 源代码
│   │   ├── commands.rs  # Tauri 命令定义
│   │   ├── config.rs    # 配置文件管理
│   │   ├── provider.rs  # 供应商管理逻辑
│   │   └── store.rs     # 状态管理
│   ├── capabilities/    # 权限配置
│   └── icons/           # 应用图标资源
└── .github/workflows/   # CI/CD 配置
```

## 代码质量

### 格式化代码

```bash
# 格式化前端代码
pnpm format

# 检查代码格式
pnpm format:check
```

### Rust 代码

```bash
cd src-tauri

# 格式化 Rust 代码
cargo fmt

# 运行 clippy 检查
cargo clippy

# 运行测试
cargo test
```

## 添加新的供应商预设

1. 编辑 `src/config/providerPresets.ts` (Claude Code)
2. 或编辑 `src/config/codexProviderPresets.ts` (Codex)
3. 按照现有格式添加新的预设配置

示例：
```typescript
{
  name: "新供应商",
  websiteUrl: "https://example.com",
  settingsConfig: {
    env: {
      ANTHROPIC_BASE_URL: "https://api.example.com",
      ANTHROPIC_AUTH_TOKEN: "",
    },
  },
  category: "third_party",
}
```

## GitHub Actions

项目使用GitHub Actions自动构建跨平台安装包：

- **触发**: 推送tag（如 `v1.0.0`）
- **平台**: Windows, macOS, Linux
- **产物**: MSI, ZIP, DEB, AppImage

### 手动触发构建

```bash
# 创建并推送tag
git tag v1.1.0
git push origin v1.1.0
```

## 调试技巧

### Tauri 开发者工具

在开发模式下，可以：
1. 打开浏览器开发者工具（F12）
2. 查看Rust后端日志
3. 调试前端React组件

### 配置文件位置

- **Windows**: `%USERPROFILE%\.cc-switch\config.json`
- **macOS/Linux**: `~/.cc-switch/config.json`

### 日志输出

```rust
// 在 Rust 代码中添加日志
tauri::generate_handler![your_command];

#[tauri::command]
fn your_command() {
    println!("Debug: {}", "your message");
}
```

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

本项目基于 MIT 许可证开源。
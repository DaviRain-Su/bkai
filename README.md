# BKAI EPUB Reader (Bun + React)

基于 Bun / TypeScript / React 的电子书阅读器原型，首版聚焦 `.epub` 格式，包含解析、分页、状态管理等核心模块。

## 快速开始

```bash
# 安装依赖
bun install

# 运行测试（解析模块等）
bun test

# 启动开发服务器（当前仍是 React 模板页）
bun dev
```

## 工作区结构

- `packages/core-platform`：错误模型、事件总线等基础设施。
- `packages/epub-parser`：纯 TypeScript 的 `.epub` 解析逻辑。
- `packages/render-engine`：分页渲染接口（原型阶段）。
- `packages/state-store`：阅读进度、书签的状态管理。
- `apps/reader`：命令行入口，用于快速验证 `openEpub`。
- `src/`：现有 React 模板代码，后续迁移为 Web 阅读器界面。

更详细的角色划分和架构说明见：

- `AGENTS.md`
- `docs/architecture.md`

## 开发规划

1. 在 React Web 端实现文件上传、目录、翻页等基础 UI。
2. 完成分页引擎并输出 `PageView` 数据模型。
3. 接入浏览器持久化，保存阅读进度与书签。
4. 扩展解析模块的边界场景测试，准备多格式扩展（mobi/pdf/cbz）。

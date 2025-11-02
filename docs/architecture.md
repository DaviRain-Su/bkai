# EPUB 阅读器架构初稿（Bun / React Web）

## 目标对齐
- 首版聚焦 `.epub` 阅读：上传 → 解析 → 渲染 → 分页 → 记录进度/书签。
- 平台基于 Bun + React + TypeScript，支持快速迭代并兼容未来多格式扩展。
- 以 Agent 角色拆分职责，确保接口清晰、协作顺滑。

## 技术栈速览
- **Runtime**：Bun 1.x（包管理、脚本、测试）。
- **语言**：TypeScript（严格模式）。
- **UI**：React 19 + Tailwind，面向 Web 端。
- **状态管理**：React hooks + 自研事件总线 / 持久化适配器。
- **EPUB 支撑**：自实现 ZIP/XML 解析（纯 TypeScript，兼容浏览器与 Bun）。
- **工具链**：`bun test`、`bunx eslint/prettier`（待接入）。

## 模块拓扑
```
┌────────────┐     ┌───────────────┐     ┌──────────────┐
│ React UI   │◄───►│ State/Storage │◄───►│ QA & Tooling │
└─────▲──────┘     └──────▲────────┘     └──────▲───────┘
      │                   │                       │
      ▼                   │                       │
┌─────────────┐   paging  │      metrics/tests     │
│ Renderer    │──────────►│                       │
└─────▲───────┘           │                       │
      │                   ▼                       │
      │        ┌──────────────────┐                │
      └────────│ EPUB Parser Core │◄───────────────┘
               └──────────────────┘
```

- **Platform/Architecture**：定义 workspace、依赖、共享基建（日志、配置、错误类型、事件系统）。
- **EPUB Parser Core**：解压 ZIP、解析 OPF/NCX/XHTML，输出结构化 `BookModel`。
- **Renderer & Pagination**：将章节 HTML/CSS 转换为可分页布局，提供 `PaginationSession`。
- **React UI Shell**：实现文件上传、目录/进度侧栏、阅读区，驱动渲染与状态交互。
- **State & Storage**：管理阅读进度、书签、用户设置；封装本地/浏览器存储接口。
- **QA & Tooling**：维护测试数据、脚手架、CI 脚本（`bun lint`, `bun test`）。

## 工作区建议结构
- `package.json`（Bun 项目根，集中 scripts / devDependencies）。
- `docs/`（设计、协议、架构文档）。
- `packages/`
  - `core-platform/`：错误模型、事件总线、配置。
  - `epub-parser/`：`openEpub(source) -> Promise<BookModel>`。
  - `render-engine/`：分页算法、`PageView` 类型。
  - `state-store/`：状态机、存储适配器（Bun.fs、IndexedDB）。
  - `tooling/`（可选）：测试素材、CLI。
- `apps/web/`（计划中）：React 前端入口，组合各模块。
- 现阶段 React 代码仍在 `src/`，需逐步迁移到 `apps/web/`。

## 核心数据结构（TypeScript）
```ts
export interface BookModel {
  id: string;
  metadata: BookMetadata;
  spine: SpineItemRef[];
  manifest: Record<string, ManifestItem>;
  toc: TocItem[];
  resources: ResourceStore;
}

export interface PageView {
  id: string;
  spineIndex: number;
  fragments: TextFragment[];
  viewport: Viewport;
}

export interface PaginationSession {
  page(index: number): PageView | undefined;
  next(): PageView | undefined;
  prev(): PageView | undefined;
  locate(percent: number): PageView | undefined;
}
```

## 模块接口约定
- `epub-parser`：`openEpub(source: string | ArrayBuffer | Uint8Array) => Promise<BookModel>`，错误区分 IO/结构/DRM。
- `render-engine`：
  - `paginate(book, prefs, viewport) -> PaginationSession`
  - 事件：`onPageComputed`, `onLayoutInvalidated`（待实现）。
- `react ui` 响应命令：
  - `ReaderCommand.OpenFile(file: File)`
  - `ReaderCommand.Goto(target: PageId | ChapterRef | Percent)`
  - `ReaderCommand.ToggleSetting(key, value)`
- `state-store`：
  - `saveProgress(bookId, location)`
  - `loadProgress(bookId)`
  - `addBookmark(bookId, location)`
  - 广播 `progress:updated` / `bookmark:added`。
- `core-platform`：
  - `AppError`（`code`, `source`, `severity`, `userMessage`）
  - `EventBus<Event>`

## 关键流程
1. 用户在 React UI 上传 `.epub`，UI 将 `File` 读取为 `ArrayBuffer` 传给 `openEpub`。
2. `epub-parser` 返回 `BookModel`，UI 存入状态并触发 `render-engine` 预分页。
3. `render-engine` 基于用户设置和容器尺寸计算 `PageView`，提供翻页/跳转方法。
4. React 组件展示页面内容，监听交互（翻页、跳章节、调整字号）。
5. `state-store` 记录进度与书签，并在刷新时恢复。
6. QA 工具用 `bun test` 校验解析 & 分页，未来接入端到端截图对比。

## 近期里程碑
1. **Platform**：整理 Bun 工作区、为 React 前端建立 `apps/web` 入口，接入 ESLint/Prettier。
2. **Parser**：扩展错误覆盖、补充更多 EPUB Fixtures（图片、缺资源、RTL）。
3. **Renderer**：实现基础分页（固定字体/容器），输出真实 `PageView`。
4. **React UI**：实现文件上传 → 渲染章节 → 翻页，展示目录与进度。
5. **State**：接入浏览器持久化（IndexedDB/localStorage）并暴露 hook。
6. **QA**：构建解析与分页的 Smoke Test，准备端到端测试计划。

## 后续扩展预留
- 解析层以 `FormatParser` 接口扩展 `.mobi`、`.pdf`、`.cbz`。
- `render-engine` 支持主题/夜间模式、阅读偏好（行距、字间距、无障碍字体）。
- `state-store` 引入 `StorageBackend` 切换本地与云端。
- 增加搜索、高亮、批注模块，与事件总线共享数据。 

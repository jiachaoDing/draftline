<p align="center">
  <img src="docs/images/cover.png" alt="Draftline：从草图与尺寸描述到可编辑 SVG 图纸" width="100%" />
</p>

<p align="center">
  <strong>用自然语言画图，让每一次修改都有据可循。</strong><br />
  将草图、参考文件和尺寸要求，转为可继续编辑的毫米级 SVG 图纸。
</p>

<p align="center">
  <a href="https://draftline.anxinsm.com">在线体验</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/user-guide.md">使用指南</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb" alt="MIT License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="Strict TypeScript" /></a>
  <a href="wrangler.jsonc"><img src="https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020" alt="Cloudflare Workers" /></a>
</p>

![Draftline 实际界面：项目列表、可编辑图纸与 AI 对话](docs/images/workspace.png)

## Draftline 能做什么

Draftline 是一个开源的 AI 绘图工作台。你提供草图与尺寸，AI 生成图纸；选中对象后，还能通过对话继续修改。每张图纸保留自己的对话、参考文件和撤销历史。

| 能力          | 使用方式                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| 草图 → 图纸   | 输入文字或附上图片、SVG、PDF、DXF、文本；缺少关键尺寸时，AI 会先提问           |
| 局部修改      | 点选、框选或进入分组，让 AI 调整相关对象；超出选区的修改先交由你审阅           |
| 可编辑源代码  | 在 Code 编辑器中查看、修改、格式化 HTML / SVG / JavaScript，并在沙箱验证后应用 |
| 毫米 SVG 导出 | 1 个 SVG 单位对应 1 mm；导出纯几何，或包含尺寸、标题栏和技术说明的完整图纸     |
| 独立项目      | 自动保存图纸、对话、附件与草稿；支持撤销 / 重做，生成时也可切换项目            |
| 自选模型      | 配置 OpenAI 兼容接口或 NewAPI，使用自己的 API Key；回复与绘图过程流式呈现      |
| 中英双语      | 默认简体中文，可即时切换英文；桌面、平板与手机均有对应布局                     |

## 先体验，再接入模型

1. 打开 **[在线工作台](https://draftline.anxinsm.com)**，查看四个可编辑示例。
2. 在 **模型设置** 中填写 Base URL、API Key 和模型名称，测试连接。
3. 新建图纸，描述尺寸或上传参考文件；回答 AI 的测量问题。
4. 选中对象继续修改，审阅变更后导出 SVG。

例如，可以先描述：

> 画一块 120 × 80 mm 的矩形板，四角圆角半径 8 mm。中心开一个直径 20 mm 的圆孔，标注外形与孔径。

使用支持**流式工具调用**的模型；图片或 PDF 输入还需要模型及接口支持对应文件类型。每次最多附上 10 个文件，总计 8 MB。模型 API 的使用费用由你的服务商收取。

## 快速开始

需要 **Node.js 24.11+** 和 npm。

```bash
git clone https://github.com/jiachaoDing/draftline.git
cd draftline
npm ci
npm run dev
```

打开 <http://127.0.0.1:3000>，在模型设置中配置接口。开发 API 运行在本机 `3001` 端口，由 Vite 代理。

| 服务                     | Base URL 示例                                               |
| ------------------------ | ----------------------------------------------------------- |
| OpenAI                   | `https://api.openai.com/v1`                                 |
| NewAPI / OpenAI 兼容服务 | `https://your-api.example.com/v1`，保留服务商要求的路径前缀 |

开发环境支持本机 HTTP 模型接口；生产环境使用公开 HTTPS 接口。

## 部署到 Cloudflare Workers

前端通过 **Workers Static Assets** 提供，Hono API 运行在同一个 Worker 下。

```bash
npx wrangler login
npm run deploy
```

自行部署时，先将 [wrangler.jsonc](wrangler.jsonc) 中的域名改为你在 Cloudflare 管理的域名。Wrangler 会配置自定义域名和 HTTPS 证书。Git 集成的构建命令为 `npm run build`，部署命令为 `npx wrangler deploy`。

本机预览生产路由：`npm run build` → `npm run dev:worker`。Node 部署：`npm run build` → `npm start`。更多说明见 [开发指南](docs/development.md#cloudflare-deployment-checks)。

## 数据与执行

- **浏览器保存项目**：图纸、对话与附件使用 IndexedDB；数据按域名和浏览器配置隔离，重要图纸可导出留存。
- **自己管理模型凭据**：设置保存在浏览器本地存储，请求时经过应用服务端转发到所选服务商。凭据与图纸、项目记录及导出文件分离。
- **沙箱验证后提交**：生成代码在隔离 iframe 中执行，经过清理与 SVG 校验后才进入图纸历史。中止、失败或不完整的响应保留已提交的图纸。
- **尺寸仍需核对**：程序验证图纸结构与比例约定，生成结果的几何关系和工程适用性需要使用者确认。

## 技术栈与文档

| 层次           | 主要实现                                              |
| -------------- | ----------------------------------------------------- |
| 界面与对话     | React、TypeScript、Vite、assistant-ui                 |
| 图纸与编辑     | SVG、CodeMirror 6、Prettier、DOMPurify、svg-pan-zoom  |
| 增量修改       | OpenAI Codex Rust apply-patch 引擎，编译为浏览器 WASM |
| API 与流式传输 | Hono、OpenAI JavaScript SDK、SSE、Zod                 |
| 存储与部署     | IndexedDB / idb、Cloudflare Workers / Static Assets   |
| 验证           | Vitest、Playwright、Biome                             |

- [使用指南](docs/user-guide.md)：附件、快捷键、分组、澄清问题、导出和安全边界。
- [架构说明](docs/architecture.md)：模块职责、数据契约和请求生命周期。
- [开发指南](docs/development.md)：本地检查、浏览器测试、调试与部署。
- [贡献约定](AGENTS.md)：代码边界和需要保持的行为。

## 参与贡献

欢迎提交 [问题反馈](https://github.com/jiachaoDing/draftline/issues) 或 Pull Request。报告问题时，请附上复现步骤、浏览器版本和最小示例，分享前移除凭据与私人附件。

```bash
npm run verify:all
```

完整检查包括格式、静态检查、类型、单元测试、构建及浏览器回归。浏览器安装说明见 [开发指南](docs/development.md)。

## 许可证与致谢

Draftline 使用 [MIT License](LICENSE)。

增量补丁引擎与澄清交互复用了 [OpenAI Codex](https://github.com/openai/codex) 的开源实现；来源、改动与 Apache-2.0 许可声明保存在 [third_party/codex](third_party/codex/README.md) 和 [补丁引擎说明](third_party/codex/apply-patch/README.md) 中。第三方代码保留各自的许可证与声明。

# MockData

基于 Next.js 16 的 OpenAPI Mock 工作台。

这个项目提供一套从 OpenAPI JSON 导入、接口筛选、TS 类型生成、Mock 数据生成、本地 Mock 服务启动，到 AI 调优、热更新与本地缓存复用的完整闭环，适合前后端联调、接口演示和快速造数。

## 功能概览

- 上传并解析 OpenAPI JSON
- 按 `tag` 分组选择需要参与生成的接口
- 生成并下载 `types.ts` 与 `api.ts`
- 生成结构化 Mock 数据并进入工作区管理
- 启动本地 Mock 服务，支持 `GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD`
- 单接口调整状态码、延迟和返回内容，并支持热更新
- 支持批量 AI 调优与单接口内联 AI 调优
- AI 调优结果与手动热更新结果持久化到 IndexedDB
- 刷新 Mock 数据时按当前接口清理历史缓存并重新生成
- 工作区预览区展示“最终实际返回值”，与真实 `/mock-api` 响应保持一致

## 当前工作流

### 1. 上传并解析 OpenAPI

首页支持上传或直接粘贴 OpenAPI JSON。

支持能力：

- 解析接口、响应结构、请求结构、tag、状态码
- 统计接口数量
- 按 `tag` 分组展示
- 默认全选解析出的接口
- 将工作区基础数据写入 `sessionStorage`

### 2. 进入工作区

工作区分为两个 Tab：

- `TS 类型生成`
- `Mock 数据（3步）`

并提供 `重置工作区` 按钮，用于清空当前工作区状态并回到上传页。

### 3. TS 类型生成

支持：

- 基于当前勾选接口生成 `types.ts`
- 生成 `api.ts`
- 在线预览
- 下载 `types.ts`
- 下载 `api.ts`
- 在接口勾选变化后重新生成

当前实现使用：

- `swagger-typescript-api`

### 4. Mock 数据流程

Mock 数据流程固定为 3 步：

1. 接口确认
2. 策略生成
3. 服务状态

#### Step 1：接口确认

支持：

- 按 tag 分组查看接口
- 卡片式勾选接口
- `全选`
- `反选`

#### Step 2：策略生成

当前保留的策略项：

- 数据条数

说明：

- 仅对分页接口或 `data` 为数组的接口生效
- 普通对象接口固定生成 1 条

#### Step 3：服务状态

每个接口支持：

- 设置状态码
- 设置延迟毫秒数
- 查看请求调用示例 `curl`
- 查看并编辑“实际返回预览”
- `热更新`
- `AI 调优`
- 查看请求参数提示
- 查看接口更新状态：默认、loading、success、error

额外支持：

- `刷新 Mock 数据`
  会清空当前已选接口在 IndexedDB 中的历史调优缓存，重新生成 Mock，并自动热更新到服务
- `重新启动服务`

## AI 调优

项目已接入 AI 调优能力，既支持批量调优，也支持单接口内联调优。

当前能力包括：

- 右下角对话面板支持批量选择多个接口统一调优
- 单接口卡片内支持内联输入调优要求
- AI 调优后结果立即写回工作区
- AI 调优结果持久化到 IndexedDB，后续优先复用
- AI 调优成功后，预览区回显“最终实际返回值”
- 若模型执行成功但内容未变化，界面会明确提示“没有可回填变更”
- 服务端会打印 AI 调用日志，包含请求摘要、模型原始响应摘要和变更字段

当前 AI 接口实现位于：

- `app/api/mock-workflow/route.ts`

当前 AI 调用方式：

- SDK：`openai`
- Provider：由 `BASE_URL` 指定，当前默认配置为 DeepSeek
- Model：`deepseek-chat`
- Key 来源：`API_KEY`

## Mock 服务能力

本地 Mock 服务通过项目内 API 路由完成配置与启动。

当前支持：

- 服务启动
- 服务重置
- 路由动态配置
- 单接口状态码与延迟热更新
- 实际接口返回动态读取当前配置

Mock 服务相关接口：

- `app/api/mock-server/route.ts`
- `app/api/mock/[...slug]/route.ts`

默认访问前缀：

- `/mock-api`

例如：

```bash
curl http://localhost:3666/mock-api/your/path
```

## 实际返回预览与热更新

服务状态页中的预览区现在展示的是“最终实际返回值”，而不是内部原始 mock payload。

当前行为：

- 预览区内容与实际 `/mock-api/...` 响应语义一致
- 可直接编辑最终响应 JSON
- 点击 `热更新` 后，会将最终响应体反解为内部 payload，并同步更新服务和 IndexedDB
- 热更新成功后：
  - 当前接口标题显示成功状态
  - 当前接口调优数据写入 IndexedDB
  - 实际接口返回立即更新
- 热更新失败后：
  - 当前接口标题显示失败状态
  - 页面显示明确错误提示

### 预览编辑规则

- 当状态码为 `200` 时，预览区应编辑 `{ rc, msg, data }` 结构
- 热更新时仅将 `data` 反解回内部 payload，避免把 `rc/msg` 当业务字段存入 mock
- 当状态码为非 `200` 时，预览区按错误响应结构编辑

## 接口返回规则

当前接口返回封装规则：

- 成功响应默认返回：

```json
{
  "rc": 0,
  "msg": "",
  "data": {}
}
```

- 当接口状态码为 `403` 时，默认返回：

```json
{
  "rc": 1,
  "msg": "请登录",
  "data": null
}
```

- 当接口状态码为其他非 `200` 值时，默认返回：

```json
{
  "rc": 1,
  "msg": "接口错误",
  "data": null
}
```

- 如果原始 mock payload 本身已经是 `{ rc, msg, data }` 结构，成功响应阶段会优先取其中的 `data` 再重新封装，保证最终返回结构统一

## 分页接口规则

当前分页处理按接口语义区分：

### 普通数组接口

如果返回结构是：

```json
{
  "rc": 0,
  "msg": "",
  "data": []
}
```

规则：

- `page/pageSize` 不影响 `data` 数组数量
- 始终按当前配置的完整数组返回

### 分页对象接口

如果返回结构是：

```json
{
  "rc": 0,
  "msg": "",
  "data": {
    "items": [],
    "total": 0,
    "hasMore": false
  }
}
```

或：

```json
{
  "rc": 0,
  "msg": "",
  "data": {
    "item": [],
    "total": 0,
    "hasMore": false
  }
}
```

规则：

- `page/pageSize` 只影响 `data.items` 或 `data.item` 的返回数量
- `total` 取当前配置的总数据量
- 不传分页参数时，返回完整内容

## 数据持久化

当前项目同时使用两类本地存储。

### SessionStorage

用于保存当前工作区基础状态：

- OpenAPI 文本
- 解析结果
- 已选择接口
- 生成后的 TS 内容

### IndexedDB

用于保存 AI 调优后或手动热更新后的接口数据。

特性：

- 以 `workspaceId + endpointId` 为 key
- 同一份 OpenAPI 文档稳定命中同一个工作区 ID
- 服务启动时优先读取已调优数据
- 刷新 Mock 数据时可按当前已选接口维度清理缓存

相关实现位于：

- `lib/tuned-mock-db.ts`

## 字体与构建产物

项目当前仅通过 `next/font/google` 引入 `JetBrains_Mono`，用于代码和等宽文本区域。

说明：

- 正文字体已改为系统 sans 字体栈
- 构建后 `.next/static/media` 中的字体文件主要来自 `JetBrains_Mono`
- `static/media` 属于构建产物，不是仓库中的静态资源目录

## 技术栈

- Next.js 16
- React 19
- TypeScript 5
- HeroUI
- Tailwind CSS 4
- swagger-typescript-api
- openapi-types
- @faker-js/faker
- assistant-ui
- lucide-react
- OpenAI SDK

## 安装与运行

```bash
pnpm install
pnpm dev
```

默认开发端口：

```bash
3666
```

生产构建：

```bash
pnpm build
pnpm start
```

代码检查：

```bash
pnpm lint
```

## 环境变量

在项目根目录配置 `.env`：

```env
API_KEY=your_api_key
BASE_URL=https://api.deepseek.com
FIXED_IMAGE_URL=["https://example.com/1.jpg","https://example.com/2.jpg"]
```

说明：

- `API_KEY`：AI 调优使用的模型服务 Key
- `BASE_URL`：AI 提供方接口地址，当前默认配置为 DeepSeek
- `FIXED_IMAGE_URL`：图片字段候选资源

`FIXED_IMAGE_URL` 支持：

- JSON 数组字符串
- 逗号分隔字符串
- 换行分隔字符串

## 目录说明

```text
app/
  page.tsx                      上传与接口选择首页
  workspace/page.tsx            工作区主页面
  api/mock-workflow/route.ts    TS 生成、Mock 生成、AI 调优
  api/mock-server/route.ts      Mock 服务控制接口
  api/mock/[...slug]/route.ts   实际 Mock 返回接口

components/
  tune-assistant-dialog.tsx     AI 对话调优弹窗
  thread.tsx                    assistant-ui 对话线程

lib/
  mock.ts                       Mock 数据生成逻辑
  mock-response.ts              实际响应构建与预览反解逻辑
  mock-server-store.ts          Mock 服务状态存储
  tuned-mock-db.ts              IndexedDB 持久化
  fixed-image-url.ts            图片 URL 统一处理
```

## 已实现的重点能力

- 工作区双 Tab 布局
- 接口卡片统一宽度展示
- TS 类型预览与下载
- 请求参数提示区固定高度并支持滚动
- 单接口热更新与运行时状态反馈
- 右下角 AI 对话调优
- 批量接口调优
- 单接口内联 AI 调优输入面板
- Mock 数据预览区与实际接口返回语义一致
- 刷新 Mock 数据时自动清理当前接口缓存
- 热更新和 AI 调优都会驱动接口标题状态变化
- 分页接口只限制 `items/item` 数量，不影响普通 `data` 数组总量

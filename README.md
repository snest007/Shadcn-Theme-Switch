# shadcn-preset-figma-generator

把 `shadcn` 主题和 Figma Variables 连接起来的一套工具。

这个仓库包含两部分：

- 一个本地 CLI，用来从 `shadcn` preset 或项目生成 Token Studio / Figma collections
- 一个 Figma 插件，用来在 Figma 里做主题的 `Export / Import`

## 目录说明

- `src/`: 核心生成、主题 contract、CSS 解析、Figma 变量映射逻辑
- `plugin/src/`: Figma 插件源码
- `blueprints/`: 生成 collections 时使用的蓝图文件
- `scripts/`: 构建插件和生成默认 contract 的脚本
- `test/`: Node 内置测试
- `DESIGN.md`: 视觉和设计参考说明

## 环境要求

- Node.js `>=24`

## 安装

```bash
npm install
```

## 常用命令

运行测试：

```bash
npm test
```

构建 Figma 插件：

```bash
npm run build:plugin
```

从 preset 生成 collections：

```bash
npm run generate -- --preset bdvx03LE --out generated
```

从现有项目生成 collections：

```bash
npm run generate -- --project /path/to/shadcn-project --out generated
```

## Figma 插件

先执行：

```bash
npm run build:plugin
```

然后在 Figma 里通过 `plugin/manifest.json` 加载插件。

插件当前主要处理：

- `2. Theme`
- `3. Mode`

支持 `Export` 当前 Figma 主题为 CSS / CLI 命令，也支持把 CSS `Import` 回 Figma Variables。

## GitHub 提交建议

这个仓库默认只提交源码和必要配置，不提交依赖、构建产物和本地临时文件。对应规则已经写在 `.gitignore` 里。

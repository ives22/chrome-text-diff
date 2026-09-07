# 文本对比 TextDiff

TextDiff 是一个面向配置、代码和短日志的 Chrome 文本对比扩展。它在浏览器本地完成差异计算，不上传文本，也不依赖后端服务。

![TextDiff 图标](public/icons/icon-128.png)

## 功能

- 双栏 CodeMirror 文本编辑器，支持粘贴、拖放和 UTF-8 文本文件导入
- 拆分与统一视图，差异单元/受影响行统计和块级行内高亮
- 智能、单词、字符三种比对精度
- 忽略大小写、空白变化或空行
- 差异块循环导航、自动换行、左右文本交换
- 点击差异块后可单独向左或向右合并，并支持会话内撤销
- 复制原文、新文本或 unified diff，导出 `.patch` 文件
- 本地草稿和最多 20 条压缩历史记录
- 浅色、深色和跟随系统主题
- 网页选中文本右键设为原文，再选择另一段文本直接比较

## 本地开发

要求 Node.js 22 和 npm 10 或更高版本。

```bash
npm ci
npm run dev
```

开发服务器默认运行在 `http://127.0.0.1:5173/workbench.html`。该页面用于界面开发，不包含 Service Worker 和右键菜单能力。

## 构建与安装

```bash
npm run build
```

1. 在 Chrome 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择项目中的 `dist` 目录。
5. 点击 TextDiff 工具栏图标打开工作台。

更新代码后重新执行 `npm run build`，再在扩展管理页点击“重新加载”。

## 右键取文

1. 在网页中选中第一段文本，右键选择“TextDiff：设为原文”。工具栏图标会显示 `A`。
2. 选中第二段文本，右键选择“TextDiff：作为新文本并比较”。
3. TextDiff 会打开或聚焦唯一的工作台标签页，并自动开始比较。

扩展只接收用户明确选中的文本，不读取整页正文。

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 开始比较 | `Ctrl/Command + Enter` |
| 上一处差异 | `Alt + ↑` |
| 下一处差异 | `Alt + ↓` |
| 撤销最近一次合并 | `Ctrl/Command + Z` |

## 差异块合并

在结果中点击任意差异块，即可展开一体化的当前块操作区。标题栏可直接前往上一处或下一处差异，底部可选择“合并到右侧”或“合并到左侧”，中间的关闭按钮用于收起面板；统一视图会显示完整的替换方向。操作只修改当前差异块，完成后立即重新计算。

合并结果会进入自动保存的当前草稿，但不会自动创建或覆盖历史记录。工具栏的撤销按钮及 `Ctrl/Command + Z` 最多可撤销当前页面会话中的 20 次合并；重新加载页面后撤销记录不会保留。

## 数据与限制

- 单侧文本最多 2 MB 或 20,000 行。
- 草稿和历史保存在 `chrome.storage.local`，压缩后总量限制为 8 MB。
- 历史记录只在点击“保存”后创建；达到容量上限时优先移除较早记录。
- 所有资源随扩展本地打包，运行时不发送网络请求。

详细说明见 [PRIVACY.md](PRIVACY.md)。

## 权限

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存设置、草稿、历史和右键暂存文本 |
| `contextMenus` | 添加两项选中文本右键菜单 |
| `clipboardWrite` | 响应用户点击复制文本或补丁 |

扩展不申请 `host_permissions`、`activeTab`，不注入内容脚本。

## 质量检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run package` 会执行生产构建，并按当前版本生成 ZIP，例如 `artifacts/textdiff-v0.2.1.zip`。GitHub Actions 在每次提交和拉取请求上运行完整门禁，并上传同样的构建产物。

## 技术结构

- React + TypeScript + Vite：工作台和生产构建
- CodeMirror 6：文本输入
- jsdiff：稳定的行级对齐以及强制单词/字符模式
- CodeMirror Merge：智能模式的块级可展示差异范围
- Web Worker：隔离大文本计算；新请求会终止旧任务
- TanStack Virtual：虚拟化差异行
- Chrome Manifest V3：工具栏、右键菜单和本地存储

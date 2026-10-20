# JavaScript / TypeScript API

`texelune-editor` 是独立 ESM 组件。Rust/WASM 负责文档、Unicode 字素、BiDi 视觉导航和排版；DOM 负责输入桥接与悬浮 UI。每个实例独立拥有布局 Worker、文档和 GPU 资源。

## 创建与生命周期

```ts
import {createEditor, type EditorAPI} from 'texelune-editor';
const editor: EditorAPI = await createEditor(container, {
  value: 'fn main() {}', filename: 'main.rs', theme: 'paper',
  fontSize: 17, wrap: true, syntax: true, performance: false,
  autoIndent: 'brackets', indentUnit: '    ',
});
const unsubscribe = editor.on('change', ({detail}) => console.log(detail));
// 应用卸载时释放订阅和实例。
unsubscribe();
editor.destroy();
```

容器必须有明确高度。运行环境须支持 WebGPU、WebAssembly、模块 Worker，并通过 HTTPS 或 localhost 访问。包内 CSS、字体、WASM 和 Worker URL 相对模块解析。开发服务器可直接导入 `/packages/editor/index.js`。

创建 Promise 在实例与渲染器初始化后完成；排版独立异步进行。`frame` 初始为 `null`，`caret` 在光标没有可见布局时为 `null`。通过 `frame` 事件和 `visible_ready` 观察可见区域准备情况；`pending` 包括预排版，不必等待归零才能编辑。

`destroy()` 可重复调用。移除自定义元素也会销毁实例，取消 provider，释放 Worker、事件监听器、观察器和 GPU 资源。销毁后应创建新实例，不复用原 API。

## 坐标与版本

- 文档范围、选择、装饰、inlay、overlay 锚点采用 **Unicode scalar 偏移**，不是 JS UTF-16 索引、字节或字素序号。范围为 `[start, end)`。
- `positionAt(offset)` / `offsetAt({line, character})` 使用从零开始的逻辑行和 UTF-16 列，适合 LSP。小字符串可用 `[...prefix].length` 将 JS 前缀转换为 scalar 数。
- `lineRange(line)` 包含换行符。末尾空行可以是空范围。软折行不创建逻辑行。
- 文本、格式、撤销、重做使 `version` 递增；`load()` 替换文档并从版本零开始。异步任务还应保存宿主文档身份，不能只比较版本零。
- `frame` / `caret` 的几何采用视口 CSS 像素；`scroll` / `scrollTo(y)` 采用文档纵向 CSS 像素。

## 文档操作

| API | 行为 |
| --- | --- |
| `text`, `slice(start,end)` | 全文或局部文本。大文档优先用 `slice`；`text` 会构造整个 JS 字符串。 |
| `documentInfo` | `{bytes,chars,lines}`，不构造全文。 |
| `selection`, `select(anchor,head)` | 读取或设置选择，保留方向；单独设置选择不滚动。 |
| `insert(text)` | 替换当前选择，返回是否成功应用。 |
| `replace(start,end,text)` | 单个可撤销替换，返回是否成功应用。 |
| `applyEdit(request,expectedVersion?)` | 替换并支持 `caretOffset`；版本不匹配返回 `false`。 |
| `undo()`, `redo()` | 历史操作，没有历史时返回 `false`。 |
| `format(style)`, `toggle(attribute)` | 设置完整样式，或切换 bold/italic/underline 并保留其他项。 |
| `reveal(offset?)`, `focus()` | 最小幅度将目标滚入视口；默认当前光标。聚焦不触发浏览器页面滚动。 |
| `load(text,filename?)` | 替换文档、清空历史、文档装饰、inlay 和 overlay。 |
| `loadSynthetic(bytes?,singleLine?)` | 异步生成 UTF-8 压力文档，默认 100MiB，导入可取消。 |

`EditRequest` 为 `{start,end,text,source?,caretOffset?}`。`caretOffset` 相对插入起点，单位为 scalar。`applyEdit` 的版本检查仅限当前文档；文档替换后应同时验证宿主文档 ID。

`format` 使用 `{bold,italic,underline,foreground,background}`，颜色为 `[r,g,b,a]`，通道 0–1，`null` 清除颜色。未提供的布尔值取 `false`，颜色取 `null`；这是完整样式设置，不是局部补丁。

## 扩展配置与编辑回调

```ts
editor.configure({
  onBeforeEdit(request) {
    if (request.text.includes('\0')) return false;
    return {...request, text: request.text.replaceAll('\t', '  ')};
  },
  onChange(change, instance) { queueIncrementalSave(change); },
  onKeyDown(event, instance) {
    if (event.key === 'F2') { instance.insert('symbol'); return true; }
  },
});
```

创建参数和 `configure()` 接受同一套 `EditorExtensions`。`configure()` 只更新传入项，设为 `undefined` 可移除回调。只读 `configuration` 返回当前扩展配置快照与默认值。

`onBeforeEdit(request,editor)` 在文本替换前同步执行。请求包含 `start/end/text/source/caretOffset/version/selection`。返回 `false` 取消，返回替换请求可改写文本和范围，返回 `undefined` 保持原请求。随后触发可取消的 `beforeedit` 事件。版本过期、非法范围或回调抛错时不应用事务；错误通过 `providererror` 报告。

拦截覆盖普通输入、删除、剪切、粘贴、IME 更新、换行、Tab 和 `insert/replace/applyEdit`。`source` 为 `input/delete/cut/paste/composition/newline/tab/api`。格式事务、撤销/重做和文档替换不经过文本改写钩子；普通事务均通过 `change/onChange` 通知，文档替换使用 `documentchange`。IME 更新属于一个组合输入历史组。

`onBeforeEdit/onChange/onSelectionChange/onKeyDown` 是同步主线程回调，应保持轻量。`onKeyDown` 返回 `true` 或调用 `preventDefault()` 表示已处理。不要把 Promise 返回给 `onBeforeEdit`；昂贵分析放入 Worker，异步结果使用 `applyEdit(request,readVersion)`。避免在没有终止条件的 `onChange` 中再次编辑文档。

## 事件

`editor.on(type,listener)` 返回取消订阅函数；监听器收到 `CustomEvent`，数据在 `detail`。也可在 `editor.element` 上使用标准 `addEventListener`。

| 事件 | detail / 时机 |
| --- | --- |
| `beforeedit` | `BeforeEdit`，可 `preventDefault()` 取消替换。 |
| `change` | `EditorChange`，包含版本、替换范围、文本、选择与文档样式。 |
| `selectionchange` | `Selection`。 |
| `documentchange` | `{name,version,bytes}`。 |
| `themechange` | 完整解析后的主题。 |
| `frame` | 主线程接受并上传几何后的 `Frame`，不代表 GPU 已显示完成。 |
| `navigate` | `NavigationTarget`，可取消默认跳转。 |
| `providererror` | `{kind,error}`，取消不作为错误报告。 |
| `notice` | 用户状态字符串。 |
| `dispose` | `null`。 |

`frame`、性能与导航数组仅供只读观察。`frame.rects` / `frame.navigation` 惰性解码可见几何，不宜为高频监控反复展开。

## 悬浮提示与控件

```ts
editor.configure({
  hoverDelay: 350, providerTimeout: 8000,
  async hoverProvider({offset,version,signal}) {
    const response = await fetch(`/symbols?offset=${offset}&version=${version}`, {signal});
    return {contents: await response.text(), start: offset};
  },
});
const button = document.createElement('button');
button.textContent = '运行单元';
button.onclick = () => runCell();
const widget = editor.addOverlay({anchor:12, content:button, placement:'above'});
widget.update({anchor:24});
widget.dispose();
```

provider 接收 `{editor,offset,position,version,signal}`，同步或异步返回字符串、DOM Node、`{contents,start?,end?}` 或 `null`。LSP 标记文本与普通字符串作为纯文本显示，不执行 HTML。鼠标换目标、离开编辑器、滚动、编辑、配置变更或销毁会取消过期悬浮。

`addOverlay({anchor,content,placement?,interactive?,className?})` 返回 `{element,update,dispose}`。控件位于组件 Shadow DOM，限制在视口内，锚点离开视口时隐藏。文本编辑按右亲和性映射锚点：恰好在锚点处插入时，它移动到新文本之后。`interactive:false` 关闭指针交互；文档替换移除控件。

`showHover(content,anchor?)` / `hideHover()` 管理一个临时提示；多个独立控件使用 `addOverlay()`。Overlay 覆盖文本，不占文档高度；需要参与布局时使用 block inlay。

## Ctrl 悬浮与跳转

```ts
editor.configure({
  async definitionProvider(context) {
    return [{start:10, end:17, originRange:{start:40,end:47}}];
  },
  async onNavigate(target, instance, signal) {
    if (target.start !== undefined) return false;
    await openApplicationFile(target.uri, target.selectionRange ?? target.range, signal);
    return true;
  },
});
await editor.goToDefinition();
```

按住 Ctrl 或 Meta 悬浮时解析目标，仅在存在结果后为源范围添加下划线与背景。优先使用 `originRange`，否则使用分词范围。Ctrl/Meta+单击与 F12 执行跳转；多个目标提供选择控件。

`NavigationTarget` 支持 scalar `start/end`，或跨文件 `uri/range/selectionRange`（UTF-16 行列）。同文档 scalar 目标默认选中并滚入视口。跨文件由 `onNavigate` 或可取消的 `navigate` 事件交给宿主，不自动读取文件。`onNavigate` 返回 `true` 表示已处理，`false/undefined` 允许默认同文档行为。

异步 provider 默认 8 秒截止时间并携带 `AbortSignal`；文档变化、销毁使旧结果失效。provider 应响应取消；Promise 不会自动将同步计算移到 Worker。手动悬浮内容与自定义 Node 的业务生命周期由宿主维护。

## 逻辑行与分词选择

点击行号选择完整逻辑行，包括换行符；拖动行号或 Shift+单击扩展整行选择。续行属于同一逻辑行。双击遵循 Unicode 单词边界，保留标识符下划线、组合字符、emoji ZWJ 和 RTL 单词。

`wordRange(offset,signal?)` 返回 Promise。默认 Unicode UAX #29；逻辑行超过 4KiB 时移到导航 Worker，最多等待 8 秒。取消、超时或版本变化拒绝结果。默认规则不包含中文词典或语言词法，可配置 `wordProvider`：

```ts
const segmenter = new Intl.Segmenter('zh', {granularity:'word'});
editor.configure({
  wordProvider({text,start,offset,truncated}) {
    if (truncated) return null;
    const local = [...text].slice(0,offset-start).join('').length;
    const unit = segmenter.segment(text).containing(local);
    if (!unit) return null;
    const first = start + [...text.slice(0,unit.index)].length;
    return {start:first, end:first+[...unit.segment].length};
  },
});
```

`WordContext.text` 最多覆盖附近 4096 scalar，`start` 为其文档起点，`truncated` 表示未覆盖完整逻辑行。返回 `null` 使用默认策略。自定义范围必须采用 scalar 坐标并保持字素边界；支持异步与取消。

## 自动缩进

| `autoIndent` | Enter 行为 |
| --- | --- |
| `'none'` | 一个换行。 |
| `'keep'`（默认） | 延续当前逻辑行前导空格和 Tab。 |
| `'brackets'` | 在 `{`、`[`、`(` 后增加 `indentUnit`；配对括号中间换行会将闭括号移到下一行。 |
| `(context)=>insertion` | 同步或异步返回字符串、`{text,caretOffset?}`；`null` 取消换行。 |

`indentUnit` 默认四个空格，可设为 `'\t'` 或其他空格数；Tab 插入该单位。括号策略匹配邻近字符，不解析注释和字符串；语法感知缩进使用自定义策略。

```ts
editor.configure({
  indentUnit:'  ',
  async autoIndent(context) {
    const result = await indentationWorker(context.before,context.after,context.signal);
    return {text:'\n'+result.indent};
  },
});
```

`IndentContext` 包含 `before/after/leadingWhitespace/indentUnit/selection/position/version/signal/truncated`。前后文各限制为 4096 scalar，前导缩进最多读取 4096 scalar；`truncated` 标识截断。等待期间继续输入、移动选择、切换文档、配置变化或销毁会取消结果，防止覆盖新操作。一次缩进插入是一个撤销事务。

## 装饰、主题与性能

`setHighlights(spans,readVersion=version)` 替换派生装饰。旧版本异步批次会通过最多 4096 条编辑映射重放到当前版本。未来版本、超出历史或落后于已接受分析时返回 `false`，保留现有样式。派生高亮不进入撤销历史；文档持久格式优先。

`setInlays([{anchor,text,block}])` 替换虚拟提示；`block:false` 行内 hint，`block:true` 占据块高度。`setTheme('paper'|'dusk'|theme)` 支持自定义 UI 色彩，以及 token 前景、背景、粗体、斜体、下划线。

`setFontSize(10..40)`、`setWrap(boolean)`、`setSyntax(boolean)` 控制字号、折行、内置词法着色。`showPerformance()` 控制内置性能窗；`performance` 提供实时工作估算、完整更新计时及分阶段样本。`benchmark('warm'|'redraw')` 是独立离屏吞吐测试，`cancelBenchmark()` 取消。`restartLayout()` 重建布局副本。

100MiB 文档与超长 ASCII 行采用视口虚拟化。任意超长复杂 Unicode/BiDi 段落仍可能完整整形，144Hz 不是对全部设备和文本的保证。昂贵业务计算需离开主线程。

## LSP

```ts
import {LspClient} from 'texelune-editor/lsp';
const language = new LspClient(editor, {
  url:'ws://127.0.0.1:4173/lsp',
  rootUri:'file:///workspace', uri:'file:///workspace/main.rs', languageId:'rust',
});
const detach = language.attach();
language.addEventListener('diagnostics', ({detail}) => renderProblems(detail.diagnostics));
await language.connect();
const targets = await language.definition(editor.selection.head);
// 应用卸载时释放绑定和连接。
detach();
language.dispose();
```

`attach()` 安装 hover/definition provider。取消绑定只恢复仍由本次绑定拥有的项，不覆盖后来配置的 provider；`dispose()` 也撤销绑定。`hover/definition/complete(offset?,{signal}?)` 支持取消，拒绝文档变化后的结果。`connect/disconnect/refresh` 管理连接。事件 `status/connected/diagnostics/tokens/timing` 在 `lsp.d.ts` 中定义。

定义查询支持 LSP `Location` 与 `LocationLink`：同文档目标转为 scalar `start/end`，跨文件保留 URI 与 UTF-16 范围。切换外部文档时先更新 `language.options.uri`，再调用 `editor.load()`。

默认 LSP 同步上限 2MiB；超过上限暂停语言服务，编辑继续。语义批次使用独立读快照与版本映射；交互查询等待同步读屏障，支持超时与 `$/cancelRequest`。示例 Studio 支持工作区内跨文件跳转；服务器只读取规范化路径仍在示例工作区且不超过 2MiB 的文本文件。

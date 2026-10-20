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
- `frame` / `caret` 的几何采用视口 CSS 像素；`scroll` / `scrollTo(y)` 采用文档纵向 CSS 像素。`renderedScroll` 是 `scroll` 的兼容别名，绘制位移立即跟随输入，不等待布局返回。

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
| `executeCommand(command)` | 执行内置编辑命令，返回 `Promise<boolean>`。 |
| `format(style)`, `toggle(attribute)` | 设置完整样式，或切换 bold/italic/underline 并保留其他项。 |
| `reveal(offset?)`, `focus()` | 最小幅度将目标滚入视口；默认当前光标。聚焦不触发浏览器页面滚动。 |
| `scroll`, `renderedScroll`, `scrollTo(y)` | 读取或设置滚动位置，立即更新绘制位移；布局在 Worker 中持续更新。 |
| `load(text,filename?)` | 替换文档、清空历史、文档装饰、inlay 和 overlay。 |
| `loadSynthetic(bytes?,singleLine?)` | 异步生成 UTF-8 压力文档，默认 100MiB，导入可取消。 |

`EditRequest` 为 `{start,end,text,source?,caretOffset?}`。`caretOffset` 相对插入起点，单位为 scalar。`applyEdit` 的版本检查仅限当前文档；文档替换后应同时验证宿主文档 ID。

`format` 使用 `{bold,italic,underline,foreground,background}`，颜色为 `[r,g,b,a]`，通道 0–1，`null` 清除颜色。未提供的布尔值取 `false`，颜色取 `null`；这是完整样式设置，不是局部补丁。

`frame.scroll` 是场景几何的原点，`frame.scroll_min/scroll_max` 描述该场景能完整覆盖的纵向范围，仅用于诊断，不限制输入。`frame.navigation` 与场景几何使用这个原点；将它们映射到当前画面时，纵向减去 `scroll - frame.scroll`。组件的 `caret`、鼠标命中、行号、诊断和悬浮层已经应用此偏移。目标位置的冷布局尚未生成时，场景缓冲以外的内容可暂时缺失；没有可用几何的位置不会命中不相关的缓存行。

`frame.request` 是该场景处理的视口请求编号，持续滚动时可以小于最新请求。`frame.scene_revision` 将字体、尺寸、折行、主题与装饰等影响场景的状态分组；只有相同文档版本和相同场景修订的完整帧可以复用，且场景请求编号不会倒退。`frame.selection_revision` 标识已处理的选择与显露意图；选择变化不阻止兼容几何发布，过期意图不会覆盖当前滚动位置。性能追踪标识不作为画面接收条件。

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

拦截覆盖普通输入、删除、剪切、粘贴、IME 更新、换行、Tab、行编辑命令和 `insert/replace/applyEdit`。`source` 为 `input/delete/cut/paste/composition/newline/tab/completion/api` 或行编辑命令名。格式事务、撤销/重做和文档替换不经过文本改写钩子；普通事务均通过 `change/onChange` 通知，文档替换使用 `documentchange`。IME 更新属于一个组合输入历史组。

`onBeforeEdit/onChange/onSelectionChange/onKeyDown` 是同步主线程回调，应保持轻量。`onKeyDown` 返回 `true` 或调用 `preventDefault()` 表示已处理。不要把 Promise 返回给 `onBeforeEdit`；昂贵分析放入 Worker，异步结果使用 `applyEdit(request,readVersion)`。避免在没有终止条件的 `onChange` 中再次编辑文档。

## 快捷键与命令

```ts
import {defaultKeybindings, editorCommands} from 'texelune-editor';
editor.configure({
  keybindings: {
    'Mod+Shift+d': 'duplicateLineDown',
    'Mod+l': null,
    'F2': async ({editor, event, signal}) => {
      const text = await loadSnippet(signal);
      if (!signal.aborted) editor.insert(text);
    },
  },
});
await editor.executeCommand('selectLine');
```

`keybindings` 是默认映射上的覆盖表。键名大小写不敏感，修饰符顺序不限；`Mod` 在 macOS/iOS 对应 Meta，其他平台对应 Ctrl。支持 `Ctrl/Meta/Alt/Shift`、`Left/Right/Up/Down`（也可用 `ArrowLeft` 等）、`Plus`、`Space` 和标准 `KeyboardEvent.key` 名称。映射按 `key` 匹配，采用当前键盘布局。`null` 消费事件并禁用该快捷键；命令名重新绑定内置行为；函数接收 `{editor,event,signal}`，同步或异步执行。`onKeyDown` 优先于映射；IME、Dead key、AltGraph 交给输入系统。未绑定按键保留浏览器行为。

每次 `configure({keybindings})` 替换整个覆盖表，`undefined` 恢复默认映射。`defaultKeybindings` 和 `editorCommands` 是只读导出；类型分别为 `Keybindings` 与 `EditorCommand`。非法修饰符或命令名使配置抛出 `TypeError`，保持当前配置。`executeCommand` 使用同一套内置行为，不调用 `onKeyDown`；返回是否处理了命令，异步准备取消、失败或没有可执行的编辑时返回 `false`，未知命令拒绝 Promise。移动命令返回 `true` 表示已提交导航，几何可能随后异步就绪。剪贴板命令需要安全上下文、浏览器权限和用户手势。

| 默认快捷键 | 命令 / 行为 |
| --- | --- |
| Mod+A / Z / Shift+Z，Ctrl+Y | 全选 / 撤销 / 重做。 |
| Mod+C / X / V，Ctrl+Insert，Shift+Delete / Insert | 复制 / 剪切 / 粘贴。无选择时复制或剪切当前逻辑行。 |
| Mod+L / Mod+Shift+K | `selectLine` / `deleteLine`。 |
| Alt+Up / Down | `moveLineUp` / `moveLineDown`。 |
| Alt+Shift+Up / Down | `duplicateLineUp` / `duplicateLineDown`。 |
| Tab / Shift+Tab，Mod+] / [ | 插入缩进单位（有选择时缩进逻辑行）/ 减少缩进。 |
| Enter，Mod+Enter / Mod+Shift+Enter | 自动缩进换行，当前行块下方 / 上方插入空行。 |
| 方向键、Home / End，加 Shift | BiDi 视觉移动、软折行起止；Shift 扩展选择。 |
| Mod+Left / Right，加 Shift | 按逻辑文本顺序移动到分词边界；Shift 扩展选择。 |
| Mod+Home / End，加 Shift | 文档起止；Shift 扩展选择。 |
| Backspace / Delete，加 Mod | 删除字素 / 按分词删除。 |
| Mod+B / I / U | 粗体 / 斜体 / 下划线。 |
| F12，F8 / Shift+F8 | 定义跳转，下一个 / 上一个诊断。 |
| Mod+Space | `triggerCompletion`，在光标旁请求补全。 |
| Mod+Plus / = / - / 0 | 增大 / 减小 / 重置字号。 |
| Alt+P / Alt+Enter，Escape | 性能窗 / 全屏；取消待处理命令、关闭提示和退出全屏。 |

行操作采用逻辑行，包含换行；选择恰好结束于下一行行首时排除该行。移动、复制和缩进保留选择方向，作为一个可撤销文本事务。末行没有换行时，整行复制附加换行；剪切末行移除相邻分隔符，避免留下空行。组件写入整行元数据，粘贴到空选择时插入当前行上方；带选择或来自外部的普通文本按选择替换。行变换保留换行符；系统剪贴板可能按平台转换换行。剪切仅在剪贴板写入成功后删除文本，仍经过 `onBeforeEdit`。

超过 8192 scalar 的行变换在临时 Worker 中准备；主线程以 4096 scalar 切片并约每 1.5ms 让出执行。大范围复制使用流式异步剪贴板写入。准备期间编辑、选择变化、文档替换、配置变化、下一条异步命令或销毁会取消结果；默认截止时间由 `providerTimeout` 控制，8 秒。分词命令复用 `wordProvider` 与导航 Worker，保持字素单元完整。原子事务提交和宿主回调仍在主线程，成本随修改量增长；Worker 准备不等于对任意大范围替换保证帧预算。自定义异步处理函数应检查 `signal`，自行执行的异步副作用不会自动回滚。

剪贴板使用纯文本；系统已接受的异步写入无法撤销，过期写入不会继续剪切文档。行变换通过文本替换提交，装饰遵循替换范围的映射规则，不提供富文本片段的样式搬运。

## 事件

`editor.on(type,listener)` 返回取消订阅函数；监听器收到 `CustomEvent`，数据在 `detail`。也可在 `editor.element` 上使用标准 `addEventListener`。

| 事件 | detail / 时机 |
| --- | --- |
| `beforeedit` | `BeforeEdit`，可 `preventDefault()` 取消替换。 |
| `change` | `EditorChange`，包含版本、替换范围、文本、选择与文档样式。 |
| `selectionchange` | `Selection`。 |
| `documentchange` | `{name,version,bytes}`。 |
| `themechange` | 完整解析后的主题。 |
| `frame` | 可见布局完整、版本与视口请求匹配且几何已上传的 `Frame`，不代表 GPU 已显示完成。 |
| `diagnosticschange` | `{version,diagnostics}`，诊断替换或过期清除。 |
| `completionchange` | `{visible,pending,index,items}`，补全查询、菜单选择或关闭。 |
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

## 定义悬浮与跳转

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

按住 Ctrl 或 Meta 悬浮时解析目标，仅在存在结果后为源范围添加下划线与背景。优先使用 `originRange`，否则使用分词范围。Ctrl/Meta+单击、鼠标中键单击与 F12 执行跳转；多个目标提供选择控件。中键在正文中阻止浏览器自动滚动，不触发左键选区拖动；悬浮控件、滚动条和行号不参与中键跳转。`middleClickDefinition:false` 关闭中键行为。所有入口共用 `definitionProvider`、取消、超时、`onNavigate` 和 `navigate` 事件。

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
| `'brackets'` | 在 `bracketPairs` 定义的左括号后增加 `indentUnit`；配对括号中间换行会将闭括号移到下一行。 |
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

`IndentContext` 包含 `before/after/leadingWhitespace/indentUnit/bracketPairs/selection/position/version/signal/truncated`。前后文各限制为 4096 scalar，前导缩进最多读取 4096 scalar；`truncated` 标识截断。等待期间继续输入、移动选择、切换文档、配置变化或销毁会取消结果，防止覆盖新操作。一次缩进插入是一个撤销事务。

## 括号

```ts
import {defaultBracketPairs} from 'texelune-editor';
editor.configure({
  bracketPairs: [...defaultBracketPairs, {open:'⟦',close:'⟧'}],
  autoClosingBrackets: true,
  skipClosingBrackets: true,
  bracketMatching: true,
  keybindings: {'Mod+Shift+\\': 'goToBracket'},
});
const match = await editor.matchBrackets(editor.selection.head, signal);
if (match) editor.reveal(match.close.start);
editor.skipClosingBracket('）');
```

`bracketPairs` 默认包含 `()`、`[]`、`{}`、`（）`、`【】`、`「」`、`『』`、`〈〉`、`《》`。配置替换整张定义表，`undefined` 恢复默认，空数组关闭所有定义。每个端点必须是独立的单个 Unicode scalar，所有端点互不重复；最多 64 对，不允许空白、控制符、组合标记或未配对代理项。定义会复制并冻结，非法配置抛出 `TypeError` 并保留原配置。不支持同字符引号和多字符分隔符。

`autoClosingBrackets` 默认 `true`：空选择输入左括号时插入一对并将光标放在中间，整体为一个撤销事务，经过 `onBeforeEdit/beforeedit`。`skipClosingBrackets` 默认 `true`：空选择输入的右括号与光标右侧字符相同时，仅将光标越过它所在的整个字素，不产生文本事务。`skipClosingBracket(close?)` 对应用控件开放同一能力，省略参数时使用光标右侧的已定义右括号，成功返回 `true`。两项可以独立关闭。选区替换、粘贴和 `insert/replace/applyEdit` 保持字面文本；IME 组合期间保留候选文本，只在空选择开始的组合提交时处理配对与越过。

`bracketMatching` 默认 `true`，为折叠光标附近的一对括号绘制边框和背景；支持软折行与 BiDi 几何，主题颜色为 `bracketBorder`、`bracketBackground`。匹配优先检查光标位置的端点，否则检查前一字符，使用逻辑顺序和严格嵌套；遇到交叉配对、缺失端点或超过 65,536 层嵌套时返回 `null`。默认匹配是字符级的，包含注释和字符串中的括号。语法感知匹配可配置 `bracketMatchingProvider(context)`，接收 `ProviderContext`，同步或异步返回 `{open:{start,end},close:{start,end}}` 或 `null`；这些范围采用 scalar 坐标并包含端点。

`matchBrackets(offset?,signal?)` 返回 `Promise<BracketMatch|null>`，默认当前光标，即使关闭自动高亮也可显式查询。默认扫描每次读取不超过 1,024 scalar，约 1ms 后让出主线程，不构造全文。所有查询受 `providerTimeout`（默认 8 秒）和 `AbortSignal` 控制；编辑、选择变化、文档切换、配置变化和销毁取消在途查询。取消拒绝 `AbortError`，超时拒绝 `TimeoutError`；自动高亮的其他失败通过 `providererror` 的 `kind:'brackets'` 报告。耗时的自定义 provider 应在 Worker 中分析并遵守取消信号。

`executeCommand('goToBracket')` 将光标移至匹配另一端并显露目标，返回是否跳转；没有默认绑定，可以在 `keybindings` 中分配快捷键。匹配按当前读版本和选择验证后才用于导航。

## 补全

```ts
editor.configure({
  automaticCompletion: true,
  completionDelay: 120,
  async completionProvider({offset, version, signal}) {
    return querySymbols({offset, version, signal});
  },
});
const items = await editor.triggerCompletion();
editor.acceptCompletion(0);
editor.hideCompletion();
editor.on('completionchange', ({detail}) => console.log(detail.pending, detail.items.length));
```

`completionProvider` 接收 `CompletionContext`：通用 provider 字段，以及 `triggerKind:'invoked'|'automatic'`、可选 `triggerCharacter`。返回候选数组或 `null`，允许异步。`CompletionItem` 包含 `label`，可选 `text/start/end/detail/filterText/sortText/preselect/kind`；`start/end` 是当前读版本的 scalar 半开范围，必须覆盖查询位置。省略文本时插入标签，省略范围时使用附近标识符的完整范围，包括光标右侧后缀。标识符推断各扫描前后最多 513 scalar；超出 512 scalar 的单侧部分需要显式范围。

候选按 `filterText ?? label` 做 NFC 与大小写无关的前缀过滤，按 `sortText ?? label` 稳定排序；默认首项，优先选择标记为 `preselect` 的项。最多处理 200 项，显示标签和详情时限制长度。每行按类型标记、名称、详情对齐，长文本省略并可通过原生悬浮提示读取。候选与详情按纯文本显示，颜色跟随组件主题。菜单位于光标旁，空间不足时向上或向左调整，保留输入焦点，并通过 listbox、option 和 `aria-activedescendant` 暴露当前项。

Ctrl/Meta+Space 手动查询。输入标识符字符、`.` 或 `:` 后自动查询，默认防抖 120ms；`completionDelay` 可调整，`automaticCompletion:false` 关闭自动开启，已手动打开的会话仍随输入刷新。IME 组合输入期间关闭菜单，组合结束后可再次自动查询。菜单打开时，↑/↓ 循环选择，PageUp/PageDown 跨 8 项，Enter/Tab 接受，Escape 关闭。显式 `keybindings` 与 `onKeyDown` 优先于菜单快捷键；支持 `triggerCompletion/acceptCompletion/nextCompletion/previousCompletion/hideCompletion` 命令。

`triggerCompletion()` 最小幅度显露光标并返回经过筛选的候选数组，取消、超时或无结果时为空；`acceptCompletion(index?)` 默认接受当前项，返回是否应用；`hideCompletion()` 取消准备并关闭菜单。只读 `completion` 和 `completionchange` 提供 `{visible,pending,index,items}`。接受候选使用 `source:'completion'` 的单次文本事务，经过编辑拦截并可一次撤销。`EditorChange.source` 标识文本编辑来源；撤销、重做和格式事务可能不包含此字段。

每批结果严格绑定文档版本和选区。继续编辑、移动选择、文档替换、失焦、正文点击或滚轮、重新配置、销毁使查询失效；同版本零的不同文档也会取消。异步请求携带 `AbortSignal`，默认使用 `providerTimeout` 的 8 秒截止时间。输入和删除位于已有候选替换范围内时，先将已显示候选映射到当前版本并按新前缀过滤，等待期间仍可接受这些候选。窗口保持同一个 DOM 容器，当前选择与滚动位置尽量保留，新结果原位替换；新几何到达前使用原锚点几何。其他编辑关闭会话。`completion.pending` 可以和非空候选同时存在，列表用 `aria-busy` 标识刷新。补全不会阻塞输入，也不会接受过期请求的结果；昂贵计算由 provider 放到 Worker。

`LspClient.attach()` 自动安装补全 provider，并恢复其仍拥有的配置。适配器支持数组与 `CompletionList`、默认编辑范围、`TextEdit`、`InsertReplaceEdit`（采用 replace 范围），在 LSP Worker 中将 UTF-16 转为 scalar。只有已声明的触发字符使用 LSP TriggerCharacter 上下文。断开服务关闭其补全菜单；超过同步上限时不读取全文。需要 snippet、额外编辑或自动导入的候选不显示；当前不执行 completion command、延迟 resolve、参数提示或占位符跳转。

## 装饰、主题与性能

`setHighlights(spans,readVersion=version)` 替换派生装饰。旧版本异步批次会通过最多 4096 条编辑映射重放到当前版本。未来版本、超出历史或落后于已接受分析时返回 `false`，保留现有样式。派生高亮不进入撤销历史；文档持久格式优先。

`setInlays([{anchor,text,block}])` 替换虚拟提示；`block:false` 行内 hint，`block:true` 占据块高度。`setTheme('paper'|'dusk'|theme)` 支持自定义 UI 色彩，以及 token 前景、背景、粗体、斜体、下划线。

`setFontSize(10..40)`、`setWrap(boolean)`、`setSyntax(boolean)` 控制字号、折行、内置词法着色。`showPerformance()` 控制内置性能窗；`performance` 提供实时工作估算、完整更新计时及分阶段样本。`benchmark('warm'|'redraw')` 是独立离屏吞吐测试，`cancelBenchmark()` 取消。`restartLayout()` 重建布局副本。

100MiB 文档与超长 ASCII 行采用视口虚拟化。任意超长复杂 Unicode/BiDi 段落仍可能完整整形，144Hz 不是对全部设备和文本的保证。昂贵业务计算需离开主线程。

## 诊断标记

```ts
editor.setDiagnostics([
  {start:6, end:11, message:'Expected a number', severity:1, source:'Checker', code:'E1'},
], editor.version);
editor.on('diagnosticschange', ({detail}) => updateProblems(detail.diagnostics));
editor.goToDiagnostic(1);
```

`EditorDiagnostic` 使用 scalar 半开范围，包含 `start/end/message`，可选 `severity/source/code/tags`。严重级别 1/2/3/4 分别为错误、警告、信息、提示，默认 1。零长度范围显示位置标记；诊断不修改文本、持久格式或撤销历史。正文标记按折行和 BiDi 可见单元定位，悬浮显示消息、来源和代码；状态栏提供计数，行号区域显示严重级别。

`setDiagnostics(items,readVersion=version)` 同步接受当前版本的批次并返回 `true`。未来或过期版本返回 `false`，保留当前诊断；范围非法时抛出 `TypeError`。`diagnostics` 返回只读诊断数组。文本或格式事务、撤销/重做、文档替换会清除诊断，等待语言服务重新分析。

`goToDiagnostic(1|-1)` 循环选择下一个或上一个诊断，滚动定位并显示消息，返回诊断或 `null`。快捷键为 F8 / Shift+F8；`onKeyDown` 可拦截。`LspClient.attach()` 自动将当前文档的诊断批次绑定到组件；取消绑定或断开服务只清除仍由该绑定拥有的标记。

主题 `colors` 可配置 `diagnosticError`、`diagnosticWarning`、`diagnosticInformation`、`diagnosticHint`。标记只构造视口内的 DOM，区间索引按可见范围查询；重叠区域显示最高严重级别，悬浮最多列出 20 条诊断。

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

`attach()` 安装 hover/definition/completion provider。取消绑定只恢复仍由本次绑定拥有的项，不覆盖后来配置的 provider；`dispose()` 也撤销绑定。`hover/definition/complete(offset?,{signal}?)` 支持取消，拒绝文档变化后的结果。`complete` 还接受 `triggerCharacter`。`connect/disconnect/refresh` 管理连接。事件 `status/connected/diagnostics/tokens/timing` 在 `lsp.d.ts` 中定义。

`LspOptions` 支持 `url?:string`、`workerUrl?:string`、`workerType?:'module'|'classic'`。至少提供一种传输地址；`workerUrl` 优先于 `url`。Worker 通过 `postMessage` 收发 JSON-RPC 对象，使用 LSP UTF-16 坐标，不使用字符串编码或 Content-Length 帧。Worker 默认采用 module 模式。

```ts
const language = new LspClient(editor, {
  workerUrl: new URL('./language-server.js', import.meta.url).href,
  workerType: 'module', rootUri: 'file:///workspace/',
  uri: 'file:///workspace/main.ts', languageId: 'typescript',
});
```

适配器拥有服务 Worker 的生命周期。`disconnect()`、`dispose()`、文档超过同步上限时释放 Worker；Worker RPC 超时会结束服务并发出 `error` 状态，再次 `connect()` 可重启。`timeout` 控制普通 RPC 截止时间，默认 10000 ms；初始化上限 20000 ms，公开连接上限 25000 ms。取消请求发送 `$/cancelRequest`，无法合作取消的同步分析可由超时终止。

定义查询支持 LSP `Location` 与 `LocationLink`：同文档目标转为 scalar `start/end`，跨文件保留 URI 与 UTF-16 范围。切换外部文档时先更新 `language.options.uri`，再调用 `editor.load()`。

默认 LSP 同步上限 2MiB；超过上限暂停语言服务，编辑继续。语义批次使用独立读快照与版本映射；交互查询等待同步读屏障，支持超时与 `$/cancelRequest`。示例 Studio 支持工作区内跨文件跳转；服务器只读取规范化路径仍在示例工作区且不超过 2MiB 的文本文件。

export type RGBA = [number, number, number, number];
export interface TextStyle { foreground?: RGBA | null; background?: RGBA | null; bold?: boolean; italic?: boolean; underline?: boolean; }
export interface TokenStyle { foreground?: string; background?: string; bold?: boolean; italic?: boolean; underline?: boolean; }
export interface Theme { name?: string; colors?: Record<string, string>; tokens?: Record<string, string | TokenStyle>; }
export interface ResolvedTheme extends Theme { name: string; colors: Record<string, string>; tokens: Record<string, string | TokenStyle>; engine: Record<string, RGBA>; }
export interface Position { line: number; character: number; }
export interface Selection { anchor: number; head: number; }
export interface Highlight { start: number; end: number; style: TextStyle; }
export interface Inlay { anchor: number; text: string; block: boolean; }
export interface TextRange { start: number; end: number; }
export interface BracketPair { readonly open: string; readonly close: string; }
export interface BracketMatch { open: TextRange; close: TextRange; }
export interface EditorDiagnostic extends TextRange { message: string; severity?: 1 | 2 | 3 | 4; source?: string; code?: string | number; tags?: ReadonlyArray<1 | 2>; }
export interface LspRange { start: Position; end: Position; }
export interface NavigationTarget { uri?: string; range?: LspRange; selectionRange?: LspRange; start?: number; end?: number; originRange?: TextRange; }
export interface ProviderContext { editor: EditorAPI; offset: number; position: Position; version: number; signal: AbortSignal; }
export interface HoverResult { contents: string | Node | {value: string; language?: string; kind?: string} | Array<string | {value: string; language?: string}>; range?: LspRange; start?: number; end?: number; }
export interface WordContext extends ProviderContext { text: string; start: number; truncated: boolean; }
export interface CompletionContext extends ProviderContext { triggerKind: 'invoked' | 'automatic'; triggerCharacter?: string | undefined; }
export interface CompletionItem { label: string; text?: string; start?: number; end?: number; detail?: string; filterText?: string; sortText?: string; preselect?: boolean; kind?: number; snippet?: boolean; additionalEdits?: boolean; }
export interface ResolvedCompletion extends CompletionItem { start: number; end: number; text: string; detail: string; }
export interface CompletionState { readonly visible: boolean; readonly pending: boolean; readonly index: number; readonly items: ReadonlyArray<Readonly<ResolvedCompletion>>; }
export interface IndentContext { editor: EditorAPI; version: number; selection: Selection; position: Position; before: string; after: string; leadingWhitespace: string; indentUnit: string; bracketPairs: ReadonlyArray<BracketPair>; truncated: boolean; signal: AbortSignal; }
export interface IndentInsertion { text: string; caretOffset?: number; }
export type AutoIndent = 'none' | 'keep' | 'brackets' | ((context: IndentContext) => string | IndentInsertion | null | Promise<string | IndentInsertion | null>);
export interface EditRequest { start: number; end: number; text: string; source?: string; caretOffset?: number; }
export interface BeforeEdit extends EditRequest { version: number; selection: Selection; }
export type EditorCommand =
  | 'selectAll' | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'bold' | 'italic' | 'underline'
  | 'selectLine' | 'deleteLine' | 'moveLineUp' | 'moveLineDown' | 'duplicateLineUp' | 'duplicateLineDown'
  | 'insertTab' | 'indent' | 'outdent' | 'insertNewline' | 'insertLineAbove' | 'insertLineBelow'
  | 'cursorWordLeft' | 'cursorWordRight' | 'selectWordLeft' | 'selectWordRight' | 'deleteWordLeft' | 'deleteWordRight'
  | 'cursorLeft' | 'cursorRight' | 'cursorUp' | 'cursorDown' | 'selectLeft' | 'selectRight' | 'selectUp' | 'selectDown'
  | 'cursorLineStart' | 'cursorLineEnd' | 'selectLineStart' | 'selectLineEnd'
  | 'cursorDocumentStart' | 'cursorDocumentEnd' | 'selectDocumentStart' | 'selectDocumentEnd'
  | 'deleteLeft' | 'deleteRight' | 'cancel' | 'goToDefinition' | 'goToBracket' | 'nextDiagnostic' | 'previousDiagnostic'
  | 'triggerCompletion' | 'acceptCompletion' | 'nextCompletion' | 'previousCompletion' | 'hideCompletion'
  | 'increaseFontSize' | 'decreaseFontSize' | 'resetFontSize' | 'togglePerformance' | 'toggleFullscreen';
export interface KeybindingContext { editor: EditorAPI; event: KeyboardEvent; signal: AbortSignal; }
export type KeybindingHandler = (context: KeybindingContext) => void | boolean | Promise<void | boolean>;
export type Keybindings = Record<string, EditorCommand | KeybindingHandler | null>;
export interface EditorExtensions {
  bracketPairs?: ReadonlyArray<BracketPair>;
  autoClosingBrackets?: boolean;
  skipClosingBrackets?: boolean;
  bracketMatching?: boolean;
  bracketMatchingProvider?: (context: ProviderContext) => BracketMatch | null | Promise<BracketMatch | null>;
  autoIndent?: AutoIndent;
  indentUnit?: string;
  hoverDelay?: number;
  providerTimeout?: number;
  keybindings?: Keybindings;
  middleClickDefinition?: boolean;
  automaticCompletion?: boolean;
  completionDelay?: number;
  completionProvider?: (context: CompletionContext) => ReadonlyArray<CompletionItem> | null | Promise<ReadonlyArray<CompletionItem> | null>;
  wordProvider?: (context: WordContext) => TextRange | null | Promise<TextRange | null>;
  hoverProvider?: (context: ProviderContext) => HoverResult | string | Node | null | Promise<HoverResult | string | Node | null>;
  definitionProvider?: (context: ProviderContext) => NavigationTarget | NavigationTarget[] | null | Promise<NavigationTarget | NavigationTarget[] | null>;
  onBeforeEdit?: (request: BeforeEdit, editor: EditorAPI) => false | void | EditRequest;
  onChange?: (change: EditorChange, editor: EditorAPI) => void;
  onSelectionChange?: (selection: Selection, editor: EditorAPI) => void;
  onKeyDown?: (event: KeyboardEvent, editor: EditorAPI) => boolean | void;
  onNavigate?: (target: NavigationTarget, editor: EditorAPI, signal: AbortSignal) => boolean | void | Promise<boolean | void>;
}
export interface EditorOptions extends EditorExtensions { value?: string; filename?: string; theme?: string | Theme; fontSize?: number; wrap?: boolean; syntax?: boolean; performance?: boolean; }
export type EditorConfiguration = {[K in keyof EditorExtensions]?: EditorExtensions[K] | undefined};
export interface OverlayOptions { anchor: number; content: string | Node; placement?: 'above' | 'below'; interactive?: boolean; className?: string; }
export interface OverlayHandle { readonly element: HTMLDivElement; update(options: Partial<OverlayOptions>): void; dispose(): void; }
export interface CaretHit { x: number; y: number; h: number; offset: number; cluster: number; trailing: boolean; }
export interface VisualCell extends TextRange { bounds: RGBA; rtl: boolean; }
export interface Frame {
  version: number | bigint; request: number; scene_revision: number; selection_revision: number; scroll: number; scroll_min: number; scroll_max: number; total_height: number;
  visible_ready: boolean; pending: number; cached_blocks: number; quad_count: number;
  document_bytes: number; document_chars: number; document_lines: number;
  layout_ms: number; longest_job_ms: number; raster_ms: number; scene_ms: number;
  atlas_epoch: number; atlas_entries: number; jobs_processed: number;
  highlight_source_version: number | bigint | null; highlight_spans: number;
  instances: Float32Array; packed_navigation: Uint32Array;
  labels: Array<{line: number; y: number}>;
  hits: CaretHit[];
  navigation: {hits: CaretHit[]; cells: VisualCell[]; rows: Array<{y: number; h: number; rtl: boolean}>};
  rects: Array<{bounds: RGBA; uv: RGBA; color: RGBA}>;
}
export interface SampleSummary { count: number; last: number | null; p50: number | null; p95: number | null; p99: number | null; max: number | null; }
export interface BenchmarkReport { mode: 'warm' | 'redraw'; frames: number; rounds: number; quads: number; elapsed_ms: number; mean_ms: number; fps: number; worker_ms: number; main_ms: number; samples: Array<{frames: number; elapsed: number; workerMs: number; mainMs: number; quads: number}>; }
export interface PerformanceSnapshot {
  equivalentFps: number | null; latencyEquivalentFps: number | null; cpuEquivalentFps: number | null;
  renderFps: number; rafFps: number; longTasks: number; longestTask: number;
  live: {kind: 'update' | 'redraw'; cost_ms: number; cpu_ms: number; gpu_ms: number | null; fps: number | null; age_ms: number; samples: number; gpu_status: string} | null;
  metrics: Record<string, SampleSummary>;
  benchmark: BenchmarkReport | null;
  lastCompletedFrame: {id: number; version: number; request: number; generation_ms: number; latency_ms: number; raf_wait_ms: number; backpressure_ms: number} | null;
  frameTrace: {state: string; id?: number; startedAt?: number; epoch?: number};
}
export interface EditorChange { version: number; start: number; end: number; text: string; selection: Selection; decorations: Highlight[]; source?: string; }
export interface EditorEvents { change: EditorChange; beforeedit: BeforeEdit; navigate: NavigationTarget; frame: Frame; completionchange: CompletionState; diagnosticschange: {version: number; diagnostics: ReadonlyArray<Readonly<EditorDiagnostic>>}; providererror: {kind: string; error: Error}; documentchange: {name: string; version: number; bytes: number}; selectionchange: Selection; themechange: ResolvedTheme; notice: string; dispose: null; }
export interface EditorAPI {
  readonly element: TexeluneEditorElement;
  readonly root: ShadowRoot;
  readonly text: string;
  readonly version: number;
  readonly selection: Selection;
  readonly theme: ResolvedTheme;
  readonly documentInfo: {bytes: number; chars: number; lines: number};
  readonly frame: Frame | null;
  readonly caret: CaretHit | null;
  readonly performance: PerformanceSnapshot;
  readonly stats: {drawCount: number; inFlight: number; request: number; version: number; submitTimes: number[]; intervals: number[]; lastLatency: number | null};
  on<K extends keyof EditorEvents>(type: K, listener: (event: CustomEvent<EditorEvents[K]>) => void): () => void;
  load(text: string, filename?: string): void;
  loadSynthetic(bytes?: number, singleLine?: boolean): Promise<void>;
  slice(start: number, end: number): string;
  select(anchor: number, head: number): void;
  insert(text: string): boolean;
  replace(start: number, end: number, text: string): boolean;
  applyEdit(request: EditRequest, expectedVersion?: number): boolean;
  executeCommand(command: EditorCommand): Promise<boolean>;
  configure(extensions: EditorConfiguration): void;
  readonly configuration: Readonly<EditorConfiguration>;
  lineRange(line: number): TextRange;
  wordRange(offset: number, signal?: AbortSignal): Promise<TextRange>;
  matchBrackets(offset?: number, signal?: AbortSignal): Promise<BracketMatch | null>;
  skipClosingBracket(close?: string): boolean;
  addOverlay(options: OverlayOptions): OverlayHandle;
  showHover(content: string | Node, anchor?: number): void;
  hideHover(): void;
  goToDefinition(offset?: number): Promise<void>;
  triggerCompletion(): Promise<ReadonlyArray<Readonly<ResolvedCompletion>>>;
  acceptCompletion(index?: number): boolean;
  hideCompletion(): void;
  readonly completion: CompletionState;
  readonly diagnostics: ReadonlyArray<Readonly<EditorDiagnostic>>;
  setDiagnostics(items: ReadonlyArray<EditorDiagnostic>, readVersion?: number): boolean;
  goToDiagnostic(direction?: 1 | -1): Readonly<EditorDiagnostic> | null;
  reveal(offset?: number): void;
  readonly scroll: number;
  readonly renderedScroll: number;
  positionAt(offset: number): Position;
  offsetAt(position: Position): number;
  focus(): void;
  setFontSize(px: number): void;
  setWrap(enabled: boolean): void;
  setSyntax(enabled: boolean): void;
  toggle(attribute: 'bold' | 'italic' | 'underline'): void;
  format(style: TextStyle): void;
  undo(): boolean;
  redo(): boolean;
  setInlays(inlays: Inlay[]): void;
  setHighlights(spans: Highlight[], readVersion?: number): boolean;
  setTheme(theme: string | Theme): void;
  scrollTo(y: number): void;
  showPerformance(visible?: boolean): void;
  benchmark(mode?: 'warm' | 'redraw'): Promise<BenchmarkReport>;
  cancelBenchmark(): void;
  restartLayout(): void;
  destroy(): void;
}
export class TexeluneEditorElement extends HTMLElement { readonly api?: EditorAPI; initialize(options?: EditorOptions): Promise<EditorAPI>; }
export function createEditor(container: HTMLElement, options?: EditorOptions): Promise<EditorAPI>;
export const themes: Record<'paper' | 'dusk', Theme>;
export function resolveTheme(theme?: string | Theme): ResolvedTheme;
export const defaultKeybindings: Readonly<Record<string, EditorCommand>>;
export const editorCommands: ReadonlyArray<EditorCommand>;
export const defaultBracketPairs: ReadonlyArray<BracketPair>;

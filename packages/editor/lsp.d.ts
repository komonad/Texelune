import type {EditorAPI,NavigationTarget,HoverResult} from './index.js';
export interface LspOptions { url?: string; workerUrl?: string; workerType?: 'module' | 'classic'; rootUri: string; uri: string; languageId?: string; maxDocumentBytes?: number; timeout?: number; }
export interface Completion { label: string; detail: string; text: string; start: number; end: number; additionalEdits: boolean; snippet: boolean; }
export interface Diagnostic { range: import('./index.js').LspRange; start: number; end: number; message: string; severity?: number; source?: string; code?: string | number; }
export interface LspEvents {
  status: {state: string; message: string};
  connected: {server: {name: string; version?: string}; capabilities: Record<string, unknown>};
  diagnostics: {epoch: number; version: number; diagnostics: Diagnostic[]};
  tokens: {epoch: number; version: number; appliedVersion: number; count: number; theme: string; batch: number};
  timing: {version: number; sourceVersion: number; elapsed: number};
}
export class LspClient extends EventTarget {
  constructor(editor: EditorAPI, options: LspOptions);
  readonly editor: EditorAPI;
  readonly options: LspOptions;
  readonly state: string;
  readonly quiescent?: boolean;
  readonly capabilities?: Record<string, unknown>;
  addEventListener<K extends keyof LspEvents>(type: K, listener: (event: CustomEvent<LspEvents[K]>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof LspEvents>(type: K, listener: (event: CustomEvent<LspEvents[K]>) => void, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
  connect(): Promise<LspEvents['connected'] | void>;
  disconnect(): void;
  refresh(): void;
  hover(offset?: number, options?: {signal?: AbortSignal}): Promise<HoverResult | null>;
  complete(offset?: number, options?: {signal?: AbortSignal}): Promise<Completion[]>;
  definition(offset?: number, options?: {signal?: AbortSignal}): Promise<NavigationTarget[]>;
  attach(): () => void;
  dispose(): void;
}

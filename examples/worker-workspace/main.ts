interface Palette {
  name: string;
  colors: readonly string[];
}

function describe(palette: Palette): string {
  return `${palette.name}: ${palette.colors.length} colors`;
}

const paper: Palette = {
  name: "Paper",
  colors: ["#8041ae", "#315eb6", "#20638b"],
};

type TokenKind = "keyword" | "function" | "type" | "string" | "comment";

interface TokenRule {
  kind: TokenKind;
  foreground: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface TextRecord {
  id: number;
  language: string;
  text: string;
  enabled: boolean;
}

interface TextSummary {
  records: number;
  scalars: number;
  utf16: number;
  byLanguage: ReadonlyMap<string, number>;
}

class PaletteCatalog {
  private readonly entries = new Map<string, Palette>();

  constructor(initial: readonly Palette[]) {
    for (const palette of initial) this.entries.set(palette.name, palette);
  }

  register(palette: Palette): this {
    this.entries.set(palette.name, palette);
    return this;
  }

  find(name: string): Palette | undefined {
    return this.entries.get(name);
  }

  names(): string[] {
    return [...this.entries.keys()].sort();
  }

  search(prefix: string): Palette[] {
    const query = prefix.toLocaleLowerCase();
    return [...this.entries.values()].filter(palette =>
      palette.name.toLocaleLowerCase().startsWith(query)
    );
  }

  describeAll(): string[] {
    return [...this.entries.values()].map(describe);
  }
}

const tokenRules: readonly TokenRule[] = [
  { kind: "keyword", foreground: "#8041ae", bold: true },
  { kind: "function", foreground: "#315eb6" },
  { kind: "type", foreground: "#20638b" },
  { kind: "string", foreground: "#a35424" },
  { kind: "comment", foreground: "#7c879b", italic: true },
];

const textRecords: readonly TextRecord[] = [
  { id: 1, language: "zh", text: "中文标点：『选区』、折行与字体回退。", enabled: true },
  { id: 2, language: "en", text: "Identifiers: paletteName, token_rules, RGB24.", enabled: true },
  { id: 3, language: "ar", text: "مرحبا بالعالم — العربية 123", enabled: true },
  { id: 4, language: "he", text: "שָׁלוֹם עוֹלָם — עברית 456", enabled: true },
  { id: 5, language: "hi", text: "नमस्ते दुनिया — क्षि क्‍ष", enabled: true },
  { id: 6, language: "ko", text: "한글과 한글", enabled: true },
  { id: 7, language: "ja", text: "日本語の句読点、改行と選択。", enabled: true },
  { id: 8, language: "emoji", text: "👩🏽‍💻 👨‍👩‍👧‍👦 🧑🏿‍🚀 🇭🇰 1️⃣", enabled: true },
  { id: 9, language: "combining", text: "e\u0301 a\u0310 o\u0308\u0332 A\u030a", enabled: true },
  { id: 10, language: "bidi", text: "before \u2067العربية 123\u2069 after", enabled: true },
  { id: 11, language: "bidi", text: "A \u2067אבג \u2066TypeScript 144\u2069 דהו\u2069 Z", enabled: true },
  { id: 12, language: "symbols", text: "∀x ∈ ℝ: x² ≥ 0; α → β; ∑ₙ aₙ", enabled: false },
];

function summarize(records: readonly TextRecord[]): TextSummary {
  const byLanguage = new Map<string, number>();
  let scalars = 0;
  let utf16 = 0;
  let count = 0;
  for (const record of records) {
    if (!record.enabled) continue;
    count += 1;
    scalars += [...record.text].length;
    utf16 += record.text.length;
    byLanguage.set(record.language, (byLanguage.get(record.language) ?? 0) + 1);
  }
  return { records: count, scalars, utf16, byLanguage };
}

function groupBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey);
    if (group) group.push(value);
    else groups.set(groupKey, [value]);
  }
  return groups;
}

function filterRecords(records: readonly TextRecord[], query: string): TextRecord[] {
  const normalized = query.normalize("NFC").toLocaleLowerCase();
  return records.filter(record =>
    record.text.normalize("NFC").toLocaleLowerCase().includes(normalized)
  );
}

function formatSummary(summary: TextSummary): string {
  const languages = [...summary.byLanguage]
    .map(([language, count]) => `${language}=${count}`)
    .join(", ");
  return `${summary.records} records / ${summary.scalars} scalars / ${summary.utf16} UTF-16 units\n${languages}`;
}

async function* readBatches<T>(values: readonly T[], size = 4): AsyncGenerator<readonly T[]> {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("Invalid batch size");
  for (let offset = 0; offset < values.length; offset += size) {
    yield values.slice(offset, offset + size);
    await Promise.resolve();
  }
}

async function collectLanguages(records: readonly TextRecord[]): Promise<Set<string>> {
  const languages = new Set<string>();
  for await (const batch of readBatches(records)) {
    for (const record of batch) languages.add(record.language);
  }
  return languages;
}

const catalog = new PaletteCatalog([paper]);
catalog.register({ name: "Dusk", colors: ["#c5a1ff", "#acbcff", "#8dd2ee"] });
const greeting = "你好 · שלום · مرحبا · 👩🏽‍💻";
const greetingLength = [...greeting].length;
const grouped = groupBy(textRecords, record => record.language);
const matches = filterRecords(textRecords, "世界");
const summary = summarize(textRecords);
const unicode = "你好 · שלום · مرحبا · 👩🏽‍💻";
const label = describe(paper);
console.log(label, unicode, greetingLength, tokenRules);
console.log(catalog.names(), catalog.describeAll(), grouped, matches);
console.log(formatSummary(summary));
void collectLanguages(textRecords).then(languages => console.log([...languages]));

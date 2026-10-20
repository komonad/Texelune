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

const unicode = "你好 · שלום · مرحبا · 👩🏽‍💻";
const label = describe(paper);
console.log(label, unicode);

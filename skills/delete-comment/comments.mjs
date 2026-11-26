import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const require = createRequire(path.join(root, "package.json"));
const parser = require(
  require.resolve("@typescript-eslint/parser", {
    paths: [require.resolve("eslint-config-next")],
  }),
);
const { isDirective } = await import(
  pathToFileURL(path.join(root, "scripts/eslint/no-comments.mts")).href
);

const code = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const skipped = /(^|\/)(_generated|catalogs)\/|^\.agents\/|^\.claude\//;

function trackedFiles(paths) {
  const args = ["ls-files", "--", ...(paths.length ? paths : ["."])];
  return execFileSync("git", args, { cwd: root })
    .toString()
    .split("\n")
    .filter((f) => (code.test(f) || f.endsWith(".css")) && !skipped.test(f));
}

function parse(text, file) {
  return parser.parse(text, {
    range: true,
    loc: true,
    comment: true,
    tokens: true,
    jsx: /x$/.test(file),
    ecmaVersion: "latest",
    sourceType: "module",
  });
}

function commentsOf(text, file) {
  if (file.endsWith(".css")) {
    return [...text.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => ({
      range: [m.index, m.index + m[0].length],
      start: text.slice(0, m.index).split("\n").length,
      end: text.slice(0, m.index + m[0].length).split("\n").length,
      standalone: true,
    }));
  }
  return parse(text, file)
    .comments.filter((c) => !isDirective(c))
    .map((c) => {
      const lineStart = text.lastIndexOf("\n", c.range[0] - 1) + 1;
      return {
        range: c.range,
        start: c.loc.start.line,
        end: c.loc.end.line,
        standalone: /^\s*\{?\s*$/.test(text.slice(lineStart, c.range[0])),
      };
    });
}

function list(paths) {
  const blocks = [];
  for (const file of trackedFiles(paths)) {
    const text = readFileSync(path.join(root, file), "utf8");
    const lines = text.split("\n");
    let current;
    for (const c of commentsOf(text, file)) {
      if (current && c.standalone && current.standalone && c.start === current.end + 1) {
        current.end = c.end;
      } else {
        current = { file, start: c.start, end: c.end, standalone: c.standalone };
        blocks.push(current);
      }
    }
    for (const b of blocks.filter((b) => b.file === file)) {
      b.text = lines.slice(b.start - 1, b.end).join("\n");
    }
  }
  return blocks.map((b, i) => ({
    id: `C${String(i + 1).padStart(4, "0")}`,
    file: b.file,
    start: b.start,
    end: b.end,
    text: b.text,
  }));
}

function emptyJsxContainers(ast) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "JSXExpressionContainer" && node.expression.type === "JSXEmptyExpression") {
      found.push(node.range);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === "string") visit(value);
    }
  };
  visit(ast);
  return found;
}

function widen(text, s, e) {
  const lineStart = text.lastIndexOf("\n", s - 1) + 1;
  let lineEnd = text.indexOf("\n", e);
  if (lineEnd === -1) lineEnd = text.length;
  const blankBefore = /^\s*$/.test(text.slice(lineStart, s));
  const blankAfter = /^\s*$/.test(text.slice(e, lineEnd));
  if (blankBefore && blankAfter) return [lineStart, Math.min(lineEnd + 1, text.length)];
  if (blankAfter) {
    while (s > lineStart && /[ \t]/.test(text[s - 1])) s--;
    return [s, e];
  }
  while (e < lineEnd && /[ \t]/.test(text[e])) e++;
  return [s, e];
}

function remove(blocks) {
  const byFile = Map.groupBy(blocks, (b) => b.file);
  const touched = [];
  for (const [file, fileBlocks] of byFile) {
    const abs = path.join(root, file);
    const text = readFileSync(abs, "utf8");
    for (const b of fileBlocks) {
      const now = text.split("\n").slice(b.start - 1, b.end).join("\n");
      if (b.text !== undefined && now !== b.text) {
        throw new Error(`${file}:${b.start} changed since it was listed; list again.`);
      }
    }
    const containers = file.endsWith(".css") ? [] : emptyJsxContainers(parse(text, file));
    const ranges = commentsOf(text, file)
      .filter((c) => fileBlocks.some((b) => c.start >= b.start && c.end <= b.end))
      .map((c) => containers.find(([s, e]) => s <= c.range[0] && c.range[1] <= e) ?? c.range)
      .map(([s, e]) => widen(text, s, e))
      .sort((a, b) => b[0] - a[0]);
    let out = text;
    let floor = Infinity;
    for (const [s, e] of ranges) {
      if (e > floor) continue;
      out = out.slice(0, s) + out.slice(e);
      floor = s;
    }
    writeFileSync(abs, out);
    touched.push(file);
  }
  return touched;
}

function tokens(text, file) {
  if (file.endsWith(".css")) return [text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "")];
  return parse(text, file)
    .tokens.map((t) => `${t.type}:${t.type === "JSXText" ? t.value.replace(/\s+/g, " ").trim() : t.value}`)
    .filter((t) => t !== "JSXText:")
    .join("\n")
    .replace(/Punctuator:\{\nPunctuator:\}\n/g, "")
    .replace(/Punctuator:,\n(Punctuator:[\])}])/g, "$1")
    .split("\n");
}

function verify(base) {
  const changed = execFileSync("git", ["diff", "--name-only", base], { cwd: root })
    .toString()
    .split("\n")
    .filter((f) => (code.test(f) || f.endsWith(".css")) && !skipped.test(f));
  const differ = [];
  for (const file of changed) {
    let before;
    try {
      before = execFileSync("git", ["show", `${base}:${file}`], { cwd: root }).toString();
    } catch {
      continue;
    }
    const after = readFileSync(path.join(root, file), "utf8");
    if (tokens(before, file).join("\0") !== tokens(after, file).join("\0")) differ.push(file);
  }
  return { checked: changed.length, differ };
}

const [command, ...args] = process.argv.slice(2);
if (command === "list") {
  console.log(JSON.stringify(list(args), null, 1));
} else if (command === "delete") {
  const blocks = JSON.parse(readFileSync(args[0], "utf8"));
  console.log(remove(blocks).join("\n"));
} else if (command === "verify") {
  const result = verify(args[0] ?? "HEAD");
  console.log(JSON.stringify(result, null, 1));
  if (result.differ.length) process.exit(1);
} else {
  console.error("Usage: comments.mjs list [paths…] | delete <blocks.json> | verify [base]");
  process.exit(2);
}

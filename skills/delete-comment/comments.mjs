// Lists, deletes and verifies code comments in any language.
// Comments are read by a lexer driven by LANGUAGES: each entry gives a language's comment markers,
// string forms and the few tokens that would otherwise be misread. `--syntax <module.mjs>` adds or
// overrides entries: its default export maps a language id to an entry shaped like the ones below.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();

const ml = { multiline: true };
const str = (open, close = open, opts = {}) => ({ open, close, escape: "\\", ...opts });
const raw = (open, close = open, opts = {}) => ({ open, close, escape: null, ...opts });
const DQ = str('"');
const SQ = str("'");
const DQ_ML = str('"', '"', ml);
const SQ_ML = str("'", "'", ml);
const TDQ = str('"""', '"""', ml);
const TSQ = str("'''", "'''", ml);
const CHAR = /'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|[0-7]{1,3}|[^\n])|[^\\'\n])'/;
const PRIME_CHAR = /'(?:\\[^'\n]{1,12}|[^\\'\n])'/;
const PRIME_WORD = /[\p{L}\p{N}_']+/u;
const HTML_COMMENT = ["<!--", "-->"];
const C = { line: ["//"], block: [["/*", "*/"]] };
const HASH = { line: ["#"] };
const SHELL_HASH = { open: "#", boundary: true };
const levelClose = (m) => `]${m[1]}]`;
const SIGIL =
  /~[a-zA-Z]+(?:"""[\s\S]*?"""|'''[\s\S]*?'''|\/(?:\\.|[^/\\\n])*\/|\|(?:\\.|[^|\\\n])*\||"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)|\[(?:\\.|[^\]\\])*\]|\{(?:\\.|[^}\\])*\}|<(?:\\.|[^>\\])*>)[a-zA-Z]*/;

const JS = {
  ...C,
  strings: [DQ, SQ, str("`", "`", { multiline: true, interp: "${" })],
  regex: true,
  bangLegal: true,
  directives: (body, c) => c.block && /^(globals?|exported|jshint|jslint)\s/.test(body),
};
const C_FAMILY = {
  ...C,
  strings: [raw(/(?:u8|[uUL])?R"([^()\\\s]{0,16})\(/, (m) => `)${m[1]}"`, ml), DQ, SQ],
};
const RUBY_HEREDOC = /(?<![\w)\]])<<[-~]?(["'`]?)(?<id>[A-Za-z_]\w*)\1/;

const LANGUAGES = {
  javascript: { ext: ["js", "mjs", "cjs", "jsx"], shebang: /\b(node|deno|bun|zx)\b/, ...JS, jsx: true },
  typescript: { ext: ["ts", "mts", "cts"], shebang: /\b(ts-node|tsx)\b/, ...JS },
  tsx: { name: "typescript", ext: ["tsx"], ...JS, jsx: true, ts: true },
  css: { ext: ["css", "pcss", "postcss"], block: [["/*", "*/"]], strings: [DQ, SQ], bangLegal: true },
  scss: {
    ext: ["scss", "sass", "less", "styl", "stylus"],
    ...C,
    strings: [DQ, SQ],
    skip: [/url\(\s*[^\s'")][^)]*\)/i],
    bangLegal: true,
  },
  html: { ext: ["html", "htm", "xhtml", "vue", "svelte", "astro"], embed: "markup", block: [HTML_COMMENT] },
  php: {
    ext: ["php", "phtml", "php3", "php4", "php5", "php7", "phps"],
    shebang: /\bphp\b/,
    embed: "php",
    line: ["//", "#"],
    block: [["/*", "*/"]],
    strings: [DQ_ML, SQ_ML, str("`", "`", ml)],
    heredoc: /<<<[ \t]*(["']?)(?<id>[A-Za-z_]\w*)\1/,
    skip: [/#\[/],
    lineEnd: "?>",
    exit: "?>",
  },
  c: { ext: ["c", "h"], ...C_FAMILY },
  cpp: {
    ext: ["cc", "cpp", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ipp", "tpp", "inl", "ixx", "cppm", "ino", "cu", "cuh"],
    ...C_FAMILY,
  },
  "objective-c": { ext: ["m", "mm"], ...C_FAMILY },
  shader: {
    ext: ["glsl", "vert", "frag", "geom", "comp", "tesc", "tese", "hlsl", "fx", "metal", "wgsl", "shader", "cginc"],
    ...C_FAMILY,
  },
  csharp: { ext: ["cs", "csx"], ...C, strings: [raw('"""', '"""', ml), raw(/\$?@\$?"/, '"', ml), DQ, SQ] },
  java: { ext: ["java"], ...C, strings: [TDQ, DQ, SQ] },
  kotlin: {
    ext: ["kt", "kts"],
    ...C,
    nested: true,
    strings: [raw('"""', '"""', { multiline: true, interp: "${" }), str('"', '"', { interp: "${" }), SQ],
  },
  scala: { ext: ["scala", "sc", "sbt"], ...C, nested: true, strings: [raw('"""', '"""', ml), DQ], skip: [CHAR] },
  groovy: {
    ext: ["groovy", "gradle", "gvy"],
    names: ["Jenkinsfile"],
    ...C,
    strings: [TDQ, TSQ, str('"', '"', { interp: "${" }), SQ],
  },
  dart: {
    ext: ["dart"],
    ...C,
    nested: true,
    strings: [
      raw(/r"""/, '"""', ml),
      raw(/r'''/, "'''", ml),
      raw(/r"/, '"'),
      raw(/r'/, "'"),
      str('"""', '"""', { multiline: true, interp: "${" }),
      str("'''", "'''", { multiline: true, interp: "${" }),
      str('"', '"', { interp: "${" }),
      str("'", "'", { interp: "${" }),
    ],
  },
  swift: {
    ext: ["swift"],
    ...C,
    nested: true,
    strings: [
      raw(/(#+)"""/, (m) => `"""${m[1]}`, ml),
      raw(/(#+)"/, (m) => `"${m[1]}`),
      str('"""', '"""', { multiline: true, interp: "\\(" }),
      str('"', '"', { interp: "\\(" }),
    ],
  },
  go: {
    ext: ["go"],
    ...C,
    strings: [DQ, SQ, raw("`", "`", ml)],
    directives: /^(go:\w|\+build\s|export\s|line\s|extern\s)/,
    keep: cgoPreamble,
  },
  rust: {
    ext: ["rs"],
    ...C,
    nested: true,
    strings: [raw(/[bc]?r(#*)"/, (m) => `"${m[1]}`, ml), str(/[bc]?"/, '"', ml)],
    skip: [/b?'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|[^\n])|[^\\'\n])'/],
  },
  zig: { ext: ["zig", "zon"], line: ["//"], strings: [DQ], skip: [CHAR, /\\\\[^\n]*/] },
  d: {
    ext: ["d", "di"],
    ...C,
    block: [["/*", "*/"], { open: "/+", close: "+/", nested: true }],
    strings: [DQ_ML, raw("`", "`", ml), raw(/r"/, '"', ml)],
    skip: [CHAR],
  },
  solidity: { ext: ["sol"], ...C, strings: [DQ, SQ] },
  protobuf: { ext: ["proto", "thrift"], ...C, line: ["//", "#"], strings: [DQ, SQ] },
  verilog: { ext: ["v", "sv", "svh", "vh"], ...C, strings: [DQ] },
  python: {
    ext: ["py", "pyi", "pyw", "pyx", "pxd", "pxi", "bzl", "star", "sky", "gyp", "gypi"],
    names: ["BUILD", "BUILD.bazel", "WORKSPACE", "WORKSPACE.bazel", "MODULE.bazel", "Tiltfile", "SConstruct", "SConscript", "Snakefile"],
    shebang: /python|pypy/,
    ...HASH,
    strings: [TDQ, TSQ, DQ, SQ],
    directives: /^type:/,
  },
  ruby: {
    ext: ["rb", "rake", "gemspec", "ru", "rbs", "podspec", "jbuilder", "thor", "builder"],
    names: ["Rakefile", "Gemfile", "Guardfile", "Podfile", "Fastfile", "Appfile", "Matchfile", "Pluginfile", "Brewfile", "Vagrantfile", "Dangerfile", "Capfile", "Berksfile", "Steepfile"],
    shebang: /ruby/,
    ...HASH,
    block: [{ open: "=begin", close: /^=end\b[^\n]*/m, column0: true }],
    strings: [str('"', '"', { multiline: true, interp: "#{" }), SQ_ML, str("`", "`", { multiline: true, interp: "#{" })],
    regex: true,
    heredoc: RUBY_HEREDOC,
    dataEnd: /__END__[ \t]*(?=\r?\n|$)/,
  },
  crystal: { ext: ["cr"], ...HASH, strings: [str('"', '"', { multiline: true, interp: "#{" })], skip: [CHAR], heredoc: RUBY_HEREDOC },
  perl: {
    ext: ["pl", "pm", "t", "pod", "psgi"],
    shebang: /perl/,
    ...HASH,
    block: [{ open: /=[a-zA-Z]\w*/, close: /^=cut\b[^\n]*/m, column0: true }],
    strings: [DQ_ML, SQ_ML],
    regex: true,
    heredoc: /(?<![\w)\]])<<~?(["']?)(?<id>[A-Za-z_]\w*)\1/,
    dataEnd: /__(END|DATA)__[ \t]*(?=\r?\n|$)/,
    skip: [/\$#/],
  },
  shell: {
    ext: ["sh", "bash", "zsh", "ksh", "fish", "bats", "command"],
    names: [".bashrc", ".bash_profile", ".bash_aliases", ".profile", ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".kshrc", "PKGBUILD"],
    shebang: /\b(ba|z|k|da|fi|a)?sh\b/,
    line: [SHELL_HASH],
    strings: [raw("'", "'", ml), str('"', '"', ml), str("`", "`", ml)],
    heredoc: /(?<!<)<<-?[ \t]*(["']?)(?<id>[A-Za-z_]\w*)\1/,
    skip: [/\\./, /\$\{?#/, /\$'(?:\\.|[^\\'])*'/],
  },
  powershell: {
    ext: ["ps1", "psm1", "psd1"],
    line: ["#"],
    block: [["<#", "#>"]],
    strings: [raw('@"', /^[ \t]*"@/m, ml), raw("@'", /^[ \t]*'@/m, ml), str('"', '"', { escape: "`", multiline: true }), raw("'", "'", ml)],
    skip: [/`./],
  },
  batch: { ext: ["bat", "cmd"], line: [{ open: /@?rem(?=\s|$)/i, lineStart: true }, { open: "::", lineStart: true }] },
  vb: { ext: ["vb", "vbs", "bas", "frm", "vba"], line: ["'", { open: /rem(?=\s|$)/i, lineStart: true }], strings: [raw('"')] },
  sql: {
    ext: ["sql", "psql", "pgsql", "plsql", "pls", "pks", "pkb", "hql", "ddl", "dml", "cql"],
    line: ["--"],
    block: [["/*", "*/"]],
    strings: [raw(/\$([A-Za-z_]\w*)?\$/, (m) => m[0], ml), raw("'", "'", ml), raw('"', '"', ml), raw("`", "`", ml)],
  },
  lua: {
    ext: ["lua", "luau", "rockspec"],
    shebang: /\blua/,
    line: ["--"],
    block: [{ open: /--\[(=*)\[/, close: levelClose }],
    strings: [raw(/\[(=*)\[/, levelClose, ml), DQ, SQ],
    directives: /^-+\s*@/,
  },
  haskell: {
    ext: ["hs", "hsc", "hs-boot", "purs", "elm", "agda", "idr", "dhall"],
    line: [/--+(?![!#$%&*+./<=>?@\\^|~:])/],
    block: [["{-", "-}"]],
    nested: true,
    strings: [DQ],
    skip: [PRIME_CHAR],
    word: PRIME_WORD,
    directives: /^#/,
  },
  ocaml: {
    ext: ["ml", "mli", "mll", "mly"],
    block: [["(*", "*)"]],
    nested: true,
    strings: [DQ_ML, raw(/\{([a-z_]*)\|/, (m) => `|${m[1]}}`, ml)],
    skip: [/\(\*\)/, PRIME_CHAR],
    word: PRIME_WORD,
  },
  fsharp: {
    ext: ["fs", "fsi", "fsx"],
    line: ["//"],
    block: [["(*", "*)"]],
    nested: true,
    strings: [raw('"""', '"""', ml), raw('@"', '"', ml), DQ_ML],
    skip: [/\(\*\)/, PRIME_CHAR],
    word: PRIME_WORD,
  },
  elixir: {
    ext: ["ex", "exs"],
    ...HASH,
    strings: [str('"""', '"""', { multiline: true, interp: "#{" }), TSQ, str('"', '"', { multiline: true, interp: "#{" }), SQ_ML],
    skip: [/\?\\?\S/, SIGIL],
  },
  erlang: { ext: ["erl", "hrl", "escript"], line: ["%"], strings: [DQ_ML, raw("'")], skip: [/\$\\?\S/] },
  clojure: {
    ext: ["clj", "cljs", "cljc", "edn", "bb"],
    line: [";"],
    strings: [DQ_ML],
    skip: [/\\(?:newline|space|tab|formfeed|backspace|return|u[0-9a-fA-F]{4}|o[0-7]{1,3}|\S)/],
  },
  lisp: {
    ext: ["lisp", "lsp", "cl", "asd", "scm", "ss", "sld", "rkt", "fnl"],
    line: [";"],
    block: [["#|", "|#"]],
    nested: true,
    strings: [DQ_ML],
    skip: [/#\\(?:[a-zA-Z]+|\S)/],
  },
  "emacs-lisp": { ext: ["el"], names: [".emacs"], line: [";"], strings: [DQ_ML], skip: [/\?\\?\S/] },
  r: { ext: ["r"], names: [".Rprofile"], shebang: /Rscript/, ...HASH, strings: [DQ_ML, SQ_ML, raw("`")] },
  julia: { ext: ["jl"], shebang: /julia/, ...HASH, block: [["#=", "=#"]], nested: true, strings: [TDQ, DQ_ML, raw("`", "`", ml)], skip: [CHAR] },
  nim: { ext: ["nim", "nims", "nimble"], ...HASH, block: [["#[", "]#"]], nested: true, strings: [raw('"""', '"""', ml), DQ], skip: [CHAR] },
  fortran: { ext: ["f90", "f95", "f03", "f08", "f18", "f", "for", "ftn", "fpp"], line: ["!"], strings: [raw('"'), raw("'")] },
  pascal: {
    ext: ["pas", "pp", "dpr", "dpk", "lpr"],
    line: ["//"],
    block: [["(*", "*)"], ["{", "}"]],
    strings: [raw("'")],
    directives: /^\$/,
  },
  ada: { ext: ["adb", "ads", "ada"], line: ["--"], strings: [raw('"')], skip: [/'.'/] },
  vhdl: { ext: ["vhd", "vhdl"], line: ["--"], block: [["/*", "*/"]], strings: [raw('"')], skip: [/'.'/] },
  tcl: { ext: ["tcl", "tk", "itcl"], line: [SHELL_HASH], strings: [DQ_ML] },
  awk: { ext: ["awk"], shebang: /awk/, ...HASH, strings: [DQ], regex: true },
  tex: { ext: ["tex", "sty", "cls", "ltx", "dtx", "ins"], line: ["%"], skip: [/\\./] },
  graphql: { ext: ["graphql", "gql", "graphqls"], ...HASH, strings: [TDQ, DQ] },
  prisma: { ext: ["prisma"], line: ["//"], strings: [DQ] },
  hcl: {
    ext: ["tf", "tfvars", "hcl", "nomad"],
    line: ["#", "//"],
    block: [["/*", "*/"]],
    strings: [str('"', '"', { interp: "${" })],
    heredoc: /<<-?(?<id>[A-Za-z_]\w*)/,
  },
  nix: {
    ext: ["nix"],
    ...HASH,
    block: [["/*", "*/"]],
    strings: [str('"', '"', { multiline: true, interp: "${" }), raw("''", "''", { multiline: true, interp: "${" })],
  },
  make: { ext: ["mk", "mak", "make"], names: ["Makefile", "makefile", "GNUmakefile", "BSDmakefile"], ...HASH, skip: [/\\./] },
  cmake: {
    ext: ["cmake"],
    names: ["CMakeLists.txt"],
    line: ["#"],
    block: [{ open: /#\[(=*)\[/, close: levelClose }],
    strings: [DQ_ML, raw(/\[(=*)\[/, levelClose, ml)],
  },
  dockerfile: {
    ext: ["dockerfile", "containerfile"],
    names: ["Dockerfile", "Containerfile"],
    namePattern: /^(Docker|Container)file\./,
    line: [{ open: "#", lineStart: true }],
    directives: /^(syntax|escape|check)\s*=/i,
  },
  just: { ext: ["just"], names: ["justfile", "Justfile", ".justfile"], ...HASH, strings: [DQ, raw("'")] },
  erb: { name: "template", ext: ["erb", "ejs", "eex", "heex", "leex"], block: [["<%!--", "--%>"], ["<%#", "%>"], HTML_COMMENT] },
  jinja: { name: "template", ext: ["j2", "jinja", "jinja2", "twig", "njk", "nunjucks", "tera"], block: [["{#", "#}"], HTML_COMMENT] },
  handlebars: { name: "template", ext: ["hbs", "handlebars", "mustache"], block: [["{{!--", "--}}"], ["{{!", "}}"], HTML_COMMENT] },
  liquid: {
    name: "template",
    ext: ["liquid"],
    block: [{ open: /\{%-?\s*comment\s*-?%\}/, close: /\{%-?\s*endcomment\s*-?%\}/ }, HTML_COMMENT],
  },
  razor: { name: "template", ext: ["cshtml", "razor"], block: [["@*", "*@"], HTML_COMMENT] },
  json: {
    group: "config",
    ext: ["json", "jsonc", "json5", "code-workspace"],
    names: [".babelrc", ".swcrc", ".jshintrc"],
    ...C,
    strings: [DQ, SQ],
  },
  yaml: {
    group: "config",
    ext: ["yml", "yaml"],
    names: [".clang-format", ".clang-tidy"],
    line: [SHELL_HASH],
    strings: [str('"', '"', { multiline: true, boundary: true }), raw("'", "'", { multiline: true, boundary: true })],
    blockScalars: true,
  },
  toml: { group: "config", ext: ["toml"], names: ["Pipfile"], ...HASH, strings: [TDQ, raw("'''", "'''", ml), DQ, raw("'")] },
  ini: {
    group: "config",
    ext: ["ini", "cfg", "conf", "properties", "editorconfig", "gitconfig", "npmrc"],
    names: [".editorconfig", ".gitconfig", ".gitmodules", ".npmrc", ".yarnrc", ".pylintrc", ".flake8", ".coveragerc", ".pypirc", ".hgrc"],
    line: [{ open: ";", lineStart: true }, { open: "#", lineStart: true }],
  },
  dotenv: { group: "config", ext: ["env"], namePattern: /^\.env(\..+)?$/, line: [SHELL_HASH], strings: [DQ_ML, raw("'", "'", ml)] },
  ignore: {
    group: "config",
    ext: ["gitignore", "dockerignore", "npmignore", "eslintignore", "prettierignore", "gitattributes", "helmignore"],
    names: [".gitignore", ".dockerignore", ".npmignore", ".eslintignore", ".prettierignore", ".stylelintignore", ".vercelignore", ".gcloudignore", ".slugignore", ".gitattributes", ".helmignore", "CODEOWNERS"],
    line: [{ open: "#", lineStart: true }],
  },
  xml: {
    group: "config",
    ext: ["xml", "svg", "xsd", "xsl", "xslt", "plist", "xaml", "csproj", "fsproj", "vbproj", "props", "targets", "resx", "storyboard", "xib", "wsdl"],
    block: [HTML_COMMENT],
    skip: [/<!\[CDATA\[[\s\S]*?\]\]>/],
  },
};

// Comments a tool reads. Tested on the comment's text with its markers stripped.
const DIRECTIVE = new RegExp(
  "^(" +
    [
      String.raw`eslint-(disable|enable)|eslint\s|@ts-(expect-error|ignore|nocheck|check)\b|prettier-ignore|biome-ignore|oxlint-(disable|enable)`,
      String.raw`deno-(lint|fmt)-ignore|dprint-ignore|stylelint-(disable|enable)|(istanbul|c8|v8)\s+ignore|@(vitest|jest)-environment\s`,
      String.raw`@jsx(ImportSource|Runtime|Frag)?\s|@flow\b|@noflow\b|@refresh\s|@format\b|@prettier\b|[#@]\s*source(Mapping)?URL=`,
      String.raw`webpack[A-Z]\w*:|turbopackIgnore:|@vite-ignore|[#@]__(PURE|NO_SIDE_EFFECTS|INLINE)__|<reference\s|<amd-(module|dependency)`,
      String.raw`svelte-ignore|@vue-(ignore|skip|expect-error)|noqa\b|type:\s*ignore|pyright:|pylint:|mypy:|pragma:|fmt:\s*(off|on|skip)`,
      String.raw`isort:|ruff:|nosec\b|pyre-|pytype:|rubocop:|frozen_string_literal:|(en)?coding[:=]|-\*-.*-\*-|vim?:\s*(set?\s+)?\w+=`,
      String.raw`warn_indent:|shareable_constant_value:|typed:\s*(ignore|false|true|strict|strong)\b|:nocov:|steep:ignore|nolint\b`,
      String.raw`lint:(ignore|file-ignore)\b|NOLINT|clang-format\s+(off|on)|IWYU\s+pragma|LCOV_EXCL|cppcheck-suppress|coverity\[`,
      String.raw`falls?\s?through|noinspection|@formatter:(off|on)|CHECKSTYLE:|NOPMD|NOSONAR|nosemgrep|\$NON-NLS|ktlint-(disable|enable)`,
      String.raw`language=|swiftlint:|swift-format-ignore|sourcery:|ReSharper\s+(disable|restore)|phpcs:|@phpstan-|@psalm-`,
      String.raw`@codeCoverageIgnore|@noinspection|shellcheck\s|shfmt:|luacheck:|yamllint\s|yaml-language-server:|markdownlint-`,
      String.raw`cspell:|spell-checker:|codespell:ignore|gitleaks:allow|trivy:ignore|checkov:skip|tfsec:ignore|kics-scan|hadolint\s`,
      String.raw`htmlhint\s|jscpd:ignore|SPDX-|SAFETY:|@license\b|@preserve\b|@generated\b|<auto-generated`,
    ].join("|") +
    ")",
  "i",
);
// Directives a tool also finds after other text in the same comment.
const DIRECTIVE_ANYWHERE =
  /\b(noqa|type:\s*ignore|pragma:\s*(no\s*(cover|branch)|allowlist)|nosec|NOLINT(NEXTLINE|BEGIN|END)?|nolint|NOSONAR|nosemgrep|gitleaks:allow|pylint:\s*disable|pyright:\s*ignore|fmt:\s*skip|isort:\s*skip|rubocop:(disable|todo)|eslint-disable-(next-)?line|LCOV_EXCL_LINE|codespell:ignore)\b/i;
const LEGAL =
  /copyright|©|\(c\)\s*\d{4}|licen[cs]ed\s+(under|to)|SPDX-License-Identifier|all rights reserved|permission is hereby granted/i;
const GENERATED =
  /@generated\b|DO NOT EDIT|<auto-generated|automatically generated|auto-generated|autogenerated|code generated by/i;
const NON_CODE = new Set(
  "md mdx markdown txt rst adoc asciidoc org png jpg jpeg gif webp avif ico icns bmp tif tiff psd pdf woff woff2 ttf otf eot mp3 mp4 m4a wav ogg webm mov zip gz tgz tar bz2 xz 7z jar war lock sum snap csv tsv map wasm bin exe dll so dylib a o class pyc db sqlite pem crt key".split(
    " ",
  ),
);
const NON_CODE_NAME = /^(LICEN[CS]E|COPYING|NOTICE|AUTHORS|CHANGELOG|CHANGES|README|CONTRIBUTORS|VERSION|PATENTS)/i;
const defaultSkip =
  /(^|\/)(node_modules|bower_components|_generated|generated|__generated__|vendor|third[_-]party|dist|build|out|coverage|target|\.venv|venv|__pycache__|Pods|\.next|\.nuxt|\.svelte-kit|\.turbo|\.gradle|obj)\/|\.min\.(js|css)$|(^|\/)[^/]*\.lock$|(^|\/)(package-lock|npm-shrinkwrap)\.json$|-lock\.ya?ml$|\.pb(\.gw)?\.go$|_pb2(_grpc)?\.pyi?$|\.g\.dart$|\.freezed\.dart$|\.designer\.cs$|^\.agents\/|^\.claude\//;

function cgoPreamble(text, comment, segs) {
  let i = comment.e;
  for (const seg of segs) {
    if (seg.s < i) continue;
    if (seg.kind !== "comment" || !/^\s*$/.test(text.slice(i, seg.s))) break;
    i = seg.e;
  }
  return /^\s*import\s+"C"/.test(text.slice(i, i + 100));
}

// ---------- command line ----------

const argv = process.argv.slice(2);
const option = (name) => {
  const k = argv.indexOf(name);
  return k === -1 ? undefined : argv.splice(k, 2)[1];
};
const extraSkip = option("--skip");
const langOption = option("--lang") ?? "code";
const syntaxOption = option("--syntax");
if (syntaxOption) {
  const mod = await import(pathToFileURL(path.resolve(syntaxOption)).href);
  Object.assign(LANGUAGES, mod.default);
}
const skipped = (f) => defaultSkip.test(f) || (extraSkip ? new RegExp(extraSkip).test(f) : false);
const scope = new Set(langOption.split(",").map((s) => s.trim()));

// ---------- syntax preparation ----------

const sticky = (re) => new RegExp(re.source, re.flags.includes("y") ? re.flags : `${re.flags}y`);
const pattern = (p) => (p instanceof RegExp ? sticky(p) : p);

function prepare(id, lang) {
  return {
    ...lang,
    id,
    name: lang.name ?? id,
    group: lang.group ?? "code",
    line: (lang.line ?? []).map((l) =>
      typeof l === "string" || l instanceof RegExp ? { open: pattern(l) } : { ...l, open: pattern(l.open) },
    ),
    block: (lang.block ?? []).map((b) => {
      const o = Array.isArray(b) ? { open: b[0], close: b[1] } : b;
      return { nested: lang.nested ?? false, ...o, open: pattern(o.open), close: typeof o.close === "function" ? o.close : pattern(o.close) };
    }),
    strings: (lang.strings ?? []).map((s) => ({
      ...s,
      open: pattern(s.open),
      close: typeof s.close === "function" ? s.close : pattern(s.close),
    })),
    skip: (lang.skip ?? []).map(sticky),
    heredoc: lang.heredoc && sticky(lang.heredoc),
    dataEnd: lang.dataEnd && sticky(lang.dataEnd),
    word: sticky(lang.word ?? /[\p{L}\p{N}_$]+/u),
  };
}

const LANG = Object.fromEntries(Object.entries(LANGUAGES).map(([id, lang]) => [id, prepare(id, lang)]));
const byExt = new Map();
const byName = new Map();
for (const lang of Object.values(LANG)) {
  for (const e of lang.ext ?? []) byExt.set(e, lang);
  for (const n of lang.names ?? []) byName.set(n, lang);
}

function languageOf(file, abs) {
  const base = path.basename(file);
  if (byName.has(base)) return byName.get(base);
  for (const lang of Object.values(LANG)) if (lang.namePattern?.test(base)) return lang;
  const ext = path.extname(base).slice(1).toLowerCase();
  if (ext) return byExt.get(ext);
  let head = "";
  try {
    head = readFileSync(abs, "utf8").slice(0, 200).split("\n")[0];
  } catch {
    return undefined;
  }
  if (!head.startsWith("#!")) return undefined;
  return Object.values(LANG).find((lang) => lang.shebang?.test(head));
}

// ---------- lexer ----------

const KEYWORDS = new Set(
  "return typeof instanceof in of new delete void throw case do else yield await and or not if unless when while until".split(" "),
);
const regexAllowed = (prev) => prev === "" || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || KEYWORDS.has(prev);
const seg = (kind, s, e) => ({ kind, s, e });

function at(p, text, i) {
  if (typeof p === "string") return text.startsWith(p, i) ? [p] : null;
  p.lastIndex = i;
  return p.exec(text);
}

const closeOf = (close, m) => (typeof close === "function" ? pattern(close(m)) : close);

function eol(text, i, to) {
  const k = text.indexOf("\n", i);
  return k === -1 || k > to ? to : k;
}

function atLineStart(text, i) {
  let j = i - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t")) j--;
  return j < 0 || text[j] === "\n";
}

function blockEnd(text, from, to, nestOpen, close) {
  if (!nestOpen && typeof close === "string") {
    const k = text.indexOf(close, from);
    return k === -1 || k + close.length > to ? [to, 0] : [k + close.length, close.length];
  }
  let depth = 1;
  let j = from;
  while (j < to) {
    if (nestOpen && text.startsWith(nestOpen, j)) {
      depth++;
      j += nestOpen.length;
      continue;
    }
    const m = at(close, text, j);
    if (m) {
      j += m[0].length;
      if (--depth === 0) return [j, m[0].length];
      continue;
    }
    j++;
  }
  return [to, 0];
}

function scanString(text, s, m, st, spec, to, out) {
  const close = closeOf(st.close, m);
  let j = s + m[0].length;
  let piece = s;
  while (j < to) {
    if (st.interp && text.startsWith(st.interp, j)) {
      j += st.interp.length;
      out.push(seg("string", piece, j));
      j = lexRegion(text, spec, j, to, out, st.interp.endsWith("(") ? ")" : "}");
      piece = j;
      j++;
      continue;
    }
    if (st.escape && text[j] === st.escape) {
      j += 2;
      continue;
    }
    const c = at(close, text, j);
    if (c) {
      j += c[0].length;
      break;
    }
    if (text[j] === "\n" && !st.multiline) break;
    j++;
  }
  j = Math.min(j, to);
  out.push(seg("string", piece, j));
  return j;
}

function regexEnd(text, i, to) {
  let inClass = false;
  for (let j = i + 1; j < to; j++) {
    const c = text[j];
    if (c === "\n") return -1;
    if (c === "\\") j++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j++;
      while (/[a-z]/i.test(text[j] ?? "")) j++;
      return j;
    }
  }
  return -1;
}

function heredocEnd(text, start, to, id, out) {
  const terminator = new RegExp(`^[ \\t]*${id}[ \\t]*[;,)\\]]*[ \\t]*\\r?$`);
  for (let p = start; p < to; ) {
    const k = eol(text, p, to);
    if (terminator.test(text.slice(p, k))) {
      out.push(seg("string", start, k));
      return Math.min(k + 1, to);
    }
    p = k + 1;
  }
  out.push(seg("string", start, to));
  return to;
}

function yamlScalar(text, i) {
  const m = at(/[|>][-+0-9]*[ \t]*(?=#|\r?\n|$)/y, text, i);
  if (!m) return null;
  const lineStart = text.lastIndexOf("\n", i - 1) + 1;
  const before = text.slice(lineStart, i).trimEnd();
  if (!/(^|[:\-?])$/.test(before)) return null;
  // The scalar's lines are those indented deeper than its parent: the key, or the dash of `- |`.
  const indent = before.endsWith("-") ? before.length - 1 : /^[ \t]*(?:-[ \t]+)*/.exec(before)[0].length;
  return { length: m[0].length, indent };
}

function scalarEnd(text, start, to, indent, out) {
  let p = start;
  while (p < to) {
    const k = eol(text, p, to);
    const line = text.slice(p, k);
    if (line.trim() && /^[ \t]*/.exec(line)[0].length <= indent) break;
    p = k + 1;
  }
  p = Math.min(p, to);
  out.push(seg("string", start, p));
  return p;
}

function lexRegion(text, spec, from, to, out, closer) {
  const opener = closer === "}" ? "{" : closer === ")" ? "(" : undefined;
  let depth = 0;
  let i = from;
  let prev = "";
  const pending = [];
  scan: while (i < to) {
    const ch = text[i];
    if (ch === "\n") {
      i++;
      for (const run of pending.splice(0)) i = run(i);
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v") {
      i++;
      continue;
    }
    if (spec.exit && text.startsWith(spec.exit, i)) return i;
    if (i === 0 && /^#!\s*\//.test(text.slice(0, 4))) {
      i = eol(text, 0, to);
      continue;
    }
    const column0 = i === 0 || text[i - 1] === "\n";
    if (spec.dataEnd && column0 && at(spec.dataEnd, text, i)) return to;
    let m;
    for (const re of spec.skip) {
      if ((m = at(re, text, i))) {
        out.push(seg("string", i, i + m[0].length));
        i += m[0].length;
        prev = '"';
        continue scan;
      }
    }
    for (const b of spec.block) {
      if (b.column0 && !column0) continue;
      if (!(m = at(b.open, text, i))) continue;
      const [e, closeLen] = blockEnd(text, i + m[0].length, to, b.nested ? m[0] : null, closeOf(b.close, m));
      out.push({ kind: "comment", block: true, s: i, e, openLen: m[0].length, closeLen, spec });
      i = e;
      continue scan;
    }
    for (const l of spec.line) {
      if (l.lineStart && !atLineStart(text, i)) continue;
      if (l.boundary && i > 0 && !/[\s;|&(){}]/.test(text[i - 1])) continue;
      if (!(m = at(l.open, text, i))) continue;
      let e = eol(text, i, to);
      if (spec.lineEnd) {
        const k = text.indexOf(spec.lineEnd, i);
        if (k !== -1 && k < e) e = k;
      }
      if (text[e - 1] === "\r") e--;
      out.push({ kind: "comment", block: false, s: i, e, openLen: m[0].length, closeLen: 0, spec });
      i = e;
      continue scan;
    }
    if (spec.heredoc && (m = at(spec.heredoc, text, i))) {
      const id = m.groups.id;
      pending.push((start) => heredocEnd(text, start, to, id, out));
      i += m[0].length;
      prev = '"';
      continue;
    }
    if (spec.blockScalars && (ch === "|" || ch === ">")) {
      const scalar = yamlScalar(text, i);
      if (scalar) {
        pending.push((start) => scalarEnd(text, start, to, scalar.indent, out));
        i += scalar.length;
        continue;
      }
    }
    for (const st of spec.strings) {
      if (st.boundary && i > 0 && !/[\s[{,]/.test(text[i - 1])) continue;
      if (!(m = at(st.open, text, i))) continue;
      i = scanString(text, i, m, st, spec, to, out);
      prev = '"';
      continue scan;
    }
    if (spec.regex && ch === "/" && regexAllowed(prev)) {
      const e = regexEnd(text, i, to);
      if (e !== -1) {
        out.push(seg("string", i, e));
        i = e;
        prev = '"';
        continue;
      }
    }
    if (spec.jsx && ch === "<" && regexAllowed(prev)) {
      const e = jsxEnd(text, i, to, spec, out);
      if (e !== -1) {
        i = e;
        prev = ")";
        continue;
      }
    }
    if ((m = at(spec.word, text, i))) {
      prev = m[0];
      i += m[0].length;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer && depth-- === 0) return i;
    prev = ch;
    i++;
  }
  return to;
}

// JSX: text between tags is not code, so `//` and apostrophes there are plain text.
const JSX_NAME = /[\p{L}_$][\p{L}\p{N}_$.:-]*/uy;

function jsxEnd(text, i, to, spec, out) {
  const first = jsxTag(text, i, to, spec, out);
  if (!first || first.closing) return -1;
  if (first.selfClosing) return first.end;
  let depth = 1;
  let j = first.end;
  while (j < to && depth > 0) {
    if (text[j] === "{") {
      j = jsxContainer(text, j, to, spec, out, true);
      continue;
    }
    if (text[j] === "<") {
      const t = jsxTag(text, j, to, spec, out);
      if (t) {
        depth += t.closing ? -1 : t.selfClosing ? 0 : 1;
        j = t.end;
        continue;
      }
    }
    j++;
  }
  return j;
}

function jsxTag(text, i, to, spec, out) {
  const mark = out.length;
  const fail = () => {
    out.length = mark;
    return null;
  };
  let j = i + 1;
  const closing = text[j] === "/";
  if (closing) j++;
  let m = at(JSX_NAME, text, j);
  if (m) j += m[0].length;
  else if (text[j] !== ">") return fail();
  if (m && spec.ts && /^\s+extends\b/.test(text.slice(j, j + 16))) return fail();
  while (j < to) {
    const c = text[j];
    if (/\s/.test(c)) {
      j++;
      continue;
    }
    if (c === ">") return { end: j + 1, closing, selfClosing: false };
    if (text.startsWith("/>", j)) return closing ? fail() : { end: j + 2, closing, selfClosing: true };
    if (text.startsWith("/*", j) || text.startsWith("//", j)) {
      const block = text[j + 1] === "*";
      const k = block ? text.indexOf("*/", j + 2) : eol(text, j, to);
      const e = block ? (k === -1 ? to : k + 2) : k;
      out.push({ kind: "comment", block, s: j, e, openLen: 2, closeLen: block && k !== -1 ? 2 : 0, spec });
      j = e;
      continue;
    }
    if (closing) return fail();
    if (c === "{") {
      j = jsxContainer(text, j, to, spec, out, false);
      continue;
    }
    if (!(m = at(JSX_NAME, text, j))) return fail();
    j += m[0].length;
    while (/\s/.test(text[j] ?? "")) j++;
    if (text[j] !== "=") continue;
    j++;
    while (/\s/.test(text[j] ?? "")) j++;
    if (text[j] === '"' || text[j] === "'") {
      const k = text.indexOf(text[j], j + 1);
      if (k === -1 || k >= to) return fail();
      out.push(seg("string", j, k + 1));
      j = k + 1;
    } else if (text[j] === "{") {
      j = jsxContainer(text, j, to, spec, out, false);
    } else if (text[j] === "<") {
      const e = jsxEnd(text, j, to, spec, out);
      if (e === -1) return fail();
      j = e;
    } else {
      return fail();
    }
  }
  return fail();
}

// A child `{…}` holding only comments is recorded, so `delete` removes it with its braces.
function jsxContainer(text, j, to, spec, out, child) {
  const mark = out.length;
  const close = lexRegion(text, spec, j + 1, to, out, "}");
  const inner = out.slice(mark);
  if (child && inner.length && inner.every((x) => x.kind === "comment")) {
    let rest = text.slice(j + 1, close);
    for (const x of [...inner].reverse()) rest = rest.slice(0, x.s - j - 1) + rest.slice(x.e - j - 1);
    if (!rest.trim()) out.push(seg("container", j, close + 1));
  }
  return Math.min(close + 1, to);
}

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*["']?([^"'\\s>]+)`, "i").exec(tag)?.[1]?.toLowerCase();
}

function scriptLanguage(tag) {
  const lang = attribute(tag, "lang");
  const type = attribute(tag, "type");
  if (lang === "ts" || lang === "typescript") return LANG.typescript;
  if (lang === "tsx") return LANG.tsx;
  if (lang && lang !== "js" && lang !== "jsx" && lang !== "javascript") return undefined;
  if (type && /json|importmap|speculationrules/.test(type)) return LANG.json;
  if (type && !/javascript|ecmascript|module|babel|jsx/.test(type)) return undefined;
  return LANG.javascript;
}

function styleLanguage(tag) {
  return /^(scss|sass|less|styl|stylus)$/.test(attribute(tag, "lang") ?? "") ? LANG.scss : LANG.css;
}

function lexMarkup(text, lang, ext, out) {
  const php = lang.embed === "php";
  let i = 0;
  const front = !php && /^---\r?\n/.exec(text);
  if (front) {
    const end = text.indexOf("\n---", front[0].length);
    const stop = end === -1 ? text.length : end;
    lexRegion(text, ext === "astro" ? LANG.typescript : LANG.yaml, front[0].length, stop, out);
    i = stop + 4;
  }
  const tags = php ? /<!--|<script\b[^>]*>|<style\b[^>]*>|<\?(?:php\b|=)?/gi : /<!--|<script\b[^>]*>|<style\b[^>]*>/gi;
  while (i < text.length) {
    tags.lastIndex = i;
    const m = tags.exec(text);
    if (!m) break;
    const body = m.index + m[0].length;
    if (m[0] === "<!--") {
      const k = text.indexOf("-->", body);
      const e = k === -1 ? text.length : k + 3;
      out.push({ kind: "comment", block: true, s: m.index, e, openLen: 4, closeLen: k === -1 ? 0 : 3, spec: LANG.html });
      i = e;
    } else if (m[0].startsWith("<?")) {
      i = lexRegion(text, lang, body, text.length, out) + 2;
    } else {
      const script = /^<script/i.test(m[0]);
      const end = new RegExp(script ? "</script" : "</style", "gi");
      end.lastIndex = body;
      const stop = end.exec(text)?.index ?? text.length;
      const sub = script ? scriptLanguage(m[0]) : styleLanguage(m[0]);
      if (sub) lexRegion(text, sub, body, stop, out);
      i = stop;
    }
  }
}

function lexFile(text, lang, ext) {
  const out = [];
  if (lang.embed) lexMarkup(text, lang, ext, out);
  else lexRegion(text, lang, 0, text.length, out);
  return out.sort((a, b) => a.s - b.s);
}

// ---------- comments ----------

function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function isDirective(text, c) {
  const body = text.slice(c.s + c.openLen, c.e - c.closeLen);
  if (c.block && c.spec.bangLegal && body.startsWith("!")) return true;
  const own = c.spec.directives;
  if (own && (typeof own === "function" ? own(body.trim(), c) : own.test(body.trim()))) return true;
  return DIRECTIVE.test(body.replace(/^[\s/*#;%!-]+/, "")) || DIRECTIVE_ANYWHERE.test(body);
}

// Comments before the first line of code, grouped by adjacent lines; a group that reads as a
// copyright or license notice is kept.
function legalHeader(text, segs, starts) {
  const header = [];
  let pos = text.startsWith("#!") ? eol(text, 0, text.length) : 0;
  for (const x of segs) {
    if (x.s < pos) continue;
    if (x.kind !== "comment" || !/^\s*(<\?php\b)?\s*$/.test(text.slice(pos, x.s))) break;
    header.push(x);
    pos = x.e;
  }
  const legal = new Set();
  let run = [];
  const flush = () => {
    if (run.some((c) => LEGAL.test(text.slice(c.s, c.e)))) for (const c of run) legal.add(c);
    run = [];
  };
  for (const c of header) {
    if (run.length && lineOf(starts, c.s) > lineOf(starts, run.at(-1).e - 1) + 1) flush();
    run.push(c);
  }
  flush();
  return legal;
}

function analyze(text, lang, ext) {
  const segs = lexFile(text, lang, ext);
  const starts = lineStarts(text);
  const legal = legalHeader(text, segs, starts);
  const comments = segs
    .filter((x) => x.kind === "comment" && !legal.has(x) && !isDirective(text, x) && !x.spec.keep?.(text, x, segs))
    .map((x) => {
      const start = lineOf(starts, x.s);
      const end = lineOf(starts, Math.max(x.s, x.e - 1));
      const lead = text.slice(starts[start - 1], x.s);
      return {
        seg: x,
        start,
        end,
        col: x.s - starts[start - 1] + 1,
        endCol: x.e - starts[end - 1] + 1,
        standalone: (x.spec.jsx ? /^\s*\{?\s*$/ : /^\s*$/).test(lead),
      };
    });
  return { segs, comments };
}

function readSource(file) {
  try {
    const text = readFileSync(path.join(root, file), "utf8");
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

const extOf = (file) => path.extname(file).slice(1).toLowerCase();

function tracked(paths) {
  const args = ["ls-files", "--full-name", "-z", "--", ...(paths.length ? paths : [":/"])];
  return execFileSync("git", args, { maxBuffer: 1 << 28 })
    .toString()
    .split("\0")
    .filter((f) => f && !skipped(f));
}

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const inScope = (lang) => scope.has("all") || scope.has(lang.group) || scope.has(lang.name) || scope.has(lang.id);

function list(paths) {
  const blocks = [];
  const scanned = new Map();
  const outOfScope = new Map();
  const unknown = new Map();
  const generated = [];
  for (const file of tracked(paths)) {
    const lang = languageOf(file, path.join(root, file));
    const ext = extOf(file);
    if (!lang) {
      if (!NON_CODE.has(ext) && !NON_CODE_NAME.test(path.basename(file))) count(unknown, ext ? `.${ext}` : "(no extension)");
      continue;
    }
    if (!inScope(lang)) {
      count(outOfScope, lang.name);
      continue;
    }
    const text = readSource(file);
    if (text === undefined) continue;
    if (GENERATED.test(text.split("\n", 10).join("\n"))) {
      generated.push(file);
      continue;
    }
    const lines = text.split("\n");
    const fileBlocks = [];
    let current;
    for (const c of analyze(text, lang, ext).comments) {
      if (current && c.standalone && current.standalone && c.start === current.end + 1) {
        current.end = c.end;
        current.endCol = c.endCol;
      } else {
        current = { file, lang: c.seg.spec.name, start: c.start, end: c.end, col: c.col, endCol: c.endCol, standalone: c.standalone };
        fileBlocks.push(current);
      }
    }
    const stat = scanned.get(lang.name) ?? { files: 0, blocks: 0 };
    stat.files++;
    stat.blocks += fileBlocks.length;
    scanned.set(lang.name, stat);
    for (const b of fileBlocks) {
      b.text = lines.slice(b.start - 1, b.end).join("\n");
      blocks.push(b);
    }
  }
  const summary = (map, size, show) =>
    [...map].sort((a, b) => size(b[1]) - size(a[1])).map(([k, v]) => `${k} (${show(v)})`).join(", ") || "none";
  const files = (n) => `${n} file${n === 1 ? "" : "s"}`;
  console.error(
    [
      `Scanned: ${summary(scanned, (v) => v.blocks, (v) => `${files(v.files)}, ${v.blocks} blocks`)}`,
      `Out of scope (add with --lang): ${summary(outOfScope, (v) => v, files)}`,
      `No syntax for (add with --syntax): ${summary(unknown, (v) => v, files)}`,
      `Skipped as generated: ${generated.length ? generated.join(", ") : "none"}`,
    ].join("\n"),
  );
  return blocks.map(({ standalone, ...b }, i) => ({ id: `C${String(i + 1).padStart(4, "0")}`, ...b }));
}

// ---------- delete ----------

const notBefore = (l1, c1, l2, c2) => l1 > l2 || (l1 === l2 && c1 >= c2);

function widen(text, s, e) {
  const lineStart = text.lastIndexOf("\n", s - 1) + 1;
  let lineEnd = text.indexOf("\n", e);
  if (lineEnd === -1) lineEnd = text.length;
  const blankBefore = /^\s*$/.test(text.slice(lineStart, s));
  const blankAfter = /^\s*$/.test(text.slice(e, lineEnd));
  if (blankBefore && blankAfter) return { s: lineStart, e: Math.min(lineEnd + 1, text.length), whole: true };
  if (blankAfter) {
    while (s > lineStart && /[ \t]/.test(text[s - 1])) s--;
    return { s, e, insert: "" };
  }
  if (/^[ \t]*[)\]},;]/.test(text.slice(e, lineEnd))) {
    while (s > lineStart && /[ \t]/.test(text[s - 1])) s--;
    while (e < lineEnd && /[ \t]/.test(text[e])) e++;
    return { s, e, insert: "" };
  }
  while (e < lineEnd && /[ \t]/.test(text[e])) e++;
  const glue = /[\p{L}\p{N}_$]/u.test(text[s - 1] ?? "") && /[\p{L}\p{N}_$]/u.test(text[e] ?? "");
  return { s, e, insert: glue ? " " : "" };
}

// After removing whole lines at `s`, drop a blank line that now doubles the one above it.
function dropDoubledBlank(out, s) {
  const k = out.indexOf("\n", s);
  if (k === -1 || out.slice(s, k).trim()) return out;
  const prevStart = out.lastIndexOf("\n", s - 2) + 1;
  if (s > 0 && out.slice(prevStart, s - 1).trim()) return out;
  return out.slice(0, s) + out.slice(k + 1);
}

function remove(blocks) {
  const byFile = new Map();
  for (const b of blocks) byFile.set(b.file, [...(byFile.get(b.file) ?? []), b]);
  const touched = [];
  for (const [file, fileBlocks] of byFile) {
    const lang = languageOf(file, path.join(root, file));
    const text = readSource(file);
    if (!lang || text === undefined) throw new Error(`${file}: cannot read it or tell its language.`);
    const lines = text.split("\n");
    for (const b of fileBlocks) {
      if (b.text !== undefined && lines.slice(b.start - 1, b.end).join("\n") !== b.text) {
        throw new Error(`${file}:${b.start} changed since it was listed; list again.`);
      }
    }
    const { segs, comments } = analyze(text, lang, extOf(file));
    const chosen = comments.filter((c) =>
      fileBlocks.some(
        (b) => notBefore(c.start, c.col, b.start, b.col ?? 0) && notBefore(b.end, b.endCol ?? Infinity, c.end, c.endCol),
      ),
    );
    const chosenSegs = new Set(chosen.map((c) => c.seg));
    const containers = segs.filter((x) => x.kind === "container");
    const ranges = new Map();
    for (const { seg: c } of chosen) {
      const k = containers.find((x) => x.s <= c.s && c.e <= x.e);
      const whole = k && segs.every((x) => x.kind !== "comment" || x.s < k.s || x.e > k.e || chosenSegs.has(x));
      const [s, e] = whole ? [k.s, k.e] : [c.s, c.e];
      ranges.set(s, [s, e]);
    }
    let out = text;
    let floor = Infinity;
    for (const [s, e] of [...ranges.values()].sort((a, b) => b[0] - a[0])) {
      if (e > floor) continue;
      const w = widen(out, s, e);
      out = out.slice(0, w.s) + (w.insert ?? "") + out.slice(w.e);
      if (w.whole) out = dropDoubledBlank(out, w.s);
      floor = w.s;
    }
    if (/\n\n+$/.test(out) && !/\n\n+$/.test(text)) out = out.replace(/\n+$/, "\n");
    writeFileSync(path.join(root, file), out);
    touched.push(file);
  }
  return touched;
}

// ---------- verify ----------

// The file with comments removed and whitespace collapsed; strings are kept verbatim.
function codeStream(text, lang, ext) {
  const parts = [];
  let code = "";
  let pos = 0;
  const flush = () => {
    const c = code
      .replace(/\s+/g, " ")
      .replace(/ (?=[^\p{L}\p{N}_$])|(?<=[^\p{L}\p{N}_$]) /gu, "")
      .trim()
      .replace(/,(?=[\])}])/g, "");
    if (c) parts.push(c);
    code = "";
  };
  for (const x of lexFile(text, lang, ext)) {
    if (x.s < pos) continue;
    code += text.slice(pos, x.s);
    if (x.kind === "string") {
      flush();
      parts.push(`\u0001${text.slice(x.s, x.e)}`);
    } else {
      code += " ";
    }
    pos = x.e;
  }
  code += text.slice(pos);
  flush();
  return parts.join("\u0000");
}

function verify(base) {
  const changed = execFileSync("git", ["diff", "--name-only", "-z", base], { cwd: root, maxBuffer: 1 << 28 })
    .toString()
    .split("\0")
    .filter((f) => f && !skipped(f));
  const differ = [];
  let checked = 0;
  for (const file of changed) {
    const lang = languageOf(file, path.join(root, file));
    const after = readSource(file);
    if (!lang || after === undefined) continue;
    let before;
    try {
      before = execFileSync("git", ["show", `${base}:${file}`], { cwd: root, maxBuffer: 1 << 28 }).toString();
    } catch {
      continue;
    }
    checked++;
    if (codeStream(before, lang, extOf(file)) !== codeStream(after, lang, extOf(file))) differ.push(file);
  }
  return { checked, differ };
}

// ---------- main ----------

const [command, ...args] = argv;
if (command === "list") {
  console.log(JSON.stringify(list(args), null, 1));
} else if (command === "delete") {
  console.log(remove(JSON.parse(readFileSync(args[0], "utf8"))).join("\n"));
} else if (command === "verify") {
  const result = verify(args[0] ?? "HEAD");
  console.log(JSON.stringify(result, null, 1));
  if (result.differ.length) process.exit(1);
} else if (command === "languages") {
  for (const lang of Object.values(LANG)) {
    const files = [...(lang.ext ?? []).map((e) => `.${e}`), ...(lang.names ?? [])].join(" ");
    console.log(`${lang.name.padEnd(12)} ${lang.group.padEnd(7)} ${files}`);
  }
} else {
  console.error(
    "Usage: comments.mjs list [paths…] | delete <blocks.json> | verify [base] | languages\n" +
      "  [--lang <names|code|config|all>] [--skip <regex>] [--syntax <module.mjs>]",
  );
  process.exit(2);
}

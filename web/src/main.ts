import "./style.css";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import {
  createElement,
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode2,
  Image,
  Film,
  Music2,
  Archive,
  Search,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Monitor,
  HardDrive,
  Command,
  X,
  Check,
  Link2,
  CircleAlert,
  type IconNode,
} from "lucide";

type Entry = {
  name: string;
  path: string;
  kind: string;
  size: number | null;
  created: string | null;
  modified: string | null;
  symlink: boolean;
  accessible: boolean;
};
type Listing = {
  entries: Entry[];
  path: string;
  rootName: string;
  rootPath: string;
  version: string;
};
type Filter = "all" | "documents" | "media" | "code";
type Sort = "name" | "kind" | "size" | "created" | "modified";

const app = document.querySelector<HTMLDivElement>("#app")!;
const icons: Record<string, IconNode> = {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode2,
  Image,
  Film,
  Music2,
  Archive,
  Search,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Monitor,
  HardDrive,
  Command,
  X,
  Check,
  Link2,
  CircleAlert,
};
const icon = (name: string, cls = "") => {
  const svg = createElement(icons[name] || File);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `icon ${cls}`);
  return svg.outerHTML;
};
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const urlFor = (path: string) =>
  path ? `/?path=${encodeURIComponent(path)}` : "/";
const fileURL = (path: string, download = false) =>
  `${download ? "/download" : "/file"}?path=${encodeURIComponent(path)}`;
const extension = (name: string) =>
  name.split(".").length > 1 ? name.split(".").pop()!.toLowerCase() : "";
const isMD = (name: string) => /\.(md|markdown|mdown)$/i.test(name);
const isImage = (name: string) =>
  /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(name);
const isVideo = (name: string) => /\.(mp4|webm|ogv|mov)$/i.test(name);
const isAudio = (name: string) => /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(name);
const isCode = (name: string) =>
  /\.(js|ts|tsx|jsx|json|yaml|yml|toml|xml|html|css|scss|py|go|rs|sh|fish|sql|c|cpp|h|java|rb|php|swift)$/i.test(
    name,
  );
const isDocument = (name: string) =>
  isMD(name) || /\.(txt|pdf|rst|csv|log|docx?|odt|rtf)$/i.test(name);
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const pageSize = 100;
let listing: Listing | null = null;
let filter: Filter = "all";
let query = "";
let hidden = false;
let sort: Sort = "name";
let descending = false;
let page = 0;
let currentFile: Entry | null = null;
let content = "";
let source = false;
let routeEpoch = 0;
let controller = new AbortController();
let theme = "light";
try {
  theme =
    localStorage.getItem("servedir-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {
  /* Browser storage may be disabled. */
}
document.documentElement.dataset.theme = theme;

app.innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="/" data-path="" aria-label="servedir home"><span class="brand-mark">${icon("FolderOpen")}</span><span>servedir<span class="brand-dot">.</span></span></a>
    <div class="sidebar-body">
      <p class="eyebrow">WORKSPACE</p>
      <a class="workspace" href="/" data-path=""><span class="workspace-icon">${icon("HardDrive")}</span><span><strong id="root-name">Local files</strong><small>On this computer</small></span>${icon("ChevronRight")}</a>
      <div class="nav-section"><p class="eyebrow">IN THIS FOLDER</p>
        <nav class="filters" aria-label="Filter files">
          <button data-filter="all" class="active" aria-label="All files" title="All files">${icon("Folder")}<span>All files</span><span class="nav-count" id="count-all"></span></button>
          <button data-filter="documents" aria-label="Documents" title="Documents">${icon("FileText")}<span>Documents</span><span class="nav-count" id="count-documents"></span></button>
          <button data-filter="media" aria-label="Images and media" title="Images and media">${icon("Image")}<span>Images & media</span><span class="nav-count" id="count-media"></span></button>
          <button data-filter="code" aria-label="Code and data" title="Code and data">${icon("FileCode2")}<span>Code & data</span><span class="nav-count" id="count-code"></span></button>
        </nav>
      </div>
      <div class="sidebar-note"><span class="note-symbol">${icon("Eye")}</span><p>A little home<br>for your files.</p><small>Browse, read, explore.<br>Everything stays on your computer.</small></div>
    </div>
    <div class="sidebar-footer"><div class="local-status"><span class="status-dot"></span><span>Just localhost</span>${icon("Monitor")}</div><div class="footer-controls"><small id="version">servedir</small><button class="icon-button" id="theme-toggle" aria-label="Switch to dark theme">${icon("Moon")}</button></div></div>
  </aside>
  <div class="main-shell"><header class="topbar"><div class="topbar-label">${icon("FolderOpen")}<span>File explorer</span></div><span class="local-badge"><span class="status-dot"></span>LOCAL SESSION</span></header><main id="main" tabindex="-1"></main><div class="app-footer"><span>Made for the folder you’re in.</span><span>${icon("Command")} <kbd>/</kbd> to search <span class="footer-divider">·</span> <kbd>Esc</kbd> to go back</span></div></div>
  <div id="toast" class="toast" role="status"></div>`;

const main = document.querySelector<HTMLElement>("#main")!;
function bytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[i]}`;
}
function dateCell(value: string | null) {
  return value
    ? `<time datetime="${esc(value)}" title="${esc(new Date(value).toLocaleString())}">${esc(dateFormat.format(new Date(value)))}</time>`
    : '<span class="unavailable" title="Creation time is not available from this filesystem">—</span>';
}
function kind(e: Entry) {
  if (!e.accessible) return "Unavailable";
  if (e.kind === "directory") return "Folder";
  if (isMD(e.name)) return "Markdown";
  const ext = extension(e.name);
  return (
    (
      {
        txt: "Text",
        jpg: "JPEG image",
        jpeg: "JPEG image",
        png: "PNG image",
        svg: "SVG image",
        pdf: "PDF",
        json: "JSON",
        csv: "CSV",
        zip: "Archive",
        tar: "Archive",
        gz: "Archive",
      } as Record<string, string>
    )[ext] || (ext ? ext.toUpperCase() : "File")
  );
}
function fileIcon(e: Entry) {
  if (e.kind === "directory") return "Folder";
  if (isImage(e.name)) return "Image";
  if (isVideo(e.name)) return "Film";
  if (isAudio(e.name)) return "Music2";
  if (isCode(e.name)) return "FileCode2";
  if (/\.(zip|tar|gz|7z|rar)$/i.test(e.name)) return "Archive";
  return isDocument(e.name) ? "FileText" : "File";
}
function iconTone(e: Entry) {
  if (e.kind === "directory") return "folder";
  if (isMD(e.name)) return "markdown";
  if (isImage(e.name) || isVideo(e.name) || isAudio(e.name)) return "media";
  if (isCode(e.name)) return "code";
  if (extension(e.name) === "pdf") return "pdf";
  return "other";
}
function matchesFilter(e: Entry, f: Filter) {
  if (f === "all") return true;
  if (e.kind === "directory") return false;
  return f === "documents"
    ? isDocument(e.name)
    : f === "media"
      ? isImage(e.name) || isVideo(e.name) || isAudio(e.name)
      : isCode(e.name);
}
function breadcrumb(path: string) {
  const parts = path.split("/").filter(Boolean);
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/" data-path="">${icon("HardDrive")}${esc(listing?.rootName || "Home")}</a>${parts.map((part, i) => `${icon("ChevronRight")}<a href="${urlFor(parts.slice(0, i + 1).join("/"))}" data-path="${esc(parts.slice(0, i + 1).join("/"))}" ${i === parts.length - 1 ? 'aria-current="page"' : ""}>${esc(part)}</a>`).join("")}</nav>`;
}
async function api<T>(endpoint: string, path: string): Promise<T> {
  const response = await fetch(
    `/api/${endpoint}?path=${encodeURIComponent(path)}`,
    { signal: controller.signal },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message || "Could not read this file.");
  return data;
}
function navigate(path: string, hash = "") {
  history.pushState(null, "", urlFor(path) + hash);
  query = "";
  page = 0;
  filter = "all";
  void route();
}
function updateSidebar() {
  const entries =
    listing?.entries.filter((e) => hidden || !e.name.startsWith(".")) || [];
  for (const f of ["all", "documents", "media", "code"] as Filter[]) {
    document.querySelector(`#count-${f}`)!.textContent = String(
      entries.filter((e) => matchesFilter(e, f)).length,
    );
    const button = document.querySelector<HTMLButtonElement>(
      `[data-filter="${f}"]`,
    )!;
    button.classList.toggle("active", filter === f && !currentFile);
    button.setAttribute("aria-pressed", String(filter === f && !currentFile));
  }
  if (listing) {
    document.querySelector("#root-name")!.textContent = listing.rootName;
    document
      .querySelector(".workspace")!
      .setAttribute("title", listing.rootPath);
    document.querySelector("#version")!.textContent = `v${listing.version}`;
  }
}
function renderDirectory() {
  if (!listing) return;
  currentFile = null;
  document.title = `${listing.path.split("/").pop() || listing.rootName} · servedir`;
  const title = listing.path.split("/").pop() || listing.rootName;
  main.innerHTML = `${breadcrumb(listing.path)}
    <section class="directory-heading"><div><p class="eyebrow">YOUR LOCAL WORKSPACE</p><h1>${esc(title)}</h1><p class="subtitle" id="directory-summary"></p></div><span class="heading-illustration">${icon("FolderOpen")}</span></section>
    <div class="toolbar"><label class="search-box">${icon("Search")}<input id="search" type="search" placeholder="Find a file in this folder…" aria-label="Find a file in this folder" value="${esc(query)}" autocomplete="off"><kbd>/</kbd></label><div class="toolbar-actions"><button class="button subtle" id="hidden-toggle" aria-label="Hidden files" title="Show or hide hidden files" aria-pressed="${hidden}">${icon(hidden ? "Eye" : "EyeOff")}<span>Hidden files</span></button><button class="button icon-only" id="refresh" aria-label="Refresh folder">${icon("RefreshCw")}</button></div></div>
    <section class="file-panel" aria-label="Directory contents"><div class="table-scroll"><table><thead><tr>${(
      [
        ["name", "Name"],
        ["kind", "Type"],
        ["size", "Size"],
        ["created", "Created"],
        ["modified", "Modified"],
      ] as [Sort, string][]
    )
      .map(
        ([key, label]) =>
          `<th scope="col" data-column="${key}"><button data-sort="${key}">${label}<span class="sort-icon"></span></button></th>`,
      )
      .join(
        "",
      )}<th scope="col" class="row-action"><span class="sr-only">Actions</span></th></tr></thead><tbody id="file-rows"></tbody></table></div><div id="empty-state"></div><footer class="table-footer"><span id="visible-summary"></span><div id="pagination"></div></footer></section>
    <p class="directory-hint">${icon("FileText")} Markdown opens as a document, diagrams and all.<span>Creation dates appear when your filesystem provides them.</span></p>`;
  document
    .querySelector<HTMLInputElement>("#search")!
    .addEventListener("input", (e) => {
      query = (e.target as HTMLInputElement).value;
      page = 0;
      renderRows();
    });
  document.querySelector("#hidden-toggle")!.addEventListener("click", () => {
    hidden = !hidden;
    page = 0;
    renderDirectory();
  });
  document
    .querySelector("#refresh")!
    .addEventListener("click", () => void route());
  document
    .querySelectorAll<HTMLButtonElement>("[data-sort]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const next = button.dataset.sort as Sort;
        descending =
          sort === next
            ? !descending
            : next === "modified" || next === "created";
        sort = next;
        page = 0;
        renderRows();
      }),
    );
  renderRows();
}
function renderRows() {
  if (!listing) return;
  const visible = listing.entries.filter(
    (e) => hidden || !e.name.startsWith("."),
  );
  const folders = visible.filter((e) => e.kind === "directory").length;
  document.querySelector("#directory-summary")!.textContent =
    `${folders} ${folders === 1 ? "folder" : "folders"} · ${visible.length - folders} ${visible.length - folders === 1 ? "file" : "files"} · ${bytes(visible.reduce((n, e) => n + (e.size || 0), 0))} in files`;
  const entries = visible
    .filter(
      (e) =>
        matchesFilter(e, filter) &&
        e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => {
      if ((a.kind === "directory") !== (b.kind === "directory"))
        return a.kind === "directory" ? -1 : 1;
      let cmp = 0;
      if (sort === "name" || sort === "kind")
        cmp = collator.compare(
          sort === "name" ? a.name : kind(a),
          sort === "name" ? b.name : kind(b),
        );
      else {
        const av = a[sort],
          bv = b[sort];
        if (av === null && bv !== null) return 1;
        if (bv === null && av !== null) return -1;
        cmp =
          sort === "size"
            ? Number(av || 0) - Number(bv || 0)
            : new Date(av || 0).getTime() - new Date(bv || 0).getTime();
      }
      return (descending ? -cmp : cmp) || collator.compare(a.name, b.name);
    });
  page = Math.min(page, Math.max(0, Math.ceil(entries.length / pageSize) - 1));
  const rows = entries.slice(page * pageSize, (page + 1) * pageSize);
  document.querySelector("#file-rows")!.innerHTML = rows
    .map(
      (e) =>
        `<tr class="${e.accessible ? "" : "disabled-row"}"><td class="name-cell">${e.accessible ? `<a class="file-link" href="${urlFor(e.path)}" data-path="${esc(e.path)}">` : '<span class="file-link" title="Unavailable, unsupported, or outside this directory">'}<span class="file-icon ${iconTone(e)}">${icon(fileIcon(e))}</span><span class="file-name">${esc(e.name)}</span>${e.symlink ? icon("Link2", "symlink-icon") : ""}${e.accessible ? "</a>" : "</span>"}</td><td class="kind-cell">${esc(kind(e))}</td><td class="size-cell">${bytes(e.size)}</td><td class="date-cell">${dateCell(e.created)}</td><td class="date-cell">${dateCell(e.modified)}</td><td class="row-action">${e.kind === "directory" && e.accessible ? `<a class="icon-button" href="${urlFor(e.path)}" data-path="${esc(e.path)}" aria-label="Open ${esc(e.name)}">${icon("ChevronRight")}</a>` : e.accessible ? `<a class="icon-button" href="${fileURL(e.path, true)}" download aria-label="Download ${esc(e.name)}">${icon("Download")}</a>` : icon("CircleAlert")}</td></tr>`,
    )
    .join("");
  document.querySelector("#empty-state")!.innerHTML = entries.length
    ? ""
    : `<div class="empty-state"><span class="empty-icon">${icon(query || filter !== "all" ? "Search" : "FolderOpen")}</span><h2>${query || filter !== "all" ? "No matching files" : "A little room to breathe"}</h2><p>${query || filter !== "all" ? "Try another name or choose All files." : "This folder is empty. Files you add will appear when you refresh."}</p></div>`;
  document.querySelector("#visible-summary")!.textContent =
    `${entries.length ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, entries.length)} of ${entries.length} items${visible.length !== listing.entries.length ? ` · ${listing.entries.length - visible.length} hidden` : ""}`;
  document.querySelector("#pagination")!.innerHTML =
    entries.length > pageSize
      ? `<button class="icon-button" id="previous-page" aria-label="Previous page" ${page === 0 ? "disabled" : ""}>${icon("ChevronLeft")}</button><span>${page + 1} / ${Math.ceil(entries.length / pageSize)}</span><button class="icon-button" id="next-page" aria-label="Next page" ${(page + 1) * pageSize >= entries.length ? "disabled" : ""}>${icon("ChevronRight")}</button>`
      : `<span class="footer-local">${icon("HardDrive")} Stored locally</span>`;
  document.querySelector("#previous-page")?.addEventListener("click", () => {
    page--;
    renderRows();
  });
  document.querySelector("#next-page")?.addEventListener("click", () => {
    page++;
    renderRows();
  });
  document.querySelectorAll<HTMLElement>("[data-column]").forEach((th) => {
    const active = th.dataset.column === sort;
    th.setAttribute(
      "aria-sort",
      active ? (descending ? "descending" : "ascending") : "none",
    );
    th.querySelector(".sort-icon")!.innerHTML = active
      ? icon(descending ? "ArrowDown" : "ArrowUp")
      : "";
  });
  updateSidebar();
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight: (text, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(text, { language: lang }).value;
      } catch {
        /* Plain text is always a safe fallback. */
      }
    }
    return esc(text);
  },
});
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  if (tokens[idx].info.trim().toLowerCase() === "mermaid")
    return `<div class="diagram" data-diagram="true"><span class="diagram-label">DIAGRAM</span><pre class="mermaid-source">${esc(tokens[idx].content)}</pre><div class="diagram-output"></div></div>`;
  return defaultFence(tokens, idx, options, env, self);
};

function resolveLocal(
  ref: string,
  docPath: string,
): { path: string; hash: string } | null {
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith("//")) return null;
    const base = new URL(
      "https://servedir.invalid/" +
        docPath.split("/").map(encodeURIComponent).join("/"),
    );
    const resolved = new URL(ref, base);
    return {
      path: decodeURIComponent(resolved.pathname.slice(1)),
      hash: resolved.hash,
    };
  } catch {
    return null;
  }
}

function rewriteDocument(article: HTMLElement, docPath: string) {
  const headings = new Set<string>();
  article.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6").forEach((h) => {
    const slug =
      (h.textContent || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s+/g, "-") || "section";
    let id = slug;
    let n = 0;
    while (headings.has(id)) id = `${slug}-${++n}`;
    h.id = id;
    headings.add(id);
  });
  article.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const ref = a.getAttribute("href")!;
    if (ref.startsWith("#")) return;
    const local = resolveLocal(ref, docPath);
    if (local) {
      a.href = urlFor(local.path) + local.hash;
      a.dataset.path = local.path;
      a.dataset.hash = local.hash;
    } else {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  });
  article.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const local = resolveLocal(img.getAttribute("src") || "", docPath);
    if (local) img.src = fileURL(local.path);
    img.loading = "lazy";
  });
}

async function renderDiagrams(article: HTMLElement, epoch: number) {
  const blocks = article.querySelectorAll<HTMLElement>("[data-diagram]");
  if (!blocks.length) return;
  try {
    const { default: mermaid } = await import("mermaid");
    if (epoch !== routeEpoch || !article.isConnected) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "neutral",
      suppressErrorRendering: true,
      maxTextSize: 50000,
      fontFamily: "system-ui, sans-serif",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "htmlLabels",
        "flowchart",
      ],
    });
    for (const [i, block] of [...blocks].entries()) {
      if (epoch !== routeEpoch || !article.isConnected) return;
      const code = block.querySelector<HTMLElement>(".mermaid-source")!;
      try {
        const { svg } = await mermaid.render(
          `diagram-${epoch}-${i}-${Date.now()}`,
          code.textContent || "",
        );
        if (epoch !== routeEpoch || !article.isConnected) return;
        block.querySelector(".diagram-output")!.innerHTML = DOMPurify.sanitize(
          svg,
          { USE_PROFILES: { svg: true, svgFilters: true } },
        );
        code.hidden = true;
      } catch {
        const error = document.createElement("p");
        error.className = "diagram-error";
        error.textContent =
          "This diagram could not be rendered. Its source is shown below.";
        block.insertBefore(error, code);
      }
    }
  } catch {
    toast(
      "The diagram renderer could not load. Diagram source is still available.",
    );
  }
}

function renderViewer(e: Entry, epoch: number) {
  currentFile = e;
  source = false;
  content = "";
  document.title = `${e.name} · servedir`;
  const parent = e.path.split("/").slice(0, -1).join("/");
  main.innerHTML = `${breadcrumb(e.path)}<section class="viewer-heading"><div class="viewer-title"><a class="button icon-only" href="${urlFor(parent)}" data-path="${esc(parent)}" aria-label="Back to folder">${icon("ArrowLeft")}</a><span class="file-icon ${iconTone(e)}">${icon(fileIcon(e))}</span><div><h1>${esc(e.name)}</h1><p class="subtitle">${esc(kind(e))}<span>·</span>${bytes(e.size)}<span>·</span>Modified ${dateCell(e.modified)}</p></div></div><a class="button primary" href="${fileURL(e.path, true)}" download>${icon("Download")}<span>Download</span></a></section><section class="preview-panel"><header class="preview-toolbar"><div class="tabs" role="tablist" aria-label="File view"><button id="preview-tab" role="tab" aria-selected="true">${icon("Eye")}Preview</button><button id="source-tab" role="tab" aria-selected="false">${icon("FileCode2")}Source</button></div><button class="button subtle" id="copy-link" aria-label="Copy link" title="Copy link">${icon("Link2")}<span>Copy link</span></button></header><div id="preview-content" role="tabpanel" aria-label="File content"><div class="loading"><span class="spinner"></span>Opening your file…</div></div></section>`;
  updateSidebar();
  document.querySelector("#copy-link")!.addEventListener(
    "click",
    () =>
      void navigator.clipboard
        .writeText(location.href)
        .then(() => toast("Link copied"))
        .catch(() => toast("Copy the address from your browser.")),
  );
  document.querySelector("#preview-tab")!.addEventListener("click", () => {
    source = false;
    void renderFileContent(e, epoch);
  });
  document.querySelector("#source-tab")!.addEventListener("click", () => {
    source = true;
    void renderFileContent(e, epoch);
  });
  void loadFile(e, epoch);
}
async function loadFile(e: Entry, epoch: number) {
  const media =
    isImage(e.name) ||
    isVideo(e.name) ||
    isAudio(e.name) ||
    extension(e.name) === "pdf";
  if (media) {
    document.querySelector("#source-tab")!.setAttribute("hidden", "");
    await renderFileContent(e, epoch);
    return;
  }
  try {
    const result = await api<{ content: string }>("preview", e.path);
    if (epoch !== routeEpoch) return;
    content = result.content;
    await renderFileContent(e, epoch);
  } catch (error) {
    if (epoch !== routeEpoch) return;
    document.querySelector("#source-tab")!.setAttribute("hidden", "");
    document.querySelector("#preview-content")!.innerHTML =
      `<div class="empty-state"><span class="empty-icon">${icon(fileIcon(e))}</span><h2>Keep the original close</h2><p>${esc((error as Error).message)}</p><a class="button primary" href="${fileURL(e.path, true)}" download>${icon("Download")}Download file</a></div>`;
  }
}
async function renderFileContent(e: Entry, epoch: number) {
  if (epoch !== routeEpoch) return;
  const panel = document.querySelector<HTMLElement>("#preview-content")!;
  document
    .querySelector("#preview-tab")!
    .setAttribute("aria-selected", String(!source));
  document
    .querySelector("#source-tab")!
    .setAttribute("aria-selected", String(source));
  if (
    source ||
    (!isMD(e.name) &&
      !isImage(e.name) &&
      !isVideo(e.name) &&
      !isAudio(e.name) &&
      extension(e.name) !== "pdf")
  ) {
    const lang = extension(e.name);
    const highlighted =
      content.length <= 200000 && hljs.getLanguage(lang)
        ? hljs.highlight(content, { language: lang }).value
        : esc(content);
    panel.innerHTML = `<div class="source-meta">${content.split("\n").length} lines <span>UTF-8</span><button class="button subtle" id="copy-source">${icon("FileText")}Copy text</button></div><pre class="source-code"><code>${highlighted}</code></pre>`;
    document.querySelector("#copy-source")!.addEventListener(
      "click",
      () =>
        void navigator.clipboard
          .writeText(content)
          .then(() => toast("Text copied"))
          .catch(() => toast("Select the text and copy it from your browser.")),
    );
  } else if (isMD(e.name)) {
    panel.innerHTML = `<article class="markdown-body">${DOMPurify.sanitize(md.render(content))}</article>`;
    const article = panel.querySelector<HTMLElement>("article")!;
    rewriteDocument(article, e.path);
    await renderDiagrams(article, epoch);
    if (epoch !== routeEpoch) return;
    if (location.hash) {
      try {
        document
          .getElementById(decodeURIComponent(location.hash.slice(1)))
          ?.scrollIntoView();
      } catch {
        /* Invalid URL fragment. */
      }
    }
  } else if (isImage(e.name)) {
    panel.innerHTML = `<div class="image-preview"><img src="${fileURL(e.path)}" alt="${esc(e.name)}"></div>`;
  } else if (isVideo(e.name)) {
    panel.innerHTML = `<div class="media-preview"><video src="${fileURL(e.path)}" controls preload="metadata">Your browser cannot play this video.</video></div>`;
  } else if (isAudio(e.name)) {
    panel.innerHTML = `<div class="audio-preview">${icon("Music2")}<h2>${esc(e.name)}</h2><audio src="${fileURL(e.path)}" controls preload="metadata">Your browser cannot play this audio.</audio></div>`;
  } else {
    panel.innerHTML = `<iframe class="pdf-preview" src="${fileURL(e.path)}" title="${esc(e.name)}"></iframe><p class="pdf-note">PDF preview uses your browser’s built-in viewer. You can also download the original.</p>`;
  }
}

async function route() {
  const epoch = ++routeEpoch;
  controller.abort();
  controller = new AbortController();
  const path = new URLSearchParams(location.search).get("path") || "";
  main.innerHTML =
    '<div class="loading page-loading"><span class="spinner"></span>Reading your folder…</div>';
  window.scrollTo(0, 0);
  try {
    const info = path ? await api<Entry>("info", path) : null;
    if (epoch !== routeEpoch) return;
    if (!info || info.kind === "directory") {
      listing = await api<Listing>("list", path);
      if (epoch !== routeEpoch) return;
      renderDirectory();
    } else {
      const parent = path.split("/").slice(0, -1).join("/");
      if (!listing || listing.path !== parent)
        listing = await api<Listing>("list", parent);
      if (epoch !== routeEpoch) return;
      renderViewer(info, epoch);
    }
  } catch (error) {
    if (epoch !== routeEpoch) return;
    currentFile = null;
    main.innerHTML = `${breadcrumb("")}<div class="empty-state page-empty"><span class="empty-icon">${icon("CircleAlert")}</span><h1>Couldn’t open this path</h1><p>${esc((error as Error).message)}</p><a class="button primary" href="/" data-path="">${icon("ArrowLeft")}Back to home folder</a></div>`;
  }
}
let toastTimeout: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const node = document.querySelector<HTMLElement>("#toast")!;
  node.innerHTML = `${icon("Check")}<span>${esc(message)}</span>`;
  node.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => node.classList.remove("visible"), 2600);
}
app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLAnchorElement>(
    "a[data-path]",
  );
  if (
    !target ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
    return;
  event.preventDefault();
  navigate(target.dataset.path || "", target.dataset.hash || "");
});
document
  .querySelectorAll<HTMLButtonElement>("[data-filter]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      filter = button.dataset.filter as Filter;
      page = 0;
      if (currentFile && listing) {
        history.pushState(null, "", urlFor(listing.path));
        routeEpoch++;
        controller.abort();
        currentFile = null;
        renderDirectory();
      } else if (listing) renderRows();
    }),
  );
function updateThemeButton() {
  const button = document.querySelector("#theme-toggle")!;
  button.innerHTML = icon(theme === "dark" ? "Sun" : "Moon");
  button.setAttribute(
    "aria-label",
    `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
  );
}
document.querySelector("#theme-toggle")!.addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("servedir-theme", theme);
  } catch {
    /* Optional preference. */
  }
  updateThemeButton();
  if (currentFile && isMD(currentFile.name) && !source)
    void renderFileContent(currentFile, routeEpoch);
});
document.addEventListener("keydown", (event) => {
  const editing = /INPUT|TEXTAREA/.test((event.target as HTMLElement).tagName);
  if (event.key === "/" && !editing && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    document.querySelector<HTMLInputElement>("#search")?.focus();
  }
  if (event.key === "Escape") {
    if (editing) {
      const input = event.target as HTMLInputElement;
      input.value = "";
      query = "";
      page = 0;
      if (listing && !currentFile) renderRows();
      input.blur();
    } else if (currentFile)
      navigate(currentFile.path.split("/").slice(0, -1).join("/"));
    else if (listing?.path)
      navigate(listing.path.split("/").slice(0, -1).join("/"));
  }
});
window.addEventListener("popstate", () => {
  query = "";
  page = 0;
  filter = "all";
  void route();
});
updateThemeButton();
void route();

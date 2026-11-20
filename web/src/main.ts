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
  Check,
  Copy,
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
  Check,
  Copy,
  Link2,
  CircleAlert,
};

const icon = (name: string, cls = "") => {
  const svg = createElement(icons[name] || File);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls ? `icon ${cls}` : "icon");
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
  <header class="topbar">
    <div class="topbar-inner">
      <nav class="breadcrumbs" id="breadcrumbs" aria-label="Breadcrumb"></nav>
      <button type="button" class="icon-btn" id="theme-toggle" aria-label="Switch to dark theme">${icon("Moon")}</button>
    </div>
  </header>
  <main id="main" tabindex="-1"></main>
  <div id="toast" class="toast" role="status"></div>
`;

const main = document.querySelector<HTMLElement>("#main")!;
const breadcrumbsEl = document.querySelector<HTMLElement>("#breadcrumbs")!;

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
    : '<span class="unavailable" title="Unavailable">—</span>';
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
        jpg: "JPEG",
        jpeg: "JPEG",
        png: "PNG",
        svg: "SVG",
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

function updateBreadcrumbs(path: string) {
  const rootName = listing?.rootName || "Home";
  const parts = path.split("/").filter(Boolean);
  const rootCurrent = parts.length === 0 ? ' aria-current="page"' : "";
  breadcrumbsEl.innerHTML = `<a class="crumb crumb-root" href="/" data-path="" title="${esc(listing?.rootPath || rootName)}"${rootCurrent}>${icon("FolderOpen")}<span>${esc(rootName)}</span></a>${parts
    .map((part, i) => {
      const target = parts.slice(0, i + 1).join("/");
      const current = i === parts.length - 1 ? ' aria-current="page"' : "";
      return `<span class="crumb-sep" aria-hidden="true">/</span><a class="crumb" href="${urlFor(target)}" data-path="${esc(target)}"${current}>${esc(part)}</a>`;
    })
    .join("")}`;
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

function updateFilters() {
  const entries =
    listing?.entries.filter((e) => hidden || !e.name.startsWith(".")) || [];
  for (const f of ["all", "documents", "media", "code"] as Filter[]) {
    const countEl = document.querySelector(`#count-${f}`);
    if (countEl) {
      countEl.textContent = String(
        entries.filter((e) => matchesFilter(e, f)).length,
      );
    }
    const button = document.querySelector<HTMLButtonElement>(
      `[data-filter="${f}"]`,
    );
    if (button) {
      const active = filter === f;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
}

function renderDirectory() {
  if (!listing) return;
  currentFile = null;
  main.className = "view-directory";
  const title = listing.path.split("/").pop() || listing.rootName;
  document.title = listing.path ? `${title} — ${listing.rootName}` : title;
  updateBreadcrumbs(listing.path);

  main.innerHTML = `
    <div class="controls">
      <label class="search-box">
        ${icon("Search")}
        <input id="search" type="search" placeholder="Filter files…" aria-label="Filter files" value="${esc(query)}" autocomplete="off">
        <kbd>/</kbd>
      </label>
      <div class="filter-pills" role="group" aria-label="Filter files">
        <button type="button" data-filter="all">All files<span class="pill-count" id="count-all"></span></button>
        <button type="button" data-filter="documents">Documents<span class="pill-count" id="count-documents"></span></button>
        <button type="button" data-filter="media">Media<span class="pill-count" id="count-media"></span></button>
        <button type="button" data-filter="code">Code<span class="pill-count" id="count-code"></span></button>
      </div>
      <div class="controls-actions">
        <button type="button" class="btn ghost" id="hidden-toggle" aria-label="Hidden files" title="Show or hide hidden files" aria-pressed="${hidden}">
          ${icon(hidden ? "Eye" : "EyeOff")}<span>Hidden</span>
        </button>
        <button type="button" class="icon-btn" id="refresh" aria-label="Refresh folder" title="Refresh">
          ${icon("RefreshCw")}
        </button>
      </div>
    </div>
    <section class="file-list" aria-label="Directory contents">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              ${(
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
                    `<th scope="col" data-column="${key}" class="col-${key}"><button type="button" data-sort="${key}">${label}<span class="sort-icon"></span></button></th>`,
                )
                .join("")}
              <th scope="col" class="row-action"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody id="file-rows"></tbody>
        </table>
      </div>
      <div id="empty-state"></div>
      <footer class="list-footer">
        <span id="visible-summary"></span>
        <div id="pagination"></div>
      </footer>
    </section>
  `;

  document
    .querySelector<HTMLInputElement>("#search")!
    .addEventListener("input", (e) => {
      query = (e.target as HTMLInputElement).value;
      page = 0;
      renderRows();
    });

  document
    .querySelectorAll<HTMLButtonElement>("[data-filter]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        filter = button.dataset.filter as Filter;
        page = 0;
        renderRows();
      }),
    );

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
  const filesCount = visible.length - folders;
  const totalBytes = visible.reduce((n, e) => n + (e.size || 0), 0);

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
        `<tr class="${e.accessible ? "" : "disabled-row"}"><td class="col-name">${e.accessible ? `<a class="file-link" href="${urlFor(e.path)}" data-path="${esc(e.path)}">` : '<span class="file-link" title="Unavailable">'}<span class="file-icon ${iconTone(e)}">${icon(fileIcon(e))}</span><span class="file-name">${esc(e.name)}</span>${e.symlink ? icon("Link2", "symlink-icon") : ""}${e.accessible ? "</a>" : "</span>"}</td><td class="col-kind">${esc(kind(e))}</td><td class="col-size">${bytes(e.size)}</td><td class="col-created">${dateCell(e.created)}</td><td class="col-modified">${dateCell(e.modified)}</td><td class="row-action">${e.kind === "directory" && e.accessible ? `<a class="icon-btn" href="${urlFor(e.path)}" data-path="${esc(e.path)}" aria-label="Open ${esc(e.name)}">${icon("ChevronRight")}</a>` : e.accessible ? `<a class="icon-btn" href="${fileURL(e.path, true)}" download aria-label="Download ${esc(e.name)}">${icon("Download")}</a>` : icon("CircleAlert")}</td></tr>`,
    )
    .join("");

  document.querySelector("#empty-state")!.innerHTML = entries.length
    ? ""
    : `<div class="empty-state"><span class="empty-icon">${icon(query || filter !== "all" ? "Search" : "FolderOpen")}</span><h2>${query || filter !== "all" ? "No matching files" : "Empty folder"}</h2><p>${query || filter !== "all" ? "Try a different filter or search term." : "This folder contains no files."}</p></div>`;

  const hiddenCount = listing.entries.length - visible.length;
  const filtered = query !== "" || filter !== "all";
  const summaryParts: string[] = [];
  if (filtered) {
    summaryParts.push(`${entries.length} of ${visible.length} items`);
  } else {
    if (folders)
      summaryParts.push(`${folders} ${folders === 1 ? "folder" : "folders"}`);
    if (filesCount || !folders)
      summaryParts.push(`${filesCount} ${filesCount === 1 ? "file" : "files"}`);
    if (filesCount) summaryParts.push(bytes(totalBytes));
  }
  if (hiddenCount > 0) summaryParts.push(`${hiddenCount} hidden`);

  document.querySelector("#visible-summary")!.textContent =
    summaryParts.join(" · ");

  document.querySelector("#pagination")!.innerHTML =
    entries.length > pageSize
      ? `<button type="button" class="icon-btn" id="previous-page" aria-label="Previous page" ${page === 0 ? "disabled" : ""}>${icon("ChevronLeft")}</button><span class="page-indicator">${page + 1} / ${Math.ceil(entries.length / pageSize)}</span><button type="button" class="icon-btn" id="next-page" aria-label="Next page" ${(page + 1) * pageSize >= entries.length ? "disabled" : ""}>${icon("ChevronRight")}</button>`
      : "";

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

  updateFilters();
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
    return `<div class="diagram" data-diagram="true"><pre class="mermaid-source">${esc(tokens[idx].content)}</pre><div class="diagram-output"></div></div>`;
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
  article.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}

async function renderDiagrams(article: HTMLElement, epoch: number) {
  const blocks = article.querySelectorAll<HTMLElement>("[data-diagram]");
  if (!blocks.length) return;
  try {
    const { default: mermaid } = await import("mermaid");
    if (epoch !== routeEpoch || !article.isConnected) return;
    const isDark = theme === "dark";
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: isDark
        ? {
            darkMode: true,
            background: "#0d1117",
            mainBkg: "#151b23",
            primaryColor: "#172554",
            primaryTextColor: "#e6edf3",
            primaryBorderColor: "#3b82f6",
            secondaryColor: "#161b22",
            tertiaryColor: "#1c2430",
            lineColor: "#8b949e",
            textColor: "#e6edf3",
            nodeBorder: "#30363d",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif",
          }
        : {
            darkMode: false,
            background: "#ffffff",
            mainBkg: "#f8fafc",
            primaryColor: "#eff6ff",
            primaryTextColor: "#111827",
            primaryBorderColor: "#93c5fd",
            secondaryColor: "#f8fafc",
            tertiaryColor: "#f1f5f9",
            lineColor: "#64748b",
            textColor: "#111827",
            nodeBorder: "#cbd5e1",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif",
          },
      suppressErrorRendering: true,
      maxTextSize: 50000,
      fontFamily:
        "-apple-system, BlinkMacSystemFont, Inter, Segoe UI, system-ui, sans-serif",
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
        error.textContent = "Could not render diagram.";
        block.insertBefore(error, code);
      }
    }
  } catch {
    toast("Diagram renderer unavailable.");
  }
}

function renderViewer(e: Entry, epoch: number) {
  currentFile = e;
  source = false;
  content = "";
  main.className = "view-viewer";
  document.title = listing?.rootName
    ? `${e.name} — ${listing.rootName}`
    : e.name;
  updateBreadcrumbs(e.path);

  const parent = e.path.split("/").slice(0, -1).join("/");
  const hasTabs = isMD(e.name);
  const metaParts = [
    esc(kind(e)),
    bytes(e.size),
    e.modified ? dateCell(e.modified) : "",
  ].filter(Boolean);

  main.innerHTML = `
    <div class="viewer-bar">
      <div class="viewer-bar-left">
        <a class="icon-btn" href="${urlFor(parent)}" data-path="${esc(parent)}" aria-label="Back to folder" title="Back (Esc)">${icon("ArrowLeft")}</a>
        ${
          hasTabs
            ? `<div class="segmented" role="tablist" aria-label="File view"><button type="button" id="preview-tab" role="tab" aria-selected="true">Preview</button><button type="button" id="source-tab" role="tab" aria-selected="false">Source</button></div>`
            : ""
        }
        <span class="file-meta">${metaParts.join(" · ")}</span>
      </div>
      <div class="viewer-bar-right">
        <button type="button" class="btn ghost" id="copy-link" aria-label="Copy link" title="Copy link">${icon("Link2")}<span>Copy link</span></button>
        <a class="btn primary" href="${fileURL(e.path, true)}" download>${icon("Download")}<span>Download</span></a>
      </div>
    </div>
    <div id="preview-content" class="viewer-body"${hasTabs ? ' role="tabpanel" aria-label="File content"' : ""}>
      <div class="loading"><span class="spinner"></span>Loading…</div>
    </div>
  `;

  document.querySelector("#copy-link")!.addEventListener(
    "click",
    () =>
      void navigator.clipboard
        .writeText(location.href)
        .then(() => toast("Link copied"))
        .catch(() => toast("Copy the URL from your browser.")),
  );

  if (hasTabs) {
    document.querySelector("#preview-tab")!.addEventListener("click", () => {
      source = false;
      void renderFileContent(e, epoch);
    });
    document.querySelector("#source-tab")!.addEventListener("click", () => {
      source = true;
      void renderFileContent(e, epoch);
    });
  }

  void loadFile(e, epoch);
}

async function loadFile(e: Entry, epoch: number) {
  const media =
    isImage(e.name) ||
    isVideo(e.name) ||
    isAudio(e.name) ||
    extension(e.name) === "pdf";
  if (media) {
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
    document.querySelector(".segmented")?.setAttribute("hidden", "");
    document.querySelector("#preview-content")!.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">${icon(fileIcon(e))}</span>
        <h2>${esc(e.name)}</h2>
        <p>${esc((error as Error).message)}</p>
        <a class="btn primary" href="${fileURL(e.path, true)}" download>${icon("Download")}Download file</a>
      </div>
    `;
  }
}

async function renderFileContent(e: Entry, epoch: number) {
  if (epoch !== routeEpoch) return;
  const panel = document.querySelector<HTMLElement>("#preview-content")!;
  document
    .querySelector("#preview-tab")
    ?.setAttribute("aria-selected", String(!source));
  document
    .querySelector("#source-tab")
    ?.setAttribute("aria-selected", String(source));

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
    const lineCount = content.split("\n").length;
    panel.innerHTML = `
      <div class="code-frame">
        <div class="source-meta">
          <span>${lineCount} ${lineCount === 1 ? "line" : "lines"} · UTF-8</span>
          <button type="button" class="btn ghost compact" id="copy-source">${icon("Copy")}<span>Copy</span></button>
        </div>
        <pre class="source-code"><code>${highlighted}</code></pre>
      </div>
    `;
    document.querySelector("#copy-source")!.addEventListener(
      "click",
      () =>
        void navigator.clipboard
          .writeText(content)
          .then(() => toast("Copied"))
          .catch(() => toast("Select text to copy.")),
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
    panel.innerHTML = `<iframe class="pdf-preview" src="${fileURL(e.path)}" title="${esc(e.name)}"></iframe>`;
  }
}

async function route() {
  const epoch = ++routeEpoch;
  controller.abort();
  controller = new AbortController();
  const path = new URLSearchParams(location.search).get("path") || "";
  main.innerHTML =
    '<div class="loading page-loading"><span class="spinner"></span></div>';
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
    main.className = "view-directory";
    updateBreadcrumbs("");
    main.innerHTML = `
      <div class="empty-state page-empty">
        <span class="empty-icon">${icon("CircleAlert")}</span>
        <h1>Couldn’t open path</h1>
        <p>${esc((error as Error).message)}</p>
        <a class="btn primary" href="/" data-path="">${icon("ArrowLeft")}Back to root</a>
      </div>
    `;
  }
}

let toastTimeout: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const node = document.querySelector<HTMLElement>("#toast")!;
  node.innerHTML = `${icon("Check")}<span>${esc(message)}</span>`;
  node.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => node.classList.remove("visible"), 2200);
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
    const search = document.querySelector<HTMLInputElement>("#search");
    if (search) {
      event.preventDefault();
      search.focus();
    }
  }
  if (event.key === "Escape") {
    if (editing) {
      const input = event.target as HTMLInputElement;
      input.value = "";
      query = "";
      page = 0;
      if (listing && !currentFile) renderRows();
      input.blur();
    } else if (currentFile) {
      navigate(currentFile.path.split("/").slice(0, -1).join("/"));
    } else if (listing?.path) {
      navigate(listing.path.split("/").slice(0, -1).join("/"));
    }
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

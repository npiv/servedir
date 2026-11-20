# servedir

A little home for your files. A local file browser with sortable details and an integrated Markdown, Mermaid, code, image, PDF, and media viewer. Everything needed to run the interface is embedded in one executable.

## Use

```fish
servedir                       # Current directory
servedir ~/Documents           # Another directory
servedir --open                 # Open the browser too
servedir --port 9000 ~/Documents
servedir --port 0               # Let the OS select a free port
```

Open the localhost URL printed in the terminal. Stop with Ctrl+C. Options go before the directory. With no explicit port, servedir starts at 8000 and tries the next available port if it is occupied. An explicitly requested port fails clearly if unavailable.

## Install or move to another computer

Choose the binary matching the target OS and CPU architecture. An `amd64` build runs on x86-64 PCs; `arm64` runs on ARM64 machines, including Apple Silicon. Linux, macOS, and Windows each require their own build.

On Linux or macOS, extract the release archive and run:

```sh
bash scripts/install.sh
```

This installs the executable into `~/.local/bin` and Fish completions into the user data directory (`~/.local/share/fish/vendor_completions.d` by default). If needed, add the binary directory to Fish's PATH once:

```fish
fish_add_path ~/.local/bin
```

You can also copy just the executable to another compatible computer, mark it executable with `chmod +x servedir`, and run it. There are no runtime Go, Node, Python, or CDN dependencies. Third-party notices travel inside the binary and are available with `servedir --licenses`.

On Windows, run `servedir.exe` from PowerShell, optionally adding its directory to PATH. The macOS and Windows artifacts are unsigned; public distribution can add platform signing later.

## Browser features

- Sortable Name, Type, Size, Created, and Modified columns, with folders always first.
- Filename search, file-type filters, hidden-file toggle, breadcrumbs, and 100-row pages.
- Markdown tables, syntax-highlighted code, Mermaid diagrams, local images, relative document links, and heading anchors.
- Preview/Source tabs, original-file downloads, and copy-link/copy-text actions.
- Images, native browser PDF previews, and browser-supported audio/video playback.
- Light/dark themes, narrow-screen layouts, `/` to search, and `Esc` to clear search or go up a directory.

Filtering applies to the current folder. Refresh reads changes from disk; there is no background index or filesystem watcher. The interface and diagram rendering work without internet access. Remote images or external links explicitly referenced by a document still need a connection.

## File behavior

The server binds only to `127.0.0.1` and is read-only. Root-confined filesystem operations prevent path traversal and symlink escapes. Symlinks that remain inside the root work; unavailable paths are shown disabled. Cross-origin browser requests and foreign Host headers are rejected. Raw HTML is displayed as text, Markdown HTML is escaped, and diagrams use strict rendering with SVG sanitization.

Creation time is shown only when the filesystem provides it. Linux uses `statx` birth time; macOS and Windows use their native creation timestamps. Unavailable creation time is displayed as “—”; Unix metadata-change time is never substituted. Dates use the browser's locale, and hovering a date shows its full timestamp. Folder sizes are omitted to avoid recursive scans; summary size is the sum of files in the current listing.

Text previews are limited to 2 MiB, UTF-8, and files without NUL bytes. Binary files can always be downloaded. Syntax highlighting is skipped for text over 200 KB. A directory may contain up to 100,000 entries. Browser media support depends on the browser's installed codecs; PDFs use the native browser viewer.

## Build

Requires Go 1.26+ and a recent Node.js version supported by Vite and Mermaid (Node 24 LTS is a suitable choice).

```sh
npm ci
npm run build
./bin/servedir --open examples/project
bash scripts/install.sh
```

The build uses `CGO_ENABLED=0`, embeds `web/dist`, and produces `bin/servedir`. If Go is managed by mise, the build script can use `mise exec go@latest` without changing global tool versions.

For interface development, start `./bin/servedir --port 8000 examples/project`, then `npm run dev` in another terminal. Vite proxies file/API requests to the local server. Rebuild the binary to bundle interface changes.

## Verify

```sh
go test -race ./...
go vet ./...
npx playwright install chromium
npm run test:ui
```

The browser tests use system Chromium when it exists at `/usr/bin/chromium`, or Playwright's Chromium otherwise. Set `CHROMIUM_PATH` to choose a browser. Tests cover navigation, metadata, sorting, filtering, Markdown/Mermaid with external requests blocked, relative images and links, encoded filenames, downloads, malformed diagrams, large files, and mobile/dark layouts. The Go suite covers file confinement, symlinks, request origins, downloads, range requests, and preview limits.

## Release

The repository contains GitHub Actions checks and GoReleaser packaging for Linux, macOS, and Windows on x86-64 and ARM64. Place this directory at the root of its own Git repository. A pushed `v*` tag runs checks and creates a **draft** GitHub release with archives and SHA-256 checksums. Publish the draft when ready. No remote repository or release is created by a local build.

To build a local release with GoReleaser installed, use `goreleaser release --snapshot --clean`. Review `.goreleaser.yaml` before adapting release destinations or signing.

The project source is MIT licensed. Bundled dependencies retain their own licenses, collected in `THIRD_PARTY_NOTICES.txt`.

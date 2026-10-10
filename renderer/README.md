# Isolated snapshot PDF renderer v1

This subproject is a non-browser PDFKit 0.17.2 renderer with fontkit 2.0.4 and a bundled SIL-OFL Noto font. It accepts the frozen allowlisted DTO agreed with the document backend. It displays exact supplied strings and never calculates tax, price, money, balances or stock. There is no HTML parsing, URL fetching, scripting, upload asset, template selection or filesystem path supplied by document text.

Supported representations: issued sale / customer receipt in A4 or **80 mm × 297 mm paginated thermal**; sales-return credit note / customer statement in A4. Thermal paper feed/cut/driver and physical readability remain operator acceptance. Other document types and scripts beyond verified Latin/Devanagari are not certified; characters absent from the bundled font are rejected. PDF text extraction may return Indic combining glyphs in visual order; actual Hindi shaping must also be visually reviewed.

Input bounds: 256 KiB JSON, 300 rows, 8 columns, bounded strings/party fields, 40 pages, 8 MiB output, 15 second deadline. Missing/extra keys, controls/bidirectional overrides and unsupported glyphs fail closed. Same frozen DTO/layout produces byte-identical output; PDF metadata timestamps are fixed, while the authoritative generated timestamp is displayed from the DTO.

`backend/src/modules/documents/renderProcess.js` is the only worker-facing entry point. It requires **NODE_ENV=test** and **DOCUMENT_RUNTIME_MODE=synthetic-local**. Production stays disabled. It receives no database/cloud/session environment variables. No renderer is invoked by an API financial request.

- Native macOS: built-in sandbox-exec default-deny, allowlisted bundled assets/runtime/system libraries, no network, file writes, process forks or Mach services; only the selected Node executable is permitted. Node startup also needs read access to the literal root directory itself, not its descendants. OS CPU limit 10 seconds; 96 MiB V8 heap; bounded pages/input/output and deadline. This is not a cgroup total-memory guarantee.
- Linux: build `docker build -f renderer/Dockerfile -t hardware-erp-renderer:phase5b .`; set DOCUMENT_RENDERER_DRIVER=docker. The launcher uses a separate non-root container, no mounts, no network, read-only root, no capabilities, no-new-privileges, 256 MiB memory+swap, one CPU, 16 PIDs, CPU/nofile limits, and a hard deadline. The image contains only the renderer, pinned dependencies, bundled font and copied network guard. It is a verification image, never published by this task.
- Native driver is `DOCUMENT_RENDERER_DRIVER=macos-sandbox`. Missing driver/isolation is an error, never a direct-render fallback.

Private artifact adapter `store(buffer) → {key,sha256,bytes}` uses random UUID identity, exclusive 0600 staged write, file fsync, atomic rename and directory fsync. `read(metadata)` verifies root ownership/mode, regular non-symlink single-link object, length and SHA256. Root must be an absolute canonical directory owned by the process with 0700 permissions. Files are private and downloaded only through current API authorization.

`removeOrphans(liveIds,{olderThanMs,now})` only considers owned UUID PDF/stage files, never traverses directories or follows symlinks, never removes supplied live IDs and enforces at least a one-hour grace (default 24h). **Caller must serialize authoritative live-ID collection and cleanup against store+publication using the shared database lock.** It is not safe to treat an old live-ID snapshot as publication synchronization. Missing objects require job recovery; hash mismatch requires investigation, not silently serving/relabeling bytes.

Verification (the Node guard must be installed before startup):

```sh
NODE_OPTIONS=--require=$PWD/scripts/local-only-network.cjs NODE_ENV=test DOCUMENT_RUNTIME_MODE=synthetic-local DOCUMENT_RENDERER_DRIVER=macos-sandbox DOCUMENT_SAMPLE_DIR=/private/tmp/erp-synthetic-documents node --test scripts/test-document-runtime.cjs renderer/tests/render.test.cjs
python3 scripts/test-document-runtime-output.py /private/tmp/erp-synthetic-documents
```

The second command requires Poppler pdftotext/pdfinfo/pdftoppm on PATH, or `--tools-dir /absolute/bundled/poppler/bin`. Missing tools are explicitly BLOCKED. It validates real PDF content, exact signed/zero money, rows across page breaks, Unicode/rupee presence, page sizes, absence of active PDF features and generates first/last-page PNGs for human visual review. Synthetic output is external to the source tree.

Current dependency audit performed 2026-10-10 reported 0 advisories. Installation warned that jpeg-exif and crypto-js are deprecated; these remain visible maintenance risks. Neither image parsing nor encryption is called. License inventory is in DEPENDENCY-LICENSES.json and font license in fonts/OFL.txt. No proprietary fonts are included. Runtime evidence belongs to the coordinator's candidate-specific report; source presence alone does not prove Linux isolation.

# Renderer decision — Phase 5B

Updated2026-10-10; supersedes the provisional design in the preserved starting tree. The selected renderer is non-browser PDFKit0.17.2 with fontkit2.0.4 and bundled SIL-OFL Noto Sans Devanagari. The renderer specialist fetched current Context7 documentation, pinned the lock, reviewed license inventory and rendered real Latin/Hindi/₹ fixtures. See `renderer/README.md`, `DEPENDENCY-LICENSES.json` and `fonts/OFL.txt`.

The minimal supported text/table documents need no HTML, JavaScript, remote assets, browser engine or image uploads. A deterministic library reduces that input surface but does not replace process/OS isolation. PDF metadata timestamps are fixed; actual issue/generation facts are displayed from the frozen DTO. Same DTO/layout is byte-identical, permitting missing-object repair without silently issuing different content.

Native macOS uses built-in sandbox-exec default-deny: no network, outside file contents, file creation, process forks or Mach services; only bundled/runtime/system files and Node startup directory metadata are allowed. CPU10s, V8 heap96MiB, input/pages/output bounds and15s kill deadline apply. This is NOT a total-process cgroup memory guarantee.

Linux uses the reviewed verification image under Docker: non-root65532, networknone, no host mounts, read-only filesystem, no capabilities, no-new-privileges,256MiB memory+swap,1CPU,16PIDs, CPU/nofile limits. No host privileged runtime was installed. Native proof does not substitute for candidate-specific Linux execution; exact results are in PHASE-5B-TEST-EVIDENCE.

A4 and paginated80mm×297mm sale/receipt output, A4 credit/statement, long rows, repeated headers, exact negative/zero amounts and Hindi/₹ have real PDF/text/PNG checks. Missing glyphs fail closed; only verified Latin/Devanagari coverage is supported. PDF screen rendering does not certify a physical printer or fiscal compliance.

New renderer advisory audit reported0 findings on2026-10-10. jpeg-exif and crypto-js deprecation warnings remain recorded maintenance risks; neither image parsing nor encryption is invoked. Backend/frontend audits are reported separately, not hidden by the renderer result. No proprietary fonts are distributed. Production mode is hard-disabled; supplier attachments and unimplemented document types remain disabled.

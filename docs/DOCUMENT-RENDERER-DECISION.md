# Renderer decision — provisional, no runtime selected

Checkpoint5A blocks implementation. No dependency was installed, pinned or cleared by an advisory/license audit in this delivery.

The existing escaped HTML approach would reuse formatting. Chromium would add browser execution, font and asset loading, sandbox enforcement, operating-system network isolation, and memory/concurrency controls. The existing formatter does not provide a frozen document data model. Never restore synchronous legacy generation in the request process.

A deterministic PDF layout engine is the preferred first prototype after the gate. Text and tables need no page scripts or external resources. It still needs packaged fonts, Hindi shaping, pagination, thermal layouts, malformed-text handling, input limits and isolation tests.

Choose the non-browser approach for the first bounded evaluation after the gate. Do not select a package/version from memory or claim that it renders Hindi correctly: fetch current primary documentation, inspect license/advisories, pin the evaluated version and validate real synthetic output. If it cannot meet shaping/layout requirements, reconsider isolated Chromium explicitly; never silently add `--no-sandbox` or unrestricted networking. No actual output, performance, isolation or printer acceptance has occurred. Keep all current render paths disabled.

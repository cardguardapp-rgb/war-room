---
name: Resume document generation has two independent rendering paths
description: docx and PDF resume output are produced by two separate renderers that must be kept in sync for layout changes.
---

`docBuild.ts` (docx via the `docx` library, converted to PDF through LibreOffice/`soffice` when available) and `pdf.ts`'s `buildResumePdfFallback` (a from-scratch pdf-lib renderer used only when `soffice` can't be resolved) are two independent implementations of the same resume layout.

**Why:** they don't share layout code, so a spacing/pagination fix applied to one (e.g. Word's `keepNext`/`keepLines` paragraph properties) has no effect on the other. `soffice` was not present in this dev sandbox, so the pdf-lib fallback is actually the path exercised locally — don't assume the docx-side fix alone covers PDF output end-to-end.

**How to apply:** any future change to resume document layout/pagination/spacing must be made in both places. In `pdf.ts`, "keep together" is implemented via a `groupId` field on `Block`; `blocksToPdf` measures each group's total height and forces a page break before the group if it doesn't fit in remaining space but does fit on a fresh page.

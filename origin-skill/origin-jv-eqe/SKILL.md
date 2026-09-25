---
name: origin-jv-eqe
description: Import JV or EQE Origin plotting bundles exported by the JV · EQE Data Workbench, recreate the selected curves and styling in OriginPro, and save an Origin project. Use when the user provides an Origin plotting ZIP or asks to continue website-exported JV/EQE data in Origin. Do not use for unrelated spreadsheets or generic charting.
---

# Origin JV · EQE

Turn the website's local export into an editable Origin project while preserving the selected curve order, labels, axes, colors, and linear/log choice.

## Workflow

1. Locate the user-provided `.zip` Origin plotting bundle. If several plausible bundles exist, use the newest only when the user has not named one.
2. Use a 64-bit CPython 3.12 interpreter. If `python` is not on PATH, load the Codex workspace dependencies and invoke the returned Python executable. The skill bundles the official `originpro` and `OriginExt` packages in `vendor/`; do not install them again unless that directory is missing or incompatible.
3. Validate it before opening Origin:

   ```powershell
   python scripts/inspect_bundle.py "<bundle.zip>"
   ```

4. Create the project with OriginPro installed on Windows:

   ```powershell
   python scripts/create_origin_project.py "<bundle.zip>" --output "<result.opju>" --show
   ```

   Omit `--show` for background automation. Never overwrite an existing project unless the user explicitly requests it; then pass `--force`.
5. Confirm that the `.opju` exists and report any warnings printed by the script. If `originpro` or Origin is unavailable, stop after validation and give the manual fallback from [references/origin-automation.md](references/origin-automation.md); do not claim the project was created.

An Origin plotting bundle is not an image. It is the local handoff ZIP that this skill consumes. The resulting `.opju` contains the editable Origin graph; if the user also wants a PNG or SVG, export it from Origin after the project is created or use the website's separate “导出图片” action.

The bundle is self-contained and must remain local unless the user explicitly asks to upload it. Treat `data.xlsx` as source data and `origin-recipe.json` as the plotting contract. Do not silently change measured values. In a JV log view, apply the recipe's `absolute` display transform to Y values while retaining the original signed values in the workbook.

Read [references/bundle-schema.md](references/bundle-schema.md) when diagnosing or extending a bundle. Read [references/origin-automation.md](references/origin-automation.md) when Origin automation fails or a manual import is required.

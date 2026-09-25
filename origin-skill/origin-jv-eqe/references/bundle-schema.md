# Origin plotting bundle schema

The website exports a ZIP with exactly two required files:

- `data.xlsx`: an OOXML workbook. `Origin作图` is the machine-oriented worksheet; each curve occupies adjacent X/Y columns and row 1 contains long names.
- `origin-recipe.json`: UTF-8 JSON containing the plotting contract.

## Recipe 1.0

Required top-level fields are `schemaVersion`, `view`, `title`, `workbook`, `axes`, `plot`, and `curves`. Version `1.0` supports `JV` and `EQE`.

`workbook.columnIndexBase` is `1`. Each curve records both numeric `xColumn` / `yColumn` and Excel-style `xColumnName` / `yColumnName`. Numeric indices are authoritative.

Each curve contains:

- stable one-based `index` and display `name`;
- `device`, `point`, `illumination`, and source filename;
- adjacent worksheet column mapping;
- final hex `color`, `lineStyle`, `lineWidth`, `interpolation`, and `symbol`.

Axes provide a plain-text title, `linear` or `log` scale, optional two-number range, and optional major step. `axes.y.transform` is `absolute` only for a JV log view. Ranges are expressed in data units, including log-axis ranges; they are not logarithmic exponents.

Unknown fields must be ignored so that additive website updates remain compatible. Reject an unknown major `schemaVersion`, a missing workbook, non-adjacent column mappings, duplicate curve indices, or a view other than `JV` / `EQE`.

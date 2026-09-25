# Origin automation and fallback

## Automated path

`scripts/create_origin_project.py` targets Origin versions that expose the official `originpro` Python package. Run it in an environment connected to the installed Origin application. The script creates one worksheet, assigns X/Y column designations, builds a line graph, applies supported recipe styling, rescales, and saves `.opju`.

If Origin is already open, save unrelated work before automation. The script creates new workbook and graph pages; it does not close an interactive Origin session. Warnings mean that the data/project were created but one optional visual property needs review.

## Manual fallback

1. Validate the ZIP with `inspect_bundle.py`, then extract `data.xlsx` and `origin-recipe.json` to a new folder.
2. In Origin, import the `Origin作图` worksheet from `data.xlsx`.
3. Treat columns A/C/E/... as X and B/D/F/... as Y. Plot every adjacent pair as a line graph in the recipe's curve order.
4. Copy graph and axis titles from the recipe. For `axes.y.scale: log`, switch Y to Log10 and plot `abs(Y)` as specified by `transform`; keep the imported signed source columns unchanged.
5. Apply the bundled Wiley-style publication preset: Arial, white background, near-square page, four-sided black frame, inward ticks, no grid, and a compact frameless legend. JV and EQE are both line-only; do not add symbols to EQE curves.
6. Apply each curve's hex color, width, and interpolation. Show the legend when `plot.legend` is true.

## Origin 2024 SR1 rendering note

OriginPro 2024 SR1 (`10.1.0.x`) has a known rendering defect that draws a thin horizontal line above graph text (axis titles, legends, and newly created labels). OriginLab reports this as fixed in Origin 2024b and later. The recipe and project remain structurally correct and editable; if this line appears in a generated project, update the installed Origin before judging the Wiley-style result. Do not add `\\ab` or other overline formatting as a workaround.
7. Save as `.opju` and compare curve count, title, scale, and colors against the recipe.

Do not use the workbook's `概览` or `原始数据` sheets as plotting sources; those sheets are for review and long-form analysis.

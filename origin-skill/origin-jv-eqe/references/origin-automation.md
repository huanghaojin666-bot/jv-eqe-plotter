# Origin automation and fallback

## Automated path

`scripts/create_origin_project.py` targets Origin versions that expose the official `originpro` Python package. Run it in an environment connected to the installed Origin application. The script creates one worksheet, assigns X/Y column designations, builds a line graph, applies supported recipe styling, rescales, and saves `.opju`.

If Origin is already open, save unrelated work before automation. The script creates new workbook and graph pages; it does not close an interactive Origin session. Warnings mean that the data/project were created but one optional visual property needs review.

## Manual fallback

1. Validate the ZIP with `inspect_bundle.py`, then extract `data.xlsx` and `origin-recipe.json` to a new folder.
2. In Origin, import the `Origin作图` worksheet from `data.xlsx`.
3. Treat columns A/C/E/... as X and B/D/F/... as Y. Plot every adjacent pair as a line graph in the recipe's curve order.
4. Copy graph and axis titles from the recipe. For `axes.y.scale: log`, switch Y to Log10 and plot `abs(Y)` as specified by `transform`; keep the imported signed source columns unchanged.
5. Apply the bundled Wiley-style publication preset: Arial, white background, near-square page, four-sided black frame, inward ticks, no grid, and a compact frameless legend. Use the lower-left corner for EQE so the legend does not cover the long-wavelength curves; keep JV in the lower-right corner. Each legend row uses a colored line segment followed by the curve name. JV and EQE are both line-only; do not add symbols to EQE curves.
6. Apply each curve's hex color, width, and interpolation. Show the legend when `plot.legend` is true.
7. Save as `.opju` and compare curve count, title, scale, and colors against the recipe.

## Origin 2024 text watermark

Origin 2024 can draw a horizontal bar above every graph text object when a newly created COM process uses the evaluation/OLE watermark rendering path. This is not an axis-title format, border, underline, or paragraph separator, so editing text properties cannot remove it. The automation connects to the normal single-instance Origin session used for manual graph editing and creates ordinary editable text objects there. It never covers the bar with white line objects. If a purchased Origin installation still shows the watermark, reactivate the license as described in OriginLab FAQ-4 or update to Origin 2024b or later for the related Origin 2024 rendering fix.

Do not use the workbook's `概览` or `原始数据` sheets as plotting sources; those sheets are for review and long-form analysis.

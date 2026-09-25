(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.JVEQEExporter = api;
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const textEncoder = new TextEncoder();

  function illuminationText(value) {
    if (value === "light") return "Light";
    if (value === "dark") return "Dark";
    return "Unknown";
  }

  function illuminationChinese(value) {
    if (value === "light") return "Light（光电流）";
    if (value === "dark") return "Dark（暗电流）";
    return "未识别";
  }

  function datasetLabel(dataset) {
    if (!dataset || !dataset.illumination || dataset.illumination === "unknown") {
      return dataset ? dataset.label : "";
    }
    return `${dataset.label} · ${dataset.illumination}`;
  }

  function instrumentName(dataset) {
    const label = dataset && dataset.label ? dataset.label : "";
    if (!dataset || !dataset.illumination || dataset.illumination === "unknown") return label;
    return `${label} ${illuminationText(dataset.illumination)}`;
  }

  function tabValue(value) {
    return String(value == null ? "" : value).replace(/[\t\r\n]+/g, " ").trim();
  }

  function numberText(value) {
    return Number.isFinite(Number(value)) ? String(Number(value)) : "";
  }

  function buildJVText(datasets) {
    const columns = datasets.length * 2;
    const metadataRow = (title, valueForDataset) => {
      const cells = new Array(columns + 1).fill("");
      cells[0] = title;
      datasets.forEach((dataset, index) => {
        cells[1 + (index * 2)] = tabValue(valueForDataset(dataset));
      });
      return cells.join("\t");
    };
    const lines = [
      metadataRow("Name", (dataset) => instrumentName(dataset)),
      metadataRow("Device", (dataset) => dataset.device || ""),
      metadataRow("Point", (dataset) => dataset.point || ""),
      metadataRow("Mode", (dataset) => illuminationText(dataset.illumination)),
      metadataRow("Time Stamp", (dataset) => dataset.date || ""),
      ["[Result]"].concat(datasets.flatMap(() => ["Volt. (V)", "J (A/cm^2)"])).join("\t")
    ];
    const maxLength = Math.max(0, ...datasets.map((dataset) => dataset.x.length));
    for (let rowIndex = 0; rowIndex < maxLength; rowIndex += 1) {
      const row = ["[Raw Data]"];
      datasets.forEach((dataset) => {
        row.push(numberText(dataset.x[rowIndex]), numberText(dataset.y[rowIndex]));
      });
      lines.push(row.join("\t"));
    }
    lines.push("====");
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  function buildEQEText(datasets) {
    const metadataRow = (title, valueForDataset) => datasets.flatMap((dataset) => [
      title,
      tabValue(valueForDataset(dataset))
    ]).join("\t");
    const lines = [
      metadataRow("Name", (dataset) => instrumentName(dataset)),
      metadataRow("Device", (dataset) => dataset.device || ""),
      metadataRow("Point", (dataset) => dataset.point || ""),
      metadataRow("Mode", (dataset) => illuminationText(dataset.illumination)),
      metadataRow("Date", (dataset) => dataset.date || ""),
      datasets.flatMap(() => ["Lambda (nm)", "EQE (%)"]).join("\t")
    ];
    const maxLength = Math.max(0, ...datasets.map((dataset) => dataset.x.length));
    for (let rowIndex = 0; rowIndex < maxLength; rowIndex += 1) {
      const row = [];
      datasets.forEach((dataset) => {
        row.push(numberText(dataset.x[rowIndex]), numberText(dataset.y[rowIndex]));
      });
      lines.push(row.join("\t"));
    }
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  function buildInstrumentText(type, datasets) {
    const selected = Array.from(datasets || []).filter((dataset) => dataset && dataset.type === type);
    if (!selected.length) return "";
    return type === "EQE" ? buildEQEText(selected) : buildJVText(selected);
  }

  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function columnName(index) {
    let value = index + 1;
    let output = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      output = String.fromCharCode(65 + remainder) + output;
      value = Math.floor((value - 1) / 26);
    }
    return output;
  }

  function normalizeOriginRecipe(view, datasets, recipe, exportedAt) {
    const input = recipe || {};
    const inputCurves = Array.isArray(input.curves) ? input.curves : [];
    const xTitle = view === "JV" ? "Voltage, V (V)" : "Wavelength, λ (nm)";
    const yTitle = view === "JV"
      ? (input.axes && input.axes.y && input.axes.y.scale === "log"
        ? "Current density, |J| (A cm⁻²)"
        : "Current density, J (A cm⁻²)")
      : "External quantum efficiency, EQE (%)";
    const optionalNumber = (value) => (
      value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : null
    );
    const curves = datasets.map((dataset, index) => {
      const supplied = inputCurves[index] || {};
      return {
        index: index + 1,
        name: supplied.name || datasetLabel(dataset),
        device: dataset.device || "",
        point: dataset.point || "",
        illumination: dataset.illumination || "unknown",
        source: dataset.source || "",
        xColumn: (index * 2) + 1,
        yColumn: (index * 2) + 2,
        xColumnName: columnName(index * 2),
        yColumnName: columnName((index * 2) + 1),
        color: supplied.color || "#1F77B4",
        lineStyle: supplied.lineStyle || "solid",
        lineWidth: Number.isFinite(Number(supplied.lineWidth)) ? Number(supplied.lineWidth) : 2,
        interpolation: supplied.interpolation || "spline",
        symbol: supplied.symbol || "none"
      };
    });
    const axes = input.axes || {};
    const yAxis = axes.y || {};
    return {
      schemaVersion: "1.0",
      generator: {
        name: "JV · EQE 数据工作台",
        format: "origin-skill-bundle",
        exportedAt: exportedAt.toISOString()
      },
      view,
      title: input.title || `${view} 曲线`,
      workbook: {
        file: "data.xlsx",
        worksheet: "Origin作图",
        headerRows: 1,
        columnIndexBase: 1
      },
      axes: {
        x: {
          title: (axes.x && axes.x.title) || xTitle,
          scale: "linear",
          range: axes.x && Array.isArray(axes.x.range) ? axes.x.range : null,
          majorStep: axes.x ? optionalNumber(axes.x.majorStep) : null
        },
        y: {
          title: yAxis.title || yTitle,
          scale: view === "JV" && yAxis.scale === "log" ? "log" : "linear",
          transform: view === "JV" && yAxis.scale === "log" ? "absolute" : "identity",
          range: Array.isArray(yAxis.range) ? yAxis.range : null,
          majorStep: optionalNumber(yAxis.majorStep)
        }
      },
      plot: {
        background: "#FFFFFF",
        legend: input.plot && input.plot.legend === false ? false : true,
        curveOrder: curves.map((curve) => curve.index),
        gradient: input.plot && input.plot.gradient ? input.plot.gradient : null
      },
      curves
    };
  }

  function cellXml(cell, rowIndex, columnIndex) {
    const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
    const style = Number.isInteger(cell && cell.style) ? ` s="${cell.style}"` : "";
    const value = cell && Object.prototype.hasOwnProperty.call(cell, "value") ? cell.value : cell;
    if (value == null || value === "") return `<c r="${reference}"${style}/>`;
    if (typeof value === "number" && Number.isFinite(value)) {
      return `<c r="${reference}"${style}><v>${value}</v></c>`;
    }
    if (typeof value === "boolean") {
      return `<c r="${reference}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
    }
    return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }

  function sheetXml(rows, options) {
    const settings = options || {};
    const maxColumns = Math.max(1, ...rows.map((row) => row.length));
    const maxRows = Math.max(1, rows.length);
    const sheetRows = rows.map((row, rowIndex) => {
      const height = settings.rowHeights && settings.rowHeights[rowIndex];
      const heightXml = height ? ` ht="${height}" customHeight="1"` : "";
      const cells = row.map((cell, columnIndex) => cellXml(cell, rowIndex, columnIndex)).join("");
      return `<row r="${rowIndex + 1}"${heightXml}>${cells}</row>`;
    }).join("");
    const widths = (settings.widths || []).map((width, index) => (
      `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
    )).join("");
    const freezeRows = settings.freezeRows || 0;
    const pane = freezeRows
      ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
      : "";
    const autoFilter = settings.autoFilter ? `<autoFilter ref="${settings.autoFilter}"/>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${columnName(maxColumns - 1)}${maxRows}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="${settings.showGridLines === false ? 0 : 1}">${pane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  ${widths ? `<cols>${widths}</cols>` : ""}
  <sheetData>${sheetRows}</sheetData>
  ${autoFilter}
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="0.000"/>
    <numFmt numFmtId="166" formatCode="0.000E+00"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FF172D4B"/><name val="Arial"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FF69798E"/><i/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FA"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE4EF"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" verticalAlignment="center"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" verticalAlignment="center"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" verticalAlignment="center"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" verticalAlignment="center"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" verticalAlignment="center"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function dateTimeLabel(date) {
    const two = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
  }

  function finiteValues(values) {
    return Array.from(values || []).map(Number).filter(Number.isFinite);
  }

  function rangeMinimum(values) {
    return values.reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
  }

  function rangeMaximum(values) {
    return values.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY);
  }

  function makeWorkbookSheets(view, datasets, options) {
    const exportedAt = options && options.exportedAt instanceof Date ? options.exportedAt : new Date();
    const chartTitle = (options && options.chartTitle) || `${view} 曲线`;
    const xLabel = view === "JV" ? "电压 (V)" : "波长 (nm)";
    const yLabel = view === "JV" ? "电流密度 (A/cm²)" : "EQE (%)";
    const totalPoints = datasets.reduce((sum, dataset) => sum + dataset.x.length, 0);
    const originRows = [datasets.flatMap((dataset) => [
      { value: `${datasetLabel(dataset)} | X: ${xLabel}`, style: 3 },
      { value: `${datasetLabel(dataset)} | Y: ${yLabel}`, style: 3 }
    ])];
    const originMaxLength = Math.max(0, ...datasets.map((dataset) => dataset.x.length));
    for (let rowIndex = 0; rowIndex < originMaxLength; rowIndex += 1) {
      const row = [];
      datasets.forEach((dataset) => {
        const x = Number(dataset.x[rowIndex]);
        const y = Number(dataset.y[rowIndex]);
        row.push(
          { value: Number.isFinite(x) ? x : "", style: 6 },
          { value: Number.isFinite(y) ? y : "", style: view === "JV" ? 7 : 6 }
        );
      });
      originRows.push(row);
    }
    const summaryRows = [
      [{ value: chartTitle, style: 1 }],
      [{ value: `导出时间：${dateTimeLabel(exportedAt)} · ${datasets.length} 条曲线 · ${totalPoints} 个数据点`, style: 2 }],
      [],
      [{ value: "当前类型", style: 8 }, { value: view, style: 4 }, { value: "横坐标", style: 8 }, { value: xLabel, style: 4 }],
      [{ value: "曲线数量", style: 8 }, { value: datasets.length, style: 5 }, { value: "纵坐标", style: 8 }, { value: yLabel, style: 4 }],
      [],
      ["类型", "器件", "点位", "测量状态", "曲线名称", "数据点", `起始${xLabel}`, `结束${xLabel}`, `最小${yLabel}`, `最大${yLabel}`, "来源文件"].map((value) => ({ value, style: 3 }))
    ];
    datasets.forEach((dataset) => {
      const xValues = finiteValues(dataset.x);
      const yValues = finiteValues(dataset.y);
      summaryRows.push([
        { value: dataset.type, style: 4 },
        { value: dataset.device, style: 4 },
        { value: dataset.point, style: 4 },
        { value: illuminationChinese(dataset.illumination), style: 4 },
        { value: datasetLabel(dataset), style: 4 },
        { value: dataset.x.length, style: 5 },
        { value: xValues.length ? xValues[0] : "", style: 6 },
        { value: xValues.length ? xValues[xValues.length - 1] : "", style: 6 },
        { value: yValues.length ? rangeMinimum(yValues) : "", style: 7 },
        { value: yValues.length ? rangeMaximum(yValues) : "", style: 7 },
        { value: dataset.source || "", style: 4 }
      ]);
    });

    const dataRows = [
      ["类型", "器件", "点位", "测量状态", "曲线名称", xLabel, yLabel, "测量时间", "来源文件"]
        .map((value) => ({ value, style: 3 }))
    ];
    datasets.forEach((dataset) => {
      dataset.x.forEach((x, index) => {
        dataRows.push([
          { value: dataset.type, style: 4 },
          { value: dataset.device, style: 4 },
          { value: dataset.point, style: 4 },
          { value: illuminationChinese(dataset.illumination), style: 4 },
          { value: datasetLabel(dataset), style: 4 },
          { value: Number(x), style: 6 },
          { value: Number(dataset.y[index]), style: view === "JV" ? 7 : 6 },
          { value: dataset.date || "", style: 4 },
          { value: dataset.source || "", style: 4 }
        ]);
      });
    });

    return {
      origin: sheetXml(originRows, {
        widths: datasets.flatMap(() => [30, 30]),
        rowHeights: { 0: 36 },
        freezeRows: 1,
        showGridLines: false
      }),
      summary: sheetXml(summaryRows, {
        widths: [9, 14, 13, 18, 28, 10, 17, 17, 19, 19, 28],
        rowHeights: { 0: 26, 1: 20, 6: 34 },
        freezeRows: 7,
        autoFilter: `A7:K${Math.max(7, summaryRows.length)}`,
        showGridLines: false
      }),
      data: sheetXml(dataRows, {
        widths: [9, 14, 13, 18, 28, 20, 22, 20, 30],
        rowHeights: { 0: 34 },
        freezeRows: 1,
        autoFilter: `A1:I${Math.max(1, dataRows.length)}`,
        showGridLines: false
      })
    };
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let value = 0xFFFFFFFF;
    for (let index = 0; index < bytes.length; index += 1) {
      value = crcTable[(value ^ bytes[index]) & 0xFF] ^ (value >>> 8);
    }
    return (value ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(value) {
    return Uint8Array.of(value & 0xFF, (value >>> 8) & 0xFF);
  }

  function u32(value) {
    return Uint8Array.of(value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF);
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
    };
  }

  function zipStore(files, now) {
    const localParts = [];
    const centralParts = [];
    const stamp = dosDateTime(now);
    let offset = 0;
    files.forEach((file) => {
      const name = textEncoder.encode(file.name);
      const data = typeof file.data === "string" ? textEncoder.encode(file.data) : file.data;
      const checksum = crc32(data);
      const localHeader = concatBytes([
        u32(0x04034B50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
        u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name
      ]);
      localParts.push(localHeader, data);
      const centralHeader = concatBytes([
        u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
        u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name
      ]);
      centralParts.push(centralHeader);
      offset += localHeader.length + data.length;
    });
    const centralDirectory = concatBytes(centralParts);
    const localData = concatBytes(localParts);
    const end = concatBytes([
      u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralDirectory.length), u32(localData.length), u16(0)
    ]);
    return concatBytes([localData, centralDirectory, end]);
  }

  function buildWorkbookBytes(view, datasets, options) {
    const selected = Array.from(datasets || []).filter((dataset) => dataset && dataset.type === view);
    const now = options && options.exportedAt instanceof Date ? options.exportedAt : new Date();
    const sheets = makeWorkbookSheets(view, selected, { ...(options || {}), exportedAt: now });
    const files = [
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
      },
      {
        name: "docProps/app.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>JV · EQE 数据工作台</Application></Properties>`
      },
      {
        name: "docProps/core.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape((options && options.chartTitle) || `${view} 曲线`)}</dc:title><dc:creator>JV · EQE 数据工作台</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString()}</dcterms:created></cp:coreProperties>`
      },
      {
        name: "xl/workbook.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Origin作图" sheetId="1" r:id="rId1"/><sheet name="概览" sheetId="2" r:id="rId2"/><sheet name="原始数据" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029"/></workbook>`
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      },
      { name: "xl/styles.xml", data: stylesXml() },
      { name: "xl/worksheets/sheet1.xml", data: sheets.origin },
      { name: "xl/worksheets/sheet2.xml", data: sheets.summary },
      { name: "xl/worksheets/sheet3.xml", data: sheets.data }
    ];
    return zipStore(files, now);
  }

  function buildWorkbookBlob(view, datasets, options) {
    return new Blob([buildWorkbookBytes(view, datasets, options)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function buildOriginSkillBundle(view, datasets, recipe, options) {
    const selected = Array.from(datasets || []).filter((dataset) => dataset && dataset.type === view);
    if (!selected.length) throw new Error("Origin Skill 包至少需要一条曲线。");
    const now = options && options.exportedAt instanceof Date ? options.exportedAt : new Date();
    const normalizedRecipe = normalizeOriginRecipe(view, selected, recipe, now);
    const workbookBytes = buildWorkbookBytes(view, selected, {
      ...(options || {}),
      chartTitle: normalizedRecipe.title,
      exportedAt: now
    });
    const bundleBytes = zipStore([
      { name: "data.xlsx", data: workbookBytes },
      { name: "origin-recipe.json", data: `${JSON.stringify(normalizedRecipe, null, 2)}\n` }
    ], now);
    return new Blob([bundleBytes], { type: "application/zip" });
  }

  return {
    buildInstrumentText,
    buildWorkbookBlob,
    buildOriginSkillBundle,
    normalizeOriginRecipe,
    datasetLabel,
    illuminationChinese
  };
}));

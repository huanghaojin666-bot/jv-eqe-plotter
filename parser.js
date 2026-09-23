(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.JVEQEParser = api;
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  let idCounter = 0;

  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/\uFEFF/g, "")
      .replace(/\r/g, "")
      .trim();
  }

  function splitTabs(line) {
    return String(line || "").replace(/\r$/, "").split("\t");
  }

  function numeric(value) {
    const text = cleanText(value);
    if (!text || /^nan$/i.test(text) || /^inf$/i.test(text)) {
      return null;
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeName(value) {
    return cleanText(value)
      .replace(/[＿_]/g, "-")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ");
  }

  function detectIllumination() {
    const values = Array.from(arguments);
    for (const value of values) {
      const text = normalizeName(value);
      if (!text) continue;
      const hasLight = /(?:^|[^a-z])light(?:$|[^a-z])/i.test(text) || /光电流|光照|亮态/.test(text);
      const hasDark = /(?:^|[^a-z])dark(?:$|[^a-z])/i.test(text) || /暗电流|暗态/.test(text);
      if (hasLight && hasDark) continue;
      if (hasLight) {
        return "light";
      }
      if (hasDark) {
        return "dark";
      }
    }
    return "unknown";
  }

  function stripIllumination(value) {
    return normalizeName(value)
      .replace(/(^|[^a-z])(light|dark)(?=$|[^a-z])/ig, "$1")
      .replace(/光电流|暗电流|光照|亮态|暗态/g, "")
      .replace(/^[\s·,;:/\\_()-]+|[\s·,;:/\\_()-]+$/g, "")
      .replace(/\s+/g, " ");
  }

  function metadataFromName(rawName, fileName, relativePath) {
    const illumination = detectIllumination(rawName, fileName, relativePath);
    let name = stripIllumination(rawName);
    const sourceText = `${fileName || ""} ${relativePath || ""}`;
    const pathDevice = sourceText.match(/(?:^|[\\/])([OP])(\d+)(?:[\\/]|$)/i);

    if (!name) {
      const prefixed = sourceText.match(/(?:EQE|JV)?\s*([A-Za-z])\s*(\d+)-(\d+)/i);
      const numericOnly = sourceText.match(/(?:EQE|JV)\s*(\d+)-(\d+)/i);
      if (prefixed) {
        name = `${prefixed[1].toUpperCase()} ${prefixed[2]}-${prefixed[3]}`;
      } else if (numericOnly) {
        name = `${numericOnly[1]}-${numericOnly[2]}`;
      }
    }

    const prefixedName = name.match(/^([A-Za-z]+)\s*(\d+)-(\d+)$/);
    const numericName = name.match(/^(\d+)-(\d+)$/);
    let device = "未识别";
    let point = name || "未识别";
    let family = "未分类";

    if (prefixedName) {
      const prefix = prefixedName[1].toUpperCase();
      device = `${prefix}${prefixedName[2]}`;
      point = `${prefixedName[2]}-${prefixedName[3]}`;
      if (prefix === "O") family = "Orange";
      if (prefix === "P") family = "Purple";
    } else if (numericName) {
      point = `${numericName[1]}-${numericName[2]}`;
      if (pathDevice) {
        const prefix = pathDevice[1].toUpperCase();
        device = `${prefix}${pathDevice[2]}`;
        family = prefix === "O" ? "Orange" : "Purple";
        name = `${prefix} ${point}`;
      } else {
        device = `器件${numericName[1]}`;
      }
    }

    if (device === "未识别") {
      if (pathDevice) {
        device = `${pathDevice[1].toUpperCase()}${pathDevice[2]}`;
        family = pathDevice[1].toUpperCase() === "O" ? "Orange" : "Purple";
      }
    }

    return {
      label: name || `${device} ${point}`,
      device,
      point,
      family,
      illumination
    };
  }

  function makeDataset(type, meta, file, x, y, extra) {
    idCounter += 1;
    return {
      id: `curve-${Date.now().toString(36)}-${idCounter}`,
      type,
      label: meta.label,
      device: meta.device,
      point: meta.point,
      family: meta.family,
      illumination: meta.illumination || "unknown",
      source: file.name,
      relativePath: file.relativePath || file.name,
      x,
      y,
      visible: true,
      quality: extra && extra.quality ? extra.quality : 2,
      raw: Boolean(extra && extra.raw),
      date: extra && extra.date ? extra.date : "",
      dedupeKey: extra && extra.dedupeKey ? extra.dedupeKey : ""
    };
  }

  function parseJV(text, file) {
    const lines = String(text || "").split(/\n/);
    const resultIndex = lines.findIndex((line) => /^\[Result\]\t/.test(line));
    if (resultIndex < 0) return [];

    const nameLine = lines
      .slice(0, resultIndex)
      .find((line) => /^Name\t/.test(line));
    const nameCells = nameLine ? splitTabs(nameLine).slice(1).map(cleanText) : [];
    const names = nameCells.filter(Boolean);
    const modeLine = lines
      .slice(0, resultIndex)
      .find((line) => /^Mode\t/i.test(line));
    const modeCells = modeLine ? splitTabs(modeLine).slice(1).map(cleanText) : [];
    const deviceLine = lines
      .slice(0, resultIndex)
      .find((line) => /^Device\t/i.test(line));
    const deviceCells = deviceLine ? splitTabs(deviceLine).slice(1).map(cleanText) : [];
    const pointLine = lines
      .slice(0, resultIndex)
      .find((line) => /^Point\t/i.test(line));
    const pointCells = pointLine ? splitTabs(pointLine).slice(1).map(cleanText) : [];

    const headers = splitTabs(lines[resultIndex]).slice(1).map(cleanText);
    const groupStarts = [];
    headers.forEach((header, index) => {
      if (/^Volt\.?\s*\(V\)$/i.test(header)) groupStarts.push(index);
    });
    if (!groupStarts.length) return [];

    const columns = groupStarts.map((start, groupIndex) => {
      const end = groupStarts[groupIndex + 1] == null ? headers.length : groupStarts[groupIndex + 1];
      const groupHeaders = headers.slice(start, end);
      const jOffset = groupHeaders.findIndex((header) => /^J\s*\(A\/cm\^?2\)$/i.test(header));
      return {
        start,
        jIndex: start + (jOffset >= 0 ? jOffset : 3)
      };
    });

    const dataRows = [];
    for (let index = resultIndex + 1; index < lines.length; index += 1) {
      if (/^=+/.test(lines[index])) break;
      if (!cleanText(lines[index])) continue;
      const cells = splitTabs(lines[index]);
      if (cells[0] === "[Raw Data]" || cells[0] === "") {
        dataRows.push(cells.slice(1));
      }
    }

    const dateLine = lines.slice(0, resultIndex).find((line) => /^Time Stamp\t/.test(line));
    const dates = dateLine
      ? splitTabs(dateLine).slice(1).map(cleanText).filter(Boolean)
      : [];

    return columns.map((column, index) => {
      const fallbackName = nameCells[column.start] || names[index] || `点位 ${index + 1}`;
      const meta = metadataFromName(fallbackName, file.name, file.relativePath);
      if (deviceCells[column.start]) meta.device = deviceCells[column.start];
      if (pointCells[column.start]) meta.point = pointCells[column.start];
      meta.illumination = detectIllumination(
        modeCells[column.start],
        fallbackName,
        file.name,
        file.relativePath
      );
      const x = [];
      const y = [];
      dataRows.forEach((row) => {
        const voltage = numeric(row[column.start]);
        const currentDensity = numeric(row[column.jIndex]);
        if (voltage != null && currentDensity != null) {
          x.push(voltage);
          y.push(currentDensity);
        }
      });
      return makeDataset("JV", meta, file, x, y, {
        date: dates[index] || "",
        dedupeKey: `JV|${file.relativePath || file.name}|${meta.label}|${meta.illumination}|${index}`
      });
    }).filter((dataset) => dataset.x.length);
  }

  function findEQEName(lines, file, start, end) {
    for (const line of lines) {
      const cells = splitTabs(line).map(cleanText);
      const searchStart = Number.isFinite(start) ? start : 0;
      const searchEnd = Number.isFinite(end) ? Math.min(end, cells.length) : cells.length;
      const nameIndex = cells.findIndex((cell, index) => (
        index >= searchStart &&
        index < searchEnd &&
        /^Name$/i.test(cell)
      ));
      if (nameIndex >= 0 && cells[nameIndex + 1]) {
        return cells[nameIndex + 1];
      }
    }
    return "";
  }

  function findEQEGroupValue(lines, start, end, key) {
    const matcher = new RegExp(`^${key}$`, "i");
    for (const line of lines) {
      const cells = splitTabs(line).map(cleanText);
      const searchEnd = Math.min(end, cells.length);
      for (let index = start; index < searchEnd; index += 1) {
        if (matcher.test(cells[index]) && cells[index + 1]) {
          return cells[index + 1];
        }
      }
    }
    return "";
  }

  function findEQEGroupLabel(lines, headerIndex, start, groupIndex) {
    for (let index = headerIndex - 1; index >= 0; index -= 1) {
      const label = cleanText(splitTabs(lines[index])[start]);
      if (label) return label;
    }
    return `Point ${groupIndex + 1}`;
  }

  function isEQEXHeader(header) {
    return /^(Lambda|Wavelength)\s*\(nm\)$/i.test(header);
  }

  function isEQEYHeader(header) {
    return /^EQE\s*\(%\)$/i.test(header);
  }

  function eqeBaseName(fileName) {
    return String(fileName || "")
      .replace(/_Raw(?=\.txt$)/i, "")
      .replace(/\.txt$/i, "")
      .toLowerCase();
  }

  function parseEQE(text, file) {
    const lines = String(text || "").split(/\n/);
    let headerIndex = lines.findIndex((line) => /Lambda\s*\(nm\)/i.test(line) && /EQE\s*\(%\)/i.test(line));
    let isRaw = false;

    if (headerIndex < 0) {
      headerIndex = lines.findIndex((line) => /Wavelength\s*\(nm\)/i.test(line) && /EQE\s*\(%\)/i.test(line));
      isRaw = headerIndex >= 0;
    }
    if (headerIndex < 0) return [];

    const headers = splitTabs(lines[headerIndex]).map(cleanText);
    const groupStarts = [];
    headers.forEach((header, index) => {
      if (isEQEXHeader(header)) groupStarts.push(index);
    });
    if (!groupStarts.length) return [];

    const groups = groupStarts.map((start, groupIndex) => {
      const end = groupStarts[groupIndex + 1] == null ? headers.length : groupStarts[groupIndex + 1];
      const groupHeaders = headers.slice(start, end);
      const yOffset = groupHeaders.findIndex(isEQEYHeader);
      return {
        start,
        end,
        yIndex: yOffset >= 0 ? start + yOffset : -1
      };
    }).filter((group) => group.yIndex >= 0);
    if (!groups.length) return [];

    const baseName = eqeBaseName(file.relativePath || file.name);
    return groups.map((group, groupIndex) => {
      const x = [];
      const y = [];
      for (let index = headerIndex + 1; index < lines.length; index += 1) {
        const cells = splitTabs(lines[index]);
        const wavelength = numeric(cells[group.start]);
        const eqe = numeric(cells[group.yIndex]);
        if (wavelength != null && eqe != null) {
          x.push(wavelength);
          y.push(eqe);
        }
      }
      if (!x.length) return null;

      const fallbackName = findEQEGroupLabel(lines, headerIndex, group.start, groupIndex);
      const rawName = findEQEName(lines, file, group.start, group.end) || fallbackName;
      const meta = metadataFromName(rawName, file.name, file.relativePath);
      const exportedDevice = findEQEGroupValue(lines, group.start, group.end, "Device");
      const exportedPoint = findEQEGroupValue(lines, group.start, group.end, "Point");
      if (exportedDevice) meta.device = exportedDevice;
      if (exportedPoint) meta.point = exportedPoint;
      const date = findEQEGroupValue(lines, group.start, group.end, "Date");

      return makeDataset("EQE", meta, file, x, y, {
        quality: isRaw ? 1 : 2,
        raw: isRaw,
        date,
        dedupeKey: `EQE|${baseName}|${meta.illumination}|${groupIndex}`
      });
    }).filter(Boolean);
  }

  function detectType(text, fileName) {
    const sample = String(text || "").slice(0, 12000);
    if (/\[Result\]\t[\s\S]*Volt\.?\s*\(V\)[\s\S]*J\s*\(A\/cm\^?2\)/i.test(sample)) {
      return "JV";
    }
    if (/(Lambda|Wavelength)\s*\(nm\)[\s\S]*EQE\s*\(%\)/i.test(sample)) {
      return "EQE";
    }
    if (/^JV/i.test(fileName || "")) return "JV";
    if (/^EQE/i.test(fileName || "")) return "EQE";
    return "UNKNOWN";
  }

  function parseFile(text, fileInfo) {
    const file = {
      name: fileInfo && fileInfo.name ? fileInfo.name : "未命名.txt",
      relativePath: fileInfo && fileInfo.relativePath
        ? fileInfo.relativePath
        : (fileInfo && fileInfo.name ? fileInfo.name : "未命名.txt")
    };
    const type = detectType(text, file.name);
    if (type === "JV") return { type, datasets: parseJV(text, file) };
    if (type === "EQE") return { type, datasets: parseEQE(text, file) };
    return { type: "UNKNOWN", datasets: [] };
  }

  function mergeDatasets(existing, incoming) {
    const merged = existing.slice();
    incoming.forEach((candidate) => {
      const duplicateIndex = merged.findIndex((item) => (
        item.dedupeKey &&
        candidate.dedupeKey &&
        item.dedupeKey === candidate.dedupeKey
      ));
      if (duplicateIndex < 0) {
        merged.push(candidate);
      } else if (candidate.quality > merged[duplicateIndex].quality) {
        candidate.visible = merged[duplicateIndex].visible;
        merged.splice(duplicateIndex, 1, candidate);
      }
    });
    return merged;
  }

  return {
    detectIllumination,
    detectType,
    metadataFromName,
    mergeDatasets,
    numeric,
    parseEQE,
    parseFile,
    parseJV
  };
}));

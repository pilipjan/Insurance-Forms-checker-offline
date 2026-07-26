(function () {
  const defaultPrefixes = [
    "AG", "AP", "ASPCO", "B", "BCG", "BCR", "BCP", "BDEC", "BEONY", "BIL", "BM", "BP",
    "CA", "CF", "CG", "CL", "CM", "CP", "CR", "CU", "CX", "CY",
    "DE", "DL", "DP", "DS", "EB", "EP", "FB", "FL", "FO", "FP", "GI", "HO", "IH", "IL", "IM",
    "IN", "MC", "MI", "MM", "MP", "OP", "PM", "PP", "PR", "SE", "SF", "TC", "WC"
  ];

  function cleanText(value) {
    return String(value || "")
      .replace(/\t/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/[–—]/g, "-")
      .replace(/[［\[]/g, "(")
      .replace(/[］\]]/g, ")")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parsePrefixes(value) {
    const parts = String(value || "")
      .split(",")
      .map((part) => cleanText(part).toUpperCase())
      .filter(Boolean);
    return parts.length ? parts : defaultPrefixes.slice();
  }

  function formatEdition(edition) {
    if (!edition) return "";
    return edition.length === 4 ? `${edition.slice(0, 2)}/${edition.slice(2)}` : edition;
  }

  function displayFormCode(normalizedCode) {
    if (!normalizedCode) return "";
    const compact = cleanText(normalizedCode).replace(/\s/g, "").toUpperCase();
    // Standard ISO 2-letter prefix + 4-digit form + 4-digit edition
    if (/^[A-Z]{2}\d{8}$/.test(compact)) {
      const prefix = compact.slice(0, 2);
      const form = compact.slice(2, 6);
      const edition = compact.slice(6, 10);
      return `${prefix} ${form.slice(0, 2)} ${form.slice(2)} (${edition.slice(0, 2)}/${edition.slice(2)})`;
    }
    // Non-standard: return as-is (already reasonably formatted)
    return normalizedCode;
  }

  function fixOcrPrefix(str, knownPrefixes) {
    let clean = cleanText(str).trim();
    if (!clean) return clean;
    
    // substitutions for common numeric OCR typos at the start of a code prefix
    const substitutions = {
      '8': 'B',
      '0': 'O',
      '1': 'I',
      '5': 'S',
      '2': 'Z'
    };
    
    const firstChar = clean.charAt(0);
    if (substitutions[firstChar]) {
      const substituted = substitutions[firstChar] + clean.slice(1);
      // See if it starts with a known prefix
      const match = substituted.match(/^([A-Z]{2,8})/i);
      if (match) {
        const prefix = match[1].toUpperCase();
        if ((knownPrefixes || []).some(p => prefix === p.toUpperCase() || prefix.startsWith(p.toUpperCase()))) {
          return substituted;
        }
      }
    }
    return clean;
  }

  function parseFormLine(rawLine, knownPrefixes) {
    const prefixes = knownPrefixes || defaultPrefixes;
    let clean = cleanText(rawLine);
    
    // Fuzzy OCR prefix correction
    clean = fixOcrPrefix(clean, prefixes);

    const result = {
      raw: rawLine,
      clean,
      normalizedCode: "",
      baseCode: "",
      displayCode: clean,
      edition: "",
      displayEdition: "",
      description: "",
      known: false,
      parseStatus: clean ? "Unknown Format" : "Blank",
    };

    if (!clean) return result;

    // 1. Try matching with edition delimiter first: e.g. "BCEE (10/13) COVERAGE ENHANCEMENT"
    // Fits any alphanumeric code, an edition code, and then description.
    const edMatch = clean.match(/^([A-Z0-9\-\s]{2,12})\s*\(?\s*(\d{2})\s*[\/\-]\s*(\d{2})\s*\)?\s*(.*)$/i);
    if (edMatch) {
      const rawCode = cleanText(edMatch[1]).replace(/\s/g, "");
      const edition = `${edMatch[2]}${edMatch[3]}`;
      const description = cleanText(edMatch[4]);
      
      const prefixMatch = rawCode.match(/^([A-Z]{2,8})/i);
      const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : "";
      const known = prefixes.some(p => prefix === p.toUpperCase() || prefix.startsWith(p.toUpperCase()));
      
      const normalizedCode = `${rawCode}${edition}`;
      const displayCode = `${rawCode} (${edMatch[2]}/${edMatch[3]})`;

      return {
        ...result,
        normalizedCode,
        baseCode: rawCode,
        displayCode,
        edition,
        displayEdition: `${edMatch[2]}/${edMatch[3]}`,
        description,
        known,
        parseStatus: normalizedCode ? "Parsed" : "Unknown Format",
      };
    }

    // 2. Standard prefix+digits pattern: e.g. "BP0002 COVERAGE FORM"
    const match = clean.match(
      /^\s*([A-Z]{2,8})\s*(\d{2,6})\s*(?:\(?\s*(\d{2})\s*\/\s*(\d{2})\s*\)?)?/i
    );
    if (!match) return result;

    const prefix = match[1].toUpperCase();
    const formNumber = match[2];
    const edition = match[3] && match[4] ? `${match[3]}${match[4]}` : "";

    const normalizedCode = `${prefix}${formNumber}${edition ? edition : ""}`;
    const displayCode = edition
      ? `${prefix}${formNumber} (${match[3]}/${match[4]})`
      : `${prefix}${formNumber}`;

    const description = cleanText(clean.slice(match[0].length));
    const known = prefixes.some(p => prefix === p.toUpperCase() || prefix.startsWith(p.toUpperCase()));

    return {
      ...result,
      normalizedCode,
      baseCode: `${prefix}${formNumber}`,
      displayCode,
      edition,
      displayEdition: edition ? `${match[3]}/${match[4]}` : "",
      description,
      known,
      parseStatus: normalizedCode ? "Parsed" : "Unknown Format",
    };
  }

  /* ── SPLIT-COLUMN DETECTION ──────────────────────────────
     OCR outputs of tables often print entire columns sequentially.
     This zips Codes, Editions, and Descriptions blocks back together.
  ───────────────────────────────────────────────────────── */

  function looksLikeCode(line, knownPrefixes) {
    const clean = cleanText(line);
    if (!clean) return false;
    // Standard prefix code, or any word consisting of letters and digits of length 3-10
    const m = clean.match(/^([A-Za-z0-9]{2,10})\s*(\d*)/);
    if (!m) return false;
    const word = m[1].toUpperCase();
    return /^[A-Z]{2,}/.test(word) && word.length <= 10;
  }

  function looksLikeDescriptionOnly(line) {
    const clean = cleanText(line);
    if (!clean) return false;
    // Standard capitalized uppercase text, not a short code, not an edition
    return /^[A-Z][A-Z\s\-\/\,\(\)\'\.\&]{4,}$/.test(clean) &&
           !/^[A-Z]{2,10}\s*\d{2,}/.test(clean) &&
           !/^\(?[0-9]{2}\/[0-9]{2}\)?$/.test(clean);
  }

  function looksLikeEdition(line) {
    const clean = cleanText(line);
    return /^\s*\(?\s*\d{2}\s*[\/\-]\s*\d{2}(?:\s*[\/\-]\s*\d{2,4})?\s*\)?\s*$/.test(clean);
  }

  function detectSplitColumn(lines, knownPrefixes) {
    const prefixes = knownPrefixes || defaultPrefixes;
    
    // 1. Group non-empty lines separated by blanks
    const groups = [];
    let current = [];
    for (const line of lines) {
      const c = cleanText(line);
      if (!c) {
        if (current.length) { groups.push(current); current = []; }
      } else {
        current.push(c);
      }
    }
    if (current.length) groups.push(current);

    if (groups.length < 2) return null;

    // 2. Classify each group
    const groupTypes = groups.map(g => {
      let codeCount = 0;
      let editionCount = 0;
      let descCount = 0;
      
      for (const line of g) {
        const fixedLine = fixOcrPrefix(line, prefixes);
        if (looksLikeEdition(line)) {
          editionCount++;
        } else if (looksLikeCode(fixedLine, prefixes) || /^[A-Z]{3,8}\d{0,4}$/i.test(fixedLine)) {
          codeCount++;
        } else {
          descCount++;
        }
      }
      
      const total = g.length || 1;
      return {
        lines: g,
        isEdition: (editionCount / total) > 0.7,
        isCode: (codeCount / total) > 0.6,
        isDesc: (descCount / total) > 0.6 && (codeCount / total) < 0.3
      };
    });

    const codeGroup = groupTypes.find(g => g.isCode);
    const editionGroup = groupTypes.find(g => g.isEdition);
    const descGroup = groupTypes.find(g => g.isDesc);

    // Ensure we have at least a Code group and a Description group
    if (codeGroup && descGroup) {
      const codes = codeGroup.lines;
      const descs = descGroup.lines;
      const editions = editionGroup ? editionGroup.lines : [];

      // Mismatch tolerance (must be relatively close in size)
      const maxLen = Math.max(codes.length, descs.length);
      const minLen = Math.min(codes.length, descs.length);
      if (maxLen - minLen > maxLen * 0.4) return null;

      const parsedLines = [];
      for (let i = 0; i < codes.length; i++) {
        const rawCode = codes[i] || "";
        const fixedCode = fixOcrPrefix(rawCode, prefixes);
        const editionStr = editions.length ? (editions[i] || "") : "";
        const descStr = descs[i] || "";
        
        let combined = fixedCode;
        if (editionStr) {
          const cleanEd = cleanText(editionStr);
          if (cleanEd.startsWith("(") && cleanEd.endsWith(")")) {
            combined += ` ${cleanEd}`;
          } else {
            combined += ` (${cleanEd})`;
          }
        }
        if (descStr) {
          combined += ` ${descStr}`;
        }

        const parsed = parseFormLine(combined, prefixes);
        if (parsed.normalizedCode) {
          parsedLines.push(parsed);
        } else {
          // Fallback parsing
          parsedLines.push({
            raw: combined,
            clean: combined,
            normalizedCode: cleanText(fixedCode).replace(/\s/g, ""),
            baseCode: cleanText(fixedCode).replace(/\s/g, ""),
            displayCode: fixedCode,
            edition: editionStr.replace(/[\(\)]/g, ""),
            displayEdition: editionStr.replace(/[\(\)]/g, ""),
            description: descStr,
            known: false,
            parseStatus: "Unknown Format"
          });
        }
      }
      return parsedLines;
    }

    return null;
  }

  function parseSchedule(text, knownPrefixes) {
    const prefixes = knownPrefixes || defaultPrefixes;
    const rawLines = String(text || "").split(/\r?\n/);
    const nonEmpty = rawLines.filter(l => cleanText(l));

    // Try split-column zipping first
    if (nonEmpty.length >= 4) {
      const splitResult = detectSplitColumn(rawLines, prefixes);
      if (splitResult && splitResult.length) return splitResult;
    }

    // Standard linear parse
    return rawLines
      .map((line) => parseFormLine(line, prefixes))
      .filter((item) => item.clean);
  }

  window.ComparatorParser = {
    cleanText,
    parsePrefixes,
    parseFormLine,
    parseSchedule,
    displayFormCode,
    formatEdition,
    defaultPrefixes,
  };
})();


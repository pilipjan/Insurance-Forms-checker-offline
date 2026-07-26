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

  function parseFormLine(rawLine, knownPrefixes) {
    const clean = cleanText(rawLine);
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

    // Extended regex: 2-8 letter prefix, then digits (4-8), then optional edition (MM/YY)
    const match = clean.match(
      /^\s*([A-Z]{2,8})\s*(\d{2,6})\s*(?:\(?\s*(\d{2})\s*\/\s*(\d{2})\s*\)?)?/i
    );
    if (!match) return result;

    const prefix = match[1].toUpperCase();
    const formNumber = match[2];           // keep as-is (variable length)
    const edition = match[3] && match[4] ? `${match[3]}${match[4]}` : "";

    // Build normalized code: PREFIX + FORMNUM + EDITION (no spaces)
    const normalizedCode = `${prefix}${formNumber}${edition ? edition : ""}`;
    // Display code: PREFIX + FORMNUM + optional (MM/YY)
    const displayCode = edition
      ? `${prefix}${formNumber} (${match[3]}/${match[4]})`
      : `${prefix}${formNumber}`;

    const description = cleanText(clean.slice(match[0].length));
    const known = (knownPrefixes || []).some(p => prefix === p.toUpperCase() || prefix.startsWith(p.toUpperCase()));

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
     Some OCR tools extract two-column schedule tables as two
     separate lists: codes first, then descriptions below.
     Detect this pattern and zip them back together.
  ───────────────────────────────────────────────────────── */

  function looksLikeCode(line, knownPrefixes) {
    // A line "looks like a code" if it starts with a known prefix + digits
    const clean = cleanText(line);
    if (!clean) return false;
    // Match: 2-letter prefix, digits, optional edition like (09/11)
    const m = clean.match(/^([A-Za-z]{2,10})\s*(\d{4,})\s*(?:\(?\d{2}\/\d{2}\)?)?/);
    if (!m) return false;
    const prefix = m[1].toUpperCase();
    // Accept if it starts with any 2+ letter prefix followed by digits
    return /^[A-Z]{2,}/.test(prefix);
  }

  function looksLikeDescriptionOnly(line) {
    const clean = cleanText(line);
    if (!clean) return false;
    // A description-only line: starts with uppercase letters but NOT a code pattern
    // i.e., no digits immediately after an uppercase prefix
    return /^[A-Z][A-Z\s\-\/\,\(\)\'\.]+$/.test(clean) &&
           !/^[A-Z]{2,10}\s*\d{2,}/.test(clean);
  }

  function detectSplitColumn(lines, knownPrefixes) {
    // Find groups of lines separated by blank lines
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

    // For each group, calculate what fraction of lines look like codes vs descriptions
    const groupStats = groups.map(g => {
      const codeLines   = g.filter(l => looksLikeCode(l, knownPrefixes));
      const descLines   = g.filter(l => looksLikeDescriptionOnly(l));
      return { lines: g, codeRatio: codeLines.length / g.length, descRatio: descLines.length / g.length };
    });

    // Find a "code block" (mostly codes) and a "description block" (mostly descriptions)
    const codeGroups = groupStats.filter(g => g.codeRatio > 0.5);
    const descGroups = groupStats.filter(g => g.descRatio > 0.7 && g.codeRatio < 0.2);

    if (!codeGroups.length || !descGroups.length) return null;

    // Collect all code-only lines from codeGroups (lines with no description after the code)
    const codeOnlyLines = [];
    const codeWithDescLines = [];
    for (const g of codeGroups) {
      for (const line of g.lines) {
        const parsed = parseFormLine(line, knownPrefixes);
        if (parsed.normalizedCode && !parsed.description.trim()) {
          codeOnlyLines.push(parsed);
        } else {
          codeWithDescLines.push(parsed);
        }
      }
    }

    // Collect all description-only lines
    const descOnlyLines = [];
    for (const g of descGroups) {
      for (const line of g.lines) {
        descOnlyLines.push(cleanText(line));
      }
    }

    // If the counts are reasonably close, zip them
    if (!codeOnlyLines.length || !descOnlyLines.length) return null;
    // Allow some mismatch tolerance
    if (Math.abs(codeOnlyLines.length - descOnlyLines.length) > Math.max(codeOnlyLines.length, descOnlyLines.length) * 0.4) return null;

    // Merge: assign each description to the corresponding code-only line
    const merged = codeOnlyLines.map((parsed, i) => {
      const desc = descOnlyLines[i] || "";
      return { ...parsed, description: desc };
    });

    // Combine with code+desc lines already parsed correctly, preserve order from original code groups
    const allCodeLines = [];
    for (const g of codeGroups) {
      for (const line of g.lines) {
        const parsed = parseFormLine(line, knownPrefixes);
        if (parsed.normalizedCode && !parsed.description.trim()) {
          // Find matching merged entry
          const m = merged.find(x => x.normalizedCode === parsed.normalizedCode && !x._used);
          if (m) { m._used = true; allCodeLines.push(m); }
          else { allCodeLines.push(parsed); }
        } else {
          allCodeLines.push(parsed);
        }
      }
    }

    return allCodeLines.length ? allCodeLines : null;
  }

  function parseSchedule(text, knownPrefixes) {
    const prefixes = knownPrefixes || defaultPrefixes;
    const rawLines = String(text || "").split(/\r?\n/);
    const nonEmpty = rawLines.filter(l => cleanText(l));

    // Try split-column detection first
    if (nonEmpty.length >= 4) {
      const splitResult = detectSplitColumn(rawLines, prefixes);
      if (splitResult && splitResult.length) return splitResult;
    }

    // Normal single-column parse
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


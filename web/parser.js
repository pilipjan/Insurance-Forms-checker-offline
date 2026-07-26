(function () {
  const defaultPrefixes = [
    "AG", "AP", "B", "BM", "BP", "CA", "CF", "CG", "CL", "CM", "CP", "CR", "CU", "CX", "CY",
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
    const compact = cleanText(normalizedCode).replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z]{2}\d{8}$/.test(compact)) return normalizedCode || "";
    const prefix = compact.slice(0, 2);
    const form = compact.slice(2, 6);
    const edition = compact.slice(6, 10);
    return `${prefix} ${form.slice(0, 2)} ${form.slice(2)} (${edition.slice(0, 2)}/${edition.slice(2)})`;
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

    const match = clean.match(/^\s*([A-Z]{2})\s*(\d{2})\s*(\d{2})\s*(?:\(?\s*(\d{2})\s*\/?\s*(\d{2})\s*\)?)?/i);
    if (!match) return result;

    const prefix = match[1].toUpperCase();
    const formNumber = `${match[2]}${match[3]}`;
    const edition = match[4] && match[5] ? `${match[4]}${match[5]}` : "";
    const normalizedCode = `${prefix}${formNumber}${edition}`;
    const description = cleanText(clean.slice(match[0].length));
    const known = knownPrefixes.includes(prefix);

    return {
      ...result,
      normalizedCode,
      baseCode: `${prefix}${formNumber}`,
      displayCode: displayFormCode(normalizedCode),
      edition,
      displayEdition: formatEdition(edition),
      description,
      known,
      parseStatus: known && normalizedCode ? "Parsed" : "Unknown Format",
    };
  }

  function parseSchedule(text, knownPrefixes) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => parseFormLine(line, knownPrefixes))
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

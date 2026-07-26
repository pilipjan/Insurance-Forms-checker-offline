(function () {
  const samples = {
    previous: [
      "CG20100413 ADDITIONAL INSURED - OWNERS, LESSEES OR CONTRACTORS",
      "CG 20 37 (04/13) ADDITIONAL INSURED - OWNERS, LESSEES OR CONTRACTORS - COMPLETED OPERATIONS",
      "IL00171198 COMMON POLICY CONDITIONS",
      "CA 00 01 10/13 BUSINESS AUTO COVERAGE FORM",
      "CP00100695 BUILDING AND PERSONAL PROPERTY COVERAGE FORM",
      "WEIRD OCR LINE WITHOUT A FORM NUMBER",
    ].join("\n"),
    current: [
      "CG 20 10 (12/19) ADDITIONAL INSURED - OWNERS, LESSEES OR CONTRACTORS",
      "CG 20 37 (04/13) ADDITIONAL INSURED - OWNERS, LESSEES OR CONTRACTORS - COMPLETED OPERATIONS",
      "IL 00 17 (11/98) COMMON POLICY CONDITIONS",
      "CA00011013 BUSINESS AUTO COVERAGE FORM",
      "BP 00 03 07/13 BUSINESSOWNERS COVERAGE FORM",
      "OCR? CP FORM BADLY SCANNED",
    ].join("\n"),
    quote: [
      "CG 20 10 (12/19) ADDITIONAL INSURED - OWNERS, LESSEES OR CONTRACTORS",
      "CG 20 37 (04/13) ADDITIONAL INSURED - OWNERS, LESSEES OR CONTRACTORS - COMPLETED OPERATIONS",
      "BP 00 03 07/13 BUSINESSOWNERS COVERAGE FORM",
    ].join("\n"),
  };

  const state = {
    prefixes: window.ComparatorParser.defaultPrefixes.slice(),
    previousItems: [],
    currentItems: [],
    quoteItems: [],
    fourthItems: [],
    results: [],
    checklistRows: [],
    collapsedResultGroups: new Set(),
  };

  const draftStorageKey = "formsComparatorDraftV1";
  let draftSaveTimer = null;

  const elements = {
    previousInput: document.getElementById("previousInput"),
    currentInput: document.getElementById("currentInput"),
    quoteInput: document.getElementById("quoteInput"),
    fourthInput: document.getElementById("fourthInput"),
    previousPreview: document.getElementById("previousPreview"),
    currentPreview: document.getElementById("currentPreview"),
    quotePreview: document.getElementById("quotePreview"),
    fourthPreview: document.getElementById("fourthPreview"),
    resultsBody: document.getElementById("resultsBody"),
    excelChecklistBody: document.getElementById("excelChecklistBody"),
    resultViewSelect: document.getElementById("resultViewSelect"),
    prefixInput: document.getElementById("prefixInput"),
    lastCompared: document.getElementById("lastCompared"),
    comparisonTime: document.getElementById("comparisonTime"),
    pieChart: document.getElementById("pieChart"),
    barChart: document.getElementById("barChart"),
    offlineStatus: document.getElementById("offlineStatus"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    memoryStatus: document.getElementById("memoryStatus"),
  };

  const metricIds = {
    Previous: "metricPrevious",
    Current: "metricCurrent",
    Match: "metricMatch",
    Added: "metricAdded",
    Removed: "metricRemoved",
    "Edition Changed": "metricChanged",
    "Unknown Format": "metricUnknown",
    Completion: "metricCompletion",
  };

  function statusClass(status) {
    return `status-${status.toLowerCase().replace(/\s+/g, "-")}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderPreview(target, items) {
    target.innerHTML = items.length
      ? items.map((item) => `
          <tr class="${statusClass(item.parseStatus)}">
            <td>${escapeHtml(item.parseStatus)}</td>
            <td>${escapeHtml(item.displayCode)}</td>
            <td>${escapeHtml(item.displayEdition)}</td>
            <td>${escapeHtml(item.description)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="4">No parsed rows yet.</td></tr>`;
  }

  function renderResults() {
    const rows = selectedResults();
    if (!rows.length) {
      elements.resultsBody.innerHTML = `<tr><td colspan="8">Run a comparison to see results for the selected document.</td></tr>`;
      updateExportScopeNote();
      return;
    }

    if (selectedSource() === "all") {
      const groups = groupRowsBySource(rows);
      elements.resultsBody.innerHTML = groups.map(({ source, rows: groupRows }) => {
        const collapsed = state.collapsedResultGroups.has(source);
        const counts = summarize(groupRows);
        const meta = `${groupRows.length} rows | ${counts.Match || 0} match | ${counts.Added || 0} added | ${counts.Removed || 0} removed | ${counts["Edition Changed"] || 0} revised | ${counts["Unknown Format"] || 0} unknown`;
        return `
          <tr class="result-group-row">
            <td colspan="8">
              <button class="result-group-button" type="button" data-result-group="${escapeHtml(source)}">
                ${collapsed ? "Expand" : "Minimize"} ${escapeHtml(displaySourceName(source))}
              </button>
              <span class="result-group-meta">${escapeHtml(meta)}</span>
            </td>
          </tr>
          ${collapsed ? "" : groupRows.map(resultRowHtml).join("")}
        `;
      }).join("");
      updateExportScopeNote();
      return;
    }

    elements.resultsBody.innerHTML = rows.map(resultRowHtml).join("");
    updateExportScopeNote();
  }

  function resultRowHtml(item) {
    return `
          <tr class="${statusClass(item.status)}">
            <td>${escapeHtml(item.status)}</td>
            <td>${escapeHtml(item.source || "Current Policy")}</td>
            <td>${escapeHtml(item.displayCode || item.normalizedCode)}</td>
            <td>${escapeHtml(item.originalPrevious)}</td>
            <td>${escapeHtml(item.originalCurrent)}</td>
            <td>${escapeHtml(item.description)}</td>
            <td>${escapeHtml(item.edition)}</td>
            <td>${escapeHtml(item.notes)}</td>
          </tr>
        `;
  }

  function groupRowsBySource(rows) {
    const sourceOrder = ["Current Policy", "Quote / 3rd Document", "4th Document"];
    return sourceOrder
      .map((source) => ({ source, rows: rows.filter((row) => (row.source || "Current Policy") === source) }))
      .filter((group) => group.rows.length);
  }

  function displaySourceName(source) {
    if (source === "Quote / 3rd Document") return "3rd Document";
    return source;
  }

  function updateExportScopeNote() {
    const note = document.getElementById("exportScopeNote");
    if (!note) return;
    const source = selectedSource();
    const label = source === "all" ? "All compared documents" : displaySourceName(source);
    note.textContent = `Exports use the selected Display / Export view: ${label}.`;
  }

  function selectedSource() {
    return elements.resultViewSelect ? elements.resultViewSelect.value : "all";
  }

  function selectedResults() {
    const source = selectedSource();
    return source === "all" ? state.results : state.results.filter((row) => (row.source || "Current Policy") === source);
  }

  function selectedChecklistRows() {
    const source = selectedSource();
    return source === "all" ? state.checklistRows : state.checklistRows.filter((row) => row.source === source);
  }

  function checklistStatus(status) {
    return status === "Edition Changed" ? "Revised" : status;
  }

  function formDescription(row) {
    const code = (row.displayCode || row.normalizedCode || "").replace(/\s*\(\d{2}\/\d{2}\)\s*$/, "");
    return [code, row.description].filter(Boolean).join(" ") || code || row.normalizedCode || "";
  }

  function makeChecklistRows(results) {
    return results
      .filter((row) => row.status !== "Unknown Format")
      .map((row) => ({
        formDescription: formDescription(row),
        edition: checklistEdition(row.edition),
        status: checklistStatus(row.status),
        source: row.source || "Current Policy",
      }));
  }

  function checklistEdition(value) {
    let edition = String(value || "").trim();
    if (edition.includes("->")) edition = edition.split("->").pop().trim();
    if (!edition) return "";
    return edition.startsWith("(") ? edition : `(${edition})`;
  }

  function renderChecklist() {
    const rows = selectedChecklistRows();
    elements.excelChecklistBody.innerHTML = rows.length
      ? rows.map((row) => `
          <tr class="${statusClass(row.status)}">
            <td>${escapeHtml(row.formDescription)}</td>
            <td>${escapeHtml(row.edition)}</td>
            <td>${escapeHtml(row.status)}</td>
            <td>${escapeHtml(row.source)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="4">Run a comparison to generate Excel-ready rows for the selected document.</td></tr>`;
  }

  function summarize(results) {
    return results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
  }

  function updateMetrics(summary, comparisonMeta) {
    const total = Math.max(1, state.results.length);
    const known = (summary.Match || 0) + (summary.Added || 0) + (summary.Removed || 0) + (summary["Edition Changed"] || 0);
    const completion = Math.round((known / total) * 100);
    const values = {
      Previous: comparisonMeta ? comparisonMeta.previousCount : state.previousItems.length,
      Current: comparisonMeta ? comparisonMeta.currentCount : state.currentItems.length,
      Match: summary.Match || 0,
      Added: summary.Added || 0,
      Removed: summary.Removed || 0,
      "Edition Changed": summary["Edition Changed"] || 0,
      "Unknown Format": summary["Unknown Format"] || 0,
      Completion: `${state.results.length ? completion : 0}%`,
    };

    for (const [key, id] of Object.entries(metricIds)) {
      document.getElementById(id).textContent = values[key];
    }
  }

  function cleanPrevious() {
    state.prefixes = window.ComparatorParser.parsePrefixes(elements.prefixInput.value);
    state.previousItems = window.ComparatorParser.parseSchedule(elements.previousInput.value, state.prefixes);
    renderPreview(elements.previousPreview, state.previousItems);
    updateMetrics(summarize(state.results), null);
  }

  function cleanCurrent() {
    state.prefixes = window.ComparatorParser.parsePrefixes(elements.prefixInput.value);
    state.currentItems = window.ComparatorParser.parseSchedule(elements.currentInput.value, state.prefixes);
    renderPreview(elements.currentPreview, state.currentItems);
    updateMetrics(summarize(state.results), null);
  }

  function cleanQuote() {
    state.prefixes = window.ComparatorParser.parsePrefixes(elements.prefixInput.value);
    state.quoteItems = window.ComparatorParser.parseSchedule(elements.quoteInput.value, state.prefixes);
    renderPreview(elements.quotePreview, state.quoteItems);
  }

  function cleanFourth() {
    state.prefixes = window.ComparatorParser.parsePrefixes(elements.prefixInput.value);
    state.fourthItems = window.ComparatorParser.parseSchedule(elements.fourthInput.value, state.prefixes);
    renderPreview(elements.fourthPreview, state.fourthItems);
  }

  function compareAgainstPrevious(label, items) {
    const comparison = window.ComparatorEngine.compareSchedules(state.previousItems, items);
    comparison.results.forEach((row) => {
      row.source = label;
      if (label !== "Current Policy") row.notes = `${label}: ${row.notes}`;
    });
    return comparison;
  }

  function compare() {
    const started = performance.now();
    cleanPrevious();
    cleanCurrent();
    if (!document.getElementById("quotePane").classList.contains("hidden")) cleanQuote();
    if (!document.getElementById("fourthPane").classList.contains("hidden")) cleanFourth();

    const comparisons = [compareAgainstPrevious("Current Policy", state.currentItems)];
    if (state.quoteItems.length) comparisons.push(compareAgainstPrevious("Quote / 3rd Document", state.quoteItems));
    if (state.fourthItems.length) comparisons.push(compareAgainstPrevious("4th Document", state.fourthItems));

    const comparison = comparisons[0];
    state.results = comparisons.flatMap((item) => item.results);
    state.checklistRows = makeChecklistRows(state.results);
    const summary = summarize(state.results);
    renderResults();
    renderChecklist();
    updateMetrics(summary, comparison);
    drawCharts(summary);
    const seconds = ((performance.now() - started) / 1000).toFixed(2);
    elements.comparisonTime.textContent = `${seconds} sec`;
    elements.lastCompared.textContent = new Date().toLocaleString();
    saveDraft();
  }

  function drawCharts(summary) {
    const data = [
      ["Match", summary.Match || 0, "#15803d"],
      ["Added", summary.Added || 0, "#a16207"],
      ["Removed", summary.Removed || 0, "#b91c1c"],
      ["Edition Changed", summary["Edition Changed"] || 0, "#c2410c"],
      ["Unknown", summary["Unknown Format"] || 0, "#64748b"],
    ];
    drawPie(elements.pieChart, data);
    drawBars(elements.barChart, data);
  }

  function drawPie(canvas, data) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const total = data.reduce((sum, item) => sum + item[1], 0);
    const cx = 108;
    const cy = 112;
    const radius = 78;
    let angle = -Math.PI / 2;

    if (!total) {
      ctx.fillStyle = "#e5e7eb";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (const [, value, color] of data) {
        const slice = (value / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, angle, angle + slice);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        angle += slice;
      }
    }

    data.forEach((item, index) => {
      const y = 54 + index * 28;
      ctx.fillStyle = item[2];
      ctx.fillRect(220, y - 10, 14, 14);
      ctx.fillStyle = "#172033";
      ctx.font = "13px Segoe UI, Arial";
      ctx.fillText(`${item[0]}: ${item[1]}`, 244, y + 1);
    });
  }

  function drawBars(canvas, data) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const max = Math.max(1, ...data.map((item) => item[1]));
    const left = 132;
    const top = 28;
    const rowHeight = 34;
    const barMax = width - left - 64;

    ctx.font = "13px Segoe UI, Arial";
    data.forEach((item, index) => {
      const y = top + index * rowHeight;
      const barWidth = (item[1] / max) * barMax;
      ctx.fillStyle = "#334155";
      ctx.fillText(item[0], 12, y + 18);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(left, y, barMax, 18);
      ctx.fillStyle = item[2];
      ctx.fillRect(left, y, barWidth, 18);
      ctx.fillStyle = "#172033";
      ctx.fillText(String(item[1]), left + barMax + 14, y + 15);
    });
  }

  function toCsv(rows) {
    const headers = ["Source", "Status", "Normalized Code", "Original Previous", "Original Current", "Description", "Edition", "Notes"];
    const body = rows.map((row) => [
      row.source || "Current Policy",
      row.status,
      row.displayCode || row.normalizedCode,
      row.originalPrevious,
      row.originalCurrent,
      row.description,
      row.edition,
      row.notes,
    ]);
    return [headers, ...body]
      .map((line) => line.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  function checklistTsv() {
    const headers = ["Form / Description", "Edition", "Status", "Compared Document"];
    const body = selectedChecklistRows().map((row) => [row.formDescription, row.edition, row.status, row.source]);
    return [headers, ...body]
      .map((line) => line.map((cell) => String(cell || "").replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"))
      .join("\n");
  }

  function excelHtml() {
    const resultRows = selectedResults();
    const checklistRows = selectedChecklistRows();
    const label = selectedSource() === "all" ? "All compared documents" : displaySourceName(selectedSource());
    const table = (headers, rows) => `
      <table border="1">
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
    const resultTable = table(
      ["Source", "Status", "Code", "Original Previous", "Original Compared", "Description", "Edition", "Notes"],
      resultRows.map((row) => [
        row.source || "Current Policy",
        row.status,
        row.displayCode || row.normalizedCode,
        row.originalPrevious,
        row.originalCurrent,
        row.description,
        row.edition,
        row.notes,
      ])
    );
    const checklistTable = table(
      ["Form / Description", "Edition", "Status", "Compared Document"],
      checklistRows.map((row) => [row.formDescription, row.edition, row.status, row.source])
    );
    return `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Comparison Results - ${escapeHtml(label)}</h1>${resultTable}<h1>Excel Paste Checklist - ${escapeHtml(label)}</h1>${checklistTable}</body></html>`;
  }

  async function copyChecklist() {
    const text = checklistTsv();
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement("textarea");
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    document.getElementById("copyExcelBtn").textContent = "Copied";
    window.setTimeout(() => {
      document.getElementById("copyExcelBtn").textContent = "Copy for Excel";
    }, 1400);
  }

  function downloadFile(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function draftPayload() {
    return {
      savedAt: new Date().toISOString(),
      previousInput: elements.previousInput.value,
      currentInput: elements.currentInput.value,
      quoteInput: elements.quoteInput.value,
      fourthInput: elements.fourthInput.value,
      prefixes: elements.prefixInput.value,
      quoteVisible: !document.getElementById("quotePane").classList.contains("hidden"),
      fourthVisible: !document.getElementById("fourthPane").classList.contains("hidden"),
      resultView: selectedSource(),
    };
  }

  function updateMemoryStatus(savedAt) {
    if (!elements.memoryStatus) return;
    elements.memoryStatus.textContent = savedAt
      ? `Saved locally ${new Date(savedAt).toLocaleString()}.`
      : "No saved draft yet.";
  }

  function saveDraft() {
    try {
      const payload = draftPayload();
      localStorage.setItem(draftStorageKey, JSON.stringify(payload));
      updateMemoryStatus(payload.savedAt);
    } catch (error) {
      if (elements.memoryStatus) elements.memoryStatus.textContent = "Draft memory is unavailable in this browser.";
    }
  }

  function scheduleDraftSave() {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(saveDraft, 450);
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) {
        updateMemoryStatus(null);
        return false;
      }

      const draft = JSON.parse(raw);
      elements.previousInput.value = draft.previousInput || "";
      elements.currentInput.value = draft.currentInput || "";
      elements.quoteInput.value = draft.quoteInput || "";
      elements.fourthInput.value = draft.fourthInput || "";
      elements.prefixInput.value = draft.prefixes || elements.prefixInput.value;
      if (draft.quoteVisible || draft.quoteInput) document.getElementById("quotePane").classList.remove("hidden");
      if (draft.fourthVisible || draft.fourthInput) document.getElementById("fourthPane").classList.remove("hidden");
      if (draft.resultView && elements.resultViewSelect.querySelector(`option[value="${draft.resultView}"]`)) {
        elements.resultViewSelect.value = draft.resultView;
      }
      updateMemoryStatus(draft.savedAt);
      return true;
    } catch (error) {
      updateMemoryStatus(null);
      return false;
    }
  }

  function clearSavedDraft() {
    try {
      localStorage.removeItem(draftStorageKey);
    } catch (error) {
      // Current page data remains available even if browser storage fails.
    }
    updateMemoryStatus(null);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    elements.themeToggleBtn.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
  }

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    drawCharts(summarize(state.results));
    try {
      localStorage.setItem("formsComparatorTheme", nextTheme);
    } catch (error) {
      // Theme preference only; policy data is never stored.
    }
  }

  function clearAll() {
    elements.previousInput.value = "";
    elements.currentInput.value = "";
    elements.quoteInput.value = "";
    elements.fourthInput.value = "";
    state.previousItems = [];
    state.currentItems = [];
    state.quoteItems = [];
    state.fourthItems = [];
    state.results = [];
    state.checklistRows = [];
    renderPreview(elements.previousPreview, []);
    renderPreview(elements.currentPreview, []);
    renderPreview(elements.quotePreview, []);
    renderPreview(elements.fourthPreview, []);
    renderResults();
    renderChecklist();
    updateMetrics({}, null);
    drawCharts({});
    elements.lastCompared.textContent = "Not compared";
    elements.comparisonTime.textContent = "0.00 sec";
  }

  document.getElementById("cleanPreviousBtn").addEventListener("click", cleanPrevious);
  document.getElementById("cleanCurrentBtn").addEventListener("click", cleanCurrent);
  document.getElementById("cleanQuoteBtn").addEventListener("click", cleanQuote);
  document.getElementById("cleanFourthBtn").addEventListener("click", cleanFourth);
  document.getElementById("compareBtn").addEventListener("click", compare);
  document.getElementById("applySettingsBtn").addEventListener("click", () => {
    state.prefixes = window.ComparatorParser.parsePrefixes(elements.prefixInput.value);
    cleanPrevious();
    cleanCurrent();
    cleanQuote();
    cleanFourth();
  });
  document.getElementById("loadSamplesBtn").addEventListener("click", () => {
    elements.previousInput.value = samples.previous;
    elements.currentInput.value = samples.current;
    elements.quoteInput.value = samples.quote;
    document.getElementById("quotePane").classList.remove("hidden");
    compare();
  });
  document.getElementById("showQuoteBtn").addEventListener("click", () => {
    document.getElementById("quotePane").classList.remove("hidden", "collapsed-doc");
    document.getElementById("collapseQuoteBtn").textContent = "Minimize";
    elements.quoteInput.focus();
    scheduleDraftSave();
  });
  document.getElementById("showFourthBtn").addEventListener("click", () => {
    document.getElementById("fourthPane").classList.remove("hidden", "collapsed-doc");
    document.getElementById("collapseFourthBtn").textContent = "Minimize";
    elements.fourthInput.focus();
    scheduleDraftSave();
  });
  document.getElementById("collapseQuoteBtn").addEventListener("click", () => {
    const pane = document.getElementById("quotePane");
    pane.classList.toggle("collapsed-doc");
    document.getElementById("collapseQuoteBtn").textContent = pane.classList.contains("collapsed-doc") ? "Expand" : "Minimize";
  });
  document.getElementById("collapseFourthBtn").addEventListener("click", () => {
    const pane = document.getElementById("fourthPane");
    pane.classList.toggle("collapsed-doc");
    document.getElementById("collapseFourthBtn").textContent = pane.classList.contains("collapsed-doc") ? "Expand" : "Minimize";
  });
  document.getElementById("removeQuoteBtn").addEventListener("click", () => {
    elements.quoteInput.value = "";
    state.quoteItems = [];
    document.getElementById("quotePane").classList.add("hidden");
    if (selectedSource() === "Quote / 3rd Document") elements.resultViewSelect.value = "all";
    renderPreview(elements.quotePreview, []);
    compare();
  });
  document.getElementById("removeFourthBtn").addEventListener("click", () => {
    elements.fourthInput.value = "";
    state.fourthItems = [];
    document.getElementById("fourthPane").classList.add("hidden");
    if (selectedSource() === "4th Document") elements.resultViewSelect.value = "all";
    renderPreview(elements.fourthPreview, []);
    compare();
  });
  document.getElementById("resultViewSelect").addEventListener("change", () => {
    renderResults();
    renderChecklist();
  });
  elements.resultsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-result-group]");
    if (!button) return;
    const source = button.getAttribute("data-result-group");
    if (state.collapsedResultGroups.has(source)) {
      state.collapsedResultGroups.delete(source);
    } else {
      state.collapsedResultGroups.add(source);
    }
    renderResults();
  });
  document.getElementById("clearBtn").addEventListener("click", clearAll);
  document.getElementById("saveDraftBtn").addEventListener("click", saveDraft);
  document.getElementById("clearDraftBtn").addEventListener("click", clearSavedDraft);
  document.getElementById("themeToggleBtn").addEventListener("click", toggleTheme);
  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    downloadFile("insurance-forms-comparison.csv", toCsv(selectedResults()), "text/csv;charset=utf-8");
  });
  document.getElementById("exportExcelBtn").addEventListener("click", () => {
    downloadFile("insurance-forms-comparison.xls", excelHtml(), "application/vnd.ms-excel;charset=utf-8");
  });
  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    downloadFile("insurance-forms-comparison.json", JSON.stringify(selectedResults(), null, 2), "application/json;charset=utf-8");
  });
  document.getElementById("copyExcelBtn").addEventListener("click", copyChecklist);
  document.getElementById("downloadTsvBtn").addEventListener("click", () => {
    downloadFile("insurance-forms-checklist.tsv", checklistTsv(), "text/tab-separated-values;charset=utf-8");
  });
  if ("serviceWorker" in navigator && !document.documentElement.dataset.offlineCopy) {
    navigator.serviceWorker.register("./service-worker.js").then((registration) => {
      registration.update();
      if (elements.offlineStatus) elements.offlineStatus.textContent = "Offline cache is active. The standalone download is also available.";
    }).catch(() => {
      if (elements.offlineStatus) elements.offlineStatus.textContent = "Standalone offline download is available.";
    });
  }

  try {
    applyTheme(localStorage.getItem("formsComparatorTheme") || "light");
  } catch (error) {
    applyTheme("light");
  }
  const hadDraft = loadDraft();
  [elements.previousInput, elements.currentInput, elements.quoteInput, elements.fourthInput, elements.prefixInput].forEach((field) => {
    field.addEventListener("input", scheduleDraftSave);
  });
  window.addEventListener("beforeunload", saveDraft);
  renderPreview(elements.previousPreview, []);
  renderPreview(elements.currentPreview, []);
  renderPreview(elements.quotePreview, []);
  renderPreview(elements.fourthPreview, []);
  renderResults();
  renderChecklist();
  updateMetrics({}, null);
  drawCharts({});
  if (hadDraft && (elements.previousInput.value || elements.currentInput.value || elements.quoteInput.value || elements.fourthInput.value)) {
    compare();
  }
})();

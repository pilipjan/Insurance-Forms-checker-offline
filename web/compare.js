(function () {
  function buildKnownMap(items) {
    const map = new Map();
    const unknown = [];

    for (const item of items) {
      if (item.known && item.normalizedCode) {
        if (!map.has(item.normalizedCode)) {
          map.set(item.normalizedCode, { ...item, duplicates: [] });
        } else {
          map.get(item.normalizedCode).duplicates.push(item.raw);
        }
      } else {
        unknown.push(item);
      }
    }

    return { map, unknown };
  }

  function buildBaseLookup(map) {
    const lookup = new Map();
    for (const [normalizedCode, item] of map.entries()) {
      if (item.baseCode && !lookup.has(item.baseCode)) {
        lookup.set(item.baseCode, normalizedCode);
      }
    }
    return lookup;
  }

  function preferredDescription(previousItem, currentItem) {
    return currentItem.description || previousItem.description || "";
  }

  function makeResult(status, normalizedCode, previousItem, currentItem, notes) {
    const edition = status === "Edition Changed"
      ? `${window.ComparatorParser.formatEdition(previousItem.edition)} -> ${window.ComparatorParser.formatEdition(currentItem.edition)}`
      : window.ComparatorParser.formatEdition((currentItem || previousItem || {}).edition || "");

    return {
      status,
      normalizedCode: normalizedCode || "",
      displayCode: normalizedCode ? window.ComparatorParser.displayFormCode(normalizedCode) : "",
      originalPrevious: previousItem ? previousItem.raw : "",
      originalCurrent: currentItem ? currentItem.raw : "",
      description: previousItem && currentItem ? preferredDescription(previousItem, currentItem) : ((currentItem || previousItem || {}).description || ""),
      edition,
      notes,
    };
  }

  function compareSchedules(previousItems, currentItems) {
    const previous = buildKnownMap(previousItems);
    const current = buildKnownMap(currentItems);
    const currentBaseLookup = buildBaseLookup(current.map);
    const previousBaseLookup = buildBaseLookup(previous.map);
    const editionChangedCurrentCodes = new Set();
    const results = [];

    for (const [previousCode, previousItem] of previous.map.entries()) {
      if (current.map.has(previousCode)) {
        results.push(makeResult("Match", previousCode, previousItem, current.map.get(previousCode), "Exact form and edition match."));
        continue;
      }

      if (currentBaseLookup.has(previousItem.baseCode)) {
        const currentCode = currentBaseLookup.get(previousItem.baseCode);
        const currentItem = current.map.get(currentCode);
        editionChangedCurrentCodes.add(currentCode);
        results.push(makeResult("Edition Changed", currentItem.normalizedCode, previousItem, currentItem, "Same form number with a different edition."));
        continue;
      }

      results.push(makeResult("Removed", previousCode, previousItem, null, "Present in Previous only."));
    }

    for (const [currentCode, currentItem] of current.map.entries()) {
      if (!previous.map.has(currentCode) && !editionChangedCurrentCodes.has(currentCode) && !previousBaseLookup.has(currentItem.baseCode)) {
        results.push(makeResult("Added", currentCode, null, currentItem, "Present in Current only."));
      }
    }

    for (const item of previous.unknown) {
      results.push({
        status: "Unknown Format",
        normalizedCode: item.clean,
        displayCode: item.clean,
        originalPrevious: item.raw,
        originalCurrent: "",
        description: item.description || "",
        edition: window.ComparatorParser.formatEdition(item.edition),
        notes: "Review raw Previous input.",
      });
    }

    for (const item of current.unknown) {
      results.push({
        status: "Unknown Format",
        normalizedCode: item.clean,
        displayCode: item.clean,
        originalPrevious: "",
        originalCurrent: item.raw,
        description: item.description || "",
        edition: window.ComparatorParser.formatEdition(item.edition),
        notes: "Review raw Current input.",
      });
    }

    return {
      results,
      previousKnownCount: previous.map.size,
      currentKnownCount: current.map.size,
      previousCount: previousItems.length,
      currentCount: currentItems.length,
      unknownCount: previous.unknown.length + current.unknown.length,
    };
  }

  window.ComparatorEngine = {
    compareSchedules,
  };
})();

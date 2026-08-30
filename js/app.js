/* NYC Subway Station Checklist */
(function () {
  "use strict";

  var DATA = window.SUBWAY_DATA;
  var STORE_KEY = "nyc-subway-visited-v1";
  var SETTINGS_KEY = "nyc-subway-settings-v1";
  var UNVISITED_COLOR = "#c3c8cf";
  var VISITED_FILL = "#00933C";

  // ---- state ----------------------------------------------------------
  var visited = loadJSON(STORE_KEY) || {}; // stationId -> ISO date string
  var settings = loadJSON(SETTINGS_KEY) || { includeSIR: true };
  var focusedRoute = null;

  var stationById = {};
  DATA.stations.forEach(function (s) { stationById[s.id] = s; });

  var routeById = {};
  DATA.routes.forEach(function (r) { routeById[r.id] = r; });

  function isSIROnly(s) {
    return s.routes.length === 1 && s.routes[0] === "SI";
  }

  function loadJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(visited));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* storage unavailable; app still works for the session */ }
  }

  // ---- map ------------------------------------------------------------
  var map = L.map("map", { zoomControl: true }).setView([40.734, -73.925], 11);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a> &mdash; data: MTA GTFS',
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(map);

  var segmentLayers = []; // { line, route, a, b }
  DATA.segments.forEach(function (seg) {
    var line = L.polyline(seg.pts, {
      color: UNVISITED_COLOR,
      weight: 3,
      opacity: 0.9,
      interactive: false
    }).addTo(map);
    segmentLayers.push({ line: line, route: seg.route, a: seg.a, b: seg.b });
  });

  function markerRadius() {
    var z = map.getZoom();
    return z >= 15 ? 8 : z >= 13 ? 6 : z >= 12 ? 5 : 4;
  }

  var stationMarkers = {}; // id -> circleMarker
  DATA.stations.forEach(function (s) {
    var m = L.circleMarker([s.lat, s.lon], {
      radius: markerRadius(),
      weight: 2,
      color: "#ffffff",
      fillOpacity: 1
    }).addTo(map);
    m.bindPopup(function () { return popupHtml(s); }, { closeButton: true });
    m.bindTooltip(s.name, { direction: "top", offset: [0, -6], opacity: 0.9 });
    stationMarkers[s.id] = m;
  });

  map.on("zoomend", function () {
    var r = markerRadius();
    Object.keys(stationMarkers).forEach(function (id) {
      stationMarkers[id].setRadius(r);
    });
  });

  // ---- rendering ------------------------------------------------------
  function styleStation(id) {
    var m = stationMarkers[id];
    var s = stationById[id];
    var isVisited = !!visited[id];
    var dimmed = focusedRoute && s.routes.indexOf(focusedRoute) === -1;
    m.setStyle({
      fillColor: isVisited ? VISITED_FILL : "#9aa1ab",
      color: "#ffffff",
      opacity: dimmed ? 0.25 : 1,
      fillOpacity: dimmed ? 0.25 : 1
    });
  }

  function styleSegment(sl) {
    var unlocked = visited[sl.a] && visited[sl.b];
    var dimmed = focusedRoute && sl.route !== focusedRoute;
    sl.line.setStyle({
      color: unlocked ? routeById[sl.route].color : UNVISITED_COLOR,
      weight: unlocked ? 4 : 3,
      opacity: dimmed ? 0.12 : unlocked ? 0.95 : 0.75
    });
    if (unlocked && !dimmed) sl.line.bringToFront();
  }

  function refreshMap(ids) {
    if (ids) {
      ids.forEach(styleStation);
      segmentLayers.forEach(function (sl) {
        if (ids.indexOf(sl.a) !== -1 || ids.indexOf(sl.b) !== -1) styleSegment(sl);
      });
    } else {
      DATA.stations.forEach(function (s) { styleStation(s.id); });
      segmentLayers.forEach(styleSegment);
    }
  }

  function routeBadge(rid, small) {
    var r = routeById[rid];
    if (!r) return "";
    return '<span class="route-badge' + (small ? " small" : "") + '" style="background:' +
      r.color + ";color:" + r.textColor + '">' + escapeHtml(r.name) + "</span>";
  }

  function popupHtml(s) {
    var date = visited[s.id];
    var html = '<div class="popup-station" data-id="' + s.id + '">';
    html += '<div class="p-name">' + escapeHtml(s.name) + "</div>";
    html += '<div class="p-badges">' + s.routes.map(function (r) { return routeBadge(r, true); }).join("") + "</div>";
    if (date) {
      html += '<button class="unvisit" data-action="toggle">Remove visit</button>';
      html += '<div class="p-date">Visited ' + formatDate(date) + "</div>";
    } else {
      html += '<button data-action="toggle">Mark as visited ✓</button>';
    }
    return html + "</div>";
  }

  // Capture-phase delegation: the handler must run before Leaflet's map
  // click handling, and must survive the popup content being re-rendered.
  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest && ev.target.closest('.popup-station [data-action="toggle"]');
    if (!btn) return;
    ev.stopPropagation();
    var wrap = btn.closest(".popup-station");
    var id = wrap.getAttribute("data-id");
    toggleVisited(id);
    wrap.outerHTML = popupHtml(stationById[id]);
  }, true);

  // ---- progress & sidebar --------------------------------------------
  var el = {
    topbarCount: document.getElementById("topbar-count"),
    topbarBar: document.getElementById("topbar-bar-fill"),
    bigCount: document.getElementById("big-count"),
    bigBar: document.getElementById("big-bar-fill"),
    lineList: document.getElementById("line-list"),
    stationList: document.getElementById("station-list"),
    search: document.getElementById("search"),
    includeSIR: document.getElementById("include-sir")
  };

  function counted(s) {
    return settings.includeSIR || !isSIROnly(s);
  }

  function refreshProgress() {
    var total = 0, done = 0;
    DATA.stations.forEach(function (s) {
      if (!counted(s)) return;
      total++;
      if (visited[s.id]) done++;
    });
    var pct = total ? (100 * done / total) : 0;
    el.topbarCount.textContent = done + " / " + total;
    el.topbarBar.style.width = pct + "%";
    el.bigCount.innerHTML = done + ' <span class="total">/ ' + total + "</span>";
    el.bigBar.style.width = pct + "%";
  }

  function refreshLineList() {
    el.lineList.innerHTML = "";
    var nameCounts = {};
    DATA.routes.forEach(function (r) {
      nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;
    });
    DATA.routes.forEach(function (r) {
      var total = 0, done = 0;
      DATA.stations.forEach(function (s) {
        if (s.routes.indexOf(r.id) === -1) return;
        total++;
        if (visited[s.id]) done++;
      });
      if (!total) return;
      var row = document.createElement("div");
      row.className = "line-row" + (focusedRoute === r.id ? " focused" : "");
      var label = nameCounts[r.name] > 1 && r.longName
        ? '<span class="lname">' + escapeHtml(r.longName) + "</span>"
        : "";
      row.innerHTML = routeBadge(r.id) + label +
        '<div class="bar"><div class="bar-fill" style="width:' + (100 * done / total) + '%"></div></div>' +
        '<span class="counts">' + done + "/" + total + "</span>";
      row.title = (r.id === focusedRoute ? "Click to unfocus " : "Focus ") +
        (r.longName || r.name);
      row.addEventListener("click", function () {
        focusedRoute = focusedRoute === r.id ? null : r.id;
        refreshLineList();
        refreshMap();
      });
      el.lineList.appendChild(row);
    });
  }

  function refreshStationList() {
    var q = el.search.value.trim().toLowerCase();
    el.stationList.innerHTML = "";
    var shown = 0;
    DATA.stations.forEach(function (s) {
      if (q && s.name.toLowerCase().indexOf(q) === -1) return;
      if (focusedRoute && s.routes.indexOf(focusedRoute) === -1) return;
      shown++;
      if (shown > 400) return;
      var row = document.createElement("div");
      row.className = "station-row" + (visited[s.id] ? " visited" : "");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!visited[s.id];
      cb.addEventListener("click", function (ev) {
        ev.stopPropagation();
        toggleVisited(s.id);
      });
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = s.name;
      var badges = document.createElement("span");
      badges.className = "badges";
      badges.innerHTML = s.routes.map(function (r) { return routeBadge(r, true); }).join("");
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(badges);
      row.addEventListener("click", function () {
        map.setView([s.lat, s.lon], Math.max(map.getZoom(), 14));
        stationMarkers[s.id].openPopup();
        if (window.innerWidth <= 760) document.body.classList.remove("sidebar-open");
      });
      el.stationList.appendChild(row);
    });
    if (!shown) {
      el.stationList.innerHTML = '<div class="empty-note">No stations match.</div>';
    }
  }

  function refreshAll(changedIds) {
    refreshMap(changedIds);
    refreshProgress();
    refreshLineList();
    refreshStationList();
  }

  // ---- actions --------------------------------------------------------
  function toggleVisited(id) {
    if (visited[id]) {
      delete visited[id];
    } else {
      visited[id] = new Date().toISOString().slice(0, 10);
    }
    persist();
    refreshAll([id]);
  }

  el.includeSIR.checked = !!settings.includeSIR;
  el.includeSIR.addEventListener("change", function () {
    settings.includeSIR = el.includeSIR.checked;
    persist();
    refreshProgress();
  });

  el.search.addEventListener("input", refreshStationList);

  document.getElementById("sidebar-toggle").addEventListener("click", function () {
    document.body.classList.toggle("sidebar-open");
  });

  // export / import / reset
  document.getElementById("export-btn").addEventListener("click", function () {
    var payload = {
      app: "nyc-subway-checklist",
      exported: new Date().toISOString(),
      visited: visited
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "subway-checklist-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  var importFile = document.getElementById("import-file");
  document.getElementById("import-btn").addEventListener("click", function () {
    importFile.click();
  });
  importFile.addEventListener("change", function () {
    var f = importFile.files[0];
    if (!f) return;
    f.text().then(function (text) {
      var payload = JSON.parse(text);
      var incoming = payload.visited || payload; // accept bare maps too
      if (typeof incoming !== "object" || incoming === null) throw new Error("bad file");
      var merged = 0;
      Object.keys(incoming).forEach(function (id) {
        if (stationById[id] && typeof incoming[id] === "string") {
          visited[id] = incoming[id];
          merged++;
        }
      });
      persist();
      refreshAll();
      alert("Imported " + merged + " visited stations (merged with existing progress).");
    }).catch(function () {
      alert("Could not read that file — expected a JSON export from this app.");
    });
    importFile.value = "";
  });

  document.getElementById("reset-btn").addEventListener("click", function () {
    if (!confirm("Erase ALL visited-station progress? This cannot be undone.")) return;
    visited = {};
    persist();
    refreshAll();
  });

  // ---- utils ----------------------------------------------------------
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatDate(iso) {
    var d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ---- boot -----------------------------------------------------------
  refreshAll();
})();

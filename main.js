// ==UserScript==
// @name         Wanderer Corp Activity Tooltip
// @namespace    https://github.com/wanderer-industries/wanderer
// @version      3.0.0
// @description  On hover over a wormhole system node in Wanderer, show most active corps + alliances
// @author       You
// @match        https://wanderer.riot-formation.com/*
// @match        https://wanderer.ltd/*
// @match        https://*.wanderer.ltd/*
// @match        http://localhost:4000/*
// @match        http://localhost:*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      esi.evetech.net
// @connect      zkillboard.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LOG = (...a) =>
    console.log("%c[Wanderer Tooltip]", "color:#58a6ff;font-weight:bold", ...a);
  const ERR = (...a) =>
    console.error("%c[Wanderer Tooltip]", "color:#f85149;font-weight:bold", ...a);

  LOG("v3.0.0 initialising");

  const HOVER_DELAY_MS = 500;

  GM_addStyle(`
    #wanderer-tooltip {
      position: fixed; z-index: 99999; pointer-events: none; max-width: 320px;
      background: #0d1117; border: 1px solid #2a4a6b; border-radius: 6px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.7); font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 12px; color: #c9d1d9; padding: 0; opacity: 0;
      transition: opacity 0.15s ease; display: none;
    }
    #wanderer-tooltip.visible { opacity: 1; display: block; }
    #wanderer-tooltip .tt-header {
      background: #161b22; border-bottom: 1px solid #2a4a6b; border-radius: 6px 6px 0 0;
      padding: 7px 10px 6px; display: flex; align-items: center; gap: 8px;
    }
    #wanderer-tooltip .tt-sysname { font-weight:700; font-size:13px; color:#58a6ff; flex:1; }
    #wanderer-tooltip .tt-body { padding: 8px 10px 10px; }
    #wanderer-tooltip .tt-section-title {
      font-size:10px; text-transform:uppercase; letter-spacing:.08em;
      color:#8b949e; margin-bottom:4px; margin-top:8px;
    }
    #wanderer-tooltip .tt-section-title:first-child { margin-top:0; }
    #wanderer-tooltip .tt-corp-row { display:flex; align-items:flex-start; gap:7px; padding:3px 0; border-bottom:1px solid #1c2128; }
    #wanderer-tooltip .tt-corp-row:last-child { border-bottom:none; }
    #wanderer-tooltip .tt-corp-rank { font-size:10px; color:#8b949e; width:14px; text-align:right; flex-shrink:0; padding-top:1px; }
    #wanderer-tooltip .tt-corp-logo { width:28px; height:28px; border-radius:3px; flex-shrink:0; object-fit:cover; background:#1c2128; }
    #wanderer-tooltip .tt-corp-info { flex:1; min-width:0; }
    #wanderer-tooltip .tt-corp-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #wanderer-tooltip .tt-corp-meta { font-size:10px; }
    #wanderer-tooltip .tt-days { color:#8b949e; font-weight:600; }
    #wanderer-tooltip .tt-days.active { color:#3fb950; }
    #wanderer-tooltip .tt-last { color:#8b949e; }
    #wanderer-tooltip .tt-last-recent { color:#f85149; font-weight:600; }
    #wanderer-tooltip .tt-divider { border:none; border-top:1px solid #2a4a6b; margin:6px 0 0; }
    #wanderer-tooltip .tt-loading-body { padding: 10px 10px 12px; }
    #wanderer-tooltip .tt-loading-label { color:#8b949e; font-style:italic; margin-bottom:8px; }
    #wanderer-tooltip .tt-stages { display:flex; flex-direction:column; gap:5px; }
    #wanderer-tooltip .tt-stage { display:flex; align-items:center; gap:7px; font-size:11px; color:#484f58; }
    #wanderer-tooltip .tt-stage.active { color:#c9d1d9; }
    #wanderer-tooltip .tt-stage.done { color:#3fb950; }
    #wanderer-tooltip .tt-stage-dot { width:6px; height:6px; border-radius:50%; background:#484f58; flex-shrink:0; }
    #wanderer-tooltip .tt-stage.active .tt-stage-dot { background:#58a6ff; box-shadow:0 0 4px #58a6ff; }
    #wanderer-tooltip .tt-stage.done .tt-stage-dot { background:#3fb950; }
    #wanderer-tooltip .tt-progress-wrap { margin-top:4px; display:flex; align-items:center; gap:8px; }
    #wanderer-tooltip .tt-progress-bg { flex:1; background:#1c2128; border-radius:3px; height:3px; overflow:hidden; }
    #wanderer-tooltip .tt-progress-fill { height:3px; background:#58a6ff; border-radius:3px; transition:width 0.08s linear; }
    #wanderer-tooltip .tt-progress-count { font-size:10px; color:#8b949e; white-space:nowrap; }
    #wanderer-tooltip .tt-error { padding:10px; color:#f85149; font-size:11px; }
    #wanderer-tooltip .tt-empty { padding:10px; color:#8b949e; font-style:italic; font-size:11px; }
    #wanderer-tooltip .tt-sov-value { font-weight:600; color:#c9d1d9; font-size:13px; }
    #wanderer-tooltip .tt-sov-npc { font-weight:600; color:#e3b341; font-size:13px; }
    #wanderer-tooltip .tt-sov-none { color:#8b949e; font-style:italic; }
  `);

  const tooltip = document.createElement("div");
  tooltip.id = "wanderer-tooltip";
  function init() {
    document.body.appendChild(tooltip);
    LOG("Ready ✓  |  Alt+C = clear cache");
  }
  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);

  const killmailCache = new Map(); // immutable — cache indefinitely
  const nameCache = new Map();     // corp/alliance id → name

  const KM_STORE_KEY  = "wandererTooltipKM";
  const KM_MAX_BYTES  = 20 * 1024 * 1024; // 20 MB

  function cacheBytes(map) {
    const b = JSON.stringify([...map.values()]).length;
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(1) + " MB";
  }

  // Load persisted killmails
  try {
    const raw = GM_getValue(KM_STORE_KEY, "[]");
    JSON.parse(raw).forEach(([id, km]) => killmailCache.set(id, km));
    LOG(`Restored ${killmailCache.size} killmails (${cacheBytes(killmailCache)})`);
  } catch (e) {
    ERR("Cache restore failed:", e.message);
  }

  function persistKillmailCache() {
    let entries = [...killmailCache.entries()];
    let json = JSON.stringify(entries);
    if (json.length > KM_MAX_BYTES) {
      entries.sort((a, b) => a[1].time - b[1].time); // oldest first
      while (entries.length && json.length > KM_MAX_BYTES) {
        entries.splice(0, Math.max(1, Math.ceil(entries.length * 0.1)));
        json = JSON.stringify(entries);
      }
      killmailCache.clear();
      entries.forEach(([id, km]) => killmailCache.set(id, km));
      LOG(`Cache trimmed to ${killmailCache.size} entries`);
    }
    GM_setValue(KM_STORE_KEY, json);
  }
  let hoverTimer = null;
  let currentSystem = null;

  // ─── Position ─────────────────────────────────────────────────────────────
  function positionTooltip(x, y) {
    const pad = 14,
      tw = tooltip.offsetWidth || 320,
      th = tooltip.offsetHeight || 160;
    let left = x + pad,
      top = y + pad;
    if (left + tw > window.innerWidth - 8) left = x - tw - pad;
    if (top + th > window.innerHeight - 8) top = y - th - pad;
    tooltip.style.left = Math.max(4, left) + "px";
    tooltip.style.top = Math.max(4, top) + "px";
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  function header(name) {
    return `<div class="tt-header"><span class="tt-sysname">${escHtml(name)}</span></div>`;
  }

  function hrdur(ms) {
    if (ms < 10000) return (ms / 1000).toFixed(2) + " seconds";
    if (ms < 60000) return (ms / 1000).toFixed(0) + " seconds";
    if (ms < 3600000) return (ms / 60000).toFixed(2) + " minutes";
    if (ms < 86400000) return (ms / 3600000).toFixed(2) + " hours";
    return (ms / 86400000).toFixed(2) + " days";
  }

  function renderRows(list) {
    return list
      .map((c, i) => {
        const lastSeen =
          c.lastSeenDaysAgo >= 9999
            ? "unknown"
            : hrdur(c.lastSeenDaysAgo * 86400000) + " ago";
        const recentCls = c.lastSeenDaysAgo < 3 / 24 ? " tt-last-recent" : "";
        return `<div class="tt-corp-row">
        <span class="tt-corp-rank">${i + 1}.</span>
        ${c.logoUrl ? `<img class="tt-corp-logo" src="${escHtml(c.logoUrl)}" alt="">` : ""}
        <div class="tt-corp-info">
          <div class="tt-corp-name" title="${escHtml(c.name)}">${escHtml(c.name)}${c.allianceName ? ` <span style="color:#8b949e">[${escHtml(c.allianceName)}]</span>` : ""}</div>
          <div class="tt-corp-meta">
            <span class="tt-days${c.daysActive >= 3 ? " active" : ""}">${c.daysActive} day${c.daysActive !== 1 ? "s" : ""} active</span>
            <span class="tt-last">,</span> <span class="tt-last${recentCls}">last seen ${lastSeen}</span>
          </div>
        </div>
      </div>`;
      })
      .join("");
  }

  const STAGES = [
    { key: "zkill",     label: "zkillboard"       },
    { key: "killmails", label: "killmail details"  },
    { key: "names",     label: "resolving names"   },
  ];

  function showLoading(name, step, done, total) {
    // For killmail progress updates, patch the bar in-place to avoid layout thrash
    if (step === "killmails" && done > 0 && tooltip._loadingSystem === name) {
      const fill  = tooltip.querySelector(".tt-progress-fill");
      const count = tooltip.querySelector(".tt-progress-count");
      if (fill && count) {
        fill.style.width = ((done / total) * 100).toFixed(1) + "%";
        count.textContent = `${done} / ${total}`;
        return;
      }
    }

    tooltip._loadingSystem = name;

    const stagesHtml = STAGES.map(({ key, label }) => {
      const idx  = STAGES.findIndex((s) => s.key === step);
      const mine = STAGES.findIndex((s) => s.key === key);
      const cls  = mine < idx ? "done" : mine === idx ? "active" : "";
      const extra =
        key === "killmails" && mine <= idx
          ? `<div class="tt-progress-wrap">
               <div class="tt-progress-bg">
                 <div class="tt-progress-fill" style="width:${total ? ((done / total) * 100).toFixed(1) : 0}%"></div>
               </div>
               <span class="tt-progress-count">${total ? `${done} / ${total}` : "…"}</span>
             </div>`
          : "";
      return `<div class="tt-stage ${cls}">
        <span class="tt-stage-dot"></span>
        <span>${label}${key === "killmails" && total && mine > idx ? ` (${total})` : ""}</span>
      </div>${extra}`;
    }).join("");

    tooltip.innerHTML = `${header(name)}<div class="tt-loading-body"><div class="tt-stages">${stagesHtml}</div></div>`;
    tooltip.classList.add("visible");
  }

  function showData(name, data) {
    const hasCorps = data?.corps?.length > 0;
    const hasAlliances = data?.alliances?.length > 0;
    if (!hasCorps && !hasAlliances) {
      tooltip.innerHTML = `${header(name)}<div class="tt-empty">No recent activity found.</div>`;
    } else {
      tooltip.innerHTML = `${header(name)}<div class="tt-body">
        ${hasCorps ? `<div class="tt-section-title">Most Active Corps</div>${renderRows(data.corps)}` : ""}
        ${hasAlliances ? `<hr class="tt-divider"><div class="tt-section-title">Most Active Alliances</div>${renderRows(data.alliances)}` : ""}
      </div>`;
    }
    tooltip.classList.add("visible");
  }

  function showError(name, msg) {
    ERR("Error for", name, ":", msg);
    tooltip.innerHTML = `${header(name)}<div class="tt-error">⚠ ${escHtml(msg)}</div>`;
    tooltip.classList.add("visible");
  }

  function hideTooltip() {
    tooltip.classList.remove("visible");
    currentSystem = null;
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 10000,
        onload(r) {
          if (r.status < 200 || r.status >= 300) {
            reject(new Error(`HTTP ${r.status}`));
            return;
          }
          try {
            resolve(JSON.parse(r.responseText));
          } catch (e) {
            reject(new Error("JSON parse failed"));
          }
        },
        onerror() {
          reject(new Error("Network error"));
        },
        ontimeout() {
          reject(new Error("Timed out"));
        },
      });
    });
  }

  function gmPost(url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        timeout: 10000,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(body),
        onload(r) {
          if (r.status < 200 || r.status >= 300) {
            reject(new Error(`HTTP ${r.status}`));
            return;
          }
          try {
            resolve(JSON.parse(r.responseText));
          } catch (e) {
            reject(new Error("JSON parse failed"));
          }
        },
        onerror() {
          reject(new Error("Network error"));
        },
        ontimeout() {
          reject(new Error("Timed out"));
        },
      });
    });
  }

  // ─── Core pipeline ────────────────────────────────────────────────────────
  async function fetchCorpActivity(sysName, zkillPromise, onStep) {
    const now = Date.now();

    onStep("zkill");
    const zkbKills = await zkillPromise;
    LOG("zkb kills:", zkbKills?.length);
    if (!zkbKills || zkbKills.length === 0) return { corps: [], alliances: [] };

    const CUTOFF_MS = 1000 * 60 * 60 * 24 * 56; // 56 days (8 weeks), matching anoik.is
    const cutoffTs = now - CUTOFF_MS;
    const MAX_KILLS = 200; // zkillboard returns newest-first; 200 covers any 56-day window

    const batch = zkbKills.slice(0, MAX_KILLS);
    const prevCacheSize = killmailCache.size;
    let done = 0;
    onStep("killmails", 0, batch.length);
    const results = await Promise.all(
      batch.map((k) => {
        const cacheKey = k.killmail_id;
        if (killmailCache.has(cacheKey)) {
          onStep("killmails", ++done, batch.length);
          return killmailCache.get(cacheKey);
        }
        return gmFetch(
          `https://esi.evetech.net/latest/killmails/${k.killmail_id}/${k.zkb.hash}/?datasource=tranquility`,
        ).catch((e) => {
          LOG("killmail failed:", k.killmail_id, e.message);
          return null;
        }).then((r) => {
          if (r) killmailCache.set(cacheKey, {
            time: new Date(r.killmail_time).getTime(),
            day:  r.killmail_time.slice(0, 10),
            participants: [r.victim, ...(r.attackers || [])].map((c) => [c.corporation_id || 0, c.alliance_id || 0]),
          });
          onStep("killmails", ++done, batch.length);
          return killmailCache.get(cacheKey) ?? null;
        });
      }),
    );
    const killmails = results.filter(Boolean);
    LOG("killmails fetched:", killmails.length, "/", batch.length, "| cache:", killmailCache.size, "entries /", cacheBytes(killmailCache));
    if (killmailCache.size > prevCacheSize) persistKillmailCache();

    const corpStats = new Map();
    for (const kill of killmails) {
      const killTime = kill.time;
      if (killTime < cutoffTs) continue;
      const killDay = kill.day;
      for (const [corpId, allianceId] of kill.participants) {
        if (!corpId || corpId < 1000000) continue;
        if (!corpStats.has(corpId)) {
          corpStats.set(corpId, { days: new Set(), lastKillTime: 0, allianceId: allianceId || null });
        }
        const s = corpStats.get(corpId);
        s.days.add(killDay);
        if (killTime > s.lastKillTime) s.lastKillTime = killTime;
        if (!s.allianceId && allianceId) s.allianceId = allianceId;
      }
    }
    LOG("unique corps found:", corpStats.size);
    if (corpStats.size === 0) return { corps: [], alliances: [] };

    const ranked = [...corpStats.entries()]
      .map(([corpId, s]) => ({
        corpId,
        allianceId: s.allianceId,
        daysActive: s.days.size,
        lastSeenDaysAgo: s.lastKillTime
          ? (now - s.lastKillTime) / 86400000
          : 9999,
      }))
      .sort(
        (a, b) =>
          b.daysActive - a.daysActive || a.lastSeenDaysAgo - b.lastSeenDaysAgo,
      );
    // Top 3 always; include beyond 3 if they have more than 1 active day (anoik.is rule)
    const sortedCorps = ranked.filter((c, i) => i < 3 || c.daysActive > 1);

    const allianceStats = new Map();
    for (const [, s] of corpStats) {
      if (!s.allianceId) continue;
      if (!allianceStats.has(s.allianceId)) {
        allianceStats.set(s.allianceId, { days: new Set(), lastKillTime: 0 });
      }
      const a = allianceStats.get(s.allianceId);
      for (const d of s.days) a.days.add(d);
      if (s.lastKillTime > a.lastKillTime) a.lastKillTime = s.lastKillTime;
    }
    const rankedAlliances = [...allianceStats.entries()]
      .map(([allianceId, s]) => ({
        allianceId,
        daysActive: s.days.size,
        lastSeenDaysAgo: s.lastKillTime
          ? (now - s.lastKillTime) / 86400000
          : 9999,
      }))
      .sort(
        (a, b) =>
          b.daysActive - a.daysActive || a.lastSeenDaysAgo - b.lastSeenDaysAgo,
      );
    const sortedAlliances = rankedAlliances.filter(
      (a, i) => i < 3 || a.daysActive > 1,
    );

    onStep("names");
    const allIds = [
      ...new Set([
        ...sortedCorps.map((c) => c.corpId),
        ...sortedCorps.map((c) => c.allianceId).filter(Boolean),
        ...sortedAlliances.map((a) => a.allianceId),
      ]),
    ].filter((id) => !nameCache.has(id));
    if (allIds.length) {
      const names = await gmPost(
        "https://esi.evetech.net/latest/universe/names/?datasource=tranquility",
        allIds,
      );
      names.forEach((n) => nameCache.set(n.id, n.name));
    }
    const nameMap = nameCache;

    return {
      corps: sortedCorps.map((c) => ({
        name: nameMap.get(c.corpId) || `Corp #${c.corpId}`,
        allianceName: c.allianceId ? (nameMap.get(c.allianceId) || null) : null,
        logoUrl: `https://images.evetech.net/corporations/${c.corpId}/logo?size=32`,
        daysActive: c.daysActive,
        lastSeenDaysAgo: c.lastSeenDaysAgo,
      })),
      alliances: sortedAlliances.map((a) => ({
        name: nameMap.get(a.allianceId) || `Alliance #${a.allianceId}`,
        logoUrl: `https://images.evetech.net/alliances/${a.allianceId}/logo?size=32`,
        daysActive: a.daysActive,
        lastSeenDaysAgo: a.lastSeenDaysAgo,
      })),
    };
  }

  // ─── System detection ─────────────────────────────────────────────────────
  function isDeadZone(el) {
    let node = el;
    for (let i = 0; i < 8; i++) {
      if (!node || node === document.body) break;
      const cls = typeof node.className === "string" ? node.className : "";
      if (cls.includes("_hoverTarget_") || cls.includes("_tooltip_"))
        return true;
      node = node.parentElement;
    }
    return false;
  }

  function extractSystemInfo(el) {
    let root = el;
    for (let i = 0; i < 10; i++) {
      if (!root || root === document.body) break;
      if (
        typeof root.className === "string" &&
        root.className.includes("_RootCustomNode_")
      )
        break;
      root = root.parentElement;
    }
    if (
      !root ||
      typeof root.className !== "string" ||
      !root.className.includes("_RootCustomNode_")
    )
      return null;

    // Dead zone — bottom row icons
    let checkEl = el;
    for (let i = 0; i < 6; i++) {
      if (!checkEl || checkEl === root) break;
      const cls =
        typeof checkEl.className === "string" ? checkEl.className : "";
      if (
        cls.includes("_BottomRow_") ||
        cls.includes("_hoverTarget_") ||
        cls.includes("pi-users") ||
        checkEl.tagName === "I"
      )
        return null;
      checkEl = checkEl.parentElement;
    }

    const nameEl = root.querySelector('[class*="_classSystemName_"]');
    const name = nameEl ? nameEl.textContent.trim() : null;
    if (!name) return null;

    // Prefer security class detection over name pattern — more reliable
    const secEl = root.querySelector('[class*="eve-security-color-"]');
    const secClass = secEl ? [...secEl.classList].find((c) => c.startsWith("eve-security-color-")) : null;
    let type = null;
    if (secClass) {
      // m- prefix = negative security = null sec; "0" = 0.0 security = also null
      const val = secClass.slice("eve-security-color-".length);
      type = (val === "0" || val.startsWith("m-")) ? "null" : null;
    }
    // Fall back to name pattern for WH systems (no security class)
    if (!type) type = systemType(name);
    if (!type) return null;

    let systemId = null;
    let rfNode = root.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!rfNode || rfNode === document.body) break;
      if (rfNode.classList && rfNode.classList.contains("react-flow__node")) {
        systemId = rfNode.dataset.id;
        break;
      }
      rfNode = rfNode.parentElement;
    }
    if (!systemId) {
      const h = root.querySelector("[data-nodeid]");
      if (h) systemId = h.dataset.nodeid;
    }
    if (!systemId) {
      const h = root.querySelector("[data-id]");
      if (h) systemId = h.dataset.id?.split("-")[0];
    }

    return { name, systemId, type };
  }

  function systemType(s) {
    s = s.trim();
    if (/^J\d{6}$/i.test(s) || /^Thera$/i.test(s)) return "wh";
    return null;
  }

  // ─── Sovereignty ──────────────────────────────────────────────────────────
  let sovMap = null;
  let sovMapPromise = null;

  function getSovMap() {
    if (sovMap) return Promise.resolve(sovMap);
    if (sovMapPromise) return sovMapPromise;
    sovMapPromise = gmFetch("https://esi.evetech.net/latest/sovereignty/map/?datasource=tranquility")
      .then((data) => {
        sovMap = new Map(data.map((e) => [e.system_id, e]));
        sovMapPromise = null;
        LOG("Sov map loaded:", sovMap.size, "systems");
        return sovMap;
      });
    return sovMapPromise;
  }

  async function fetchAndShowSov(name, systemId) {
    tooltip.innerHTML = `${header(name)}<div class="tt-loading-body"><div class="tt-loading-label">Loading sovereignty…</div></div>`;
    tooltip.classList.add("visible");
    try {
      const map = await getSovMap();
      const entry = map.get(Number(systemId));

      let bodyHtml;
      if (entry?.alliance_id) {
        const ids = [entry.alliance_id].filter((id) => !nameCache.has(id));
        if (ids.length) {
          const names = await gmPost("https://esi.evetech.net/latest/universe/names/?datasource=tranquility", ids);
          names.forEach((n) => nameCache.set(n.id, n.name));
        }
        const allianceName = nameCache.get(entry.alliance_id) || `Alliance #${entry.alliance_id}`;
        bodyHtml = `<div class="tt-body">
          <div class="tt-section-title">Sovereignty</div>
          <div class="tt-sov-value">${escHtml(allianceName)}</div>
        </div>`;
      } else if (entry?.faction_id) {
        const ids = [entry.faction_id].filter((id) => !nameCache.has(id));
        if (ids.length) {
          const names = await gmPost("https://esi.evetech.net/latest/universe/names/?datasource=tranquility", ids);
          names.forEach((n) => nameCache.set(n.id, n.name));
        }
        const factionName = nameCache.get(entry.faction_id) || `Faction #${entry.faction_id}`;
        bodyHtml = `<div class="tt-body">
          <div class="tt-section-title">NPC Null Security</div>
          <div class="tt-sov-npc">${escHtml(factionName)}</div>
        </div>`;
      } else {
        bodyHtml = `<div class="tt-body">
          <div class="tt-section-title">NPC Null Security</div>
          <div class="tt-sov-none">No sovereignty held</div>
        </div>`;
      }

      if (currentSystem === name) {
        tooltip.innerHTML = `${header(name)}${bodyHtml}`;
        tooltip.classList.add("visible");
      }
    } catch (err) {
      if (currentSystem === name) showError(name, err.message);
    }
  }

  // ─── Hover logic ──────────────────────────────────────────────────────────
  document.addEventListener("mouseover", (e) => {
    // Dead zone — hide our tooltip silently, keep currentSystem so it can re-show
    if (isDeadZone(e.target)) {
      clearTimeout(hoverTimer);
      tooltip.classList.remove("visible");
      return;
    }

    const info = extractSystemInfo(e.target);

    if (!info) return;

    // Same system — re-show if hidden by dead zone
    if (info.name === currentSystem) {
      tooltip.classList.add("visible");
      return;
    }

    // New system — update immediately
    clearTimeout(hoverTimer);
    currentSystem = info.name;

    if (!info.systemId) {
      showError(info.name, "Could not find solar system ID in DOM");
      return;
    }

    if (info.type === "null") {
      // Prefetch sov map immediately
      getSovMap();
      hoverTimer = setTimeout(() => fetchAndShowSov(info.name, info.systemId), HOVER_DELAY_MS);
      tooltip.innerHTML = `${header(info.name)}<div class="tt-loading-body"><div class="tt-loading-label">Loading sovereignty…</div></div>`;
      tooltip.classList.add("visible");
      return;
    }

    // WH — show loading header right away
    showLoading(info.name, "zkill");

    // Prefetch zkillboard immediately — by the time the hover delay expires it'll likely be done
    const zkillPromise = gmFetch(
      `https://zkillboard.com/api/kills/w-space/solarSystemID/${info.systemId}/`,
    ).catch((e) => { ERR("zkillboard prefetch failed:", e.message); return []; });
    LOG("zkb prefetch started:", info.systemId);

    hoverTimer = setTimeout(async () => {
      try {
        const data = await fetchCorpActivity(
          info.name,
          zkillPromise,
          (step, done, total) => {
            if (currentSystem === info.name) showLoading(info.name, step, done, total);
          },
        );
        if (currentSystem === info.name) showData(info.name, data);
      } catch (err) {
        if (currentSystem === info.name) showError(info.name, err.message);
      }
    }, HOVER_DELAY_MS);
  });

  document.addEventListener("mouseout", (e) => {
    const related = e.relatedTarget;
    if (related) {
      let node = related;
      for (let i = 0; i < 10; i++) {
        if (!node || node === document.body) break;
        if (
          typeof node.className === "string" &&
          node.className.includes("_RootCustomNode_")
        )
          return;
        node = node.parentElement;
      }
    }
    clearTimeout(hoverTimer);
    hideTooltip();
  });

  document.addEventListener(
    "mousemove",
    (e) => positionTooltip(e.clientX, e.clientY),
    { passive: true },
  );
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "c") {
      killmailCache.clear();
      nameCache.clear();
      GM_setValue(KM_STORE_KEY, "[]");
      LOG("Cache cleared");
    }
  });

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();

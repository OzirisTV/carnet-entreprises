(function () {
  const STORAGE_KEY = "dhl-company-board-v1";
  const UI_STORAGE_KEY = "dhl-company-board-ui-v1";
  const API_STATE_URL = "/api/state";
  const SHARED_SYNC_MS = 5000;
  const STATUS_REFRESH_MS = 60_000;
  const ROUTES = Array.from({ length: 26 }, (_, index) => `NPX${String.fromCharCode(65 + index)}`);
  const WEEK_DAYS = [
    { key: "monday", label: "Lundi" },
    { key: "tuesday", label: "Mardi" },
    { key: "wednesday", label: "Mercredi" },
    { key: "thursday", label: "Jeudi" },
    { key: "friday", label: "Vendredi" }
  ];
  const DAY_KEYS_BY_INDEX = {
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday"
  };
  const sharedStorageEnabled = window.location.protocol !== "file:";

  const tabsEl = document.querySelector("#tabs");
  const activeRouteTitle = document.querySelector("#activeRouteTitle");
  const companyCount = document.querySelector("#companyCount");
  const companyList = document.querySelector("#companyList");
  const addCompanyForm = document.querySelector("#addCompanyForm");
  const companyName = document.querySelector("#companyName");
  const searchInput = document.querySelector("#searchInput");
  const printButton = document.querySelector("#printButton");
  const printArea = document.querySelector("#printArea");

  let state = createDefaultState();
  let focusedCompanyId = "";
  let saveTimer = 0;

  init();

  async function init() {
    state = await loadState();
    renderTabs();
    renderCompanies();

    if (sharedStorageEnabled) {
      window.setInterval(refreshSharedState, SHARED_SYNC_MS);
      window.addEventListener("focus", refreshSharedState);
    }

    window.setInterval(refreshCurrentStatuses, STATUS_REFRESH_MS);
  }

  addCompanyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = normalizeCompanyName(companyName.value);

    if (!name) {
      companyName.focus();
      return;
    }

    const company = {
      id: createId(),
      name,
      schedule: createEmptySchedule(),
      closedMonday: false,
      closedFriday: false,
      open: true
    };

    state.tabs[state.activeRoute].unshift(company);
    companyName.value = "";
    state.search = "";
    searchInput.value = "";
    saveState();
    renderCompanies();
    requestAnimationFrame(() => companyName.focus());
  });

  companyName.addEventListener("input", () => {
    companyName.value = uppercaseCompanyNameInput(companyName.value);
  });

  tabsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route]");
    if (!button) return;

    state.activeRoute = button.dataset.route;
    state.search = "";
    focusedCompanyId = "";
    saveState();
    renderTabs();
    renderCompanies();
  });

  searchInput.addEventListener("input", () => {
    state.search = searchInput.value.trim();
    const matches = getSearchMatches(state.search);
    const exactMatch = matches.find((item) => normalizeSearch(item.company.name) === normalizeSearch(state.search));

    if (exactMatch || matches.length === 1) {
      goToCompany((exactMatch || matches[0]).route, (exactMatch || matches[0]).company.id);
      return;
    }

    renderCompanies();
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const firstMatch = getSearchMatches(searchInput.value)[0];
    if (!firstMatch) return;

    event.preventDefault();
    goToCompany(firstMatch.route, firstMatch.company.id);
  });

  printButton.addEventListener("click", () => {
    renderPrintArea();
    window.print();
  });

  companyList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-action='delete']");
    const toggleButton = event.target.closest("[data-action='toggle']");
    const goButton = event.target.closest("[data-action='go']");
    const card = event.target.closest(".company-card");
    if (!card) return;

    const route = card.dataset.route || state.activeRoute;
    const company = findCompany(card.dataset.id, route);
    if (!company) return;

    if (deleteButton) {
      const ok = window.confirm("Supprimer cette entreprise ?");
      if (!ok) return;

      state.tabs[route] = getCompaniesForRoute(route).filter((item) => item.id !== company.id);
      saveState();
      renderCompanies();
      return;
    }

    if (goButton) {
      goToCompany(route, company.id);
      return;
    }

    if (toggleButton) {
      company.open = !company.open;
      saveState();
      renderCompanies();
    }
  });

  companyList.addEventListener("input", handleCompanyField);
  companyList.addEventListener("change", handleCompanyField);

  function handleCompanyField(event) {
    const field = event.target.dataset.field;
    const scheduleDay = event.target.dataset.scheduleDay;
    if (!field && !scheduleDay) return;

    const card = event.target.closest(".company-card");
    const route = card ? card.dataset.route || state.activeRoute : state.activeRoute;
    const company = card ? findCompany(card.dataset.id, route) : null;
    if (!company) return;

    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    if (scheduleDay) {
      company.schedule = normalizeSchedule(company.schedule);
      company.schedule[scheduleDay] = value;
    } else if (field === "name") {
      company.name = normalizeCompanyName(value);
      event.target.value = uppercaseCompanyNameInput(value);
    } else {
      company[field] = value;
    }
    saveState();
    syncCompanyPreview(card, company);
  }

  function renderTabs() {
    tabsEl.innerHTML = ROUTES.map((route) => {
      const selected = route === state.activeRoute;
      return `
        <button
          class="tab-button"
          type="button"
          role="tab"
          data-route="${route}"
          aria-selected="${selected}"
        >${route}</button>
      `;
    }).join("");
  }

  function renderCompanies() {
    const activeCompanies = getActiveCompanies();
    const searchTerm = normalizeSearch(state.search || "");
    const focusedCompany = focusedCompanyId ? findCompany(focusedCompanyId, state.activeRoute) : null;
    const showingFoundCompany = Boolean(
      searchTerm &&
      focusedCompany &&
      normalizeSearch(focusedCompany.name).includes(searchTerm)
    );
    const visibleCompanies = searchTerm && !showingFoundCompany
      ? getSearchMatches(state.search)
      : activeCompanies.map((company) => ({ company, route: state.activeRoute }));
    const showingSearchResults = searchTerm && !showingFoundCompany;

    searchInput.value = state.search || "";
    activeRouteTitle.textContent = showingSearchResults ? "Recherche" : state.activeRoute;
    companyCount.textContent = showingSearchResults ? formatResultCount(visibleCompanies.length) : formatCount(activeCompanies.length);

    if (!visibleCompanies.length) {
      companyList.innerHTML = `<p class="empty-state">${showingSearchResults ? "Aucun resultat dans les onglets." : "Aucune entreprise dans cet onglet."}</p>`;
      return;
    }

    companyList.innerHTML = visibleCompanies.map((item) => renderCompanyCard(item.company, item.route, showingSearchResults)).join("");
  }

  function renderCompanyCard(company, route, searchActive) {
    const safeName = escapeHtml(company.name || "Sans nom");
    const schedule = normalizeSchedule(company.schedule);
    const open = Boolean(company.open);
    const status = getTodayStatus(company);
    const styles = cardStyle(status.color);

    return `
      <article class="company-card${open ? " is-open" : ""}${focusedCompanyId === company.id ? " is-found" : ""}" data-id="${company.id}" data-route="${route}" style="${styles}">
        <div class="company-main">
          <button class="company-toggle" type="button" data-action="${searchActive ? "go" : "toggle"}" aria-expanded="${open}">
            <span class="company-swatch" aria-hidden="true"></span>
            <span class="company-title">${safeName}</span>
          </button>
          <div class="company-actions">
            <button class="light-button" type="button" data-action="${searchActive ? "go" : "toggle"}">${searchActive ? "Voir" : open ? "Fermer" : "Ouvrir"}</button>
            <button class="danger-button" type="button" data-action="delete">Supprimer</button>
          </div>
        </div>
        <div class="company-details" ${open ? "" : "hidden"}>
          <div class="company-badges">
            ${searchActive ? `<span class="badge route">${escapeHtml(route)}</span>` : ""}
            <span class="badge ${status.closedToday ? "closed" : "open"}">${escapeHtml(status.label)}</span>
            ${company.closedMonday ? `<span class="badge closed">Ferme lundi</span>` : ""}
            ${company.closedFriday ? `<span class="badge closed">Ferme vendredi</span>` : ""}
          </div>
          <div class="detail-grid">
            <label>
              <span>Nom</span>
              <input type="text" data-field="name" value="${safeName}" autocomplete="off">
            </label>
          </div>
          <div class="schedule-grid" aria-label="Horaires par jour">
            ${WEEK_DAYS.map((day) => `
              <label class="schedule-row">
                <span>${day.label}</span>
                <input
                  type="text"
                  data-schedule-day="${day.key}"
                  value="${escapeHtml(schedule[day.key])}"
                  autocomplete="off"
                  placeholder="Ex: 08:00-12:00"
                >
              </label>
            `).join("")}
          </div>
          <div class="checks" role="group" aria-label="Jours fermes">
            <label class="check-option">
              <input type="checkbox" data-field="closedMonday" ${company.closedMonday ? "checked" : ""}>
              <span>Ferme lundi</span>
            </label>
            <label class="check-option">
              <input type="checkbox" data-field="closedFriday" ${company.closedFriday ? "checked" : ""}>
              <span>Ferme vendredi</span>
            </label>
          </div>
        </div>
      </article>
    `;
  }

  function syncCompanyPreview(card, company) {
    const status = getTodayStatus(company);
    card.setAttribute("style", cardStyle(status.color));

    const title = card.querySelector(".company-title");
    const badges = card.querySelector(".company-badges");

    if (title) title.textContent = company.name || "Sans nom";
    if (badges) {
      badges.innerHTML = `
        ${card.dataset.route && activeRouteTitle.textContent === "Recherche" ? `<span class="badge route">${escapeHtml(card.dataset.route)}</span>` : ""}
        <span class="badge ${status.closedToday ? "closed" : "open"}">${escapeHtml(status.label)}</span>
        ${company.closedMonday ? `<span class="badge closed">Ferme lundi</span>` : ""}
        ${company.closedFriday ? `<span class="badge closed">Ferme vendredi</span>` : ""}
      `;
    }
  }

  function getTodayStatus(company) {
    const now = new Date();
    const today = now.getDay();
    const todayKey = DAY_KEYS_BY_INDEX[today];

    if (!todayKey) {
      return {
        color: "#d40511",
        closedToday: true,
        label: "Ferme aujourd'hui"
      };
    }

    if ((today === 1 && company.closedMonday) || (today === 5 && company.closedFriday)) {
      return {
        color: "#d40511",
        closedToday: true,
        label: "Ferme aujourd'hui"
      };
    }

    const schedule = normalizeSchedule(company.schedule);
    const todaySchedule = schedule[todayKey].trim();

    if (!todaySchedule) {
      return {
        color: "#d40511",
        closedToday: true,
        label: "Horaire non renseigne"
      };
    }

    const ranges = parseScheduleRanges(todaySchedule);
    if (!ranges.length) {
      return {
        color: "#d40511",
        closedToday: true,
        label: "Horaire non reconnu"
      };
    }

    const currentMinutes = (now.getHours() * 60) + now.getMinutes();
    const openNow = ranges.some(([start, end]) => isMinuteInRange(currentMinutes, start, end));

    return {
      color: openNow ? "#15803d" : "#d40511",
      closedToday: !openNow,
      label: openNow ? "Ouvert maintenant" : "Ferme maintenant"
    };
  }

  function formatCount(count) {
    return `${count} ${count > 1 ? "entreprises" : "entreprise"}`;
  }

  function formatResultCount(count) {
    return `${count} ${count > 1 ? "resultats" : "resultat"}`;
  }

  function getActiveCompanies() {
    return getCompaniesForRoute(state.activeRoute);
  }

  function getCompaniesForRoute(route) {
    return state.tabs[route] || [];
  }

  function getAllCompanies() {
    return ROUTES.flatMap((route) => getCompaniesForRoute(route).map((company) => ({ company, route })));
  }

  function getSearchMatches(value) {
    const searchTerm = normalizeSearch(value || "");
    if (!searchTerm) return [];
    return getAllCompanies().filter((item) => normalizeSearch(item.company.name).includes(searchTerm));
  }

  function findCompany(id, route = state.activeRoute) {
    return getCompaniesForRoute(route).find((company) => company.id === id);
  }

  function goToCompany(route, companyId) {
    const company = findCompany(companyId, route);
    if (!company) return;

    state.activeRoute = route;
    company.open = true;
    focusedCompanyId = companyId;
    saveState();
    renderTabs();
    renderCompanies();

    requestAnimationFrame(() => {
      const card = Array.from(companyList.querySelectorAll(".company-card"))
        .find((item) => item.dataset.id === companyId);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function renderPrintArea() {
    const route = state.activeRoute;
    const companies = getCompaniesForRoute(route);

    if (!companies.length) {
      printArea.innerHTML = `
        <h1>DHL - Recap ${escapeHtml(route)}</h1>
        <p>Aucune entreprise enregistree dans cet onglet.</p>
      `;
      return;
    }

    printArea.innerHTML = `
      <h1>DHL - Recap ${escapeHtml(route)}</h1>
      <section class="print-route">
        <h2>${escapeHtml(route)}</h2>
        ${companies.map((company) => renderPrintCompany(company)).join("")}
      </section>
    `;
  }

  function renderPrintCompany(company) {
    const status = getTodayStatus(company);
    const schedule = normalizeSchedule(company.schedule);
    const closedDays = [
      company.closedMonday ? "Ferme lundi" : "",
      company.closedFriday ? "Ferme vendredi" : ""
    ].filter(Boolean).join(" - ");

    return `
      <div class="print-company">
        <strong>${escapeHtml(company.name || "Sans nom")}</strong>
        ${WEEK_DAYS.map((day) => `
          <span>${day.label} : ${escapeHtml(schedule[day.key] || "Non renseigne")}</span>
        `).join("")}
        <span>Fermeture : ${escapeHtml(closedDays || "Non renseignee")}</span>
        <span>Aujourd'hui : ${escapeHtml(status.label)}</span>
      </div>
    `;
  }

  async function loadState() {
    const fallback = createDefaultState();
    const localState = readLocalState(fallback);

    if (!sharedStorageEnabled) return localState;

    const localUiState = readLocalUiState(fallback);
    try {
      const remoteState = await fetchSharedState();
      const nextState = {
        ...fallback,
        ...localUiState,
        tabs: remoteState.tabs
      };

      if (isTabsEmpty(remoteState.tabs) && !isTabsEmpty(localState.tabs)) {
        nextState.tabs = localState.tabs;
        await persistSharedState(nextState);
      }

      return nextState;
    } catch (error) {
      return {
        ...localState,
        ...localUiState
      };
    }
  }

  function readLocalState(fallback) {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)), fallback);
    } catch (error) {
      return fallback;
    }
  }

  function readLocalUiState(fallback) {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_STORAGE_KEY));
      if (!saved || typeof saved !== "object") return {
        activeRoute: fallback.activeRoute,
        search: fallback.search
      };

      return {
        activeRoute: ROUTES.includes(saved.activeRoute) ? saved.activeRoute : fallback.activeRoute,
        search: typeof saved.search === "string" ? saved.search : fallback.search
      };
    } catch (error) {
      return {
        activeRoute: fallback.activeRoute,
        search: fallback.search
      };
    }
  }

  function saveLocalUiState() {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({
      activeRoute: state.activeRoute,
      search: state.search
    }));
  }

  async function fetchSharedState() {
    const response = await fetch(API_STATE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Impossible de charger la sauvegarde partagee.");
    return normalizeState(await response.json(), createDefaultState());
  }

  async function persistSharedState(nextState) {
    const response = await fetch(API_STATE_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tabs: normalizeTabs(nextState.tabs) })
    });

    if (!response.ok) throw new Error("Impossible d'enregistrer la sauvegarde partagee.");
  }

  async function refreshSharedState() {
    if (!sharedStorageEnabled || document.hidden || isEditingCompany()) return;

    try {
      const remoteState = await fetchSharedState();
      state.tabs = remoteState.tabs;
      renderCompanies();
    } catch (error) {
      // Le serveur peut etre coupe temporairement; la saisie locale reste utilisable.
    }
  }

  function refreshCurrentStatuses() {
    if (document.hidden || isUserTyping()) return;
    renderCompanies();
  }

  function isEditingCompany() {
    return Boolean(document.activeElement && document.activeElement.closest(".company-details"));
  }

  function isUserTyping() {
    return Boolean(document.activeElement && document.activeElement.matches("input, textarea"));
  }

  function normalizeState(saved, fallback) {
    if (!saved || typeof saved !== "object") return fallback;

    return {
      activeRoute: ROUTES.includes(saved.activeRoute) ? saved.activeRoute : fallback.activeRoute,
      search: typeof saved.search === "string" ? saved.search : fallback.search,
      tabs: normalizeTabs(saved.tabs || fallback.tabs)
    };
  }

  function normalizeTabs(tabs) {
    return Object.fromEntries(ROUTES.map((route) => {
      const companies = tabs && Array.isArray(tabs[route]) ? tabs[route].map(normalizeCompany) : [];
      return [route, companies];
    }));
  }

  function isTabsEmpty(tabs) {
    return ROUTES.every((route) => !tabs[route] || tabs[route].length === 0);
  }

  function createDefaultState() {
    return {
      activeRoute: "NPXA",
      search: "",
      tabs: Object.fromEntries(ROUTES.map((route) => [route, []]))
    };
  }

  function normalizeCompany(company) {
    return {
      id: String(company.id || createId()),
      name: normalizeCompanyName(company.name || ""),
      schedule: normalizeSchedule(company.schedule),
      closedMonday: Boolean(company.closedMonday),
      closedFriday: Boolean(company.closedFriday),
      open: Boolean(company.open)
    };
  }

  function saveState() {
    if (!sharedStorageEnabled) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return;
    }

    saveLocalUiState();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      persistSharedState(state).catch(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      });
    }, 250);
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeColor(color) {
    return /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#ffd400";
  }

  function normalizeCompanyName(value) {
    return String(value || "").trim().toLocaleUpperCase("fr-FR");
  }

  function uppercaseCompanyNameInput(value) {
    return String(value || "").toLocaleUpperCase("fr-FR");
  }

  function createEmptySchedule() {
    return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, ""]));
  }

  function normalizeSchedule(schedule) {
    const emptySchedule = createEmptySchedule();
    if (typeof schedule === "string") {
      return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, schedule]));
    }
    if (!schedule || typeof schedule !== "object") return emptySchedule;

    return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, String(schedule[day.key] || "")]));
  }

  function parseScheduleRanges(value) {
    const times = Array.from(String(value || "").matchAll(/(\d{1,2})(?:\s*(?:h|:)\s*(\d{2}))?/gi))
      .map((match) => timePartsToMinutes(match[1], match[2]))
      .filter((minutes) => minutes !== null);

    const ranges = [];
    for (let index = 0; index + 1 < times.length; index += 2) {
      if (times[index] !== times[index + 1]) ranges.push([times[index], times[index + 1]]);
    }

    return ranges;
  }

  function timePartsToMinutes(hourPart, minutePart) {
    const hours = Number(hourPart);
    const minutes = minutePart === undefined ? 0 : Number(minutePart);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return (hours * 60) + minutes;
  }

  function isMinuteInRange(current, start, end) {
    if (start < end) return current >= start && current < end;
    return current >= start || current < end;
  }

  function normalizeSearch(value) {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function cardStyle(color) {
    const safeColor = normalizeColor(color);
    return `--company-color: ${safeColor}; --company-soft: ${hexToRgba(safeColor, 0.18)};`;
  }

  function hexToRgba(hex, alpha) {
    const value = normalizeColor(hex).slice(1);
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();

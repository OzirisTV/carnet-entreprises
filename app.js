(function () {
  const SESSION_KEY = "dhl-agency-session-v1";
  const UI_STORAGE_KEY = "dhl-multi-agency-ui-v1";
  const ROUTES_STORAGE_KEY = "dhl-direct-routes-v1";
  const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3000" : "";
  const SHARED_SYNC_MS = 5000;
  const STATUS_REFRESH_MS = 60_000;
  const CLOSING_ALERT_WINDOW_MINUTES = 30;
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
  const SCHEDULE_PARTS = ["start1", "end1", "start2", "end2"];
  const TIME_OPTIONS = createQuarterHourOptions();

  const agencyGate = document.querySelector("#agencyGate");
  const loginPanel = document.querySelector("#loginPanel");
  const createPanel = document.querySelector("#createPanel");
  const deletePanel = document.querySelector("#deletePanel");
  const gateError = document.querySelector("#gateError");
  const gateNotice = document.querySelector("#gateNotice");
  const loginForm = document.querySelector("#loginForm");
  const agencySelect = document.querySelector("#agencySelect");
  const loginPassword = document.querySelector("#loginPassword");
  const showCreateAgency = document.querySelector("#showCreateAgency");
  const showDeleteAgency = document.querySelector("#showDeleteAgency");
  const showLoginAgency = document.querySelector("#showLoginAgency");
  const cancelDeleteAgency = document.querySelector("#cancelDeleteAgency");
  const createAgencyForm = document.querySelector("#createAgencyForm");
  const createAgencyName = document.querySelector("#createAgencyName");
  const createAgencyPassword = document.querySelector("#createAgencyPassword");
  const createAgencyConfirm = document.querySelector("#createAgencyConfirm");
  const deleteAgencyForm = document.querySelector("#deleteAgencyForm");
  const deleteAgencyName = document.querySelector("#deleteAgencyName");
  const deleteAgencyPassword = document.querySelector("#deleteAgencyPassword");

  const appShell = document.querySelector("#appShell");
  const currentAgencyName = document.querySelector("#currentAgencyName");
  const logoutButton = document.querySelector("#logoutButton");
  const tabsEl = document.querySelector("#tabs");
  const toggleRouteForm = document.querySelector("#toggleRouteForm");
  const addRouteForm = document.querySelector("#addRouteForm");
  const routeNameInput = document.querySelector("#routeNameInput");
  const activeRouteTitle = document.querySelector("#activeRouteTitle");
  const companyCount = document.querySelector("#companyCount");
  const companyCountLabel = document.querySelector("#companyCountLabel");
  const openCompanyCount = document.querySelector("#openCompanyCount");
  const closedCompanyCount = document.querySelector("#closedCompanyCount");
  const modifiedCompanyCount = document.querySelector("#modifiedCompanyCount");
  const companyList = document.querySelector("#companyList");
  const addCompanyForm = document.querySelector("#addCompanyForm");
  const companyName = document.querySelector("#companyName");
  const searchInput = document.querySelector("#searchInput");
  const printButton = document.querySelector("#printButton");
  const pdfButton = document.querySelector("#pdfButton");
  const printArea = document.querySelector("#printArea");
  const toastRegion = document.querySelector("#toastRegion");
  const themeToggles = Array.from(document.querySelectorAll("[data-theme-toggle]"));
  const themeIcons = Array.from(document.querySelectorAll("[data-theme-icon]"));

  let state = createDefaultState();
  let focusedCompanyId = "";
  let saveTimer = 0;
  let pendingLocalSave = false;
  let offlineNoticeShown = false;

  bindEvents();
  init();

  async function init() {
    const prefs = readUiPrefs();
    state.theme = prefs.theme;
    applyTheme();
    updateThemeButtons();
    clearSession();
    await loadDirectWorkspace();

    window.setInterval(refreshAgencyState, SHARED_SYNC_MS);
    window.setInterval(refreshCurrentStatuses, STATUS_REFRESH_MS);
    window.addEventListener("focus", refreshAgencyState);
  }

  function bindEvents() {
    showCreateAgency?.addEventListener("click", () => setGateView("create"));
    showDeleteAgency?.addEventListener("click", showAgencyDeletion);
    showLoginAgency?.addEventListener("click", () => setGateView("login"));
    cancelDeleteAgency?.addEventListener("click", () => setGateView("login"));
    loginForm?.addEventListener("submit", handleLogin);
    createAgencyForm?.addEventListener("submit", handleAgencyCreation);
    deleteAgencyForm?.addEventListener("submit", handleAgencyDeletion);
    logoutButton?.addEventListener("click", logout);

    themeToggles.forEach((button) => {
      button.addEventListener("click", () => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        applyTheme();
        updateThemeButtons();
        saveUiPrefs();
      });
    });

    toggleRouteForm.addEventListener("click", () => {
      addRouteForm.hidden = !addRouteForm.hidden;
      if (!addRouteForm.hidden) requestAnimationFrame(() => routeNameInput.focus());
    });
    addRouteForm.addEventListener("submit", addRoute);
    routeNameInput.addEventListener("input", () => {
      routeNameInput.value = normalizeRouteName(routeNameInput.value);
    });
    tabsEl.addEventListener("click", handleRouteClick);

    addCompanyForm.addEventListener("submit", addCompany);
    companyName.addEventListener("input", () => {
      companyName.value = uppercaseCompanyNameInput(companyName.value);
    });
    searchInput.addEventListener("input", handleSearch);
    searchInput.addEventListener("keydown", handleSearchEnter);
    printButton.addEventListener("click", () => {
      renderPrintArea();
      window.print();
    });
    pdfButton.addEventListener("click", downloadCurrentRoutePdf);
    companyList.addEventListener("click", handleCompanyClick);
    companyList.addEventListener("input", handleCompanyField);
    companyList.addEventListener("change", handleCompanyField);
  }

  async function loadDirectWorkspace() {
    state.agency = { id: "direct", name: "Entreprises" };
    state.token = "";
    agencyGate.hidden = true;
    appShell.hidden = false;
    currentAgencyName.textContent = "Entreprises";

    try {
      const response = await apiRequest("/api/state", {}, false);
      writeLocalRoutes(response.routes);
      pendingLocalSave = false;
      activateDirectWorkspace(response.routes);
    } catch (error) {
      state.routes = readLocalRoutes() || createDefaultRoutes();
      state.activeRouteId = state.routes[0].id;
      renderAll();
      showOfflineNotice("Serveur absent : sauvegarde locale active.");
    }
  }

  function activateDirectWorkspace(routes) {
    state.routes = normalizeRoutes(routes);
    state.search = "";
    focusedCompanyId = "";
    closeAllCompanies(state.routes);

    const prefs = readUiPrefs();
    const preferredRoute = prefs.activeRouteByAgency.direct;
    state.activeRouteId = state.routes.some((route) => route.id === preferredRoute)
      ? preferredRoute
      : state.routes[0] && state.routes[0].id || "";

    searchInput.value = "";
    renderAll();
  }

  async function showAgencyGate(message = "") {
    appShell.hidden = true;
    agencyGate.hidden = false;
    setGateView("login");
    setGateError(message);
    await loadAgencyOptions();
  }

  function setGateView(view) {
    loginPanel.hidden = view !== "login";
    createPanel.hidden = view !== "create";
    deletePanel.hidden = view !== "delete";
    setGateError("");
    setGateNotice("");
    requestAnimationFrame(() => {
      if (view === "create") createAgencyName.focus();
      else if (view === "delete") deleteAgencyPassword.focus();
      else agencySelect.focus();
    });
  }

  async function loadAgencyOptions(selectedId = "") {
    try {
      const response = await apiRequest("/api/agencies", {}, false);
      if (!response.agencies.length) {
        agencySelect.innerHTML = '<option value="">Aucune agence</option>';
        loginPassword.disabled = true;
        loginForm.querySelector("button[type='submit']").disabled = true;
        showDeleteAgency.disabled = true;
        setGateView("create");
        return false;
      }

      agencySelect.innerHTML = response.agencies.map((agency) => `
        <option value="${escapeHtml(agency.id)}" ${agency.id === selectedId ? "selected" : ""}>${escapeHtml(agency.name)}</option>
      `).join("");
      loginPassword.disabled = false;
      loginForm.querySelector("button[type='submit']").disabled = false;
      showDeleteAgency.disabled = false;
      return true;
    } catch (error) {
      setGateError(error.message || "Impossible de charger les agences.");
      return null;
    }
  }

  function showAgencyDeletion() {
    const agencyId = agencySelect.value;
    const selectedOption = agencySelect.selectedOptions[0];
    if (!agencyId || !selectedOption) return setGateError("Choisissez une agence a supprimer.");
    deleteAgencyForm.dataset.agencyId = agencyId;
    deleteAgencyName.textContent = selectedOption.textContent;
    deleteAgencyPassword.value = "";
    setGateView("delete");
  }

  async function handleLogin(event) {
    event.preventDefault();
    const agencyId = agencySelect.value;
    if (!agencyId) return setGateError("Choisissez une agence.");

    setGateBusy(loginForm, true);
    setGateError("");
    try {
      const response = await apiRequest(`/api/agencies/${encodeURIComponent(agencyId)}/login`, {
        method: "POST",
        body: JSON.stringify({ password: loginPassword.value })
      }, false);
      loginPassword.value = "";
      activateAgency(response);
    } catch (error) {
      setGateError(error.message || "Connexion impossible.");
    } finally {
      setGateBusy(loginForm, false);
    }
  }

  async function handleAgencyCreation(event) {
    event.preventDefault();
    if (createAgencyPassword.value !== createAgencyConfirm.value) {
      setGateError("Les mots de passe ne correspondent pas.");
      return;
    }

    setGateBusy(createAgencyForm, true);
    setGateError("");
    try {
      const response = await apiRequest("/api/agencies", {
        method: "POST",
        body: JSON.stringify({
          name: createAgencyName.value,
          password: createAgencyPassword.value
        })
      }, false);
      createAgencyForm.reset();
      activateAgency(response);
    } catch (error) {
      setGateError(error.message || "Creation impossible.");
    } finally {
      setGateBusy(createAgencyForm, false);
    }
  }

  async function handleAgencyDeletion(event) {
    event.preventDefault();
    const agencyId = deleteAgencyForm.dataset.agencyId;
    const agencyName = deleteAgencyName.textContent;
    if (!agencyId) return setGateView("login");

    setGateBusy(deleteAgencyForm, true);
    setGateError("");
    try {
      await apiRequest(`/api/agencies/${encodeURIComponent(agencyId)}`, {
        method: "DELETE",
        body: JSON.stringify({ password: deleteAgencyPassword.value })
      }, false);
      deleteAgencyForm.reset();
      delete deleteAgencyForm.dataset.agencyId;

      const savedSession = readSession();
      if (savedSession && savedSession.agency.id === agencyId) clearSession();

      const hasAgencies = await loadAgencyOptions();
      if (hasAgencies) setGateView("login");
      setGateNotice(`L'agence ${agencyName} a ete supprimee.`);
    } catch (error) {
      setGateError(error.message || "Suppression impossible.");
    } finally {
      setGateBusy(deleteAgencyForm, false);
    }
  }

  function activateAgency(payload) {
    state.agency = payload.agency;
    state.token = payload.token;
    state.routes = normalizeRoutes(payload.state && payload.state.routes || []);
    state.search = "";
    focusedCompanyId = "";
    closeAllCompanies(state.routes);

    const prefs = readUiPrefs();
    const preferredRoute = prefs.activeRouteByAgency[state.agency.id];
    state.activeRouteId = state.routes.some((route) => route.id === preferredRoute)
      ? preferredRoute
      : state.routes[0] && state.routes[0].id || "";

    writeSession({ agency: state.agency, token: state.token });
    currentAgencyName.textContent = state.agency.name;
    agencyGate.hidden = true;
    appShell.hidden = false;
    searchInput.value = "";
    renderAll();
  }

  async function logout() {
    window.clearTimeout(saveTimer);
    clearSession();
    state = { ...createDefaultState(), theme: state.theme };
    await loadDirectWorkspace();
  }

  function setGateBusy(form, busy) {
    Array.from(form.elements).forEach((element) => {
      element.disabled = busy;
    });
  }

  function setGateError(message) {
    gateError.textContent = message;
    gateError.hidden = !message;
    if (message) setGateNotice("");
  }

  function setGateNotice(message) {
    gateNotice.textContent = message;
    gateNotice.hidden = !message;
  }

  function showToast(message, tone = "info") {
    const toast = document.createElement("div");
    const symbol = document.createElement("span");
    const text = document.createElement("span");
    toast.className = `toast toast-${tone}`;
    symbol.className = "toast-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = tone === "danger" ? "!" : tone === "success" ? "+" : "i";
    text.textContent = message;
    toast.append(symbol, text);
    toastRegion.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    }, 2800);
  }

  function showOfflineNotice(message) {
    if (offlineNoticeShown) return;
    offlineNoticeShown = true;
    showToast(message, "info");
  }

  function renderAll() {
    renderRoutes();
    renderCompanies();
    saveUiPrefs();
  }

  function renderDashboardStats(entries, searchActive) {
    const statuses = entries.map(({ company }) => getTodayStatus(company));
    companyCount.textContent = String(entries.length);
    companyCountLabel.textContent = searchActive ? "Resultats" : "Entreprises";
    openCompanyCount.textContent = String(statuses.filter((status) => status.tone === "open").length);
    closedCompanyCount.textContent = String(statuses.filter((status) => status.tone === "closed").length);
    modifiedCompanyCount.textContent = String(entries.filter(({ company }) => isTimestampToday(company.updatedAt)).length);
  }

  function renderRoutes() {
    if (!state.routes.length) {
      tabsEl.innerHTML = '<p class="sidebar-empty">Aucune tournee</p>';
      return;
    }

    tabsEl.innerHTML = state.routes.map((route) => `
      <div class="route-item${route.id === state.activeRouteId ? " is-active" : ""}" data-route-id="${escapeHtml(route.id)}">
        <button class="route-select" type="button" data-action="select-route">
          <span class="route-label"><span class="route-symbol" aria-hidden="true">#</span><span class="route-name">${escapeHtml(route.name)}</span></span>
          <small>${route.companies.length}</small>
        </button>
        <button class="route-delete" type="button" data-action="delete-route" title="Supprimer ${escapeHtml(route.name)}" aria-label="Supprimer ${escapeHtml(route.name)}">&times;</button>
      </div>
    `).join("");
  }

  function handleRouteClick(event) {
    const item = event.target.closest("[data-route-id]");
    if (!item) return;
    const route = getRouteById(item.dataset.routeId);
    if (!route) return;

    if (event.target.closest("[data-action='delete-route']")) {
      if (!window.confirm(`Supprimer la tournee ${route.name} et toutes ses entreprises ?`)) return;
      item.classList.add("is-removing");
      window.setTimeout(() => {
        state.routes = state.routes.filter((itemRoute) => itemRoute.id !== route.id);
        state.activeRouteId = state.routes[0] && state.routes[0].id || "";
        state.search = "";
        focusedCompanyId = "";
        saveAgencyState();
        renderAll();
        showToast(`Tournee ${route.name} supprimee.`, "danger");
      }, 180);
      return;
    }

    state.activeRouteId = route.id;
    state.search = "";
    focusedCompanyId = "";
    searchInput.value = "";
    renderAll();
  }

  function addRoute(event) {
    event.preventDefault();
    const name = normalizeRouteName(routeNameInput.value);
    if (!name) return routeNameInput.focus();
    if (state.routes.some((route) => route.name.toLocaleLowerCase("fr-FR") === name.toLocaleLowerCase("fr-FR"))) {
      window.alert("Cette tournee existe deja.");
      return;
    }

    const route = { id: createId(), name, companies: [] };
    state.routes.push(route);
    state.activeRouteId = route.id;
    routeNameInput.value = "";
    addRouteForm.hidden = true;
    saveAgencyState();
    renderAll();
    showToast(`Tournee ${name} ajoutee.`, "success");
  }

  function addCompany(event) {
    event.preventDefault();
    const route = getActiveRoute();
    const name = normalizeCompanyName(companyName.value);
    if (!route || !name) return companyName.focus();

    route.companies.unshift({
      id: createId(),
      name,
      schedule: createEmptySchedule(),
      closureException: createEmptyClosureException(),
      notes: "",
      closedMonday: false,
      closedFriday: false,
      updatedAt: new Date().toISOString(),
      open: true
    });
    companyName.value = "";
    state.search = "";
    searchInput.value = "";
    saveAgencyState();
    renderCompanies();
    renderRoutes();
    showToast(`${name} a ete ajoutee.`, "success");
    requestAnimationFrame(() => companyName.focus());
  }

  function handleSearch() {
    state.search = searchInput.value.trim();
    const matches = getSearchMatches(state.search);
    const exact = matches.find((item) => normalizeSearch(item.company.name) === normalizeSearch(state.search));
    if (exact || matches.length === 1) {
      const match = exact || matches[0];
      goToCompany(match.route.id, match.company.id);
      return;
    }
    renderCompanies();
  }

  function handleSearchEnter(event) {
    if (event.key !== "Enter") return;
    const match = getSearchMatches(searchInput.value)[0];
    if (!match) return;
    event.preventDefault();
    goToCompany(match.route.id, match.company.id);
  }

  function handleCompanyClick(event) {
    const card = event.target.closest(".company-card");
    if (!card) return;
    const route = getRouteById(card.dataset.routeId);
    const company = route && route.companies.find((item) => item.id === card.dataset.id);
    if (!route || !company) return;

    if (event.target.closest("[data-action='delete']")) {
      if (!window.confirm("Supprimer cette entreprise ?")) return;
      card.classList.add("is-removing");
      window.setTimeout(() => {
        route.companies = route.companies.filter((item) => item.id !== company.id);
        saveAgencyState();
        renderCompanies();
        renderRoutes();
        showToast(`${company.name || "Entreprise"} a ete supprimee.`, "danger");
      }, 180);
      return;
    }

    if (event.target.closest("[data-action='copy-monday-schedule']")) {
      company.schedule = normalizeSchedule(company.schedule);
      const mondaySchedule = company.schedule.monday;
      WEEK_DAYS.forEach((day) => {
        company.schedule[day.key] = mondaySchedule;
      });
      company.updatedAt = new Date().toISOString();
      saveAgencyState();
      renderCompanies();
      showToast("Horaire du lundi applique a toute la semaine.", "success");
      return;
    }

    if (event.target.closest("[data-action='go']")) {
      goToCompany(route.id, company.id);
      return;
    }

    if (event.target.closest("[data-action='toggle']")) {
      company.open = !company.open;
      renderCompanies();
    }
  }

  function handleCompanyField(event) {
    const card = event.target.closest(".company-card");
    const route = card && getRouteById(card.dataset.routeId);
    const company = route && route.companies.find((item) => item.id === card.dataset.id);
    if (!company) return;

    const field = event.target.dataset.field;
    const scheduleDay = event.target.dataset.scheduleDay;
    const schedulePart = event.target.dataset.schedulePart;
    const exceptionField = event.target.dataset.exceptionField;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;

    if (scheduleDay && schedulePart) {
      company.schedule = normalizeSchedule(company.schedule);
      const parts = readSchedulePartsFromRow(event.target.closest(".schedule-row")) || parseScheduleParts(company.schedule[scheduleDay]);
      parts[schedulePart] = value;
      company.schedule[scheduleDay] = buildScheduleFromParts(parts);
    } else if (scheduleDay) {
      company.schedule = normalizeSchedule(company.schedule);
      company.schedule[scheduleDay] = value;
    } else if (exceptionField) {
      company.closureException = normalizeClosureException(company.closureException);
      company.closureException[exceptionField] = value;
    } else if (field === "name") {
      company.name = normalizeCompanyName(value);
      event.target.value = uppercaseCompanyNameInput(value);
    } else if (field) {
      company[field] = value;
    } else {
      return;
    }

    company.updatedAt = new Date().toISOString();
    saveAgencyState();
    syncCompanyPreview(card, company);
    renderDashboardStats(getActiveRoute()
      ? getActiveRoute().companies.map((item) => ({ company: item, route: getActiveRoute() }))
      : [], false);
  }

  function renderCompanies() {
    const activeRoute = getActiveRoute();
    const searchTerm = normalizeSearch(state.search);
    const focused = focusedCompanyId && activeRoute
      ? activeRoute.companies.find((company) => company.id === focusedCompanyId)
      : null;
    const showingFoundCompany = Boolean(searchTerm && focused && normalizeSearch(focused.name).includes(searchTerm));
    const showingSearchResults = Boolean(searchTerm && !showingFoundCompany);
    const visible = showingSearchResults
      ? getSearchMatches(state.search)
      : activeRoute
        ? activeRoute.companies.map((company) => ({ company, route: activeRoute }))
        : [];

    searchInput.value = state.search;
    activeRouteTitle.textContent = showingSearchResults ? "Recherche" : activeRoute ? activeRoute.name : "Aucune tournee";
    renderDashboardStats(visible, showingSearchResults);
    addCompanyForm.hidden = !activeRoute || showingSearchResults;
    printButton.disabled = !activeRoute;
    pdfButton.disabled = !activeRoute;

    if (!visible.length) {
      const message = showingSearchResults
        ? "Aucun resultat dans cette agence."
        : activeRoute
          ? "Aucune entreprise dans cette tournee."
          : "Ajoutez une tournee depuis la barre laterale.";
      companyList.innerHTML = `<p class="empty-state">${message}</p>`;
      return;
    }

    companyList.innerHTML = visible.map(({ company, route }) => renderCompanyCard(company, route, showingSearchResults)).join("");
  }

  function renderCompanyCard(company, route, searchActive) {
    const schedule = normalizeSchedule(company.schedule);
    const exception = normalizeClosureException(company.closureException);
    const status = getTodayStatus(company);
    const open = Boolean(company.open);
    const initial = (company.name || "?").trim().charAt(0).toLocaleUpperCase("fr-FR") || "?";

    return `
      <article class="company-card${open ? " is-open" : ""}${focusedCompanyId === company.id ? " is-found" : ""}" data-id="${escapeHtml(company.id)}" data-route-id="${escapeHtml(route.id)}" style="${cardStyle(status.color)}">
        <div class="company-main">
          <button class="company-toggle" type="button" data-action="${searchActive ? "go" : "toggle"}" aria-expanded="${open}">
            <span class="company-mark" aria-hidden="true">${escapeHtml(initial)}</span>
            <span class="company-title">${escapeHtml(company.name || "Sans nom")}</span>
            <span class="closing-alert-slot">${renderClosingAlert(status)}</span>
          </button>
          <div class="company-actions">
            <button class="light-button" type="button" data-action="${searchActive ? "go" : "toggle"}">${searchActive ? "Voir" : open ? "Fermer" : "Ouvrir"}</button>
            <button class="danger-button" type="button" data-action="delete">Supprimer</button>
          </div>
        </div>
        <div class="company-details" ${open ? "" : "hidden"}>
          <div class="company-badges">
            ${searchActive ? `<span class="badge route">${escapeHtml(route.name)}</span>` : ""}
            <span class="badge ${statusBadgeClass(status)}">${escapeHtml(status.label)}</span>
            ${renderClosingAlert(status)}
            ${exception.enabled ? '<span class="badge closed">Exception fermeture</span>' : ""}
            ${company.closedMonday ? '<span class="badge closed">Ferme lundi</span>' : ""}
            ${company.closedFriday ? '<span class="badge closed">Ferme vendredi</span>' : ""}
          </div>
          <div class="detail-grid">
            <label>
              <span>Nom</span>
              <input type="text" data-field="name" value="${escapeHtml(company.name)}" autocomplete="off">
            </label>
          </div>
          <div class="detail-section-title"><span aria-hidden="true">&#9638;</span><span>Horaires</span></div>
          <button class="light-button copy-schedule-button" type="button" data-action="copy-monday-schedule">Mettre le lundi sur toute la semaine</button>
          <div class="schedule-grid" aria-label="Horaires par jour">
            ${WEEK_DAYS.map((day) => `
              ${renderScheduleRow(day, schedule[day.key])}
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
          <div class="exception-panel">
            <label class="check-option">
              <input type="checkbox" data-exception-field="enabled" ${exception.enabled ? "checked" : ""}>
              <span>Exception fermeture</span>
            </label>
            <div class="exception-dates">
              <label><span>Du</span><input type="date" data-exception-field="start" value="${escapeHtml(exception.start)}"></label>
              <label><span>Au</span><input type="date" data-exception-field="end" value="${escapeHtml(exception.end)}"></label>
            </div>
          </div>
          <label class="notes-field">
            <span><span class="field-symbol" aria-hidden="true">N</span>Notes</span>
            <textarea data-field="notes" placeholder="Notes">${escapeHtml(company.notes)}</textarea>
          </label>
        </div>
      </article>
    `;
  }

  function renderScheduleRow(day, value) {
    const parts = parseScheduleParts(value);
    return `
      <div class="schedule-row">
        <span>${day.label}</span>
        <div class="schedule-selects">
          ${renderTimeSelect(day.key, "start1", "Debut 1", parts.start1)}
          ${renderTimeSelect(day.key, "end1", "Fin 1", parts.end1)}
          ${renderTimeSelect(day.key, "start2", "Debut 2", parts.start2)}
          ${renderTimeSelect(day.key, "end2", "Fin 2", parts.end2)}
        </div>
      </div>
    `;
  }

  function renderTimeSelect(dayKey, part, label, selected) {
    return `
      <label class="time-select">
        <span>${label}</span>
        <select data-schedule-day="${dayKey}" data-schedule-part="${part}">
          ${renderTimeOptions(selected)}
        </select>
      </label>
    `;
  }

  function renderTimeOptions(selected) {
    const current = normalizeTimeValue(selected);
    return TIME_OPTIONS.map((option) => `
      <option value="${escapeHtml(option.value)}" ${option.value === current ? "selected" : ""}>${escapeHtml(option.label)}</option>
    `).join("");
  }

  function syncCompanyPreview(card, company) {
    const status = getTodayStatus(company);
    card.setAttribute("style", cardStyle(status.color));
    const title = card.querySelector(".company-title");
    const mark = card.querySelector(".company-mark");
    const badges = card.querySelector(".company-badges");
    const alertSlot = card.querySelector(".closing-alert-slot");
    if (title) title.textContent = company.name || "Sans nom";
    if (mark) mark.textContent = (company.name || "?").trim().charAt(0).toLocaleUpperCase("fr-FR") || "?";
    if (alertSlot) alertSlot.innerHTML = renderClosingAlert(status);
    if (badges) {
      const route = getRouteById(card.dataset.routeId);
      const exception = normalizeClosureException(company.closureException);
      badges.innerHTML = `
        ${activeRouteTitle.textContent === "Recherche" && route ? `<span class="badge route">${escapeHtml(route.name)}</span>` : ""}
        <span class="badge ${statusBadgeClass(status)}">${escapeHtml(status.label)}</span>
        ${renderClosingAlert(status)}
        ${exception.enabled ? '<span class="badge closed">Exception fermeture</span>' : ""}
        ${company.closedMonday ? '<span class="badge closed">Ferme lundi</span>' : ""}
        ${company.closedFriday ? '<span class="badge closed">Ferme vendredi</span>' : ""}
      `;
    }
  }

  function goToCompany(routeId, companyId) {
    const route = getRouteById(routeId);
    const company = route && route.companies.find((item) => item.id === companyId);
    if (!company) return;
    state.activeRouteId = routeId;
    company.open = true;
    focusedCompanyId = companyId;
    renderAll();
    requestAnimationFrame(() => {
      const card = Array.from(companyList.querySelectorAll(".company-card")).find((item) => item.dataset.id === companyId);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function renderPrintArea() {
    const route = getActiveRoute();
    if (!route) {
      printArea.innerHTML = "";
      return;
    }

    printArea.innerHTML = `
      <h1>${escapeHtml(state.agency.name)} - ${escapeHtml(route.name)}</h1>
      <section class="print-route">
        ${route.companies.length ? route.companies.map(renderPrintCompany).join("") : "<p>Aucune entreprise.</p>"}
      </section>
    `;
  }

  function renderPrintCompany(company) {
    const schedule = normalizeSchedule(company.schedule);
    const exception = normalizeClosureException(company.closureException);
    const status = getTodayStatus(company);
    const exceptionText = exception.enabled
      ? `${formatDateFr(exception.start) || "date non renseignee"} au ${formatDateFr(exception.end || exception.start) || "date non renseignee"}`
      : "Aucune";

    return `
      <div class="print-company">
        <strong>${escapeHtml(company.name || "Sans nom")}</strong>
        ${WEEK_DAYS.map((day) => `<span>${day.label} : ${escapeHtml(schedule[day.key] || "Non renseigne")}</span>`).join("")}
        <span>Exception fermeture : ${escapeHtml(exceptionText)}</span>
        <span>Notes : ${escapeHtml(company.notes || "Aucune")}</span>
        <span>Aujourd'hui : ${escapeHtml(status.label)}</span>
      </div>
    `;
  }

  function downloadCurrentRoutePdf() {
    const route = getActiveRoute();
    if (!route) return;
    const pdf = buildRoutePdf(route);
    const blob = new Blob([pdf], { type: "application/pdf" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `${sanitizeFileName(route.name || "tournee")}-recap.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`PDF ${route.name} cree.`, "success");
  }

  function buildRoutePdf(route) {
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 42;
    const bottom = 42;
    const normalSize = 10;
    const lineHeight = 14;
    const contentWidth = pageWidth - margin * 2;
    const pages = [];
    let lines = [];
    let y = pageHeight - margin;

    function newPage() {
      if (lines.length) pages.push(lines);
      lines = [];
      y = pageHeight - margin;
      addText("Carnet entreprises", margin, y, 9, "0.38 0.45 0.56");
      y -= 18;
      addText(`Tournee ${route.name || ""}`, margin, y, 18, "0.12 0.31 0.85");
      y -= 18;
      addText(`Export PDF - ${formatDateTimeFr(new Date())}`, margin, y, 9, "0.38 0.45 0.56");
      y -= 22;
      addRule();
      y -= 14;
    }

    function ensureSpace(requiredLines = 1) {
      if (y - requiredLines * lineHeight < bottom) newPage();
    }

    function addRule() {
      lines.push("0.82 0.88 0.96 RG");
      lines.push(`${margin} ${y} m ${pageWidth - margin} ${y} l S`);
      lines.push("0 0 0 RG");
    }

    function addText(text, x, currentY, size = normalSize, color = "0.10 0.13 0.20") {
      lines.push(`${color} rg`);
      lines.push(`BT /F1 ${size} Tf ${x} ${currentY} Td (${escapePdfText(text)}) Tj ET`);
      lines.push("0 0 0 rg");
    }

    function addWrapped(text, x = margin, size = normalSize, color = "0.10 0.13 0.20") {
      const maxChars = Math.max(24, Math.floor((pageWidth - x - margin) / (size * 0.52)));
      wrapPdfText(text, maxChars).forEach((line) => {
        ensureSpace();
        addText(line, x, y, size, color);
        y -= lineHeight;
      });
    }

    newPage();

    if (!route.companies.length) {
      addWrapped("Aucune entreprise dans cette tournee.");
    } else {
      route.companies.forEach((company, index) => {
        const schedule = normalizeSchedule(company.schedule);
        const exception = normalizeClosureException(company.closureException);
        const status = getTodayStatus(company);
        const exceptionText = exception.enabled
          ? `${formatDateFr(exception.start) || "date non renseignee"} au ${formatDateFr(exception.end || exception.start) || "date non renseignee"}`
          : "Aucune";

        ensureSpace(8);
        addWrapped(`${index + 1}. ${company.name || "Sans nom"}`, margin, 13, "0.12 0.31 0.85");
        addWrapped(`Statut aujourd'hui : ${status.label}`, margin + 12);
        WEEK_DAYS.forEach((day) => {
          addWrapped(`${day.label} : ${schedule[day.key] || "Non renseigne"}`, margin + 12);
        });
        if (company.closedMonday) addWrapped("Fermeture fixe : lundi", margin + 12);
        if (company.closedFriday) addWrapped("Fermeture fixe : vendredi", margin + 12);
        addWrapped(`Exception fermeture : ${exceptionText}`, margin + 12);
        addWrapped(`Notes : ${company.notes || "Aucune"}`, margin + 12);
        y -= 4;
        ensureSpace();
        addRule();
        y -= 12;
      });
    }

    if (lines.length) pages.push(lines);
    return createPdfDocument(pages, pageWidth, pageHeight);
  }

  function createPdfDocument(pageStreams, pageWidth, pageHeight) {
    const objects = [];
    const pageIds = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

    pageStreams.forEach((streamLines, index) => {
      const pageId = 4 + index * 2;
      const contentId = pageId + 1;
      pageIds.push(`${pageId} 0 R`);
      const stream = streamLines.join("\n");
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    objects[2] = `<< /Type /Pages /Kids [${pageIds.join(" ")}] /Count ${pageIds.length} >>`;
    return serializePdf(objects);
  }

  function serializePdf(objects) {
    let output = "%PDF-1.4\n";
    const offsets = [0];
    for (let index = 1; index < objects.length; index += 1) {
      offsets[index] = output.length;
      output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xref = output.length;
    output += `xref\n0 ${objects.length}\n`;
    output += "0000000000 65535 f \n";
    for (let index = 1; index < objects.length; index += 1) {
      output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return output;
  }

  async function refreshAgencyState() {
    if (!state.agency || document.hidden || isUserTyping() || pendingLocalSave) return;
    try {
      const response = await apiRequest("/api/state", {}, false);
      state.routes = preserveOpenStates(normalizeRoutes(response.routes));
      writeLocalRoutes(state.routes);
      if (!state.routes.some((route) => route.id === state.activeRouteId)) {
        state.activeRouteId = state.routes[0] && state.routes[0].id || "";
      }
      renderRoutes();
      renderCompanies();
    } catch (error) {
      showOfflineNotice("Serveur absent : les donnees restent sur cet appareil.");
    }
  }

  function refreshCurrentStatuses() {
    if (!state.agency || document.hidden || isUserTyping()) return;
    renderCompanies();
  }

  function saveAgencyState() {
    saveUiPrefs();
    if (!state.agency) return;
    writeLocalRoutes(state.routes);
    pendingLocalSave = true;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        const response = await apiRequest("/api/state", {
          method: "PUT",
          body: JSON.stringify({ routes: normalizeRoutes(state.routes) })
        }, false);
        writeLocalRoutes(response.routes);
        pendingLocalSave = false;
        offlineNoticeShown = false;
      } catch (error) {
        showOfflineNotice("Serveur absent : modification sauvegardee localement.");
      }
    }, 250);
  }

  async function apiRequest(url, options = {}, authenticated = false) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = "application/json";
    if (authenticated && state.token) headers.Authorization = `Bearer ${state.token}`;
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers, cache: "no-store" });
    } catch (error) {
      const networkError = new Error("Serveur absent.");
      networkError.status = 0;
      throw networkError;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Erreur serveur.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function getActiveRoute() {
    return getRouteById(state.activeRouteId);
  }

  function getRouteById(id) {
    return state.routes.find((route) => route.id === id);
  }

  function getAllCompanies() {
    return state.routes.flatMap((route) => route.companies.map((company) => ({ company, route })));
  }

  function getSearchMatches(value) {
    const term = normalizeSearch(value);
    if (!term) return [];
    return getAllCompanies().filter((item) => normalizeSearch(item.company.name).includes(term));
  }

  function normalizeRoutes(routes) {
    if (!Array.isArray(routes)) return [];
    const names = new Set();
    return routes.flatMap((route) => {
      const name = normalizeRouteName(route && route.name);
      const key = name.toLocaleLowerCase("fr-FR");
      if (!name || names.has(key)) return [];
      names.add(key);
      return [{
        id: String(route.id || createId()),
        name,
        companies: Array.isArray(route.companies) ? route.companies.map(normalizeCompany) : []
      }];
    });
  }

  function normalizeCompany(company) {
    return {
      id: String(company && company.id || createId()),
      name: normalizeCompanyName(company && company.name),
      schedule: normalizeSchedule(company && company.schedule),
      closureException: normalizeClosureException(company && company.closureException),
      notes: String(company && company.notes || ""),
      closedMonday: Boolean(company && company.closedMonday),
      closedFriday: Boolean(company && company.closedFriday),
      updatedAt: normalizeTimestamp(company && company.updatedAt),
      open: Boolean(company && company.open)
    };
  }

  function closeAllCompanies(routes) {
    routes.forEach((route) => route.companies.forEach((company) => {
      company.open = false;
    }));
  }

  function preserveOpenStates(remoteRoutes) {
    const openById = new Map(getAllCompanies().map((item) => [item.company.id, item.company.open]));
    remoteRoutes.forEach((route) => route.companies.forEach((company) => {
      company.open = openById.get(company.id) || false;
    }));
    return remoteRoutes;
  }

  function createDefaultState() {
    return {
      agency: null,
      token: "",
      routes: [],
      activeRouteId: "",
      search: "",
      theme: "light"
    };
  }

  function createDefaultRoutes() {
    return [{ id: createId(), name: "NPXA", companies: [] }];
  }

  function readUiPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(UI_STORAGE_KEY));
      return {
        theme: saved && saved.theme === "dark" ? "dark" : "light",
        activeRouteByAgency: saved && typeof saved.activeRouteByAgency === "object" ? saved.activeRouteByAgency : {}
      };
    } catch (error) {
      return { theme: "light", activeRouteByAgency: {} };
    }
  }

  function saveUiPrefs() {
    const prefs = readUiPrefs();
    prefs.theme = state.theme;
    prefs.activeRouteByAgency.direct = state.activeRouteId;
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(prefs));
  }

  function readLocalRoutes() {
    try {
      const saved = JSON.parse(localStorage.getItem(ROUTES_STORAGE_KEY));
      return Array.isArray(saved) ? normalizeRoutes(saved) : null;
    } catch (error) {
      return null;
    }
  }

  function writeLocalRoutes(routes) {
    localStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(normalizeRoutes(routes)));
  }

  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
      return saved && saved.agency && saved.token ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function writeSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function applyTheme() {
    document.body.dataset.theme = state.theme === "dark" ? "dark" : "light";
  }

  function updateThemeButtons() {
    const dark = state.theme === "dark";
    themeIcons.forEach((icon) => {
      icon.textContent = dark ? "\u263e" : "\u2600";
    });
    themeToggles.forEach((button) => {
      button.title = dark ? "Mode clair" : "Mode sombre";
      button.setAttribute("aria-label", dark ? "Passer en mode clair" : "Passer en mode sombre");
    });
  }

  function getTodayStatus(company) {
    const now = new Date();
    const dayIndex = now.getDay();
    const dayKey = DAY_KEYS_BY_INDEX[dayIndex];
    const schedule = normalizeSchedule(company.schedule);
    const exception = normalizeClosureException(company.closureException);
    const hasSchedule = WEEK_DAYS.some((day) => schedule[day.key].trim());

    if (isClosureExceptionActive(exception, now)) return statusResult("#d40511", true, "Exception fermeture", "closed");
    if ((dayIndex === 1 && company.closedMonday) || (dayIndex === 5 && company.closedFriday)) {
      return statusResult("#d40511", true, "Ferme aujourd'hui", "closed");
    }
    if (!hasSchedule) return statusResult("#ffcc00", false, "Horaire non renseigne", "neutral");
    if (!dayKey) return statusResult("#d40511", true, "Ferme aujourd'hui", "closed");

    const todaySchedule = schedule[dayKey].trim();
    if (!todaySchedule) return statusResult("#d40511", true, "Horaire du jour non renseigne", "closed");
    const ranges = parseScheduleRanges(todaySchedule);
    if (!ranges.length) return statusResult("#d40511", true, "Horaire non reconnu", "closed");

    const current = now.getHours() * 60 + now.getMinutes();
    const activeRange = ranges.find(([start, end]) => isMinuteInRange(current, start, end));
    if (!activeRange) return statusResult("#d40511", true, "Ferme maintenant", "closed");

    const warningMinutes = getClosingWarningMinutes(current, activeRange[0], activeRange[1]);
    return statusResult("#15803d", false, "Ouvert maintenant", "open", warningMinutes);
  }

  function statusResult(color, closedToday, label, tone, warningMinutes = 0) {
    return { color, closedToday, label, tone, warningMinutes };
  }

  function statusBadgeClass(status) {
    return status.tone === "neutral" ? "neutral" : status.closedToday ? "closed" : "open";
  }

  function renderClosingAlert(status) {
    if (!status.warningMinutes) return "";
    return `<span class="closing-alert" title="Ferme dans ${status.warningMinutes} minutes"><span aria-hidden="true">&#9200;</span><span>${status.warningMinutes}</span></span>`;
  }

  function createEmptySchedule() {
    return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, ""]));
  }

  function normalizeSchedule(schedule) {
    if (typeof schedule === "string") return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, schedule]));
    return Object.fromEntries(WEEK_DAYS.map((day) => [day.key, String(schedule && schedule[day.key] || "")]));
  }

  function createQuarterHourOptions() {
    const options = [{ value: "", label: "--" }];
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const value = minutesToTime(minutes);
      options.push({ value, label: value });
    }
    return options;
  }

  function parseScheduleParts(value) {
    const ranges = parseScheduleRanges(value);
    return {
      start1: ranges[0] ? minutesToTime(ranges[0][0]) : "",
      end1: ranges[0] ? minutesToTime(ranges[0][1]) : "",
      start2: ranges[1] ? minutesToTime(ranges[1][0]) : "",
      end2: ranges[1] ? minutesToTime(ranges[1][1]) : ""
    };
  }

  function buildScheduleFromParts(parts) {
    const first = normalizeScheduleRange(parts.start1, parts.end1);
    const second = normalizeScheduleRange(parts.start2, parts.end2);
    return [first, second].filter(Boolean).join(" ");
  }

  function readSchedulePartsFromRow(row) {
    if (!row) return null;
    return SCHEDULE_PARTS.reduce((parts, part) => {
      const select = row.querySelector(`[data-schedule-part="${part}"]`);
      parts[part] = select ? select.value : "";
      return parts;
    }, {});
  }

  function normalizeScheduleRange(start, end) {
    const safeStart = normalizeTimeValue(start);
    const safeEnd = normalizeTimeValue(end);
    return safeStart && safeEnd ? `${safeStart}-${safeEnd}` : "";
  }

  function createEmptyClosureException() {
    return { enabled: false, start: "", end: "" };
  }

  function normalizeClosureException(value) {
    return {
      enabled: Boolean(value && value.enabled),
      start: normalizeDateValue(value && value.start),
      end: normalizeDateValue(value && value.end)
    };
  }

  function normalizeDateValue(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
  }

  function isClosureExceptionActive(exception, date) {
    if (!exception.enabled) return false;
    const start = parseInputDate(exception.start);
    const end = parseInputDate(exception.end || exception.start);
    if (!start || !end) return false;
    const today = startOfDay(date);
    return today >= startOfDay(start) && today <= startOfDay(end);
  }

  function parseInputDate(value) {
    const normalized = normalizeDateValue(value);
    if (!normalized) return null;
    const [year, month, day] = normalized.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function normalizeTimestamp(value) {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  }

  function isTimestampToday(value) {
    const timestamp = normalizeTimestamp(value);
    if (!timestamp) return false;
    const date = new Date(timestamp);
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }

  function formatDateFr(value) {
    const date = parseInputDate(value);
    if (!date) return "";
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  }

  function formatDateTimeFr(date) {
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function sanitizeFileName(value) {
    return toPdfPlainText(value || "tournee")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "tournee";
  }

  function wrapPdfText(value, maxChars) {
    const words = toPdfPlainText(value).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      if (word.length > maxChars) {
        if (line) {
          lines.push(line);
          line = "";
        }
        for (let index = 0; index < word.length; index += maxChars) {
          lines.push(word.slice(index, index + maxChars));
        }
      } else if (!line) {
        line = word;
      } else if (`${line} ${word}`.length <= maxChars) {
        line = `${line} ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function escapePdfText(value) {
    return toPdfPlainText(value)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function toPdfPlainText(value) {
    return String(value || "")
      .replace(/€/g, "EUR")
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function normalizeTimeValue(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return "";
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function minutesToTime(minutes) {
    const safe = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function isMinuteInRange(current, start, end) {
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  function getClosingWarningMinutes(current, start, end) {
    let closeAt = end;
    if (start > end && current >= start) closeAt += 1440;
    const minutes = closeAt - current;
    return minutes > 0 && minutes <= CLOSING_ALERT_WINDOW_MINUTES ? minutes : 0;
  }

  function isUserTyping() {
    return Boolean(document.activeElement && document.activeElement.matches("input, textarea, select"));
  }

  function normalizeAgencyName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
  }

  function normalizeRouteName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleUpperCase("fr-FR").slice(0, 30);
  }

  function normalizeCompanyName(value) {
    return String(value || "").trim().toLocaleUpperCase("fr-FR");
  }

  function uppercaseCompanyNameInput(value) {
    return String(value || "").toLocaleUpperCase("fr-FR");
  }

  function normalizeSearch(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function formatCount(count, singular, plural) {
    return `${count} ${count > 1 ? plural : singular}`;
  }

  function cardStyle(color) {
    const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffcc00";
    const value = safe.slice(1);
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `--company-color: ${safe}; --company-soft: rgba(${red}, ${green}, ${blue}, 0.18);`;
  }

  function createId() {
    return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();

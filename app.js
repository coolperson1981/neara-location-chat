const query = new URLSearchParams(window.location.search);
const FORCE_DEMO_LOCATION = query.get("demo") === "1";
const MAP_ZOOM = 18;
const TILE_SIZE = 256;

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

const state = {
  userId: query.get("userId") || randomId(),
  name: query.get("name") || "You",
  people: [],
  connectedPeople: [],
  incomingWaves: [],
  sentWaves: new Set(),
  acceptedPeople: new Set(),
  messages: {},
  currentPerson: null,
  currentWave: null,
  isVisible: true,
  joined: false,
  eventSource: null,
  location: null,
  locationWatchId: null,
  previousIncomingIds: new Set(),
  previousConnectedIds: new Set(),
  pendingAutoOpen: new Set(),
  topicIndexes: new Map(),
  clientDraftIndexes: new Map(),
  profile: {},
};

const elements = {
  welcomeOverlay: document.getElementById("welcomeOverlay"),
  startButton: document.getElementById("startButton"),
  profileNameInput: document.getElementById("profileNameInput"),
  profileIntentInput: document.getElementById("profileIntentInput"),
  profileFoodInput: document.getElementById("profileFoodInput"),
  profileMoodInput: document.getElementById("profileMoodInput"),
  profilePaceInput: document.getElementById("profilePaceInput"),
  profileAvatar: document.getElementById("profileAvatar"),
  profileName: document.getElementById("profileName"),
  railButtons: document.querySelectorAll("[data-rail-target]"),
  peoplePanel: document.getElementById("peoplePanel"),
  conversationSection: document.getElementById("conversationSection"),
  conversationList: document.getElementById("conversationList"),
  peopleList: document.getElementById("peopleList"),
  peopleMarkers: document.getElementById("peopleMarkers"),
  nearbyCount: document.getElementById("nearbyCount"),
  nearbyLabel: document.getElementById("nearbyLabel"),
  mapCanvas: document.getElementById("mapCanvas"),
  realMapLayer: document.getElementById("realMapLayer"),
  realMapEmpty: document.getElementById("realMapEmpty"),
  locationLabel: document.querySelector("#locationLabel span"),
  visibilityToggle: document.getElementById("visibilityToggle"),
  notificationButton: document.getElementById("notificationButton"),
  notificationPanel: document.getElementById("notificationPanel"),
  notificationDot: document.getElementById("notificationDot"),
  closeNotifications: document.getElementById("closeNotifications"),
  privacyPanel: document.getElementById("privacyPanel"),
  closePrivacyPanel: document.getElementById("closePrivacyPanel"),
  privacyVisibilityShortcut: document.getElementById("privacyVisibilityShortcut"),
  incomingRequest: document.getElementById("incomingRequest"),
  emptyNotification: document.getElementById("emptyNotification"),
  requestModal: document.getElementById("requestModal"),
  closeRequestModal: document.getElementById("closeRequestModal"),
  modalAvatar: document.getElementById("modalAvatar"),
  modalTitle: document.getElementById("modalTitle"),
  modalDescription: document.getElementById("modalDescription"),
  confirmRequest: document.getElementById("confirmRequest"),
  chatDrawer: document.getElementById("chatDrawer"),
  closeChat: document.getElementById("closeChat"),
  chatAvatar: document.getElementById("chatAvatar"),
  chatName: document.getElementById("chatName"),
  chatMessages: document.getElementById("chatMessages"),
  aiDraftButton: document.getElementById("aiDraftButton"),
  aiAssistStatus: document.getElementById("aiAssistStatus"),
  chatSuggestions: document.getElementById("chatSuggestions"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  toastStack: document.getElementById("toastStack"),
  refreshButton: document.getElementById("refreshButton"),
  messageBadge: document.getElementById("messageBadge"),
};

function icon(name) {
  return `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = String(value || "");
  return node.innerHTML;
}

function initials(name) {
  return String(name || "").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "NA";
}

function personById(personId) {
  return state.people.find((person) => person.id === personId);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (error) {
    throw new Error(`Could not reach Neara at ${window.location.origin}. Refresh the page or restart the local server.`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function showToast(message, isChat = false) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `${icon(isChat ? "message" : "check")}<span>${escapeHtml(message)}</span>`;
  elements.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4300);
}

function sendBrowserNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
}

function requestBrowserNotifications() {
  if (FORCE_DEMO_LOCATION) return;
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function setProfile(name) {
  state.name = name;
  elements.profileName.textContent = name;
  elements.profileAvatar.textContent = initials(name);
}

function readStoredInterviewProfile() {
  return {};
}

function getInterviewProfile() {
  return {
    intent: elements.profileIntentInput.value.trim(),
    food: elements.profileFoodInput.value.trim(),
    mood: elements.profileMoodInput.value.trim(),
    pace: elements.profilePaceInput.value.trim(),
    energy: elements.profileMoodInput.value.trim(),
    notes: "",
  };
}

function saveInterviewProfile() {
  state.profile = getInterviewProfile();
}

function fillInterviewProfile() {
  state.profile = readStoredInterviewProfile();
  elements.profileIntentInput.value = state.profile.intent || "";
  elements.profileFoodInput.value = state.profile.food || "";
  elements.profileMoodInput.value = state.profile.mood || state.profile.energy || "";
  elements.profilePaceInput.value = state.profile.pace || "";
}

function deriveProfileTags(profile) {
  const text = Object.values(profile).join(" ").toLowerCase();
  const candidates = [
    ["coffee", ["coffee", "cafe", "matcha", "tea", "latte"]],
    ["walk", ["walk", "stroll", "wander"]],
    ["food", ["food", "lunch", "dinner", "brunch", "tacos", "sushi"]],
    ["quiet", ["quiet", "reflective", "calm", "low key", "low-key"]],
    ["social", ["social", "chat", "talk", "group", "meetup"]],
    ["art", ["art", "gallery", "museum", "design"]],
    ["outside", ["park", "outside", "outdoor", "sun"]],
    ["easy", ["easy", "casual", "no rush", "low pressure"]],
  ];
  return candidates
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([tag]) => tag)
    .slice(0, 2);
}

function profileActivity(profile) {
  return profile.intent || profile.food || profile.mood || "Available for a nearby hello";
}

function setRailActive(target) {
  elements.railButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.railTarget === target);
  });
}

function flashFocus(element) {
  if (!element) return;
  element.classList.remove("is-focus-flash");
  void element.offsetWidth;
  element.classList.add("is-focus-flash");
  window.setTimeout(() => element.classList.remove("is-focus-flash"), 900);
}

function closeFloatingPanels() {
  elements.notificationPanel.classList.remove("is-open");
  elements.notificationPanel.setAttribute("aria-hidden", "true");
  elements.privacyPanel.classList.remove("is-open");
  elements.privacyPanel.setAttribute("aria-hidden", "true");
}

function latestConnectedPerson() {
  return (state.connectedPeople || [])[0] || null;
}

async function handleRailAction(target) {
  setRailActive(target);
  if (target !== "privacy") elements.privacyPanel.classList.remove("is-open");
  if (target !== "privacy") elements.privacyPanel.setAttribute("aria-hidden", "true");

  if (target === "discover") {
    closeFloatingPanels();
    elements.chatDrawer.classList.remove("is-open");
    elements.chatDrawer.setAttribute("aria-hidden", "true");
    elements.peoplePanel.scrollTo({ top: 0, behavior: "smooth" });
    flashFocus(elements.mapCanvas);
    showToast("Discover view is ready.");
    return;
  }

  if (target === "messages") {
    closeFloatingPanels();
    await refreshState().catch(() => {});
    const person = latestConnectedPerson();
    flashFocus(elements.conversationSection);
    if (person) {
      openChat(person);
      showToast(`Opened your conversation with ${person.name}.`, true);
    } else {
      showToast("No conversations yet. Send a wave and both say yes to create one.");
    }
    return;
  }

  if (target === "connections") {
    closeFloatingPanels();
    await refreshState().catch(() => {});
    elements.chatDrawer.classList.remove("is-open");
    elements.chatDrawer.setAttribute("aria-hidden", "true");
    elements.conversationSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    flashFocus(elements.conversationSection);
    showToast(state.connectedPeople.length ? "Conversation cards are here." : "No connected people yet.");
    return;
  }

  if (target === "privacy") {
    elements.notificationPanel.classList.remove("is-open");
    elements.notificationPanel.setAttribute("aria-hidden", "true");
    elements.privacyPanel.classList.toggle("is-open");
    elements.privacyPanel.setAttribute("aria-hidden", String(!elements.privacyPanel.classList.contains("is-open")));
  }
}

function lastMessageFor(person) {
  const thread = state.messages[person.id] || [];
  return thread[thread.length - 1] || null;
}

function applyServerState(snapshot) {
  const previousConnectedIds = state.previousConnectedIds;
  const nextConnectedIds = new Set(snapshot.connected.map((person) => person.id));
  const connectedPeople = new Map(snapshot.connected.map((person) => [person.id, person]));
  const mergedPeople = new Map(snapshot.nearby.map((person) => [person.id, person]));
  for (const person of snapshot.connected) mergedPeople.set(person.id, person);

  state.people = [...mergedPeople.values()];
  state.connectedPeople = snapshot.connected;
  state.incomingWaves = snapshot.incomingWaves;
  state.sentWaves = new Set(snapshot.sentWaves);
  state.acceptedPeople = nextConnectedIds;
  state.messages = snapshot.messages;
  state.isVisible = snapshot.self.visible;
  elements.visibilityToggle.classList.toggle("is-on", state.isVisible);
  elements.visibilityToggle.setAttribute("aria-pressed", String(state.isVisible));
  document.body.classList.toggle("is-hidden-mode", !state.isVisible);
  renderRealMap();

  for (const wave of snapshot.incomingWaves) {
    if (!state.previousIncomingIds.has(wave.id)) {
      showToast(`${wave.from.name} waved hello.`, true);
      sendBrowserNotification(`${wave.from.name} waved hello`, "Open Neara to accept or decline the chat request.");
    }
  }

  for (const personId of nextConnectedIds) {
    if (!previousConnectedIds.has(personId) && state.pendingAutoOpen.has(personId)) {
      const person = connectedPeople.get(personId);
      state.pendingAutoOpen.delete(personId);
      showToast(`${person.name} accepted your wave. Your chat is ready.`, true);
      sendBrowserNotification(`${person.name} accepted your wave`, "Your private chat is ready to open.");
      openChat(person);
    }
  }

  state.previousIncomingIds = new Set(snapshot.incomingWaves.map((wave) => wave.id));
  state.previousConnectedIds = nextConnectedIds;
  renderConversations();
  renderPeople();
  renderNotifications();
  renderChat();
}

async function refreshState() {
  if (!state.joined) return null;
  const snapshot = await api(`/api/state?userId=${encodeURIComponent(state.userId)}`);
  applyServerState(snapshot);
  return snapshot;
}

function renderConversations() {
  const conversations = state.connectedPeople || [];
  elements.conversationSection.classList.toggle("is-empty", conversations.length === 0);

  if (conversations.length === 0) {
    elements.conversationList.innerHTML = `
      <div class="conversation-empty">
        <strong>No chats yet</strong>
        <span>When both people say yes, a card appears here.</span>
      </div>
    `;
    return;
  }

  elements.conversationList.innerHTML = conversations.map((person) => {
    const lastMessage = lastMessageFor(person);
    const topics = conversationTopicsFor(person);
    const topicIndex = (state.topicIndexes.get(person.id) || 0) % topics.length;
    const topic = topics[topicIndex];
    const preview = lastMessage ? `${lastMessage.from === state.userId ? "You: " : ""}${lastMessage.text}` : "No messages yet";
    const archetype = person.matchRecommendation?.archetype || "Mutual connection";
    return `
      <article class="conversation-card" data-conversation-id="${person.id}">
        <button class="conversation-card-main" data-conversation-open="${person.id}" type="button">
          <span class="avatar ${person.avatar}">${escapeHtml(person.initials)}</span>
          <span class="conversation-copy">
            <strong>${escapeHtml(person.name)}</strong>
            <small>${escapeHtml(archetype)}</small>
            <span>${escapeHtml(preview)}</span>
          </span>
          <span class="conversation-open">${icon("message")}</span>
        </button>
        <div class="topic-flashcard">
          <span class="topic-kicker">${icon("sparkle")} AI topic flashcard</span>
          <p>${escapeHtml(topic)}</p>
          <div class="topic-actions">
            <span>Topic ${topicIndex + 1}/${topics.length}</span>
            <button type="button" data-topic-next="${person.id}">Next topic</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-conversation-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const person = state.connectedPeople.find((connected) => connected.id === button.dataset.conversationOpen);
      if (person) openChat(person);
    });
  });
  document.querySelectorAll("[data-topic-next]").forEach((button) => {
    button.addEventListener("click", () => {
      const person = state.connectedPeople.find((connected) => connected.id === button.dataset.topicNext);
      if (!person) return;
      const topics = conversationTopicsFor(person);
      const nextIndex = ((state.topicIndexes.get(person.id) || 0) + 1) % topics.length;
      state.topicIndexes.set(person.id, nextIndex);
      renderConversations();
    });
  });
}

function conversationTopicsFor(person) {
  const starters = person.matchRecommendation?.conversationStarters || [];
  const topics = [...starters, clientDraftSuggestion(person)]
    .map((topic) => String(topic || "").trim())
    .filter(Boolean);
  return [...new Set(topics)].slice(0, 3).length
    ? [...new Set(topics)].slice(0, 3)
    : ["Ask what kind of nearby hello would feel easy right now."];
}

function renderPeople() {
  elements.nearbyCount.textContent = state.people.length;
  elements.nearbyLabel.textContent = state.people.length === 1 ? "person" : "people";
  elements.messageBadge.textContent = state.acceptedPeople.size;
  elements.messageBadge.classList.toggle("is-hidden", state.acceptedPeople.size === 0);

  if (state.people.length === 0) {
    elements.peopleList.innerHTML = `
      <div class="people-empty">
        ${icon("radar")}
        <strong>No one nearby yet</strong>
        <p>Open this page in another browser tab and join as a second person to see live discovery.</p>
      </div>
    `;
    elements.peopleMarkers.innerHTML = "";
    return;
  }

  elements.peopleList.innerHTML = state.people.map((person) => {
    const requestSent = state.sentWaves.has(person.id);
    const connected = state.acceptedPeople.has(person.id);
    let action = `${icon("wave")}<span class="sr-only">Wave to ${escapeHtml(person.name)}</span>`;
    if (requestSent) action = `${icon("check")}<span class="sr-only">Request sent to ${escapeHtml(person.name)}</span>`;
    if (connected) action = `${icon("message")}<span class="sr-only">Chat with ${escapeHtml(person.name)}</span>`;

    return `
      <article class="person-card">
        <span class="avatar ${person.avatar}">${escapeHtml(person.initials)}</span>
        <div class="person-copy">
          <div class="person-topline">
            <strong>${escapeHtml(person.name)}</strong>
            <small>${escapeHtml(person.distance)}</small>
          </div>
          <p>${escapeHtml(person.activity)}</p>
          <p class="exact-location">${icon("pin")} ${formatCoordinates(person.location)}</p>
          <div class="person-tags">${person.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          ${renderAgentMatch(person)}
        </div>
        <button class="wave-button ${requestSent ? "is-sent" : ""}" data-person-id="${person.id}" type="button"
          aria-label="${connected ? `Chat with ${escapeHtml(person.name)}` : `Wave to ${escapeHtml(person.name)}`}">
          ${action}
        </button>
      </article>
    `;
  }).join("");

  elements.peopleMarkers.innerHTML = state.people.map((person) => `
    <button class="map-marker" style="${mapMarkerStyle(person.location || person.position)}" data-person-id="${person.id}"
      type="button" aria-label="${state.acceptedPeople.has(person.id) ? "Chat with" : "Wave to"} ${escapeHtml(person.name)}, ${escapeHtml(person.distance)} away">
      <span class="avatar ${person.avatar}">${escapeHtml(person.initials)}</span>
      <span class="marker-status"></span>
      <span class="marker-label">${escapeHtml(person.name)} / ${escapeHtml(person.distance)}</span>
    </button>
  `).join("");

  document.querySelectorAll("[data-person-id]").forEach((button) => {
    button.addEventListener("click", () => handlePersonAction(button.dataset.personId));
  });
}

function renderNotifications() {
  const wave = state.incomingWaves[0];
  elements.notificationDot.classList.toggle("is-hidden", state.incomingWaves.length === 0);
  if (!wave) {
    elements.incomingRequest.classList.add("is-hidden");
    elements.emptyNotification.style.display = "block";
    return;
  }

  state.currentWave = wave;
  elements.emptyNotification.style.display = "none";
  elements.incomingRequest.classList.remove("is-hidden");
  elements.incomingRequest.innerHTML = `
    <div class="notification-person">
      <span class="avatar ${wave.from.avatar}">${escapeHtml(wave.from.initials)}</span>
      <div>
        <strong>${escapeHtml(wave.from.name)} waved hello</strong>
        <p>${escapeHtml(wave.from.activity)}</p>
        <small>${escapeHtml(wave.from.matchRecommendation?.headline || "Just now")}</small>
      </div>
    </div>
    <div class="notification-actions">
      <button class="secondary-button" id="declineRequest" type="button">Not now</button>
      <button class="primary-button" id="acceptRequest" type="button">Accept chat</button>
    </div>
  `;
  document.getElementById("acceptRequest").addEventListener("click", () => resolveIncomingRequest(true));
  document.getElementById("declineRequest").addEventListener("click", () => resolveIncomingRequest(false));
}

function renderChat() {
  if (!state.currentPerson || !state.acceptedPeople.has(state.currentPerson.id)) return;
  const person = personById(state.currentPerson.id) || state.currentPerson;
  state.currentPerson = person;
  elements.chatName.textContent = person.name;
  elements.chatAvatar.textContent = person.initials;
  elements.chatAvatar.className = `avatar ${person.avatar}`;
  const chatMessages = state.messages[person.id] || [];
  elements.chatMessages.innerHTML = `
    <div class="chat-time">Today, nearby</div>
    ${chatMessages.length
      ? chatMessages.map((message) => messageMarkup(message, person)).join("")
      : `<div class="chat-empty">Your private chat is open. Say hello to ${escapeHtml(person.name)}.</div>`}
  `;
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function setAiAssistStatus(message) {
  elements.aiAssistStatus.textContent = message;
}

function clientDraftSuggestion(person, advance = false) {
  const history = state.messages[person.id] || [];
  const recent = history[history.length - 1];
  const match = person.matchRecommendation || {};
  const signals = [
    ...(match.sharedSignals || []),
    ...((match.dimensionOverlaps || []).map((overlap) => overlap.label)),
    ...(person.tags || []),
  ].join(" ").toLowerCase();
  const draftIndex = state.clientDraftIndexes.get(person.id) || 0;
  const pick = (options) => {
    const suggestion = options[draftIndex % options.length];
    if (advance) state.clientDraftIndexes.set(person.id, draftIndex + 1);
    return suggestion;
  };

  if (!recent) {
    const options = [];
    if (signals.includes("coffee")) options.push(
      `Hey ${person.name}, want to grab a quick coffee nearby if it feels easy?`,
      "Coffee sounds like a good overlap. Want to pick a close public cafe?",
      "Want to start simple with coffee somewhere nearby?",
    );
    if (signals.includes("walk") || signals.includes("leisurely")) options.push(
      `Hey ${person.name}, want to take a low-pressure walk nearby?`,
      "A short easy walk could be nice. Want to keep it casual?",
      "Want to say hi with a no-rush walk nearby?",
    );
    if (signals.includes("quiet") || signals.includes("reflective")) options.push(
      `Hey ${person.name}, want to say hi somewhere calm nearby?`,
      "A quieter spot sounds good to me. Want to choose one nearby?",
      "Want to keep the first hello low-key and easy?",
    );
    if (signals.includes("curious") || signals.includes("art")) options.push(
      `Hey ${person.name}, what nearby place have you been curious to try?`,
      "Want to compare one local spot each of us has been curious about?",
      "Curious to try somewhere nearby together?",
    );
    return pick(options.length ? [...new Set(options)] : [
      `Hey ${person.name}, nice to connect. Want to say hi nearby?`,
      "Want to start with a quick low-pressure hello?",
      "Happy to keep this easy. What kind of nearby spot feels comfortable?",
    ]);
  }

  if (recent.from === state.userId) return "";
  const lower = recent.text.toLowerCase();
  if (lower.includes("time") || lower.includes("when")) return pick([
    "I can do soon. What time works best for you?",
    "Soon works for me. Want to pick a time that feels easy?",
  ]);
  if (lower.includes("where") || lower.includes("spot") || lower.includes("meet")) return pick([
    "A close, public spot works for me. What place feels easy?",
    "Somewhere public and nearby sounds good. Any spot you like?",
  ]);
  if (lower.includes("coffee") || lower.includes("cafe")) return pick([
    "Coffee sounds easy. Want to pick a close public cafe?",
    "I'm down for coffee. Want to keep it nearby?",
  ]);
  if (lower.includes("walk")) return pick([
    "A short walk works for me. Want to keep it casual and nearby?",
    "A quick walk sounds nice. Want to choose the route?",
  ]);
  return pick([
    "That sounds good. Want to keep it casual and say hi nearby?",
    "I like that. Want to keep the first hello easy?",
    "Sounds good to me. What would feel low-pressure?",
  ]);
}

function applyAiDraft(suggestion, status) {
  const cleanSuggestion = String(suggestion || "").trim();
  if (!cleanSuggestion) return false;
  elements.chatInput.value = cleanSuggestion;
  elements.chatInput.focus();
  elements.chatSuggestions.style.display = "flex";
  elements.chatSuggestions.innerHTML = `<button type="button">${escapeHtml(cleanSuggestion)}</button>`;
  setAiAssistStatus(status);
  return true;
}

function messageMarkup(message, person) {
  const outgoing = message.from === state.userId;
  return `
    <div class="message-row ${outgoing ? "outgoing" : "incoming"}">
      <div class="message-bubble">${escapeHtml(message.text)}</div>
      <small>${outgoing ? "You" : escapeHtml(person.name)} · ${formatTime(message.createdAt)}</small>
    </div>
  `;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatCoordinates(location) {
  if (!location) return "Location unavailable";
  return `${Number(location.lat).toFixed(6)}, ${Number(location.lng).toFixed(6)}`;
}

function renderAgentMatch(person) {
  const match = person.matchRecommendation;
  if (!match) return "";
  const decision = ["strong", "recommended", "light", "low"].includes(match.decision) ? match.decision : "light";
  const signals = Array.isArray(match.sharedSignals) ? match.sharedSignals.slice(0, 3) : [];
  const dimensions = Array.isArray(match.dimensionOverlaps) ? match.dimensionOverlaps.slice(0, 2) : [];
  return `
    <div class="agent-match agent-match-${decision}">
      <div>
        <strong>${escapeHtml(match.archetype || match.headline || "Agent match")}</strong>
        <span>${Number(match.score || 0)}% fit</span>
      </div>
      <p>${escapeHtml(match.reason || "The backend agent is still learning from profile and chat signals.")}</p>
      ${signals.length || dimensions.length ? `<div class="agent-signals">${
        [...signals, ...dimensions.map((dimension) => dimension.label)]
          .slice(0, 4)
          .map((signal) => `<span>${escapeHtml(signal)}</span>`)
          .join("")
      }</div>` : ""}
    </div>
  `;
}

function latLngToWorld(location, zoom = MAP_ZOOM) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((Number(location.lat) * Math.PI) / 180);
  return {
    x: ((Number(location.lng) + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function mapMarkerStyle(location) {
  if (!state.location || !location) return "left: 50%; top: 50%;";
  if (typeof location.left === "string" && typeof location.top === "string") {
    return `left: ${location.left}; top: ${location.top};`;
  }

  const center = latLngToWorld(state.location);
  const point = latLngToWorld(location);
  const width = elements.mapCanvas.clientWidth || 800;
  const height = elements.mapCanvas.clientHeight || 480;
  const x = width / 2 + point.x - center.x;
  const y = height / 2 + point.y - center.y;
  return `left: ${x}px; top: ${y}px;`;
}

function renderRealMap() {
  if (!state.location) {
    elements.realMapLayer.innerHTML = "";
    elements.mapCanvas.classList.remove("has-real-map");
    return;
  }

  const width = elements.mapCanvas.clientWidth || 800;
  const height = elements.mapCanvas.clientHeight || 480;
  const center = latLngToWorld(state.location);
  const tileCount = 2 ** MAP_ZOOM;
  const startX = Math.floor((center.x - width / 2) / TILE_SIZE);
  const endX = Math.floor((center.x + width / 2) / TILE_SIZE);
  const startY = Math.floor((center.y - height / 2) / TILE_SIZE);
  const endY = Math.floor((center.y + height / 2) / TILE_SIZE);
  const tiles = [];

  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) {
      if (y < 0 || y >= tileCount) continue;
      const wrappedX = ((x % tileCount) + tileCount) % tileCount;
      const left = x * TILE_SIZE - center.x + width / 2;
      const top = y * TILE_SIZE - center.y + height / 2;
      tiles.push(`
        <img
          class="real-map-tile"
          src="https://tile.openstreetmap.org/${MAP_ZOOM}/${wrappedX}/${y}.png"
          alt=""
          loading="eager"
          style="left: ${left}px; top: ${top}px;"
        />
      `);
    }
  }

  elements.realMapLayer.innerHTML = tiles.join("");
  elements.mapCanvas.classList.add("has-real-map");
}

function handlePersonAction(personId) {
  const person = personById(personId);
  if (!person) return;
  if (state.acceptedPeople.has(person.id)) return openChat(person);
  if (state.sentWaves.has(person.id)) return showToast(`Your wave to ${person.name} is still waiting for a reply.`);

  state.currentPerson = person;
  elements.modalAvatar.className = `avatar avatar-lg ${person.avatar}`;
  elements.modalAvatar.textContent = person.initials;
  elements.modalTitle.textContent = `Say hello to ${person.name}?`;
  elements.modalDescription.textContent = `${person.name} will get a real-time request. A private chat opens only if they choose to accept. ${person.matchRecommendation ? `${person.matchRecommendation.headline}: ${person.matchRecommendation.reason}` : ""}`;
  document.getElementById("modalMessage").textContent = person.matchRecommendation?.conversationStarters?.[0] || "Hey! Looks like we're both nearby.";
  elements.requestModal.classList.add("is-open");
  elements.requestModal.setAttribute("aria-hidden", "false");
}

function closeRequestModal() {
  elements.requestModal.classList.remove("is-open");
  elements.requestModal.setAttribute("aria-hidden", "true");
}

async function sendWave() {
  const person = state.currentPerson;
  if (!person) return;
  try {
    await api("/api/waves", { method: "POST", body: JSON.stringify({ from: state.userId, to: person.id }) });
    await refreshState().catch(() => {});
    state.pendingAutoOpen.add(person.id);
    closeRequestModal();
    showToast(`Wave sent to ${person.name}. We'll let you know if they accept.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function resolveIncomingRequest(accepted) {
  const wave = state.currentWave;
  if (!wave) return;
  try {
    await api(`/api/waves/${wave.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ userId: state.userId, accept: accepted }),
    });
    if (accepted) await refreshState().catch(() => {});
    elements.notificationPanel.classList.remove("is-open");
    elements.notificationPanel.setAttribute("aria-hidden", "true");
    if (accepted) {
      const connectedPerson = state.connectedPeople.find((person) => person.id === wave.from.id) || wave.from;
      showToast(`You accepted ${wave.from.name}'s wave. Your private chat is open.`, true);
      window.setTimeout(() => openChat(connectedPerson), 150);
    } else {
      showToast(`${wave.from.name}'s request was declined.`);
    }
  } catch (error) {
    showToast(error.message);
  }
}

function openChat(person) {
  state.currentPerson = person;
  renderChat();
  elements.chatInput.value = "";
  elements.chatSuggestions.style.display = "";
  setAiAssistStatus("Drafts use recent chat. Your match schema learns only broad traits.");
  elements.chatDrawer.classList.add("is-open");
  elements.chatDrawer.setAttribute("aria-hidden", "false");
}

async function requestAiDraft() {
  const person = state.currentPerson;
  if (!person) return;
  if (!state.acceptedPeople.has(person.id)) {
    await refreshState().catch(() => {});
  }
  if (!state.acceptedPeople.has(person.id)) {
    setAiAssistStatus("AI drafts unlock after both people choose yes.");
    showToast("Accept the connection first, then AI can draft a message.");
    return;
  }

  const latestMessage = lastMessageFor(person);
  if (latestMessage?.from === state.userId) {
    elements.chatSuggestions.style.display = "none";
    setAiAssistStatus("You already sent the last message. Wait for their reply before drafting again.");
    showToast("AI paused so you do not stack repeated follow-up messages.");
    return;
  }

  elements.aiDraftButton.disabled = true;
  elements.aiDraftButton.classList.add("is-loading");
  setAiAssistStatus("Drafting a reply...");

  try {
    const payload = await api("/api/ai/suggest-message", {
      method: "POST",
      body: JSON.stringify({ userId: state.userId, personId: person.id }),
    });
    const suggestion = payload.suggestion || clientDraftSuggestion(person, true);
    applyAiDraft(suggestion, payload.provider === "digitalocean"
      ? "DigitalOcean AI draft ready. Edit before sending."
      : payload.provider === "openai"
        ? "OpenAI draft ready. Edit before sending."
        : "Local match-agent draft ready. API key is not loaded here.");
  } catch (error) {
    const fallback = clientDraftSuggestion(person, true);
    applyAiDraft(fallback, "Neara AI draft ready offline. Edit before sending.");
    showToast("AI draft is using the local match agent right now.");
  } finally {
    elements.aiDraftButton.disabled = false;
    elements.aiDraftButton.classList.remove("is-loading");
  }
}

function exactLocation(position) {
  return { lat: position.coords.latitude, lng: position.coords.longitude, demo: false };
}

function demoLocation() {
  const jitter = [...state.userId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    lat: 34.083 + ((jitter % 9) - 4) * 0.0004,
    lng: -118.371 + (((jitter * 7) % 9) - 4) * 0.0004,
    demo: true,
  };
}

function findLocation() {
  return new Promise((resolve) => {
    if (FORCE_DEMO_LOCATION) return resolve(demoLocation());
    if (!navigator.geolocation) return resolve(demoLocation());
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(exactLocation(position)),
      () => resolve(demoLocation()),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

function startLocationTracking() {
  if (!navigator.geolocation || state.location?.demo || state.locationWatchId !== null) return;
  state.locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      state.location = exactLocation(position);
      elements.locationLabel.textContent = formatCoordinates(state.location);
      renderRealMap();
      heartbeat().catch(() => {});
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}

async function joinNearby() {
  const name = elements.profileNameInput.value.trim().slice(0, 32);
  if (!name) return elements.profileNameInput.focus();
  elements.startButton.disabled = true;
  elements.startButton.querySelector("span").textContent = "Finding your area...";
  requestBrowserNotifications();
  setProfile(name);
  saveInterviewProfile();
  state.location = await findLocation();
  const tags = deriveProfileTags(state.profile);

  try {
    const snapshot = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({
        id: state.userId,
        name: state.name,
        lat: state.location.lat,
        lng: state.location.lng,
        visible: state.isVisible,
        activity: profileActivity(state.profile),
        tags,
        profile: state.profile,
      }),
    });
    state.joined = true;
    elements.welcomeOverlay.classList.add("is-hidden");
    elements.locationLabel.textContent = state.location.demo ? "West Hollywood demo" : formatCoordinates(state.location);
    renderRealMap();
    applyServerState(snapshot);
    connectEvents();
    startLocationTracking();
    showToast(state.location.demo ? "Location permission skipped. You're using West Hollywood demo coordinates." : "Exact location sharing is on. You're visible nearby.");
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.startButton.disabled = false;
    elements.startButton.querySelector("span").textContent = "Start discovering";
  }
}

function connectEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource(`/api/events?userId=${encodeURIComponent(state.userId)}`);
  state.eventSource.addEventListener("state", (event) => applyServerState(JSON.parse(event.data)));
  state.eventSource.addEventListener("error", () => {
    window.setTimeout(() => refreshState().catch(() => {}), 750);
  });
}

async function sendMessage(text) {
  if (!state.currentPerson) return;
  try {
    await api("/api/messages", { method: "POST", body: JSON.stringify({ from: state.userId, to: state.currentPerson.id, text }) });
    await refreshState().catch(() => {});
    setAiAssistStatus("Your match schema updated from broad chat traits.");
  } catch (error) {
    showToast(error.message);
  }
}

async function heartbeat() {
  if (!state.joined || !state.location) return;
  const snapshot = await api("/api/heartbeat", {
    method: "POST",
    body: JSON.stringify({ id: state.userId, visible: state.isVisible, lat: state.location.lat, lng: state.location.lng }),
  });
  applyServerState(snapshot);
}

async function toggleVisibility() {
  state.isVisible = !state.isVisible;
  elements.visibilityToggle.classList.toggle("is-on", state.isVisible);
  elements.visibilityToggle.setAttribute("aria-pressed", String(state.isVisible));
  document.body.classList.toggle("is-hidden-mode", !state.isVisible);
  if (state.joined) {
    try {
      await heartbeat();
    } catch (error) {
      showToast(error.message);
    }
  }
  showToast(state.isVisible ? "You're visible nearby again." : "Visibility paused. You won't appear nearby.");
}

elements.profileNameInput.value = state.name;
fillInterviewProfile();
setProfile(state.name);
renderConversations();
renderPeople();
renderNotifications();
elements.startButton.addEventListener("click", joinNearby);
elements.profileNameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") joinNearby(); });
[elements.profileIntentInput, elements.profileFoodInput, elements.profileMoodInput, elements.profilePaceInput].forEach((input) => {
  input.addEventListener("input", saveInterviewProfile);
});
elements.railButtons.forEach((button) => {
  button.addEventListener("click", () => handleRailAction(button.dataset.railTarget));
});
elements.visibilityToggle.addEventListener("click", toggleVisibility);
elements.notificationButton.addEventListener("click", () => {
  elements.privacyPanel.classList.remove("is-open");
  elements.privacyPanel.setAttribute("aria-hidden", "true");
  elements.notificationPanel.classList.toggle("is-open");
  elements.notificationPanel.setAttribute("aria-hidden", String(!elements.notificationPanel.classList.contains("is-open")));
});
elements.closeNotifications.addEventListener("click", () => {
  elements.notificationPanel.classList.remove("is-open");
  elements.notificationPanel.setAttribute("aria-hidden", "true");
});
elements.closePrivacyPanel.addEventListener("click", () => {
  elements.privacyPanel.classList.remove("is-open");
  elements.privacyPanel.setAttribute("aria-hidden", "true");
  setRailActive("discover");
});
elements.privacyVisibilityShortcut.addEventListener("click", toggleVisibility);
elements.closeRequestModal.addEventListener("click", closeRequestModal);
elements.requestModal.addEventListener("click", (event) => { if (event.target === elements.requestModal) closeRequestModal(); });
elements.confirmRequest.addEventListener("click", sendWave);
elements.closeChat.addEventListener("click", () => {
  elements.chatDrawer.classList.remove("is-open");
  elements.chatDrawer.setAttribute("aria-hidden", "true");
});
elements.aiDraftButton.addEventListener("click", requestAiDraft);
elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = elements.chatInput.value.trim();
  if (!text) return;
  sendMessage(text);
  elements.chatInput.value = "";
  elements.chatSuggestions.style.display = "none";
});
elements.chatSuggestions.addEventListener("click", (event) => {
  if (event.target.tagName !== "BUTTON") return;
  elements.chatInput.value = event.target.textContent.trim();
  elements.chatInput.focus();
  setAiAssistStatus("Draft inserted. Edit it, then press send when ready.");
  elements.chatSuggestions.style.display = "none";
});
elements.refreshButton.addEventListener("click", async () => {
  elements.refreshButton.querySelector("svg").style.transform = "rotate(180deg)";
  try {
    await heartbeat();
    showToast(`Nearby refreshed. ${state.people.length} ${state.people.length === 1 ? "person is" : "people are"} around.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    window.setTimeout(() => { elements.refreshButton.querySelector("svg").style.transform = ""; }, 350);
  }
});
window.setInterval(() => heartbeat().catch(() => {}), 15_000);
window.addEventListener("resize", () => {
  renderRealMap();
  renderPeople();
});
window.addEventListener("beforeunload", () => {
  if (state.locationWatchId !== null) navigator.geolocation.clearWatch(state.locationWatchId);
  if (state.joined) navigator.sendBeacon("/api/leave", JSON.stringify({ id: state.userId }));
});

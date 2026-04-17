(() => {
  const SETTINGS_KEY = "dvMobileSettings";
  const RECENT_KEY = "dvMobileRecent";
  const MAX_PHOTOS = 8;
  const MAX_IMAGE_DIMENSION = 1600;
  const IMAGE_QUALITY = 0.8;
  const GDRIVE_FOLDER_NAME = "DemandVintageMobile";

  const SCOPES = [
    "https://www.googleapis.com/auth/drive.appdata",
    "https://www.googleapis.com/auth/drive.file"
  ].join(" ");

  let state = {
    accessToken: "",
    accountEmail: "",
    photos: [],
    productId: "",
    gdriveRootFolderId: ""
  };

  // --- Elements ---
  const $ = (id) => document.getElementById(id);

  const els = {
    screenConnect: $("screenConnect"),
    screenMain: $("screenMain"),
    connectBtn: $("connectBtn"),
    connectStatus: $("connectStatus"),
    clientIdInput: $("clientIdInput"),
    disconnectBtn: $("disconnectBtn"),
    headerAccount: $("headerAccount"),
    productIdInput: $("productIdInput"),
    generateIdBtn: $("generateIdBtn"),
    photoGrid: $("photoGrid"),
    photoCount: $("photoCount"),
    cameraInput: $("cameraInput"),
    libraryInput: $("libraryInput"),
    saveBtn: $("saveBtn"),
    saveStatus: $("saveStatus"),
    recentSection: $("recentSection"),
    recentList: $("recentList"),
    clearRecentBtn: $("clearRecentBtn")
  };

  // --- Storage ---
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch { return {}; }
  }

  function saveSettings(data) {
    try {
      const current = loadSettings();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...data }));
    } catch {}
  }

  function loadRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch { return []; }
  }

  function saveRecent(items) {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, 20)));
    } catch {}
  }

  // --- Status helpers ---
  function setConnectStatus(msg, type = "") {
    els.connectStatus.textContent = msg;
    els.connectStatus.className = "status-text" + (type ? ` is-${type}` : "");
  }

  function setSaveStatus(msg, type = "") {
    els.saveStatus.textContent = msg;
    els.saveStatus.className = "status-text" + (type ? ` is-${type}` : "");
  }

  // --- Screen switching ---
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
  }

  // --- Auth ---
  function getClientId() {
    return (els.clientIdInput.value.trim() || loadSettings().clientId || "").trim();
  }

  async function connectGoogleDrive() {
    const clientId = getClientId();
    if (!clientId) {
      setConnectStatus("Paste your Google OAuth Client ID first.", "error");
      return;
    }

    saveSettings({ clientId });

    const redirectUri = window.location.origin + window.location.pathname;
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem("dvOAuthState", state);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "token",
      scope: SCOPES,
      state,
      include_granted_scopes: "true"
    });

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  function handleOAuthCallback() {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const returnedState = params.get("state");
    const savedState = sessionStorage.getItem("dvOAuthState");

    if (!accessToken) return false;
    if (returnedState && savedState && returnedState !== savedState) {
      setConnectStatus("Authentication state mismatch. Try again.", "error");
      return false;
    }

    const expiresIn = Number(params.get("expires_in") || 3600);
    sessionStorage.removeItem("dvOAuthState");
    window.history.replaceState({}, document.title, window.location.pathname);

    state.accessToken = accessToken;
    saveSettings({
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000
    });

    return true;
  }

  async function fetchGoogleProfile() {
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${state.accessToken}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      state.accountEmail = data.email || "";
      saveSettings({ accountEmail: state.accountEmail });
      els.headerAccount.textContent = state.accountEmail;
    } catch {}
  }

  function isTokenFresh() {
    const settings = loadSettings();
    return !!(settings.accessToken && Number(settings.expiresAt || 0) > Date.now() + 60000);
  }

  function disconnect() {
    saveSettings({ accessToken: "", expiresAt: 0, accountEmail: "" });
    state.accessToken = "";
    state.accountEmail = "";
    state.photos = [];
    state.productId = "";
    showScreen("screenConnect");
    setConnectStatus("");
  }

  // --- Google Drive API ---
  async function driveRequest(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      setConnectStatus("Session expired. Please reconnect.", "error");
      disconnect();
      throw new Error("Token expired");
    }

    return res;
  }

  async function ensureMobileDraftFolder() {
    if (state.gdriveRootFolderId) return state.gdriveRootFolderId;

    const searchParams = new URLSearchParams({
      q: `name='${GDRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and 'appDataFolder' in parents and trashed=false`,
      spaces: "appDataFolder",
      fields: "files(id,name)"
    });

    const res = await driveRequest(`https://www.googleapis.com/drive/v3/files?${searchParams}`);
    const data = await res.json();

    if (data.files?.[0]?.id) {
      state.gdriveRootFolderId = data.files[0].id;
      return state.gdriveRootFolderId;
    }

    const createRes = await driveRequest(
      "https://www.googleapis.com/drive/v3/files",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: GDRIVE_FOLDER_NAME,
          mimeType: "application/vnd.google-apps.folder",
          parents: ["appDataFolder"]
        })
      }
    );

    const folder = await createRes.json();
    state.gdriveRootFolderId = folder.id;
    return state.gdriveRootFolderId;
  }

  async function saveDraftToDrive(productId, photos) {
    const parentFolderId = await ensureMobileDraftFolder();

    const product = {
      id: productId,
      productId,
      title: "",
      description: "",
      price: "",
      listingState: "draft",
      publishedAt: "",
      publishedPlatforms: [],
      createdAt: new Date().toISOString(),
      source: "mobile"
    };

    const productJson = JSON.stringify(product, null, 2);
    const productFormData = new FormData();
    productFormData.append("metadata", new Blob([JSON.stringify({
      name: `product-${productId}.json`,
      parents: [parentFolderId]
    })], { type: "application/json" }));
    productFormData.append("file", new Blob([productJson], { type: "application/json" }));

    await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      { method: "POST", body: productFormData }
    );

    const photosData = photos.map((photo, i) => ({
      id: photo.id,
      name: photo.name,
      type: photo.type,
      dataUrl: photo.dataUrl,
      width: photo.width,
      height: photo.height,
      compressed: true,
      sourceOrder: i
    }));

    const photosJson = JSON.stringify(photosData, null, 2);
    const photosFormData = new FormData();
    photosFormData.append("metadata", new Blob([JSON.stringify({
      name: `photos-${productId}.json`,
      parents: [parentFolderId]
    })], { type: "application/json" }));
    photosFormData.append("file", new Blob([photosJson], { type: "application/json" }));

    await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      { method: "POST", body: photosFormData }
    );

    return product;
  }

  // --- Photo handling ---
  function generateId() {
    const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
    return `DV-${timestamp}`;
  }

  async function compressPhoto(file, index) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = MAX_IMAGE_DIMENSION;
          let w = img.naturalWidth;
          let h = img.naturalHeight;

          if (Math.max(w, h) > maxDim) {
            const scale = maxDim / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }

          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);

          const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
          resolve({
            id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name || `photo-${index + 1}.jpg`,
            type: "image/jpeg",
            dataUrl,
            width: w,
            height: h
          });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addPhotos(files) {
    const remaining = MAX_PHOTOS - state.photos.length;
    if (remaining <= 0) {
      setSaveStatus(`Maximum ${MAX_PHOTOS} photos reached.`, "error");
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remaining);
    setSaveStatus("Processing photos...");

    try {
      const compressed = await Promise.all(
        filesToProcess.map((f, i) => compressPhoto(f, state.photos.length + i))
      );
      state.photos = [...state.photos, ...compressed];
      renderPhotos();
      setSaveStatus("");
      updateSaveButton();
    } catch (err) {
      setSaveStatus("Could not process photos.", "error");
    }
  }

  function removePhoto(index) {
    state.photos.splice(index, 1);
    renderPhotos();
    updateSaveButton();
  }

  function renderPhotos() {
    els.photoGrid.innerHTML = "";
    els.photoCount.textContent = `${state.photos.length} / ${MAX_PHOTOS}`;

    state.photos.forEach((photo, i) => {
      const thumb = document.createElement("div");
      thumb.className = "photo-thumb";

      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.alt = `Photo ${i + 1}`;

      const removeBtn = document.createElement("button");
      removeBtn.className = "photo-thumb-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => removePhoto(i));

      const order = document.createElement("span");
      order.className = "photo-thumb-order";
      order.textContent = i === 0 ? "Cover" : `${i + 1}`;

      thumb.appendChild(img);
      thumb.appendChild(removeBtn);
      thumb.appendChild(order);
      els.photoGrid.appendChild(thumb);
    });
  }

  function updateSaveButton() {
    const hasId = els.productIdInput.value.trim().length > 0;
    const hasPhotos = state.photos.length > 0;
    els.saveBtn.disabled = !(hasId && hasPhotos);
  }

  // --- Recent products ---
  function renderRecent() {
    const recent = loadRecent();
    if (!recent.length) {
      els.recentSection.style.display = "none";
      return;
    }

    els.recentSection.style.display = "";
    els.recentList.innerHTML = "";

    recent.forEach((item) => {
      const div = document.createElement("div");
      div.className = "recent-item";

      if (item.coverPhoto) {
        const img = document.createElement("img");
        img.src = item.coverPhoto;
        img.className = "recent-item-thumb";
        img.alt = item.productId;
        div.appendChild(img);
      }

      const info = document.createElement("div");
      info.className = "recent-item-info";

      const idEl = document.createElement("div");
      idEl.className = "recent-item-id";
      idEl.textContent = item.productId;

      const meta = document.createElement("div");
      meta.className = "recent-item-meta";
      meta.textContent = `${item.photoCount} photo${item.photoCount !== 1 ? "s" : ""} · ${new Date(item.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;

      info.appendChild(idEl);
      info.appendChild(meta);
      div.appendChild(info);
      els.recentList.appendChild(div);
    });
  }

  function addToRecent(productId, photos) {
    const recent = loadRecent();
    const newItem = {
      productId,
      photoCount: photos.length,
      coverPhoto: photos[0]?.dataUrl || "",
      savedAt: new Date().toISOString()
    };

    const filtered = recent.filter(r => r.productId !== productId);
    saveRecent([newItem, ...filtered]);
    renderRecent();
  }

  // --- Save ---
  async function saveDraft() {
    const productId = els.productIdInput.value.trim();
    if (!productId || !state.photos.length) return;

    els.saveBtn.disabled = true;
    setSaveStatus("Saving to Google Drive...");

    try {
      await saveDraftToDrive(productId, state.photos);
      addToRecent(productId, state.photos);

      setSaveStatus(`${productId} saved to drafts.`, "success");

      // Reset form for next product
      state.photos = [];
      els.productIdInput.value = "";
      renderPhotos();
      updateSaveButton();

    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus(err?.message || "Could not save right now.", "error");
      els.saveBtn.disabled = false;
    }
  }

  // --- Init ---
  function init() {
    const settings = loadSettings();

    // Pre-fill client ID if saved
    if (settings.clientId) {
      els.clientIdInput.value = settings.clientId;
    }

    // Pre-fill account email if saved
    if (settings.accountEmail) {
      els.headerAccount.textContent = settings.accountEmail;
      state.accountEmail = settings.accountEmail;
    }

    // Handle OAuth callback
    if (window.location.hash.includes("access_token")) {
      const ok = handleOAuthCallback();
      if (ok) {
        fetchGoogleProfile();
        showScreen("screenMain");
        renderPhotos();
        renderRecent();
        updateSaveButton();
        return;
      }
    }

    // Check existing token
    if (isTokenFresh()) {
      state.accessToken = settings.accessToken;
      showScreen("screenMain");
      renderPhotos();
      renderRecent();
      updateSaveButton();
      return;
    }

    showScreen("screenConnect");
  }

  // --- Event listeners ---
  els.connectBtn.addEventListener("click", connectGoogleDrive);

  els.disconnectBtn.addEventListener("click", disconnect);

  els.generateIdBtn.addEventListener("click", () => {
    els.productIdInput.value = generateId();
    updateSaveButton();
  });

  els.productIdInput.addEventListener("input", updateSaveButton);

  els.cameraInput.addEventListener("change", (e) => addPhotos(e.target.files));
  els.libraryInput.addEventListener("change", (e) => addPhotos(e.target.files));

  els.saveBtn.addEventListener("click", saveDraft);

  els.clearRecentBtn.addEventListener("click", () => {
    saveRecent([]);
    renderRecent();
  });

  init();
})();

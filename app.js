// Tile Definitions
const tiles = {
    hybrid: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    streets: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};
const hybridRef = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const map1 = L.map('map1', { zoomSnap: 0.1, attributionControl: false, zoomControl: false }).setView([40.7128, -74.0060], 12);
const map2 = L.map('map2', { zoomSnap: 0.1, attributionControl: false, zoomControl: false }).setView([51.5074, -0.1278], 12);

let currentMapType = 'hybrid'; // Track current map type

function b64UrlEncodeUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64UrlDecodeUtf8(b64u) {
    const b64 = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function b64UrlEncodeBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64UrlDecodeBytes(b64u) {
    const b64 = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function clamp(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
}

function round(n, dp = 6) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const m = Math.pow(10, dp);
    return Math.round(x * m) / m;
}

function safeLatLng(ll) {
    if (!ll || typeof ll.lat !== 'number' || typeof ll.lng !== 'number') return null;
    return [clamp(ll.lat, -85.05112878, 85.05112878), clamp(ll.lng, -180, 180)];
}

function safeLatLngLike(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return null;
    const lat = Number(arr[0]);
    const lng = Number(arr[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [clamp(lat, -85.05112878, 85.05112878), clamp(lng, -180, 180)];
}

function encodeMapType(mapType) {
    if (mapType === 'streets') return 1;
    if (mapType === 'satellite') return 2;
    return 0;
}

function decodeMapType(code) {
    if (code === 1) return 'streets';
    if (code === 2) return 'satellite';
    return 'hybrid';
}

function encodeAppState() {
    const c1 = map1.getCenter();
    const c2 = map2.getCenter();

    let encodedMode = 'dist';
    let encodedRef = 0;
    let encodedPts = [];
    try {
        encodedMode = mode;
        encodedRef = refMap === map1 ? 1 : (refMap === map2 ? 2 : 0);
        encodedPts = verticesRef.map(v => [round(v.latlng.lat, 6), round(v.latlng.lng, 6)]);
    } catch (_) {
        encodedMode = 'dist';
        encodedRef = 0;
        encodedPts = [];
    }

    const state = {
        v: 1,
        z: round(map1.getZoom(), 2),
        m1: [round(c1.lat, 6), round(c1.lng, 6)],
        m2: [round(c2.lat, 6), round(c2.lng, 6)],
        mode: encodedMode,
        ref: encodedRef,
        pts: encodedPts,
        mapType: currentMapType
    };

    const ptsCount = Array.isArray(state.pts) ? state.pts.length : 0;
    const buf = new ArrayBuffer(24 + ptsCount * 8);
    const dv = new DataView(buf);
    let o = 0;

    dv.setUint8(o, 1); o += 1;
    dv.setUint16(o, clamp(Math.round(Number(state.z) * 100), 0, 2200), true); o += 2;

    const m1lat = clamp(Math.round(Number(state.m1[0]) * 1e6), -85051129, 85051129);
    const m1lng = clamp(Math.round(Number(state.m1[1]) * 1e6), -180000000, 180000000);
    const m2lat = clamp(Math.round(Number(state.m2[0]) * 1e6), -85051129, 85051129);
    const m2lng = clamp(Math.round(Number(state.m2[1]) * 1e6), -180000000, 180000000);

    dv.setInt32(o, m1lat, true); o += 4;
    dv.setInt32(o, m1lng, true); o += 4;
    dv.setInt32(o, m2lat, true); o += 4;
    dv.setInt32(o, m2lng, true); o += 4;

    dv.setUint8(o, state.mode === 'area' ? 1 : 0); o += 1;
    dv.setUint8(o, clamp(Math.round(Number(state.ref)), 0, 2)); o += 1;
    dv.setUint8(o, encodeMapType(state.mapType)); o += 1;
    dv.setUint16(o, clamp(ptsCount, 0, 65535), true); o += 2;

    for (let i = 0; i < ptsCount; i++) {
        const p = state.pts[i];
        const ll = safeLatLngLike(p);
        const plat = ll ? ll[0] : 0;
        const plng = ll ? ll[1] : 0;
        dv.setInt32(o, Math.round(plat * 1e6), true); o += 4;
        dv.setInt32(o, Math.round(plng * 1e6), true); o += 4;
    }

    return b64UrlEncodeBytes(new Uint8Array(buf));
}

function decodeAppState(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw) return null;
    try {
        const bytes = b64UrlDecodeBytes(raw);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let o = 0;

        if (dv.byteLength < 24) return null;
        const v = dv.getUint8(o); o += 1;
        if (v !== 1) return null;

        const z = dv.getUint16(o, true) / 100; o += 2;
        const m1lat = dv.getInt32(o, true) / 1e6; o += 4;
        const m1lng = dv.getInt32(o, true) / 1e6; o += 4;
        const m2lat = dv.getInt32(o, true) / 1e6; o += 4;
        const m2lng = dv.getInt32(o, true) / 1e6; o += 4;
        const modeCode = dv.getUint8(o); o += 1;
        const ref = dv.getUint8(o); o += 1;
        const mapTypeCode = dv.getUint8(o); o += 1;
        const ptsCount = dv.getUint16(o, true); o += 2;

        if (dv.byteLength !== 24 + ptsCount * 8) return null;

        const pts = [];
        for (let i = 0; i < ptsCount; i++) {
            const plat = dv.getInt32(o, true) / 1e6; o += 4;
            const plng = dv.getInt32(o, true) / 1e6; o += 4;
            pts.push([plat, plng]);
        }

        return {
            v: 1,
            z,
            m1: [m1lat, m1lng],
            m2: [m2lat, m2lng],
            mode: modeCode === 1 ? 'area' : 'dist',
            ref: ref,
            pts,
            mapType: decodeMapType(mapTypeCode)
        };
    } catch (_) {
        return null;
    }
}

let isApplyingUrlState = false;

function applyDecodedState(state) {
    if (!state || typeof state !== 'object') return;

    const z = clamp(state.z, 0, 22);
    const m1 = safeLatLngLike(state.m1);
    const m2 = safeLatLngLike(state.m2);
    const decodedMode = state.mode === 'area' ? 'area' : 'dist';
    const pts = Array.isArray(state.pts) ? state.pts : [];
    const mapType = state.mapType || 'hybrid'; // Get map type from state, default to hybrid

    isApplyingUrlState = true;
    try {
        // Apply map type first
        if (mapType !== currentMapType) {
            currentMapType = mapType;
            
            // Remove existing layers
            map1.removeLayer(l1);
            map2.removeLayer(l2);
            if (map1.hasLayer(h1)) map1.removeLayer(h1);
            if (map2.hasLayer(h2)) map2.removeLayer(h2);
            
            // Create new tile layers
            l1 = L.tileLayer(tiles[mapType], { 
                fadeAnimation: false,
                updateWhenIdle: false,
                updateWhenZooming: true,
                keepBuffer: 0,
                maxNativeZoom: 18,
                maxZoom: 20
            }).addTo(map1);
            
            l2 = L.tileLayer(tiles[mapType], { 
                fadeAnimation: false,
                updateWhenIdle: false,
                updateWhenZooming: true,
                keepBuffer: 0,
                maxNativeZoom: 18,
                maxZoom: 20
            }).addTo(map2);

            // Add error handling to new layers
            l1.on('tileerror', handleTileError);
            l2.on('tileerror', handleTileError);

            // Add hybrid reference layer for hybrid maps
            if (mapType === 'hybrid') {
                h1 = L.tileLayer(hybridRef, { 
                    opacity: 0.9, 
                    fadeAnimation: false,
                    updateWhenIdle: false,
                    updateWhenZooming: true,
                    keepBuffer: 0,
                    maxNativeZoom: 18,
                    maxZoom: 20
                }).addTo(map1);
                h2 = L.tileLayer(hybridRef, { 
                    opacity: 0.9, 
                    fadeAnimation: false,
                    updateWhenIdle: false,
                    updateWhenZooming: true,
                    keepBuffer: 0,
                    maxNativeZoom: 18,
                    maxZoom: 20
                }).addTo(map2);
                
                // Add error handling to hybrid layers
                h1.on('tileerror', handleTileError);
                h2.on('tileerror', handleTileError);
            }
        }

        setMode(decodedMode);
        if (m1) map1.setView(m1, z, { animate: false });
        if (m2) map2.setView(m2, z, { animate: false });

        clearAll();

        if (pts.length > 0) {
            const refIdx = state.ref === 2 ? 2 : 1;
            refMap = refIdx === 1 ? map1 : map2;
            ovlMap = refMap === map1 ? map2 : map1;
            mercAnchorRef = toMerc(refMap.getCenter());
            mercAnchorOvl = toMerc(ovlMap.getCenter());
            document.getElementById('label1').innerText = refMap === map1 ? "Ref" : "Ovl";
            document.getElementById('label2').innerText = refMap === map2 ? "Ref" : "Ovl";

            pts.forEach((p) => {
                const llArr = safeLatLngLike(p);
                if (!llArr) return;
                const ll = L.latLng(llArr[0], llArr[1]);
                const mPos = toMerc(ll);
                const ghostLL = fromMerc(L.point(mercAnchorOvl.x + (mPos.x - mercAnchorRef.x), mercAnchorOvl.y + (mPos.y - mercAnchorRef.y)));

                const mR = L.marker(ll, { icon: L.divIcon({ className: 'handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(refMap);
                const mO = L.marker(ghostLL, { icon: L.divIcon({ className: 'ghost-handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(ovlMap);

                bindHandleInteractionLock(mR);
                bindHandleInteractionLock(mO);

                mR.on('contextmenu', (e) => showCtx(e, mR));
                mR.on('click', L.DomEvent.stopPropagation);

                mR.on('drag', (de) => {
                    const i = markersRef.indexOf(mR);
                    verticesRef[i].latlng = de.target.getLatLng();
                    const nP = toMerc(verticesRef[i].latlng);
                    verticesOvl[i].latlng = fromMerc(L.point(mercAnchorOvl.x + (nP.x - mercAnchorRef.x), mercAnchorOvl.y + (nP.y - mercAnchorRef.y)));
                    update();
                    scheduleUrlUpdate();
                });

                let dSM = null, oMs = [];
                mO.on('dragstart', (de) => { dSM = toMerc(de.target.getLatLng()); oMs = verticesOvl.map(v => toMerc(v.latlng)); });
                mO.on('drag', (de) => {
                    const cM = toMerc(de.target.getLatLng());
                    const dx = cM.x - dSM.x, dy = cM.y - dSM.y;
                    verticesOvl.forEach((v, idx) => v.latlng = fromMerc(L.point(oMs[idx].x + dx, oMs[idx].y + dy)));
                    const i = markersOvl.indexOf(mO);
                    const vOM = toMerc(verticesOvl[i].latlng), vRM = toMerc(verticesRef[i].latlng);
                    mercAnchorOvl.x = vOM.x - (vRM.x - mercAnchorRef.x);
                    mercAnchorOvl.y = vOM.y - (vRM.y - mercAnchorRef.y);
                    update();
                    scheduleUrlUpdate();
                });

                verticesRef.push({ latlng: ll });
                verticesOvl.push({ latlng: ghostLL });
                markersRef.push(mR);
                markersOvl.push(mO);
            });

            update();
        }
    } finally {
        isApplyingUrlState = false;
    }
}

let urlUpdateT = null;
function scheduleUrlUpdate() {
    if (isApplyingUrlState) return;
    clearTimeout(urlUpdateT);
    urlUpdateT = setTimeout(() => {
        if (isApplyingUrlState) return;
        try {
            const encoded = encodeAppState();
            const next = '#' + encoded;
            if (location.hash !== next) history.replaceState(null, '', next);
        } catch (_) {
        }
    }, 150);
}

window.addEventListener('hashchange', () => {
    if (isApplyingUrlState) return;
    const state = decodeAppState(location.hash);
    if (state) applyDecodedState(state);
});

function getSharableLink() {
    const encoded = encodeAppState();
    const base = location.href.split('#')[0];
    // Ensure we have a cache-busting query param for OG previews
    const withCache = base.includes('?') ? base : base + '?v=3';
    return withCache + '#' + encoded;
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 1400);
}

function flashShareCopied() {
    const shareBtn = document.querySelector('.share-btn');
    if (!shareBtn) return;
    shareBtn.classList.add('copied');
    setTimeout(() => shareBtn.classList.remove('copied'), 900);
}

function setShareMenuUrl(url) {
    const input = document.getElementById('share-link');
    if (input) input.value = url;
    document.querySelectorAll('.share-action').forEach((btn) => {
        btn.setAttribute('data-url', url);
        // Remove existing listener to avoid duplicates
        btn.removeEventListener('click', handleShareAction);
        // Add click listener to close overlay after sharing
        btn.addEventListener('click', handleShareAction);
    });
}

function handleShareAction() {
    setTimeout(() => closeShareMenu(), 500); // Close overlay after a short delay
}

function openShareMenu() {
    const overlay = document.getElementById('share-overlay');
    if (!overlay) return;

    const link = getSharableLink();
    setShareMenuUrl(link);

    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
        const input = document.getElementById('share-link');
        if (input) input.focus({ preventScroll: true });
    });
}

function closeShareMenu() {
    const overlay = document.getElementById('share-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
}

async function copyShareLink() {
    const link = getSharableLink();
    setShareMenuUrl(link);

    const input = document.getElementById('share-link');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(link);
            flashShareCopied();
            showToast('Link copied');
            setTimeout(() => closeShareMenu(), 500); // Close overlay after showing toast
            return;
        } catch (_) {
        }
    }

    if (input) {
        try {
            input.focus({ preventScroll: true });
            input.select();
            input.setSelectionRange(0, input.value.length);
            const ok = document.execCommand && document.execCommand('copy');
            if (ok) {
                flashShareCopied();
                showToast('Link copied');
                setTimeout(() => closeShareMenu(), 500); // Close overlay after showing toast
                return;
            }
        } catch (_) {
        }
    }

    showToast('Select and copy the link');
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('share-overlay');
    if (overlay && overlay.style.display !== 'none') closeShareMenu();
});

document.addEventListener('click', (e) => {
    const overlay = document.getElementById('share-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    const card = document.getElementById('share-card');
    if (card && card.contains(e.target)) return;
    if (e.target === overlay) closeShareMenu();
});

let l1 = L.tileLayer(tiles.hybrid, { 
    fadeAnimation: false,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 0,
    maxNativeZoom: 18,
    maxZoom: 20
}).addTo(map1);
let l2 = L.tileLayer(tiles.hybrid, { 
    fadeAnimation: false,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 0,
    maxNativeZoom: 18,
    maxZoom: 20
}).addTo(map2);
let h1 = L.tileLayer(hybridRef, { 
    opacity: 0.9, 
    fadeAnimation: false,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 0,
    maxNativeZoom: 18,
    maxZoom: 20
}).addTo(map1);
let h2 = L.tileLayer(hybridRef, { 
    opacity: 0.9, 
    fadeAnimation: false,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 0,
    maxNativeZoom: 18,
    maxZoom: 20
}).addTo(map2);

// Tile error handling to prevent black screens
function handleTileError(e) {
    console.warn('Tile loading error:', e);
    // Try to reload the tile after a short delay
    setTimeout(() => {
        if (e.tile && e.tile.src) {
            const img = new Image();
            img.onload = () => {
                if (e.tile.parentNode) {
                    e.tile.parentNode.replaceChild(img, e.tile);
                }
            };
            img.src = e.tile.src + '?retry=' + Date.now();
        }
    }, 1000);
}

// Add error handling to initial layers
l1.on('tileerror', handleTileError);
l2.on('tileerror', handleTileError);
h1.on('tileerror', handleTileError);
h2.on('tileerror', handleTileError);
let zoomTimeout = null;
let isSyncing = false;
const syncZoom = (e) => {
    if (isSyncing) return;
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => {
        const source = e.target;
        const target = source === map1 ? map2 : map1;
        if (Math.abs(target.getZoom() - source.getZoom()) > 0.01) {
            isSyncing = true;
            target.setZoom(source.getZoom(), { animate: false });
            isSyncing = false;
        }
    }, 50);
};
map1.on('zoom', syncZoom); map2.on('zoom', syncZoom);

map1.on('moveend', scheduleUrlUpdate);
map2.on('moveend', scheduleUrlUpdate);
map1.on('zoomend', scheduleUrlUpdate);
map2.on('zoomend', scheduleUrlUpdate);

// Search Logic with Suggestions
let searchTimeout = null;
const searchCache = new Map(); // Cache for search results

function toggleSearch(idx) {
    const lens = document.getElementById('lens' + idx);
    const wrapper = lens.closest('.search-wrapper');
    const input = document.getElementById('search' + idx);
    const list = document.getElementById('results' + idx);

    if (wrapper.classList.contains('expanded')) {
        input.value = '';
        wrapper.classList.remove('expanded');
        lens.classList.remove('active');
        list.classList.remove('visible');
        lens.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
    } else {
        wrapper.classList.add('expanded');
        lens.classList.add('active');
        lens.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        input.focus();
    }
}

async function fetchSuggestions(idx, query) {
    if (query.length < 3) {
        document.getElementById('results' + idx).classList.remove('visible');
        return;
    }

    // Check cache first
    const cacheKey = query.toLowerCase();
    if (searchCache.has(cacheKey)) {
        displaySuggestions(idx, searchCache.get(cacheKey));
        return;
    }

    try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
        const data = await resp.json();
        const list = document.getElementById('results' + idx);

        if (data && data.length > 0) {
            // Cache the results
            searchCache.set(cacheKey, data);
            displaySuggestions(idx, data);
        } else {
            document.getElementById('results' + idx).classList.remove('visible');
        }
    } catch (err) {
        console.error("Fetch failed", err);
    }
}

function displaySuggestions(idx, data) {
    const list = document.getElementById('results' + idx);
    list.innerHTML = '';
    data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerText = item.display_name;
        div.onclick = () => {
            const targetMap = idx === 1 ? map1 : map2;
            targetMap.setView([item.lat, item.lon], 14);
            list.classList.remove('visible');
            toggleSearch(idx); // Close search input
        };
        list.appendChild(div);
    });
    list.classList.add('visible');
}

const setupSearchEvents = (idx) => {
    const input = document.getElementById('search' + idx);
    input.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => fetchSuggestions(idx, e.target.value), 100);
    });
    input.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const query = e.target.value;
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const data = await resp.json();
            if (data?.[0]) {
                const targetMap = idx === 1 ? map1 : map2;
                targetMap.setView([data[0].lat, data[0].lon], 14);
                document.getElementById('results' + idx).classList.remove('visible');
                toggleSearch(idx); // Close search input
            }
        }
    });
};

setupSearchEvents(1);
setupSearchEvents(2);

// Geolocation functionality
function setLocationFromDevice(mapIndex) {
    const btn = document.getElementById('locationBtn' + mapIndex);
    const targetMap = mapIndex === 1 ? map1 : map2;
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }
    
    // Add locating animation
    btn.classList.add('locating');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            targetMap.setView([latitude, longitude], 15);
            btn.classList.remove('locating');
        },
        (error) => {
            btn.classList.remove('locating');
            let errorMessage = 'Unable to retrieve your location';
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage = 'Location access denied. Please enable location permissions.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = 'Location information unavailable.';
                    break;
                case error.TIMEOUT:
                    errorMessage = 'Location request timed out.';
                    break;
            }
            
            alert(errorMessage);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000 // Accept cached position up to 1 minute old
        }
    );
}

// Custom Dropdown Logic
const trigger = document.getElementById('layerTrigger');
const options = document.getElementById('layerOptions');

trigger.onclick = () => {
    options.classList.toggle('open');
};

document.querySelectorAll('.option').forEach(opt => {
    opt.onclick = () => {
        const val = opt.getAttribute('data-value');
        currentMapType = val; // Update current map type
        
        options.classList.remove('open');

        // Remove existing layers to prevent cache issues
        map1.removeLayer(l1);
        map2.removeLayer(l2);
        
        // Remove hybrid reference layers if they exist
        if (map1.hasLayer(h1)) map1.removeLayer(h1);
        if (map2.hasLayer(h2)) map2.removeLayer(h2);

        // Create new tile layers with fresh cache
        l1 = L.tileLayer(tiles[val], { 
            fadeAnimation: false,
            updateWhenIdle: false,
            updateWhenZooming: true,
            keepBuffer: 0,
            maxNativeZoom: 18,
            maxZoom: 20
        }).addTo(map1);
        
        l2 = L.tileLayer(tiles[val], { 
            fadeAnimation: false,
            updateWhenIdle: false,
            updateWhenZooming: true,
            keepBuffer: 0,
            maxNativeZoom: 18,
            maxZoom: 20
        }).addTo(map2);

        // Add error handling to new layers
        l1.on('tileerror', handleTileError);
        l2.on('tileerror', handleTileError);

        // Add hybrid reference layer for hybrid maps
        if (val === 'hybrid') {
            h1 = L.tileLayer(hybridRef, { 
                opacity: 0.9, 
                fadeAnimation: false,
                updateWhenIdle: false,
                updateWhenZooming: true,
                keepBuffer: 0,
                maxNativeZoom: 18,
                maxZoom: 20
            }).addTo(map1);
            h2 = L.tileLayer(hybridRef, { 
                opacity: 0.9, 
                fadeAnimation: false,
                updateWhenIdle: false,
                updateWhenZooming: true,
                keepBuffer: 0,
                maxNativeZoom: 18,
                maxZoom: 20
            }).addTo(map2);
            
            // Add error handling to hybrid layers
            h1.on('tileerror', handleTileError);
            h2.on('tileerror', handleTileError);
        }

        // Force map redraw to prevent black screen on mobile
        setTimeout(() => {
            map1.invalidateSize({ reset: true, animate: false });
            map2.invalidateSize({ reset: true, animate: false });
        }, 100);
    };
});
window.onclick = (e) => {
    if (!e.target.closest('#layerDropdown')) {
        if (options.classList.contains('open')) {
            options.classList.remove('open');
        }
    }
    if (!e.target.closest('.search-wrapper')) {
        document.querySelectorAll('.suggestions').forEach(s => s.classList.remove('visible'));
    }
    if (!e.target.closest('#ctx-menu')) hideCtx();
};

// Add touch event listener for mobile devices
window.addEventListener('touchstart', (e) => {
    if (!e.target.closest('#layerDropdown')) {
        if (options.classList.contains('open')) {
            options.classList.remove('open');
        }
    }
    if (!e.target.closest('.search-wrapper')) {
        document.querySelectorAll('.suggestions').forEach(s => s.classList.remove('visible'));
    }
    if (!e.target.closest('#ctx-menu')) hideCtx();
}, { passive: true });

// Graphics & Measurement State
const shapes = {
    sRefBg: L.polyline([], { color: 'var(--text-inv)', weight: 4, opacity: 0.8 }),
    sRef: L.polyline([], { color: 'var(--accent-blue)', weight: 2 }),
    sOvlBg: L.polyline([], { color: 'var(--text-inv)', weight: 4, opacity: 0.8 }),
    sOvl: L.polyline([], { color: 'var(--accent-yellow)', weight: 2 }),
    aRefBg: L.polygon([], { color: 'var(--text-inv)', weight: 4, opacity: 0.8, fill: false }),
    aRef: L.polygon([], { color: 'var(--accent-blue)', weight: 2, fillOpacity: 0.2 }),
    aOvlBg: L.polygon([], { color: 'var(--text-inv)', weight: 4, opacity: 0.8, fill: false }),
    aOvl: L.polygon([], { color: 'var(--accent-yellow)', weight: 2, fillOpacity: 0.3 })
};

let mode = 'dist';
let verticesRef = [], verticesOvl = [], markersRef = [], markersOvl = [];
let refMap = null, ovlMap = null, mercAnchorRef = null, mercAnchorOvl = null;
let measureLabelRef = null;
let measureLabelOvl = null;

// Movement state variables
let isMovingAllPoints = false;
let moveStartPoint = null;
let originalVerticesRef = [];
let originalVerticesOvl = [];
let activeMoveLabel = null;
let draggedLabel = null;
let hasStartedDragging = false;
let originalMercAnchorRef = null;
let originalMercAnchorOvl = null;

let mapsDisabledForLabelDrag = false;
let mapInteractionLockCount = 0;

const toMerc = (ll) => L.Projection.Mercator.project(ll);
const fromMerc = (p) => L.Projection.Mercator.unproject(p);

function setMode(m) {
    mode = m;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.id === 'btn-' + m));
    
    // Update data-active attribute for sliding animation
    const toolGroup = document.getElementById('toolGroup');
    if (toolGroup) {
        toolGroup.setAttribute('data-active', m);
    }
    
    document.querySelectorAll('.map-instance').forEach(div => div.style.cursor = 'crosshair');
    update();
    scheduleUrlUpdate();
}

// Context Menu Logic
let ctxMarker = null;
const ctxMenu = document.getElementById('ctx-menu');

function showCtx(e, m) {
    L.DomEvent.stopPropagation(e);
    ctxMarker = m;
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = e.originalEvent.clientX + 'px';
    ctxMenu.style.top = e.originalEvent.clientY + 'px';
}

function delPoint() {
    if (!ctxMarker || !refMap) return;
    const i = markersRef.indexOf(ctxMarker);
    if (i > -1) {
        verticesRef.splice(i, 1); verticesOvl.splice(i, 1);
        refMap.removeLayer(markersRef[i]); ovlMap.removeLayer(markersOvl[i]);
        markersRef.splice(i, 1); markersOvl.splice(i, 1);
        update();
        scheduleUrlUpdate();
    }
    hideCtx();
}

function hideCtx() { ctxMenu.style.display = 'none'; ctxMarker = null; }

function update() {
    const pRef = verticesRef.map(v => v.latlng);
    const pOvl = verticesOvl.map(v => v.latlng);
    const hasPoints = pRef.length > 0;

    // Show/hide clear button based on drawing state
    const clearBtn1 = document.getElementById('clearBtn1');
    const clearBtn2 = document.getElementById('clearBtn2');
    
    // Hide both clear buttons first
    clearBtn1.classList.remove('visible');
    clearBtn2.classList.remove('visible');
    
    // Only show clear button on the reference map when drawing
    if (hasPoints && refMap) {
        if (refMap === map1) {
            clearBtn1.classList.add('visible');
        } else if (refMap === map2) {
            clearBtn2.classList.add('visible');
        }
    }

    Object.values(shapes).forEach(s => { if (s._map) s.remove(); });

    if (measureLabelRef) { measureLabelRef.remove(); measureLabelRef = null; }
    if (measureLabelOvl) { measureLabelOvl.remove(); measureLabelOvl = null; }

    if (hasPoints && refMap && ovlMap) {
        const isArea = mode === 'area';
        if (isArea) {
            shapes.aRefBg.addTo(refMap).setLatLngs(pRef);
            shapes.aRef.addTo(refMap).setLatLngs(pRef);
            shapes.aOvlBg.addTo(ovlMap).setLatLngs(pOvl);
            shapes.aOvl.addTo(ovlMap).setLatLngs(pOvl);
        } else {
            shapes.sRefBg.addTo(refMap).setLatLngs(pRef);
            shapes.sRef.addTo(refMap).setLatLngs(pRef);
            shapes.sOvlBg.addTo(ovlMap).setLatLngs(pOvl);
            shapes.sOvl.addTo(ovlMap).setLatLngs(pOvl);
        }

        markersOvl.forEach((m, i) => { if (pOvl[i]) m.setLatLng(pOvl[i]); });

        const isComplete = pRef.length >= (isArea ? 3 : 2);
        if (!isComplete) return;

        if (isComplete) {
            const vRef = isArea ? getArea(pRef) : getDist(pRef);
            const vOvl = isArea ? getArea(pOvl) : getDist(pOvl);

            const pctDeltaVsRef = vRef > 0 ? ((vOvl - vRef) / vRef) * 100 : 0;
            const fmtPct = (pct) => {
                const p = Number(pct);
                const sign = p >= 0 ? '+' : '-';
                return `${sign}${Math.abs(p).toFixed(1)}%`;
            };

            const labelPoint = (pts, isAreaShape) => {
                if (!pts.length) return null;
                if (!isAreaShape) return lineMidpoint(pts);
                const c = polyCentroid(pts);
                if (c && pointInPolygon(c, pts)) return c;
                return L.polygon(pts).getBounds().getCenter();
            };

            const makeMeasureLabel = (valueText, pctText, color, isRef) => L.divIcon({
                className: 'measurement-label',
                html: `<div class="measurement-label-wrap">
                    <div class="measurement-label-inner" style="border-color:${color}">
                        <div class="measurement-label-primary" style="color:${color}">${valueText}</div>
                        ${color === 'var(--accent-yellow)' ? `<div class="measurement-label-secondary" style="color:${color}">${pctText}</div>` : ''}
                    </div>
                </div>`,
                iconSize: null
            });

            const pctRef = fmtPct(-pctDeltaVsRef);
            const pctOvl = fmtPct(pctDeltaVsRef);

            measureLabelRef = L.marker(labelPoint(pRef, isArea), {
                interactive: true,
                keyboard: false,
                icon: makeMeasureLabel(fmt(vRef, mode), pctRef, 'var(--accent-blue)', true)
            }).addTo(refMap);

            measureLabelOvl = L.marker(labelPoint(pOvl, isArea), {
                interactive: true,
                keyboard: false,
                icon: makeMeasureLabel(fmt(vOvl, mode), pctOvl, 'var(--accent-yellow)', false)
            }).addTo(ovlMap);

            // Add drag handlers for movement
            bindMeasurementLabelDrag(measureLabelRef, 'ref');
            bindMeasurementLabelDrag(measureLabelOvl, 'ovl');
        }
    }
}

function getArea(ll) {
    let a = 0; const R = 6378137;
    for (let i = 0; i < ll.length; i++) {
        const p1 = ll[i], p2 = ll[(i + 1) % ll.length];
        a += (p2.lng - p1.lng) * (Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(a * R * R / 2);
}
function getDist(ll) { let d = 0; for (let i = 0; i < ll.length - 1; i++) d += ll[i].distanceTo(ll[i + 1]); return d; }
function fmt(v, t) { 
    const comma = (num) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (t === 'area') return v >= 1e6 ? comma((v / 1e6).toFixed(2)) + ' km²' : comma(v.toFixed(0)) + ' m²'; 
    return v >= 1000 ? comma((v / 1000).toFixed(2)) + ' km' : comma(v.toFixed(0)) + ' m'; 
}

function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng, yi = polygon[i].lat;
        const xj = polygon[j].lng, yj = polygon[j].lat;
        const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
            (point.lng < (xj - xi) * (point.lat - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function polyCentroid(ll) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ll.length; i++) {
        const p1 = ll[i];
        const p2 = ll[(i + 1) % ll.length];
        const x1 = p1.lng, y1 = p1.lat;
        const x2 = p2.lng, y2 = p2.lat;
        const a = x1 * y2 - x2 * y1;
        area += a;
        cx += (x1 + x2) * a;
        cy += (y1 + y2) * a;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-12) return null;
    cx /= (6 * area);
    cy /= (6 * area);
    return L.latLng(cy, cx);
}

function lineMidpoint(ll) {
    if (ll.length === 1) return ll[0];
    const segLens = [];
    let total = 0;
    for (let i = 0; i < ll.length - 1; i++) {
        const len = ll[i].distanceTo(ll[i + 1]);
        segLens.push(len);
        total += len;
    }
    if (total <= 0) return ll[0];
    let target = total / 2;
    for (let i = 0; i < segLens.length; i++) {
        const len = segLens[i];
        if (target > len) {
            target -= len;
            continue;
        }
        const t = len > 0 ? (target / len) : 0;
        const a = ll[i], b = ll[i + 1];
        return L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
    }
    return ll[ll.length - 1];
}

function handleMapClick(e, src) {
    hideCtx();

    if (!refMap) {
        refMap = src; ovlMap = src === map1 ? map2 : map1;
        mercAnchorRef = toMerc(refMap.getCenter()); mercAnchorOvl = toMerc(ovlMap.getCenter());
        document.getElementById('label1').innerText = refMap === map1 ? "Ref" : "Ovl";
        document.getElementById('label2').innerText = refMap === map2 ? "Ref" : "Ovl";
    }
    if (src !== refMap) return;

    // Check if click is near an existing line segment to create intermediate point
    if (verticesRef.length >= 2) {
        const clickPoint = e.latlng;
        const tolerance = 15; // pixels tolerance for line detection
        
        for (let i = 0; i < verticesRef.length - 1; i++) {
            const p1 = verticesRef[i].latlng;
            const p2 = verticesRef[i + 1].latlng;
            
            // Calculate distance from click point to line segment in meters
            const distance = pointToLineDistance(clickPoint, p1, p2) * 111320; // Convert degrees to meters
            
            // Convert to pixels using current zoom level
            const zoom = src.getZoom();
            const metersPerPixel = 156543.03392 * Math.cos(clickPoint.lat * Math.PI / 180) / Math.pow(2, zoom);
            const pixelDistance = distance / metersPerPixel;
            
            if (pixelDistance < tolerance) {
                // Find the closest point on the line segment
                const closestPoint = closestPointOnLine(clickPoint, p1, p2);
                
                // Insert new point at this position
                insertIntermediatePoint(i + 1, closestPoint, src);
                return;
            }
        }
        
        // For area mode, also check the line from last to first point
        if (mode === 'area' && verticesRef.length >= 3) {
            const p1 = verticesRef[verticesRef.length - 1].latlng;
            const p2 = verticesRef[0].latlng;
            
            const distance = pointToLineDistance(clickPoint, p1, p2) * 111320;
            const zoom = src.getZoom();
            const metersPerPixel = 156543.03392 * Math.cos(clickPoint.lat * Math.PI / 180) / Math.pow(2, zoom);
            const pixelDistance = distance / metersPerPixel;
            
            if (pixelDistance < tolerance) {
                const closestPoint = closestPointOnLine(clickPoint, p1, p2);
                insertIntermediatePoint(verticesRef.length, closestPoint, src);
                return;
            }
        }
    }

    // If not near a line, add new point as usual
    const mPos = toMerc(e.latlng);
    const ghostLL = fromMerc(L.point(mercAnchorOvl.x + (mPos.x - mercAnchorRef.x), mercAnchorOvl.y + (mPos.y - mercAnchorRef.y)));

    const mR = L.marker(e.latlng, { icon: L.divIcon({ className: 'handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(refMap);
    const mO = L.marker(ghostLL, { icon: L.divIcon({ className: 'ghost-handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(ovlMap);

    bindHandleInteractionLock(mR);
    bindHandleInteractionLock(mO);

    mR.on('contextmenu', (e) => showCtx(e, mR));
    mR.on('click', L.DomEvent.stopPropagation);

    mR.on('drag', (de) => {
        const i = markersRef.indexOf(mR);
        verticesRef[i].latlng = de.target.getLatLng();
        const nP = toMerc(verticesRef[i].latlng);
        verticesOvl[i].latlng = fromMerc(L.point(mercAnchorOvl.x + (nP.x - mercAnchorRef.x), mercAnchorOvl.y + (nP.y - mercAnchorRef.y)));
        update();
        scheduleUrlUpdate();
    });

    let dSM = null, oMs = [];
    mO.on('dragstart', (de) => { dSM = toMerc(de.target.getLatLng()); oMs = verticesOvl.map(v => toMerc(v.latlng)); });
    mO.on('drag', (de) => {
        const cM = toMerc(de.target.getLatLng());
        const dx = cM.x - dSM.x, dy = cM.y - dSM.y;
        verticesOvl.forEach((v, idx) => v.latlng = fromMerc(L.point(oMs[idx].x + dx, oMs[idx].y + dy)));
        const i = markersOvl.indexOf(mO);
        const vOM = toMerc(verticesOvl[i].latlng), vRM = toMerc(verticesRef[i].latlng);
        mercAnchorOvl.x = vOM.x - (vRM.x - mercAnchorRef.x);
        mercAnchorOvl.y = vOM.y - (vRM.y - mercAnchorRef.y);
        update();
        scheduleUrlUpdate();
    });

    verticesRef.push({ latlng: e.latlng });
    verticesOvl.push({ latlng: ghostLL });
    markersRef.push(mR);
    markersOvl.push(mO);
    update();
    scheduleUrlUpdate();
}

function pointToLineDistance(point, lineStart, lineEnd) {
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
        xx = lineStart.lat;
        yy = lineStart.lng;
    } else if (param > 1) {
        xx = lineEnd.lat;
        yy = lineEnd.lng;
    } else {
        xx = lineStart.lat + param * C;
        yy = lineStart.lng + param * D;
    }

    const dx = point.lat - xx;
    const dy = point.lng - yy;

    return Math.sqrt(dx * dx + dy * dy);
}

function closestPointOnLine(point, lineStart, lineEnd) {
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    if (param < 0) {
        return lineStart;
    } else if (param > 1) {
        return lineEnd;
    } else {
        return L.latLng(
            lineStart.lat + param * C,
            lineStart.lng + param * D
        );
    }
}

function insertIntermediatePoint(index, latlng, src) {
    const mPos = toMerc(latlng);
    const ghostLL = fromMerc(L.point(mercAnchorOvl.x + (mPos.x - mercAnchorRef.x), mercAnchorOvl.y + (mPos.y - mercAnchorRef.y)));

    const mR = L.marker(latlng, { icon: L.divIcon({ className: 'handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(refMap);
    const mO = L.marker(ghostLL, { icon: L.divIcon({ className: 'ghost-handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(ovlMap);

    bindHandleInteractionLock(mR);
    bindHandleInteractionLock(mO);

    mR.on('contextmenu', (e) => showCtx(e, mR));
    mR.on('click', L.DomEvent.stopPropagation);

    mR.on('drag', (de) => {
        const i = markersRef.indexOf(mR);
        verticesRef[i].latlng = de.target.getLatLng();
        const nP = toMerc(verticesRef[i].latlng);
        verticesOvl[i].latlng = fromMerc(L.point(mercAnchorOvl.x + (nP.x - mercAnchorRef.x), mercAnchorOvl.y + (nP.y - mercAnchorRef.y)));
        update();
        scheduleUrlUpdate();
    });

    let dSM = null, oMs = [];
    mO.on('dragstart', (de) => { dSM = toMerc(de.target.getLatLng()); oMs = verticesOvl.map(v => toMerc(v.latlng)); });
    mO.on('drag', (de) => {
        const cM = toMerc(de.target.getLatLng());
        const dx = cM.x - dSM.x, dy = cM.y - dSM.y;
        verticesOvl.forEach((v, idx) => v.latlng = fromMerc(L.point(oMs[idx].x + dx, oMs[idx].y + dy)));
        const i = markersOvl.indexOf(mO);
        const vOM = toMerc(verticesOvl[i].latlng), vRM = toMerc(verticesRef[i].latlng);
        mercAnchorOvl.x = vOM.x - (vRM.x - mercAnchorRef.x);
        mercAnchorOvl.y = vOM.y - (vRM.y - mercAnchorRef.y);
        update();
        scheduleUrlUpdate();
    });

    // Insert at the specified index
    verticesRef.splice(index, 0, { latlng: latlng });
    verticesOvl.splice(index, 0, { latlng: ghostLL });
    markersRef.splice(index, 0, mR);
    markersOvl.splice(index, 0, mO);
    
    update();
    scheduleUrlUpdate();
}

map1.on('click', (e) => handleMapClick(e, map1));
map2.on('click', (e) => handleMapClick(e, map2));

function getLatLngFromDomEvent(map, ev) {
    if (!map || !ev) return null;
    const src = (ev.touches && ev.touches[0]) ? ev.touches[0]
        : (ev.changedTouches && ev.changedTouches[0]) ? ev.changedTouches[0]
        : ev;
    const containerPoint = map.mouseEventToContainerPoint(src);
    return map.containerPointToLatLng(containerPoint);
}

function bindMeasurementLabelDrag(marker, labelType) {
    if (!marker) return;
    const el = marker.getElement ? marker.getElement() : marker._icon;
    if (!el) return;

    const handler = (ev) => startLabelDrag(ev, labelType, marker);
    el.addEventListener('pointerdown', handler, { passive: false });
    el.addEventListener('touchstart', handler, { passive: false });
    el.addEventListener('mousedown', handler);
}

function bindHandleInteractionLock(marker) {
    if (!marker) return;
    const el = marker.getElement ? marker.getElement() : marker._icon;
    if (!el) return;

    const stop = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
    };

    const down = (ev) => {
        // Do NOT preventDefault immediately; wait to see if it’s a drag vs long-press
        let prevented = false;
        let moved = false;
        let startX = 0, startY = 0;
        if (ev.touches && ev.touches[0]) {
            startX = ev.touches[0].clientX;
            startY = ev.touches[0].clientY;
        } else if (ev.clientX !== undefined) {
            startX = ev.clientX;
            startY = ev.clientY;
        }

        const move = (me) => {
            const dx = Math.abs((me.touches && me.touches[0] ? me.touches[0].clientX : me.clientX) - startX);
            const dy = Math.abs((me.touches && me.touches[0] ? me.touches[0].clientY : me.clientY) - startY);
            if (!moved && (dx > 5 || dy > 5)) {
                moved = true;
                // First movement: lock interactions and prevent default to stop map pan
                lockMapInteractions();
                stop(me);
                prevented = true;
            }
        };

        // Short timer to lock interactions in case there’s no movement (still a drag intent)
        const timer = setTimeout(() => {
            if (!moved && !prevented) {
                lockMapInteractions();
                prevented = true;
            }
        }, 120);

        const up = (ue) => {
            clearTimeout(timer);
            if (moved || prevented) {
                unlockMapInteractions();
            }
            // If we never prevented default, allow contextmenu/long-press to proceed
        };

        // Bind move/up/cancel listeners
        if (ev && typeof ev.pointerId === 'number') {
            document.addEventListener('pointermove', move, { passive: false });
            document.addEventListener('pointerup', up, { passive: false, once: true });
            document.addEventListener('pointercancel', up, { passive: false, once: true });
        } else {
            document.addEventListener('mousemove', move, { passive: false });
            document.addEventListener('mouseup', up, { once: true });
            document.addEventListener('touchmove', move, { passive: false });
            document.addEventListener('touchend', up, { passive: false, once: true });
            document.addEventListener('touchcancel', up, { passive: false, once: true });
        }
    };

    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('mousedown', down);
}

function lockMapInteractions() {
    mapInteractionLockCount += 1;
    if (mapInteractionLockCount !== 1) return;
    disableMapsForLabelDrag();
}

function unlockMapInteractions() {
    mapInteractionLockCount = Math.max(0, mapInteractionLockCount - 1);
    if (mapInteractionLockCount !== 0) return;
    enableMapsAfterLabelDrag();
}

function resetMapInteractionLocks() {
    mapInteractionLockCount = 0;
    enableMapsAfterLabelDrag();
}

window.addEventListener('blur', resetMapInteractionLocks);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') resetMapInteractionLocks();
});
window.addEventListener('pagehide', resetMapInteractionLocks);

// Last-resort safety: unlock on any global pointer/touch end if somehow we're still locked
document.addEventListener('pointerup', () => {
    if (mapInteractionLockCount > 0) {
        setTimeout(() => {
            if (mapInteractionLockCount > 0) {
                console.warn('MapInteractionLock: forcing unlock after global pointerup');
                resetMapInteractionLocks();
            }
        }, 0);
    }
}, { passive: true });
document.addEventListener('touchend', () => {
    if (mapInteractionLockCount > 0) {
        setTimeout(() => {
            if (mapInteractionLockCount > 0) {
                console.warn('MapInteractionLock: forcing unlock after global touchend');
                resetMapInteractionLocks();
            }
        }, 0);
    }
}, { passive: true });
document.addEventListener('mouseup', () => {
    if (mapInteractionLockCount > 0) {
        setTimeout(() => {
            if (mapInteractionLockCount > 0) {
                console.warn('MapInteractionLock: forcing unlock after global mouseup');
                resetMapInteractionLocks();
            }
        }, 0);
    }
}, { passive: true });

function disableMapsForLabelDrag() {
    if (!refMap || !ovlMap || mapsDisabledForLabelDrag) return;
    mapsDisabledForLabelDrag = true;
    refMap.dragging.disable();
    ovlMap.dragging.disable();
    refMap.touchZoom.disable();
    ovlMap.touchZoom.disable();
    refMap.doubleClickZoom.disable();
    ovlMap.doubleClickZoom.disable();
    refMap.scrollWheelZoom.disable();
    ovlMap.scrollWheelZoom.disable();
    refMap.boxZoom.disable();
    ovlMap.boxZoom.disable();
    refMap.keyboard.disable();
    ovlMap.keyboard.disable();
}

function enableMapsAfterLabelDrag() {
    if (!refMap || !ovlMap || !mapsDisabledForLabelDrag) return;
    mapsDisabledForLabelDrag = false;
    if (refMap.dragging && refMap.dragging.enable) refMap.dragging.enable();
    if (ovlMap.dragging && ovlMap.dragging.enable) ovlMap.dragging.enable();
    if (refMap.touchZoom && refMap.touchZoom.enable) refMap.touchZoom.enable();
    if (ovlMap.touchZoom && ovlMap.touchZoom.enable) ovlMap.touchZoom.enable();
    if (refMap.doubleClickZoom && refMap.doubleClickZoom.enable) refMap.doubleClickZoom.enable();
    if (ovlMap.doubleClickZoom && ovlMap.doubleClickZoom.enable) ovlMap.doubleClickZoom.enable();
    if (refMap.scrollWheelZoom && refMap.scrollWheelZoom.enable) refMap.scrollWheelZoom.enable();
    if (ovlMap.scrollWheelZoom && ovlMap.scrollWheelZoom.enable) ovlMap.scrollWheelZoom.enable();
    if (refMap.boxZoom && refMap.boxZoom.enable) refMap.boxZoom.enable();
    if (ovlMap.boxZoom && ovlMap.boxZoom.enable) ovlMap.boxZoom.enable();
    if (refMap.keyboard && refMap.keyboard.enable) refMap.keyboard.enable();
    if (ovlMap.keyboard && ovlMap.keyboard.enable) ovlMap.keyboard.enable();
}

function clearAll() {
    if (refMap) { markersRef.forEach(m => refMap.removeLayer(m)); markersOvl.forEach(m => ovlMap.removeLayer(m)); }
    if (measureLabelRef) { measureLabelRef.remove(); measureLabelRef = null; }
    if (measureLabelOvl) { measureLabelOvl.remove(); measureLabelOvl = null; }
    verticesRef = []; verticesOvl = []; markersRef = []; markersOvl = [];
    refMap = null; ovlMap = null;
    document.getElementById('label1').innerText = "Map 1"; document.getElementById('label2').innerText = "Map 2";
    update();
    scheduleUrlUpdate();
}

// Service Worker Registration for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('Service Worker registered successfully:', registration);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    });
}

// Prompt to install PWA
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // You can show an install button here if desired
});

function startLabelDrag(e, labelType, labelMarker) {
    if (!refMap || !ovlMap || verticesRef.length === 0) return;

    const originalEvent = e && e.originalEvent ? e.originalEvent : e;
    if (originalEvent && originalEvent.preventDefault) originalEvent.preventDefault();
    if (originalEvent && originalEvent.stopPropagation) originalEvent.stopPropagation();
    
    isMovingAllPoints = true;
    activeMoveLabel = labelType;
    draggedLabel = labelMarker;
    
    // Store both reference and overlay points positions
    originalVerticesRef = verticesRef.map(v => ({ latlng: L.latLng(v.latlng.lat, v.latlng.lng) }));
    originalVerticesOvl = verticesOvl.map(v => ({ latlng: L.latLng(v.latlng.lat, v.latlng.lng) }));
    originalMercAnchorRef = mercAnchorRef ? L.point(mercAnchorRef.x, mercAnchorRef.y) : null;
    originalMercAnchorOvl = mercAnchorOvl ? L.point(mercAnchorOvl.x, mercAnchorOvl.y) : null;
    
    // Get the starting point from mouse position
    const map = labelType === 'ref' ? refMap : ovlMap;
    moveStartPoint = getLatLngFromDomEvent(map, originalEvent);

    // Prevent Leaflet from starting a pan on touch immediately
    lockMapInteractions();
    
    // Add visual feedback to labels
    if (measureLabelRef) {
        measureLabelRef._icon.classList.add('move-mode');
    }
    if (measureLabelOvl) {
        measureLabelOvl._icon.classList.add('move-mode');
    }
    
    // Add global mouse event listeners
    document.addEventListener('mousemove', handleLabelDrag);
    document.addEventListener('mouseup', handleLabelDragEnd);
    document.addEventListener('touchmove', handleLabelDrag, { passive: false });
    document.addEventListener('touchend', handleLabelDragEnd);
    document.addEventListener('touchcancel', handleLabelDragEnd);
    document.addEventListener('pointermove', handleLabelDrag, { passive: false });
    document.addEventListener('pointerup', handleLabelDragEnd);
    document.addEventListener('pointercancel', handleLabelDragEnd);
    
    }

function handleLabelDrag(e) {
    if (!isMovingAllPoints || !moveStartPoint || !draggedLabel) return;
    
    // Prevent any map-related events
    e.preventDefault();
    e.stopPropagation();
    
    // Track that movement happened
    if (!hasStartedDragging) hasStartedDragging = true;
    
    const map = activeMoveLabel === 'ref' ? refMap : ovlMap;
    const currentPoint = getLatLngFromDomEvent(map, e);
    const deltaX = currentPoint.lng - moveStartPoint.lng;
    const deltaY = currentPoint.lat - moveStartPoint.lat;

    const startM = toMerc(moveStartPoint);
    const currM = toMerc(currentPoint);
    const dMx = currM.x - startM.x;
    const dMy = currM.y - startM.y;
    
    // Move the appropriate points based on which panel is being dragged
    if (activeMoveLabel === 'ref') {
        // Move reference points only
        verticesRef.forEach((vertex, i) => {
            const original = originalVerticesRef[i];
            vertex.latlng = L.latLng(original.latlng.lat + deltaY, original.latlng.lng + deltaX);
        });

        // Update reference marker positions
        markersRef.forEach((marker, i) => {
            marker.setLatLng(verticesRef[i].latlng);
        });

        // Keep overlay fixed, but update the reference anchor so future point-drags don't desync
        if (originalMercAnchorRef && mercAnchorRef) {
            mercAnchorRef = L.point(originalMercAnchorRef.x + dMx, originalMercAnchorRef.y + dMy);
        }
    } else {
        // Move overlay points only
        verticesOvl.forEach((vertex, i) => {
            const original = originalVerticesOvl[i];
            vertex.latlng = L.latLng(original.latlng.lat + deltaY, original.latlng.lng + deltaX);
        });

        // Update overlay marker positions
        markersOvl.forEach((marker, i) => {
            marker.setLatLng(verticesOvl[i].latlng);
        });

        // Update overlay anchor so future reference-point drags keep overlay in sync with its new position
        if (originalMercAnchorOvl && mercAnchorOvl) {
            mercAnchorOvl = L.point(originalMercAnchorOvl.x + dMx, originalMercAnchorOvl.y + dMy);
        }
    }
    
    // Update the dragged label position using the appropriate points
    const labelPoint = activeMoveLabel === 'ref' ? 
        verticesRef.map(v => v.latlng) : verticesOvl.map(v => v.latlng);
    
    if (labelPoint.length > 0) {
        const isArea = mode === 'area';
        const newPosition = isArea ? 
            (polyCentroid(labelPoint) && pointInPolygon(polyCentroid(labelPoint), labelPoint) ? 
                polyCentroid(labelPoint) : L.polygon(labelPoint).getBounds().getCenter()) :
            lineMidpoint(labelPoint);
        
        if (newPosition) {
            draggedLabel.setLatLng(newPosition);
        }
    }
    
    update();
}

function handleLabelDragEnd(e) {
    if (!isMovingAllPoints) return;
    
    // Remove global event listeners
    document.removeEventListener('mousemove', handleLabelDrag);
    document.removeEventListener('mouseup', handleLabelDragEnd);
    document.removeEventListener('touchmove', handleLabelDrag);
    document.removeEventListener('touchend', handleLabelDragEnd);
    document.removeEventListener('touchcancel', handleLabelDragEnd);
    document.removeEventListener('pointermove', handleLabelDrag);
    document.removeEventListener('pointerup', handleLabelDragEnd);
    document.removeEventListener('pointercancel', handleLabelDragEnd);
    
    // Check if dragging actually occurred before resetting flags
    const didActuallyDrag = hasStartedDragging;
    
    // Re-enable map controls only if dragging had started
    unlockMapInteractions();
    
    // Remove visual feedback
    if (measureLabelRef) {
        measureLabelRef._icon.classList.remove('move-mode');
    }
    if (measureLabelOvl) {
        measureLabelOvl._icon.classList.remove('move-mode');
    }
    
    // Save the label type before resetting variables
    const movedType = activeMoveLabel === 'ref' ? 'Reference' : 'Overlay';
    
    isMovingAllPoints = false;
    moveStartPoint = null;
    activeMoveLabel = null;
    draggedLabel = null;
    hasStartedDragging = false;
    originalVerticesRef = [];
    originalVerticesOvl = [];
    originalMercAnchorRef = null;
    originalMercAnchorOvl = null;
    
    if (didActuallyDrag) {
        scheduleUrlUpdate();
    }
}

// Initialize app in ruler mode
setMode('dist');

// Restore from URL if present, otherwise ensure hash is initialized
(() => {
    const state = decodeAppState(location.hash);
    if (state) {
        applyDecodedState(state);
    }
    scheduleUrlUpdate();
})();

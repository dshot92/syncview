// Prevent context menu globally, only allow on points
document.addEventListener('contextmenu', function(e) {
    if (!e.target.classList.contains('handle') && !e.target.classList.contains('ghost-handle')) {
        e.preventDefault();
        return false;
    }
});

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
        encodedPts = masterVertices.map(v => [round(v.latlng.lat, 6), round(v.latlng.lng, 6)]);
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

            masterVertices = [];
            verticesRef = [];
            verticesOvl = [];
            markersRef = [];
            markersOvl = [];

            pts.forEach((p) => {
                const llArr = safeLatLngLike(p);
                if (!llArr) return;
                const ll = L.latLng(llArr[0], llArr[1]);
                masterVertices.push({ latlng: ll });

                const ghostLL = ll;

                const mR = L.marker(ll, { icon: L.divIcon({ className: 'handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(refMap);
                const mO = L.marker(ghostLL, { icon: L.divIcon({ className: 'ghost-handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(ovlMap);

                bindHandleInteractionLock(mR);
                bindHandleInteractionLock(mO);

                mR.on('contextmenu', (e) => showCtx(e, mR));
                mR.on('click', L.DomEvent.stopPropagation);

                mR.on('drag', (de) => {
                    const i = markersRef.indexOf(mR);
                    setMasterFromRefLatLng(i, de.target.getLatLng());
                    update();
                    scheduleUrlUpdate();
                });

                mO.on('drag', (de) => {
                    const i = markersOvl.indexOf(mO);
                    setMasterFromOvlLatLng(i, de.target.getLatLng());
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
            const url = new URL(location.href);

            // Cache busting removed

            // Write state into query param (crawler-visible)
            url.searchParams.set('s', encoded);

            // Clear hash to avoid ambiguous old-style state URLs
            url.hash = '';

            const next = url.toString();
            if (location.href !== next) history.replaceState(null, '', next);
        } catch (_) {
        }
    }, 150);
}

function getEncodedStateFromUrl() {
    try {
        const url = new URL(location.href);
        const fromQuery = url.searchParams.get('s');
        if (fromQuery) return fromQuery;
    } catch (_) {
    }

    const rawHash = String(location.hash || '').replace(/^#/, '');
    return rawHash || null;
}

function migrateHashStateToQuery() {
    const rawHash = String(location.hash || '').replace(/^#/, '');
    if (!rawHash) return;

    try {
        const url = new URL(location.href);
        if (!url.searchParams.has('s')) url.searchParams.set('s', rawHash);
        url.hash = '';
        history.replaceState(null, '', url.toString());
    } catch (_) {
    }
}

function applyStateFromUrl() {
    if (isApplyingUrlState) return;
    const encoded = getEncodedStateFromUrl();
    if (!encoded) return;
    const state = decodeAppState(encoded);
    if (state) applyDecodedState(state);
}

window.addEventListener('popstate', () => {
    applyStateFromUrl();
});

function getSharableLink() {
    const encoded = encodeAppState();

    const url = new URL(location.href);

    // Cache busting removed

    // Put state into query param (crawler-visible)
    url.searchParams.set('s', encoded);

    // Ensure we don't also include legacy state hash
    url.hash = '';

    return url.toString();
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
    closeShareMenu(); // Close overlay immediately
}

function openShareMenu() {
    const overlay = document.getElementById('share-overlay');
    if (!overlay) return;

    const link = getSharableLink();
    setShareMenuUrl(link);

    overlay.style.display = 'grid';
    document.body.classList.add('share-overlay-open');
    
    // Add visible class in next frame for transition
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
        const input = document.getElementById('share-link');
        if (input) input.focus({ preventScroll: true });
    });
}

function closeShareMenu() {
    const overlay = document.getElementById('share-overlay');
    if (!overlay) return;
    
    // Remove visible class to trigger transition
    overlay.classList.remove('visible');
    document.body.classList.remove('share-overlay-open');
    
    // Hide overlay after transition completes
    setTimeout(() => {
        if (!overlay.classList.contains('visible')) {
            overlay.style.display = 'none';
        }
    }, 300); // Match transition duration
}

async function copyShareLink() {
    const link = getSharableLink();
    setShareMenuUrl(link);

    const input = document.getElementById('share-link');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(link);
            flashShareCopied();
            closeShareMenu(); // Close overlay immediately
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
                closeShareMenu(); // Close overlay immediately
                return;
            }
        } catch (_) {
        }
    }

    // Select and copy the link
}

function openInfoMenu() {
    const overlay = document.getElementById('info-overlay');
    if (!overlay) return;

    overlay.style.display = 'grid';
    
    // Add visible class in next frame for transition
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
    });
}

function closeInfoMenu() {
    const overlay = document.getElementById('info-overlay');
    if (!overlay) return;
    
    // Remove visible class to trigger transition
    overlay.classList.remove('visible');
    
    // Hide overlay after transition completes
    setTimeout(() => {
        if (!overlay.classList.contains('visible')) {
            overlay.style.display = 'none';
        }
    }, 300); // Match transition duration
}

function undoLastPoint() {
    hideCtx();
    if (!refMap || !ovlMap) return;
    if (!verticesRef || verticesRef.length === 0) return;

    const i = verticesRef.length - 1;

    if (markersRef[i]) refMap.removeLayer(markersRef[i]);
    if (markersOvl[i]) ovlMap.removeLayer(markersOvl[i]);

    verticesRef.pop();
    verticesOvl.pop();
    markersRef.pop();
    markersOvl.pop();
    if (masterVertices && masterVertices.length > 0) masterVertices.pop();

    if (verticesRef.length === 0) {
        if (measureLabelRef) { measureLabelRef.remove(); measureLabelRef = null; }
        if (measureLabelOvl) { measureLabelOvl.remove(); measureLabelOvl = null; }
        refMap = null;
        ovlMap = null;
        document.getElementById('label1').innerText = "Map 1";
        document.getElementById('label2').innerText = "Map 2";
    }

    update();
    scheduleUrlUpdate();
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        const t = e.target;
        const isTypingTarget = t && (
            t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable
        );
        if (!isTypingTarget) {
            e.preventDefault();
            undoLastPoint();
        }
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        const t = e.target;
        const isTypingTarget = t && (
            t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable
        );
        if (!isTypingTarget) {
            e.preventDefault();
            showAabb = !showAabb;
            update();
        }
        return;
    }
    if (e.key !== 'Escape') return;
    const shareOverlay = document.getElementById('share-overlay');
    const infoOverlay = document.getElementById('info-overlay');
    if (shareOverlay && shareOverlay.style.display !== 'none') closeShareMenu();
    if (infoOverlay && infoOverlay.style.display !== 'none') closeInfoMenu();
});

document.addEventListener('click', (e) => {
    const shareOverlay = document.getElementById('share-overlay');
    const infoOverlay = document.getElementById('info-overlay');
    
    // Handle share overlay clicks
    if (shareOverlay && shareOverlay.style.display !== 'none') {
        const shareCard = document.getElementById('share-card');
        if (shareCard && shareCard.contains(e.target)) return;
        if (e.target === shareOverlay) closeShareMenu();
    }
    
    // Handle info overlay clicks
    if (infoOverlay && infoOverlay.style.display !== 'none') {
        const infoCard = document.getElementById('info-card');
        if (infoCard && infoCard.contains(e.target)) return;
        if (e.target === infoOverlay) closeInfoMenu();
    }
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

map1.on('move', update);
map2.on('move', update);
map1.on('zoom', update);
map2.on('zoom', update);

const recalcAabbAndGizmosOnInteraction = (e) => {
    if (!masterVertices || masterVertices.length === 0) return;
    if (isRotating || isMovingWithGizmo) return;

    const oe = e && e.originalEvent ? e.originalEvent : null;
    const t = oe && oe.target ? oe.target : null;
    if (t && t.closest) {
        if (t.closest('.handle, .ghost-handle, .gizmo, .measurement-label')) return;
    }

    update();
};

map1.on('mousedown', recalcAabbAndGizmosOnInteraction);
map1.on('mouseup', recalcAabbAndGizmosOnInteraction);
map1.on('touchstart', recalcAabbAndGizmosOnInteraction);
map1.on('touchend', recalcAabbAndGizmosOnInteraction);
map2.on('mousedown', recalcAabbAndGizmosOnInteraction);
map2.on('mouseup', recalcAabbAndGizmosOnInteraction);
map2.on('touchstart', recalcAabbAndGizmosOnInteraction);
map2.on('touchend', recalcAabbAndGizmosOnInteraction);

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
    sRefBg: L.polyline([], { color: 'var(--text-black)', weight: 4, opacity: 0.8 }),
    sRef: L.polyline([], { color: 'var(--accent-blue)', weight: 2 }),
    sOvlBg: L.polyline([], { color: 'var(--text-black)', weight: 4, opacity: 0.8 }),
    sOvl: L.polyline([], { color: 'var(--accent-yellow)', weight: 2 }),
    aRefBg: L.polygon([], { color: 'var(--text-black)', weight: 4, opacity: 0.8, fill: false }),
    aRef: L.polygon([], { color: 'var(--accent-blue)', weight: 2, fillOpacity: 0.2 }),
    aOvlBg: L.polygon([], { color: 'var(--text-black)', weight: 4, opacity: 0.8, fill: false }),
    aOvl: L.polygon([], { color: 'var(--accent-yellow)', weight: 2, fillOpacity: 0.3 }),
    bbRef: L.rectangle([[0, 0], [0, 0]], { color: 'rgba(59, 130, 246, 0.95)', weight: 1, fill: false, dashArray: '6 4' }),
    bbOvl: L.rectangle([[0, 0], [0, 0]], { color: 'rgba(251, 191, 36, 0.95)', weight: 1, fill: false, dashArray: '6 4' })
};

let mode = 'dist';
let masterVertices = [];
let verticesRef = [], verticesOvl = [], markersRef = [], markersOvl = [];
let refMap = null, ovlMap = null, mercAnchorRef = null, mercAnchorOvl = null;
let measureLabelRef = null;
let measureLabelOvl = null;

let showAabb = false;
let rotateGizmoRef = null;
let rotateGizmoOvl = null;
let moveGizmoRef = null;
let moveGizmoOvl = null;

const shapeTransforms = {
    ref: { rotation: 0, offsetMerc: L.point(0, 0), pivotMerc: null },
    ovl: { rotation: 0, offsetMerc: L.point(0, 0), pivotMerc: null }
};

let isRotating = false;
let rotateActive = null;
let rotateCenterMerc = null;
let rotateStartAngle = 0;
let rotateOriginalMerc = [];
let rotateStartRotation = 0;

let isMovingWithGizmo = false;
let moveActive = null;
let moveStartLatLng = null;
let moveOriginalLatLngs = [];
let moveStartOffsetMerc = null;

let suppressMapClickUntil = 0;

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

function getMasterMerc() {
    return masterVertices.map(v => toMerc(v.latlng));
}

function setMasterFromRefLatLng(index, newLatLng) {
    const baseMerc = getMasterMerc();
    const pMerc = toMerc(newLatLng);
    const mMerc = invertTransformMerc(pMerc, baseMerc, shapeTransforms.ref);
    masterVertices[index] = { latlng: fromMerc(mMerc) };
}

function setMasterFromOvlLatLng(index, newLatLng) {
    const baseMerc = getMasterMerc();
    const baseOvlMerc = baseMerc.map((p) => L.point(mercAnchorOvl.x + (p.x - mercAnchorRef.x), mercAnchorOvl.y + (p.y - mercAnchorRef.y)));
    const pMerc = toMerc(newLatLng);
    const inv = invertTransformMerc(pMerc, baseOvlMerc, shapeTransforms.ovl);
    const mMerc = L.point(mercAnchorRef.x + (inv.x - mercAnchorOvl.x), mercAnchorRef.y + (inv.y - mercAnchorOvl.y));
    masterVertices[index] = { latlng: fromMerc(mMerc) };
}

function getAabb(lls) {
    let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
    lls.forEach((p) => {
        if (!p) return;
        south = Math.min(south, p.lat);
        north = Math.max(north, p.lat);
        west = Math.min(west, p.lng);
        east = Math.max(east, p.lng);
    });
    if (!isFinite(south) || !isFinite(west) || !isFinite(north) || !isFinite(east)) return null;
    return { south, west, north, east };
}

function ensureGizmoMarkers() {
    const rotateGlyph = `
        <span class="gizmo-glyph" aria-hidden="true">
            <img src="images/rotate.svg" width="24" height="24" alt="">
        </span>
    `.trim();
    const moveGlyph = `
        <span class="gizmo-glyph" aria-hidden="true">
            <img src="images/move.svg" width="24" height="24" alt="">
        </span>
    `.trim();

    if (!rotateGizmoRef) {
        rotateGizmoRef = L.marker([0, 0], {
            draggable: true,
            keyboard: false,
            icon: L.divIcon({ className: 'gizmo gizmo-rotate gizmo-ref', html: rotateGlyph, iconSize: [28, 28], iconAnchor: [14, 14] })
        });
        bindHandleInteractionLock(rotateGizmoRef);
        rotateGizmoRef.on('contextmenu', (e) => showGizmoCtx(e, 'ref'));
        rotateGizmoRef.on('dragstart', (e) => startRotateGizmo(e, 'ref'));
        rotateGizmoRef.on('drag', handleRotateGizmo);
        rotateGizmoRef.on('dragend', endRotateGizmo);
    }
    if (!rotateGizmoOvl) {
        rotateGizmoOvl = L.marker([0, 0], {
            draggable: true,
            keyboard: false,
            icon: L.divIcon({ className: 'gizmo gizmo-rotate gizmo-ovl', html: rotateGlyph, iconSize: [28, 28], iconAnchor: [14, 14] })
        });
        bindHandleInteractionLock(rotateGizmoOvl);
        rotateGizmoOvl.on('contextmenu', (e) => showGizmoCtx(e, 'ovl'));
        rotateGizmoOvl.on('dragstart', (e) => startRotateGizmo(e, 'ovl'));
        rotateGizmoOvl.on('drag', handleRotateGizmo);
        rotateGizmoOvl.on('dragend', endRotateGizmo);
    }
    if (!moveGizmoRef) {
        moveGizmoRef = L.marker([0, 0], {
            draggable: true,
            keyboard: false,
            icon: L.divIcon({ className: 'gizmo gizmo-move gizmo-ref', html: moveGlyph, iconSize: [28, 28], iconAnchor: [14, 14] })
        });
        bindHandleInteractionLock(moveGizmoRef);
        moveGizmoRef.on('contextmenu', (e) => showGizmoCtx(e, 'ref'));
        moveGizmoRef.on('dragstart', (e) => startMoveGizmo(e, 'ref'));
        moveGizmoRef.on('drag', handleMoveGizmo);
        moveGizmoRef.on('dragend', endMoveGizmo);
    }
    if (!moveGizmoOvl) {
        moveGizmoOvl = L.marker([0, 0], {
            draggable: true,
            keyboard: false,
            icon: L.divIcon({ className: 'gizmo gizmo-move gizmo-ovl', html: moveGlyph, iconSize: [28, 28], iconAnchor: [14, 14] })
        });
        bindHandleInteractionLock(moveGizmoOvl);
        moveGizmoOvl.on('contextmenu', (e) => showGizmoCtx(e, 'ovl'));
        moveGizmoOvl.on('dragstart', (e) => startMoveGizmo(e, 'ovl'));
        moveGizmoOvl.on('drag', handleMoveGizmo);
        moveGizmoOvl.on('dragend', endMoveGizmo);
    }
}

function centroidMerc(lls) {
    let x = 0, y = 0;
    let n = 0;
    lls.forEach((ll) => {
        if (!ll) return;
        const p = toMerc(ll);
        x += p.x;
        y += p.y;
        n += 1;
    });
    if (n === 0) return null;
    return L.point(x / n, y / n);
}

function centroidMercFromMerc(pts) {
    let x = 0, y = 0;
    let n = 0;
    pts.forEach((p) => {
        if (!p) return;
        x += p.x;
        y += p.y;
        n += 1;
    });
    if (n === 0) return null;
    return L.point(x / n, y / n);
}

function applyTransformMerc(ptsMerc, tf) {
    const c = centroidMercFromMerc(ptsMerc);
    if (!c) return [];
    const pivot = (tf && tf.pivotMerc) ? tf.pivotMerc : c;
    const a = Number(tf && tf.rotation) || 0;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const off = (tf && tf.offsetMerc) ? tf.offsetMerc : L.point(0, 0);
    return ptsMerc.map((p) => {
        const dx = p.x - pivot.x;
        const dy = p.y - pivot.y;
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        return L.point(pivot.x + rx + off.x, pivot.y + ry + off.y);
    });
}

function invertTransformMerc(pMerc, basePtsMerc, tf) {
    const c = centroidMercFromMerc(basePtsMerc);
    if (!c) return pMerc;
    const pivot = (tf && tf.pivotMerc) ? tf.pivotMerc : c;
    const a = -(Number(tf && tf.rotation) || 0);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const off = (tf && tf.offsetMerc) ? tf.offsetMerc : L.point(0, 0);

    const x = pMerc.x - off.x - pivot.x;
    const y = pMerc.y - off.y - pivot.y;
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return L.point(pivot.x + rx, pivot.y + ry);
}

function isMarkerBeingDragged(marker) {
    if (!marker) return false;
    const d = marker.dragging;
    const dr = d && d._draggable;
    return !!(dr && dr._moving);
}

function startRotateGizmo(e, which) {
    if (!refMap || !ovlMap) return;
    if (verticesRef.length === 0) return;

    suppressMapClickUntil = Date.now() + 400;

    isRotating = true;
    rotateActive = which;

    const tf = which === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
    rotateStartRotation = Number(tf.rotation) || 0;

    const baseMercMaster = getMasterMerc();
    const baseMerc = which === 'ref'
        ? baseMercMaster
        : baseMercMaster.map((p) => L.point(mercAnchorOvl.x + (p.x - mercAnchorRef.x), mercAnchorOvl.y + (p.y - mercAnchorRef.y)));

    if (!tf.pivotMerc) tf.pivotMerc = centroidMercFromMerc(baseMerc);
    rotateCenterMerc = tf.pivotMerc;
    rotateOriginalMerc = baseMerc;

    const startM = toMerc(e.target.getLatLng());
    rotateStartAngle = Math.atan2(startM.y - rotateCenterMerc.y, startM.x - rotateCenterMerc.x);
}

function handleRotateGizmo(e) {
    if (!isRotating || !rotateActive || !rotateCenterMerc || rotateOriginalMerc.length === 0) return;

    const currM = toMerc(e.target.getLatLng());
    const currAngle = Math.atan2(currM.y - rotateCenterMerc.y, currM.x - rotateCenterMerc.x);
    const dA = currAngle - rotateStartAngle;
    const cos = Math.cos(dA);
    const sin = Math.sin(dA);

    const tf = rotateActive === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
    tf.rotation = rotateStartRotation + dA;

    update();
    scheduleUrlUpdate();
}

function endRotateGizmo() {
    isRotating = false;
    rotateActive = null;
    rotateCenterMerc = null;
    rotateStartAngle = 0;
    rotateOriginalMerc = [];
    rotateStartRotation = 0;

    suppressMapClickUntil = Date.now() + 400;
}

function startMoveGizmo(e, which) {
    if (!refMap || !ovlMap) return;
    if (verticesRef.length === 0) return;

    suppressMapClickUntil = Date.now() + 400;

    isMovingWithGizmo = true;
    moveActive = which;
    moveStartLatLng = e.target.getLatLng();
    const tf = which === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
    moveStartOffsetMerc = tf.offsetMerc ? L.point(tf.offsetMerc.x, tf.offsetMerc.y) : L.point(0, 0);
    moveOriginalLatLngs = [];
}

function handleMoveGizmo(e) {
    if (!isMovingWithGizmo || !moveActive || !moveStartLatLng || !moveStartOffsetMerc) return;
    const curr = e.target.getLatLng();
    const s = toMerc(moveStartLatLng);
    const c = toMerc(curr);
    const dX = c.x - s.x;
    const dY = c.y - s.y;

    const tf = moveActive === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
    tf.offsetMerc = L.point(moveStartOffsetMerc.x + dX, moveStartOffsetMerc.y + dY);

    update();
    scheduleUrlUpdate();
}

function endMoveGizmo() {
    isMovingWithGizmo = false;
    moveActive = null;
    moveStartLatLng = null;
    moveOriginalLatLngs = [];
    moveStartOffsetMerc = null;

    suppressMapClickUntil = Date.now() + 400;
}

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
let ctxGizmoWhich = null;
const ctxMenu = document.getElementById('ctx-menu');

function setCtxMenuMode(mode) {
    const del = document.getElementById('ctx-del-point');
    const rr = document.getElementById('ctx-reset-rotation');
    const rm = document.getElementById('ctx-reset-move');
    const ra = document.getElementById('ctx-reset-all');
    if (del) del.style.display = mode === 'point' ? '' : 'none';
    if (rr) rr.style.display = mode === 'gizmo' ? '' : 'none';
    if (rm) rm.style.display = mode === 'gizmo' ? '' : 'none';
    if (ra) ra.style.display = mode === 'gizmo' ? '' : 'none';
}

function showCtx(e, m) {
    L.DomEvent.stopPropagation(e);
    ctxMarker = m;
    ctxGizmoWhich = null;
    setCtxMenuMode('point');
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = e.originalEvent.clientX + 'px';
    ctxMenu.style.top = e.originalEvent.clientY + 'px';
}

function showGizmoCtx(e, which) {
    L.DomEvent.stopPropagation(e);
    ctxMarker = null;
    ctxGizmoWhich = which === 'ovl' ? 'ovl' : 'ref';
    setCtxMenuMode('gizmo');
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = e.originalEvent.clientX + 'px';
    ctxMenu.style.top = e.originalEvent.clientY + 'px';
}

function delPoint() {
    if (!ctxMarker || !refMap) return;
    const i = markersRef.indexOf(ctxMarker);
    if (i > -1) {
        verticesRef.splice(i, 1); verticesOvl.splice(i, 1);
        masterVertices.splice(i, 1);
        refMap.removeLayer(markersRef[i]); ovlMap.removeLayer(markersOvl[i]);
        markersRef.splice(i, 1); markersOvl.splice(i, 1);
        update();
        scheduleUrlUpdate();
    }
    hideCtx();
}

function hideCtx() { ctxMenu.style.display = 'none'; ctxMarker = null; }

function ctxResetRotation() {
    if (!ctxGizmoWhich) return;
    const tf = ctxGizmoWhich === 'ovl' ? shapeTransforms.ovl : shapeTransforms.ref;
    tf.rotation = 0;
    tf.pivotMerc = null;
    update();
    scheduleUrlUpdate();
    hideCtx();
}

function ctxResetMove() {
    if (!ctxGizmoWhich) return;
    const tf = ctxGizmoWhich === 'ovl' ? shapeTransforms.ovl : shapeTransforms.ref;
    tf.offsetMerc = L.point(0, 0);
    update();
    scheduleUrlUpdate();
    hideCtx();
}

function ctxResetAll() {
    if (!ctxGizmoWhich) return;
    const tf = ctxGizmoWhich === 'ovl' ? shapeTransforms.ovl : shapeTransforms.ref;
    tf.rotation = 0;
    tf.offsetMerc = L.point(0, 0);
    tf.pivotMerc = null;
    update();
    scheduleUrlUpdate();
    hideCtx();
}

function update() {
    const hasPoints = masterVertices.length > 0;

    if (hasPoints && refMap && ovlMap && mercAnchorRef && mercAnchorOvl) {
        const baseMerc = getMasterMerc();
        const refMerc = applyTransformMerc(baseMerc, shapeTransforms.ref);
        const ovlBaseMerc = baseMerc.map((p) => L.point(mercAnchorOvl.x + (p.x - mercAnchorRef.x), mercAnchorOvl.y + (p.y - mercAnchorRef.y)));
        const ovlMerc = applyTransformMerc(ovlBaseMerc, shapeTransforms.ovl);

        verticesRef = refMerc.map(p => ({ latlng: fromMerc(p) }));
        verticesOvl = ovlMerc.map(p => ({ latlng: fromMerc(p) }));
    }

    const pRef = verticesRef.map(v => v.latlng);
    const pOvl = verticesOvl.map(v => v.latlng);

    // Show/hide clear button based on drawing state
    const clearBtn1 = document.getElementById('clearBtn1');
    const clearBtn2 = document.getElementById('clearBtn2');
    const backBtn1 = document.getElementById('backBtn1');
    const backBtn2 = document.getElementById('backBtn2');
    
    // Hide both clear buttons first
    clearBtn1.classList.remove('visible');
    clearBtn2.classList.remove('visible');
    if (backBtn1) backBtn1.classList.remove('visible');
    if (backBtn2) backBtn2.classList.remove('visible');
    
    // Only show clear button on the reference map when drawing
    if (hasPoints && refMap) {
        if (refMap === map1) {
            clearBtn1.classList.add('visible');
            if (backBtn1) backBtn1.classList.add('visible');
        } else if (refMap === map2) {
            clearBtn2.classList.add('visible');
            if (backBtn2) backBtn2.classList.add('visible');
        }
    }

    Object.values(shapes).forEach(s => { if (s._map) s.remove(); });

    if (measureLabelRef) { measureLabelRef.remove(); measureLabelRef = null; }
    if (measureLabelOvl) { measureLabelOvl.remove(); measureLabelOvl = null; }

    if (!hasPoints || !refMap || !ovlMap) {
        if (rotateGizmoRef && rotateGizmoRef._map) rotateGizmoRef.remove();
        if (rotateGizmoOvl && rotateGizmoOvl._map) rotateGizmoOvl.remove();
        if (moveGizmoRef && moveGizmoRef._map) moveGizmoRef.remove();
        if (moveGizmoOvl && moveGizmoOvl._map) moveGizmoOvl.remove();
    }

    if (hasPoints && refMap && ovlMap) {
        const isArea = mode === 'area';
        const polyRef = pRef;
        const polyOvl = pOvl;
        if (isArea) {
            shapes.aRefBg.addTo(refMap).setLatLngs(polyRef);
            shapes.aRef.addTo(refMap).setLatLngs(polyRef);
            shapes.aOvlBg.addTo(ovlMap).setLatLngs(polyOvl);
            shapes.aOvl.addTo(ovlMap).setLatLngs(polyOvl);
        } else {
            shapes.sRefBg.addTo(refMap).setLatLngs(polyRef);
            shapes.sRef.addTo(refMap).setLatLngs(polyRef);
            shapes.sOvlBg.addTo(ovlMap).setLatLngs(polyOvl);
            shapes.sOvl.addTo(ovlMap).setLatLngs(polyOvl);
        }

        markersRef.forEach((m, i) => { if (pRef[i]) m.setLatLng(pRef[i]); });
        markersOvl.forEach((m, i) => { if (pOvl[i]) m.setLatLng(pOvl[i]); });

        const isComplete = pRef.length >= (isArea ? 3 : 2);
        if (!isComplete) return;

        ensureGizmoMarkers();

        const bbR = getAabb(polyRef);
        const bbO = getAabb(polyOvl);

        if (showAabb) {
            if (bbR) shapes.bbRef.addTo(refMap).setBounds([[bbR.south, bbR.west], [bbR.north, bbR.east]]);
            if (bbO) shapes.bbOvl.addTo(ovlMap).setBounds([[bbO.south, bbO.west], [bbO.north, bbO.east]]);
        }

        if (bbR) {
            const topMidLL = L.latLng(bbR.north, (bbR.west + bbR.east) / 2);
            const brLL = L.latLng(bbR.south, bbR.east);

            const topMidPt = refMap.latLngToContainerPoint(topMidLL);
            const brPt = refMap.latLngToContainerPoint(brLL);

            const containerSize = refMap.getSize();
            const gizmoRadius = 14;
            
            const rotatePt = L.point(topMidPt.x, topMidPt.y - 28);
            const movePt = L.point(brPt.x + 28, brPt.y + 28);

            // On mobile, constrain gizmos to stay above the navbar area (bottom view only)
            const isMobile = window.innerWidth <= 767;
            const constrainToNav = isMobile && refMap === map2;
            let maxY = containerSize.y - gizmoRadius;
            
            if (constrainToNav) {
                // Calculate actual navbar height dynamically
                const dashboard = document.querySelector('#dashboard');
                const navbarHeight = dashboard ? dashboard.offsetHeight : 56;
                const gizmoSize = 28; // full gizmo diameter
                const pointSize = 14; // point diameter
                const margin = 8;
                maxY = containerSize.y - navbarHeight - gizmoSize - pointSize - margin;
            }

            const clampedRotatePt = L.point(
                Math.max(gizmoRadius, Math.min(containerSize.x - gizmoRadius, rotatePt.x)),
                Math.max(gizmoRadius, Math.min(maxY, rotatePt.y))
            );
            const clampedMovePt = L.point(
                Math.max(gizmoRadius, Math.min(containerSize.x - gizmoRadius, movePt.x)),
                Math.max(gizmoRadius, Math.min(maxY, movePt.y))
            );

            const topMid = refMap.containerPointToLatLng(clampedRotatePt);
            const brOut = refMap.containerPointToLatLng(clampedMovePt);

            rotateGizmoRef.setLatLng(topMid);
            moveGizmoRef.setLatLng(brOut);
            if (!rotateGizmoRef._map) rotateGizmoRef.addTo(refMap);
            if (!moveGizmoRef._map) moveGizmoRef.addTo(refMap);
        }
        if (bbO) {
            const topMidLL = L.latLng(bbO.north, (bbO.west + bbO.east) / 2);
            const brLL = L.latLng(bbO.south, bbO.east);

            const topMidPt = ovlMap.latLngToContainerPoint(topMidLL);
            const brPt = ovlMap.latLngToContainerPoint(brLL);

            const containerSize = ovlMap.getSize();
            const gizmoRadius = 14;
            
            const rotatePt = L.point(topMidPt.x, topMidPt.y - 28);
            const movePt = L.point(brPt.x + 28, brPt.y + 28);

            // On mobile, constrain gizmos to stay above the navbar area (bottom view only)
            const isMobile = window.innerWidth <= 767;
            const constrainToNav = isMobile && ovlMap === map2;
            let maxY = containerSize.y - gizmoRadius;
            
            if (constrainToNav) {
                // Calculate actual navbar height dynamically
                const dashboard = document.querySelector('#dashboard');
                const navbarHeight = dashboard ? dashboard.offsetHeight : 56;
                const gizmoSize = 28; // full gizmo diameter
                const pointSize = 14; // point diameter
                const margin = 8;
                maxY = containerSize.y - navbarHeight - gizmoSize - pointSize - margin;
            }

            const clampedRotatePt = L.point(
                Math.max(gizmoRadius, Math.min(containerSize.x - gizmoRadius, rotatePt.x)),
                Math.max(gizmoRadius, Math.min(maxY, rotatePt.y))
            );
            const clampedMovePt = L.point(
                Math.max(gizmoRadius, Math.min(containerSize.x - gizmoRadius, movePt.x)),
                Math.max(gizmoRadius, Math.min(maxY, movePt.y))
            );

            const topMid = ovlMap.containerPointToLatLng(clampedRotatePt);
            const brOut = ovlMap.containerPointToLatLng(clampedMovePt);

            rotateGizmoOvl.setLatLng(topMid);
            moveGizmoOvl.setLatLng(brOut);
            if (!rotateGizmoOvl._map) rotateGizmoOvl.addTo(ovlMap);
            if (!moveGizmoOvl._map) moveGizmoOvl.addTo(ovlMap);
        }

        if (isComplete) {
            const vRef = isArea ? getArea(polyRef) : getDist(polyRef);
            const vOvl = isArea ? getArea(polyOvl) : getDist(polyOvl);

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
                    <div class="measurement-label-inner" style="background-color:${color}; border-color:rgba(0, 0, 0, 0.3);">
                        <div class="measurement-label-primary" style="color:#000000">${valueText}</div>
                        ${color === 'var(--accent-yellow)' ? `<div class="measurement-label-secondary" style="color:#000000">${pctText}</div>` : ''}
                    </div>
                </div>`,
                iconSize: null
            });

            const pctRef = fmtPct(-pctDeltaVsRef);
            const pctOvl = fmtPct(pctDeltaVsRef);

            measureLabelRef = L.marker(labelPoint(polyRef, isArea), {
                interactive: true,
                keyboard: false,
                icon: makeMeasureLabel(fmt(vRef, mode), pctRef, 'var(--accent-blue)', true)
            }).addTo(refMap);

            measureLabelOvl = L.marker(labelPoint(polyOvl, isArea), {
                interactive: true,
                keyboard: false,
                icon: makeMeasureLabel(fmt(vOvl, mode), pctOvl, 'var(--accent-yellow)', false)
            }).addTo(ovlMap);

            // Prevent clicks on measurement labels from creating new points
            const preventLabelClick = (marker) => {
                const labelElement = marker.getElement();
                if (labelElement) {
                    labelElement.addEventListener('click', (e) => {
                        e.stopPropagation();
                    });
                    labelElement.addEventListener('touchstart', (e) => {
                        e.stopPropagation();
                    }, { passive: true });
                }
            };
            
            preventLabelClick(measureLabelRef);
            preventLabelClick(measureLabelOvl);
        }
    }
}

function getArea(ll) {
    if (!Array.isArray(ll) || ll.length < 3) return 0;

    // If Turf is available, compute the area of the shaded (filled) regions even
    // when the polygon is self-intersecting.
    try {
        if (typeof turf !== 'undefined' && turf && typeof turf.polygon === 'function') {
            const ring = ll
                .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
                .map(p => [p.lng, p.lat]);
            if (ring.length < 3) return 0;

            // Close ring
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

            const poly = turf.polygon([ring]);
            if (typeof turf.unkinkPolygon === 'function') {
                const unk = turf.unkinkPolygon(poly);
                if (unk && unk.features && unk.features.length) {
                    let sum = 0;
                    for (const f of unk.features) sum += turf.area(f);
                    return Math.abs(sum);
                }
            }

            // Fallback to turf.area (works for simple polygons; for self-intersection
            // behavior is implementation-defined)
            return Math.abs(turf.area(poly));
        }
    } catch (_) {
        // fall through to spherical formula
    }

    // Fallback: spherical excess approximation (assumes non-self-intersecting)
    let a = 0;
    const R = 6378137;
    for (let i = 0; i < ll.length; i++) {
        const p1 = ll[i], p2 = ll[(i + 1) % ll.length];
        a += (p2.lng - p1.lng) * (Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(a * R * R / 2);
}
function getDist(ll) { let d = 0; for (let i = 0; i < ll.length - 1; i++) d += ll[i].distanceTo(ll[i + 1]); return d; }
function fmt(v, t) { 
    const comma = (num) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const nbsp = '\u00A0'; // Non-breaking space
    if (t === 'area') return v >= 1e6 ? comma((v / 1e6).toFixed(2)) + nbsp + 'km²' : comma(v.toFixed(0)) + nbsp + 'm²'; 
    return v >= 1000 ? comma((v / 1000).toFixed(2)) + nbsp + 'km' : comma(v.toFixed(0)) + nbsp + 'm'; 
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
    if (Date.now() < suppressMapClickUntil) return;
    hideCtx();

    if (!refMap) {
        refMap = src; ovlMap = src === map1 ? map2 : map1;
        mercAnchorRef = toMerc(refMap.getCenter()); mercAnchorOvl = toMerc(ovlMap.getCenter());
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
    const ghostLL = e.latlng;

    let masterLL = e.latlng;
    if (masterVertices.length > 0 && mercAnchorRef && mercAnchorOvl) {
        const baseMerc = getMasterMerc();
        const pMerc = toMerc(e.latlng);
        const mMerc = invertTransformMerc(pMerc, baseMerc, shapeTransforms.ref);
        masterLL = fromMerc(mMerc);
    }

    const mR = L.marker(e.latlng, { icon: L.divIcon({ className: 'handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(refMap);
    const mO = L.marker(ghostLL, { icon: L.divIcon({ className: 'ghost-handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(ovlMap);

    bindHandleInteractionLock(mR);
    bindHandleInteractionLock(mO);

    mR.on('contextmenu', (e) => showCtx(e, mR));
    mR.on('click', L.DomEvent.stopPropagation);

    mR.on('drag', (de) => {
        const i = markersRef.indexOf(mR);
        setMasterFromRefLatLng(i, de.target.getLatLng());
        update();
        scheduleUrlUpdate();
    });

    mO.on('drag', (de) => {
        const i = markersOvl.indexOf(mO);
        setMasterFromOvlLatLng(i, de.target.getLatLng());
        update();
        scheduleUrlUpdate();
    });

    masterVertices.push({ latlng: masterLL });
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
    const ghostLL = latlng;

    let masterLL = latlng;
    if (masterVertices.length > 0 && mercAnchorRef && mercAnchorOvl) {
        const baseMerc = getMasterMerc();
        const pMerc = toMerc(latlng);
        const mMerc = invertTransformMerc(pMerc, baseMerc, shapeTransforms.ref);
        masterLL = fromMerc(mMerc);
    }

    const mR = L.marker(latlng, { icon: L.divIcon({ className: 'handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(refMap);
    const mO = L.marker(ghostLL, { icon: L.divIcon({ className: 'ghost-handle', iconSize: [14, 14], iconAnchor: [7, 7] }), draggable: true }).addTo(ovlMap);

    bindHandleInteractionLock(mR);
    bindHandleInteractionLock(mO);

    mR.on('contextmenu', (e) => showCtx(e, mR));
    mR.on('click', L.DomEvent.stopPropagation);

    mR.on('drag', (de) => {
        const i = markersRef.indexOf(mR);
        setMasterFromRefLatLng(i, de.target.getLatLng());
        update();
        scheduleUrlUpdate();
    });

    mO.on('drag', (de) => {
        const i = markersOvl.indexOf(mO);
        setMasterFromOvlLatLng(i, de.target.getLatLng());
        update();
        scheduleUrlUpdate();
    });

    // Insert at the specified index
    masterVertices.splice(index, 0, { latlng: masterLL });
    verticesRef.splice(index, 0, { latlng: latlng });
    verticesOvl.splice(index, 0, { latlng: ghostLL });
    markersRef.splice(index, 0, mR);
    markersOvl.splice(index, 0, mO);
    
    update();
    scheduleUrlUpdate();
}

map1.on('click', (e) => handleMapClick(e, map1));
map2.on('click', (e) => handleMapClick(e, map2));

// Prevent clicks and touches on dashboard from creating points on maps
const dashboard = document.getElementById('dashboard');
if (dashboard) {
    // Prevent mouse clicks from propagating to maps
    dashboard.addEventListener('click', (e) => {
        // Only stop propagation if the click is not on interactive elements that need it
        if (!e.target.closest('button, .option, input')) {
            e.stopPropagation();
        }
    });
    
    // For touch events, use a more targeted approach
    dashboard.addEventListener('touchstart', (e) => {
        // Only stop propagation for non-interactive touches
        if (!e.target.closest('button, .option, input')) {
            e.stopPropagation();
        }
    }, { passive: true });
}

function getLatLngFromDomEvent(map, ev) {
    if (!map || !ev) return null;
    const src = (ev.touches && ev.touches[0]) ? ev.touches[0]
        : (ev.changedTouches && ev.changedTouches[0]) ? ev.changedTouches[0]
        : ev;
    const containerPoint = map.mouseEventToContainerPoint(src);
    return map.containerPointToLatLng(containerPoint);
}

function bindMeasurementLabelDrag(marker, labelType) {
    return;
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
    masterVertices = [];
    verticesRef = []; verticesOvl = []; markersRef = []; markersOvl = [];
    shapeTransforms.ref.rotation = 0;
    shapeTransforms.ref.offsetMerc = L.point(0, 0);
    shapeTransforms.ref.pivotMerc = null;
    shapeTransforms.ovl.rotation = 0;
    shapeTransforms.ovl.offsetMerc = L.point(0, 0);
    shapeTransforms.ovl.pivotMerc = null;
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
    
    // Get initial position for movement detection
    const startX = originalEvent && (originalEvent.touches && originalEvent.touches[0] ? originalEvent.touches[0].clientX : originalEvent.clientX);
    const startY = originalEvent && (originalEvent.touches && originalEvent.touches[0] ? originalEvent.touches[0].clientY : originalEvent.clientY);
    
    let moved = false;
    let prevented = false;
    
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
    
    const up = (ue) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', up);
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        
        if (moved || prevented) {
            unlockMapInteractions();
        }
    };
    
    // Add temporary listeners to detect movement
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    
    // Only start actual drag if movement detected within threshold
    const stop = (me) => {
        if (!prevented && me && me.preventDefault) me.preventDefault();
        if (!prevented && me && me.stopPropagation) me.stopPropagation();
        
        if (moved && !isMovingAllPoints) {
            // Actual drag start - only after movement threshold
            isMovingAllPoints = true;
            activeMoveLabel = labelType;
            draggedLabel = labelMarker;
            hasStartedDragging = true;
            
            // Store both reference and overlay points positions
            originalVerticesRef = verticesRef.map(v => ({ latlng: L.latLng(v.latlng.lat, v.latlng.lng) }));
            originalVerticesOvl = verticesOvl.map(v => ({ latlng: L.latLng(v.latlng.lat, v.latlng.lng) }));
            originalMercAnchorRef = mercAnchorRef ? L.point(mercAnchorRef.x, mercAnchorRef.y) : null;
            originalMercAnchorOvl = mercAnchorOvl ? L.point(mercAnchorOvl.x, mercAnchorOvl.y) : null;
            
            // Get the starting point from mouse position
            const map = labelType === 'ref' ? refMap : ovlMap;
            moveStartPoint = getLatLngFromDomEvent(map, originalEvent);
            
            // Add visual feedback to labels
            if (measureLabelRef) {
                measureLabelRef._icon.classList.add('move-mode');
            }
            if (measureLabelOvl) {
                measureLabelOvl._icon.classList.add('move-mode');
            }
            
            // Replace temporary listeners with actual drag handlers
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', up);
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            
            document.addEventListener('mousemove', handleLabelDrag);
            document.addEventListener('mouseup', handleLabelDragEnd);
            document.addEventListener('touchmove', handleLabelDrag, { passive: false });
            document.addEventListener('touchend', handleLabelDragEnd);
            document.addEventListener('touchcancel', handleLabelDragEnd);
            document.addEventListener('pointermove', handleLabelDrag, { passive: false });
            document.addEventListener('pointerup', handleLabelDragEnd);
            document.addEventListener('pointercancel', handleLabelDragEnd);
        }
    };
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

// Restore from URL if present
(() => {
    migrateHashStateToQuery();
    applyStateFromUrl();
    scheduleUrlUpdate();
})();

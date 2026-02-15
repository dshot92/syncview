// Prevent context menu globally, only allow on points
document.addEventListener('contextmenu', function(e) {
    if (!e.target.classList.contains('handle') && !e.target.classList.contains('ghost-handle')) {
        e.preventDefault();
        return false;
    }
});

// Tile Definitions
const tiles = {
    satellite: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    streets: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    dark: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', // Same as streets, CSS will darken
};

// Constants
const CONSTANTS = {
    ZOOM_MIN: 0,
    ZOOM_MAX: 22,
    DEFAULT_ZOOM: 12,
    TOLERANCE_PX: 15,
    // LABEL_OFFSET_PX: 40,
    // LABEL_LARGE_OFFSET_PX: 100,
    GIZMO_RADIUS_PX: 10,
    GIZMO_OFFSET_PX: 32,
    MAX_NATIVE_ZOOM: 18,
    MAX_ZOOM: 20,
    URL_UPDATE_DELAY: 150,
    GRID_TARGET_LINES: 6,
    MARKER_SIZE: 14,
    MARKER_ANCHOR: 7,
    LAT_MIN: -85.05112878,
    LAT_MAX: 85.05112878,
    LNG_MIN: -180,
    LNG_MAX: 180
};

// Default tile layer options - optimized for Google Maps sharpness
const TILE_LAYER_DEFAULTS = {
    fadeAnimation: false,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 0,
    maxNativeZoom: 22, // Higher for sharper tiles
    maxZoom: 22,
    tileSize: 256,
    detectRetina: false // Disable retina to prevent upscaling blur
};

const HYBRID_LAYER_DEFAULTS = {
    opacity: 0.9,
    fadeAnimation: false,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 0,
    maxNativeZoom: CONSTANTS.MAX_NATIVE_ZOOM,
    maxZoom: CONSTANTS.MAX_ZOOM
};

// Create base tile layer for a map
function createBaseTileLayer(mapType) {
    const layer = L.tileLayer(tiles[mapType], TILE_LAYER_DEFAULTS);
    layer.on('tileerror', handleTileError);
    return layer;
}

// Apply tile layers to both maps
function applyTileLayersToMaps(mapType) {
    // Remove existing layers
    [map1, map2].forEach(map => {
        [l1, l2, h1, h2].forEach(layer => {
            if (layer && map.hasLayer(layer)) map.removeLayer(layer);
        });
    });

    // Toggle dark mode class on map containers
    const isDark = mapType === 'dark';
    document.getElementById('map1').classList.toggle('map-dark', isDark);
    document.getElementById('map2').classList.toggle('map-dark', isDark);

    // Create and add new layers (use 'streets' for dark mode since we apply CSS filters)
    const actualMapType = mapType === 'dark' ? 'streets' : mapType;
    l1 = createBaseTileLayer(actualMapType).addTo(map1);
    l2 = createBaseTileLayer(actualMapType).addTo(map2);
    h1 = h2 = null;

    // Force redraw
    setTimeout(() => {
        map1.invalidateSize({ reset: true, animate: false });
        map2.invalidateSize({ reset: true, animate: false });
    }, 100);
}

// Marker factory - creates handle markers with consistent styling and event binding
function createHandleMarker(latlng, isGhost = false, map, index = null) {
    const className = isGhost ? 'ghost-handle' : 'handle';
    const showNumber = showVertexNumbers && index !== null && !isGhost;
    const html = showNumber ? `<span class="vertex-number">${index + 1}</span>` : '';
    
    const marker = L.marker(latlng, {
        icon: L.divIcon({
            className,
            html,
            iconSize: [CONSTANTS.MARKER_SIZE, CONSTANTS.MARKER_SIZE],
            iconAnchor: [CONSTANTS.MARKER_ANCHOR, CONSTANTS.MARKER_ANCHOR]
        }),
        draggable: true
    });

    if (map) marker.addTo(map);

    bindHandleInteractionLock(marker);

    // Only add context menu to reference markers
    if (!isGhost) {
        marker.on('contextmenu', (e) => showCtx(e, marker));
        marker.on('click', L.DomEvent.stopPropagation);
    }

    return marker;
}

// Update all marker icons to show/hide vertex numbers
function updateMarkerIcons() {
    markersRef.forEach((marker, i) => {
        if (marker) {
            const showNumber = showVertexNumbers;
            const html = showNumber ? `<span class="vertex-number">${i + 1}</span>` : '';
            marker.setIcon(L.divIcon({
                className: 'handle',
                html,
                iconSize: [CONSTANTS.MARKER_SIZE, CONSTANTS.MARKER_SIZE],
                iconAnchor: [CONSTANTS.MARKER_ANCHOR, CONSTANTS.MARKER_ANCHOR]
            }));
        }
    });
}

// Create a pair of markers (ref and ovl) for a point
function createMarkerPair(latlng, refMap, ovlMap, index = null) {
    const mR = createHandleMarker(latlng, false, refMap, index);
    const mO = createHandleMarker(latlng, true, ovlMap, index);

    // Bind drag handlers for both markers
    bindDragHandlers(mR, markersRef, setMasterFromRefLatLng);
    bindDragHandlers(mO, markersOvl, setMasterFromOvlLatLng);

    return { ref: mR, ovl: mO };
}

// Unified drag handler binding
function bindDragHandlers(marker, markerArray, updateFn) {
    marker.on('dragstart', () => { 
        isAnyMarkerDragging = true; 
        document.querySelectorAll('.measurement-label').forEach(el => el.classList.add('no-transition'));
    });
    marker.on('drag', (de) => {
        const i = markerArray.indexOf(marker);
        if (i > -1) {
            updateFn(i, de.target.getLatLng());
            update();
            scheduleUrlUpdate();
        }
    });
    marker.on('dragend', () => { 
        isAnyMarkerDragging = false; 
        document.querySelectorAll('.measurement-label').forEach(el => el.classList.remove('no-transition'));
    });
}

const map1 = L.map('map1', { zoomSnap: 1, attributionControl: false, zoomControl: false }).setView([40.7128, -74.0060], CONSTANTS.DEFAULT_ZOOM);
const map2 = L.map('map2', { zoomSnap: 1, attributionControl: false, zoomControl: false }).setView([51.5074, -0.1278], CONSTANTS.DEFAULT_ZOOM);

// Helper to bind events to both maps
const bindToBoth = (event, handler) => [map1, map2].forEach(m => m.on(event, handler));

function formatLat(lat) {
    const a = Math.abs(lat);
    const hemi = lat >= 0 ? 'N' : 'S';
    return `${a.toFixed(a >= 10 ? 1 : 2)}°${hemi}`;
}

function formatLng(lng) {
    let x = ((lng + 180) % 360 + 360) % 360 - 180;
    const a = Math.abs(x);
    const hemi = x >= 0 ? 'E' : 'W';
    return `${a.toFixed(a >= 10 ? 1 : 2)}°${hemi}`;
}

function pickGridStepDegrees(bounds) {
    const w = bounds.getWest();
    const e = bounds.getEast();
    const s = bounds.getSouth();
    const n = bounds.getNorth();

    const lngSpan = Math.max(0.000001, Math.abs(e - w));
    const latSpan = Math.max(0.000001, Math.abs(n - s));
    const span = Math.max(lngSpan, latSpan);

    const candidates = [
        90, 45, 30, 20, 10, 5, 2, 1,
        0.5, 0.2, 0.1, 0.05, 0.02, 0.01
    ];
    const targetLines = 6;
    const approx = span / targetLines;

    for (let i = 0; i < candidates.length; i++) {
        if (candidates[i] <= approx) return candidates[i];
    }
    return candidates[candidates.length - 1];
}

function createLatLngGrid(map) {
    const layer = L.layerGroup([], { interactive: false });
    layer.addTo(map);

    let raf = null;
    let idleTimer = null;
    const updateGrid = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            raf = null;
            if (!map) return;
            const b = map.getBounds();
            const step = pickGridStepDegrees(b);
            const west = b.getWest();
            const east = b.getEast();
            const south = b.getSouth();
            const north = b.getNorth();

            const startLat = Math.floor(south / step) * step;
            const startLng = Math.floor(west / step) * step;

            layer.clearLayers();

            const labeledLats = new Set();
            for (let lng = startLng; lng <= east; lng += step) {
                const ll1 = L.latLng(south, lng);
                const ll2 = L.latLng(north, lng);
                L.polyline([ll1, ll2], { interactive: false, weight: 1, opacity: 1, className: 'grid-line' }).addTo(layer);
            }
        });
    };

    const fadeOut = () => {
        clearTimeout(idleTimer);
        layer.eachLayer((l) => {
            if (l.getElement && l.getElement()) {
                l.getElement().classList.add('fade');
            }
        });
    };
    const fadeIn = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            layer.eachLayer((l) => {
                if (l.getElement && l.getElement()) {
                    l.getElement().classList.remove('fade');
                }
            });
        }, 200);
    };

    map.on('movestart zoomstart', fadeOut);
    map.on('moveend zoomend resize', () => {
        updateGrid();
        fadeIn();
    });
    updateGrid();
    return { layer, updateGrid };
}

const grid1 = createLatLngGrid(map1);
const grid2 = createLatLngGrid(map2);

let currentMapType = 'hybrid'; // Track current map type

// Unified base64 URL-safe encoding/decoding
function b64UrlEncode(data) {
    let bin = '';
    for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64UrlDecode(b64u) {
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
    return [clamp(ll.lat, CONSTANTS.LAT_MIN, CONSTANTS.LAT_MAX), clamp(ll.lng, CONSTANTS.LNG_MIN, CONSTANTS.LNG_MAX)];
}

function safeLatLngLike(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return null;
    const lat = Number(arr[0]);
    const lng = Number(arr[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [clamp(lat, CONSTANTS.LAT_MIN, CONSTANTS.LAT_MAX), clamp(lng, CONSTANTS.LNG_MIN, CONSTANTS.LNG_MAX)];
}

function encodeMapType(mapType) {
    if (mapType === 'streets') return 1;
    if (mapType === 'satellite') return 2;
    if (mapType === 'dark') return 3;
    return 0;
}

function decodeMapType(code) {
    if (code === 1) return 'streets';
    if (code === 2) return 'satellite';
    if (code === 3) return 'dark';
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

    return b64UrlEncode(new Uint8Array(buf));
}

function decodeAppState(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw) return null;
    try {
        const bytes = b64UrlDecode(raw);
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
let modeChanged = false;

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
            applyTileLayersToMaps(mapType);
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

            pts.forEach((p, index) => {
                const llArr = safeLatLngLike(p);
                if (!llArr) return;
                const refLatLng = L.latLng(llArr[0], llArr[1]);
                masterVertices.push({ latlng: refLatLng });

                // Create reference marker at the stored geo location
                const mR = createHandleMarker(refLatLng, false, refMap, index);
                
                // Convert reference lat/lng to view position, then to overlay lat/lng
                const containerPoint = refMap.latLngToContainerPoint(refLatLng);
                const ovlLatLng = ovlMap.containerPointToLatLng(containerPoint);
                
                // Create overlay marker at the corresponding view position
                const mO = createHandleMarker(ovlLatLng, true, ovlMap, index);
                
                // Bind drag handlers
                bindDragHandlers(mR, markersRef, setMasterFromRefLatLng);
                bindDragHandlers(mO, markersOvl, setMasterFromOvlLatLng);

                verticesRef.push({ latlng: refLatLng });
                verticesOvl.push({ latlng: ovlLatLng });
                markersRef.push(mR);
                markersOvl.push(mO);
            });

            update();
            updateMarkerIcons();
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

    return null;
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

// Settings menu functions
function openSettingsMenu() {
    const overlay = document.getElementById('settings-overlay');
    if (!overlay) return;
    
    updateSettingsValues();
    
    overlay.style.display = 'grid';
    document.body.classList.add('settings-overlay-open');
    
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
    });
}

function closeSettingsMenu() {
    const overlay = document.getElementById('settings-overlay');
    if (!overlay) return;
    
    overlay.classList.remove('visible');
    document.body.classList.remove('settings-overlay-open');
    
    setTimeout(() => {
        if (!overlay.classList.contains('visible')) {
            overlay.style.display = 'none';
        }
    }, 300);
}

// Info menu functions (like share)
function openInfoMenu() {
    const overlay = document.getElementById('info-overlay');
    if (!overlay) return;
    
    overlay.style.display = 'grid';
    document.body.classList.add('info-overlay-open');
    
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
    });
}

function closeInfoMenu() {
    const overlay = document.getElementById('info-overlay');
    if (!overlay) return;
    
    overlay.classList.remove('visible');
    document.body.classList.remove('info-overlay-open');
    
    setTimeout(() => {
        if (!overlay.classList.contains('visible')) {
            overlay.style.display = 'none';
        }
    }, 300);
}

function updateSettingsValues() {
    const unitValue = document.getElementById('settings-unit-value');
    const vertexValue = document.getElementById('settings-vertex-value');
    const bboxValue = document.getElementById('settings-bbox-value');
    
    if (unitValue) unitValue.textContent = getUnitSystemName(currentUnitSystem);
    if (vertexValue) vertexValue.textContent = showVertexNumbers ? 'On' : 'Off';
    if (bboxValue) bboxValue.textContent = showAabb ? 'On' : 'Off';
}

function toggleBoundingBox() {
    showAabb = !showAabb;
    update();
    showToast(showAabb ? 'Bounding box on' : 'Bounding box off');
    updateSettingsValues();
}

async function shareToInstagram() {
    try {
        // Copy the link to clipboard
        const link = getSharableLink();
        
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(link);
        } else {
            const input = document.getElementById('share-link');
            input.value = link;
            input.select();
            document.execCommand('copy');
        }
        
        closeShareMenu();
        
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        if (isMobile) {
            window.location.href = 'instagram://';
            setTimeout(() => {
                window.open('https://instagram.com', '_blank');
            }, 1000);
            showToast('Link copied! Open Instagram and paste in DMs');
        } else {
            window.open('https://instagram.com', '_blank');
            showToast('Link copied! Paste in Instagram DMs');
        }
    } catch (err) {
        console.error('Instagram share failed:', err);
        showToast('Could not share to Instagram');
    }
}

function shareTo(platform) {
    const link = getSharableLink();
    const urls = {
        telegram: 'https://t.me/share/url?url=' + encodeURIComponent(link),
        twitter: 'https://twitter.com/intent/tweet?text=SyncView&url=' + encodeURIComponent(link),
        facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(link),
        whatsapp: 'https://wa.me/?text=' + encodeURIComponent('SyncView: ' + link)
    };
    const url = urls[platform];
    if (!url) return;
    
    closeShareMenu();
    
    // Use same window for mobile to allow native apps to open
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
        window.location.href = url;
    } else {
        window.open(url, '_blank');
    }
}

async function copyShareLink() {
    const link = getSharableLink();
    setShareMenuUrl(link);

    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(link);
            flashShareCopied();
            closeShareMenu();
            return;
        } catch (_) {
            // Fall through to textarea method
        }
    }

    // Fallback: use temporary textarea (works reliably across browsers)
    const textarea = document.createElement('textarea');
    textarea.value = link;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    
    try {
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, link.length);
        
        const ok = document.execCommand('copy');
        if (ok) {
            flashShareCopied();
            closeShareMenu();
        } else {
            console.error('Copy failed');
        }
    } catch (err) {
        console.error('Copy error:', err);
    } finally {
        document.body.removeChild(textarea);
    }
}

// Legacy info gizmo functions removed - now using overlay pattern like share menu

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
        removeGizmos();
        refMap = null;
        ovlMap = null;
        document.getElementById('label1').innerText = "Map 1";
        document.getElementById('label2').innerText = "Map 2";
    }

    update();
    scheduleUrlUpdate();
}

document.addEventListener('keydown', (e) => {
    const isTypingTarget = e.target && (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
    );

    if (isTypingTarget) return;

    // Ctrl+Z / Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undoLastPoint();
        return;
    }

    // B for bounding box toggle
    if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        showAabb = !showAabb;
        update();
        return;
    }

    // L for Line mode
    if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setMode('dist');
        showToast('Line mode');
        return;
    }

    // A for Area mode
    if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setMode('area');
        showToast('Area mode');
        return;
    }

    // U for Unit toggle
    if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        toggleUnits();
        return;
    }

    // V for Vertex numbers toggle
    if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        toggleVertexNumbers();
        return;
    }

    // Delete key to remove last point
    if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        if (masterVertices.length > 0) {
            undoLastPoint();
            showToast('Point removed');
        }
        return;
    }

    // Escape to close overlays and menus
    if (e.key === 'Escape') {
        const shareOverlay = document.getElementById('share-overlay');
        const settingsOverlay = document.getElementById('settings-overlay');
        const infoOverlay = document.getElementById('info-overlay');
        const ctxMenu = document.getElementById('ctx-menu');
        const layerOptions = document.getElementById('layerOptions');
        const suggestions = document.querySelectorAll('.suggestions.visible');

        let closedSomething = false;

        if (shareOverlay && shareOverlay.style.display !== 'none') {
            closeShareMenu();
            closedSomething = true;
        }
        if (settingsOverlay && settingsOverlay.style.display !== 'none') {
            closeSettingsMenu();
            closedSomething = true;
        }
        if (infoOverlay && infoOverlay.style.display !== 'none') {
            closeInfoMenu();
            closedSomething = true;
        }
        if (ctxMenu && ctxMenu.style.display !== 'none') {
            hideCtx();
            closedSomething = true;
        }
        if (layerOptions && layerOptions.classList.contains('open')) {
            layerOptions.classList.remove('open');
            closedSomething = true;
        }
        suggestions.forEach(s => {
            s.classList.remove('visible');
            closedSomething = true;
        });

        // If nothing was closed, clear all points as last resort
        if (!closedSomething && masterVertices.length > 0) {
            if (confirm('Clear all points?')) {
                clearAll();
            }
        }
        return;
    }
});

document.addEventListener('click', (e) => {
    const shareOverlay = document.getElementById('share-overlay');
    const settingsOverlay = document.getElementById('settings-overlay');
    const infoOverlay = document.getElementById('info-overlay');
    
    // Handle share overlay clicks
    if (shareOverlay && shareOverlay.style.display !== 'none') {
        const shareCard = document.getElementById('share-card');
        if (shareCard && shareCard.contains(e.target)) return;
        if (e.target === shareOverlay) closeShareMenu();
    }
    
    // Handle settings overlay clicks
    if (settingsOverlay && settingsOverlay.style.display !== 'none') {
        const settingsCard = document.getElementById('settings-card');
        if (settingsCard && settingsCard.contains(e.target)) return;
        if (e.target === settingsOverlay) closeSettingsMenu();
    }
    
    // Handle info overlay clicks
    if (infoOverlay && infoOverlay.style.display !== 'none') {
        const infoCard = document.getElementById('info-card');
        if (infoCard && infoCard.contains(e.target)) return;
        if (e.target === infoOverlay) closeInfoMenu();
    }
});

// Initialize tile layers
let l1 = createBaseTileLayer('hybrid');
let l2 = createBaseTileLayer('hybrid');
let h1 = null, h2 = null;
l1.addTo(map1);
l2.addTo(map2);

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
bindToBoth('zoom', syncZoom);

bindToBoth('zoom', update);

bindToBoth('moveend', scheduleUrlUpdate);
bindToBoth('zoomend', scheduleUrlUpdate);

bindToBoth('move', update);
bindToBoth('zoomend', update);

let isZoomAnimating = false;
bindToBoth('zoomstart', () => { isZoomAnimating = true; });
bindToBoth('zoom', () => { isZoomAnimating = true; });
bindToBoth('zoomend', () => { isZoomAnimating = false; update(); });

const recalcAabbAndGizmosOnInteraction = (e) => {
    if (!masterVertices || masterVertices.length === 0) return;
    if (GIZMO_STATE.rotate.active || GIZMO_STATE.move.active) return;

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

// Vertex number display option
let showVertexNumbers = localStorage.getItem('syncview-vertex-numbers') === 'true';

function toggleVertexNumbers() {
    showVertexNumbers = !showVertexNumbers;
    localStorage.setItem('syncview-vertex-numbers', showVertexNumbers);
    updateMarkerIcons();
    showToast(showVertexNumbers ? 'Vertex numbers on' : 'Vertex numbers off');
    updateSettingsValues();
}

// Debounced search with better error handling
let searchTimeout = null;
const searchCache = new Map();
let searchAttempts = 0;
const MAX_SEARCH_ATTEMPTS = 3;

// SVG icons for search toggle - using external SVG files
const ICONS = {
    search: '<img src="images/svgs/search.svg" width="18" height="18" alt="">',
    close: '<img src="images/svgs/clear.svg" width="18" height="18" alt="">'
};

function toggleSearch(idx) {
    const lens = document.getElementById('lens' + idx);
    const wrapper = lens.closest('.tool__search-wrapper');
    const input = document.getElementById('search' + idx);
    const list = document.getElementById('results' + idx);

    if (wrapper.classList.contains('expanded')) {
        input.value = '';
        wrapper.classList.remove('expanded');
        lens.classList.remove('active');
        list.classList.remove('visible');
        lens.innerHTML = ICONS.search;
    } else {
        wrapper.classList.add('expanded');
        lens.classList.add('active');
        lens.innerHTML = ICONS.close;
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

    // Rate limiting - prevent too many requests
    if (searchAttempts >= MAX_SEARCH_ATTEMPTS) {
        return;
    }

    try {
        searchAttempts++;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = await resp.json();
        const list = document.getElementById('results' + idx);

        if (data && data.length > 0) {
            searchCache.set(cacheKey, data);
            displaySuggestions(idx, data);
            searchAttempts = 0; // Reset on success
        } else {
            document.getElementById('results' + idx).classList.remove('visible');
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Search failed:', err);
        }
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
        currentMapType = val;
        options.classList.remove('open');
        applyTileLayersToMaps(val);
    };
});
window.onclick = (e) => {
    if (!e.target.closest('#layerDropdown')) {
        if (options.classList.contains('open')) {
            options.classList.remove('open');
        }
    }
    if (!e.target.closest('.tool__search-wrapper')) {
        document.querySelectorAll('.suggestions').forEach(s => s.classList.remove('visible'));
    }
    if (!e.target.closest('#ctx-menu')) hideCtx();
    if (!e.target.closest('#gizmo-ctx-menu')) hideGizmoCtx();
};

// Add touch event listener for mobile devices
window.addEventListener('touchstart', (e) => {
    if (!e.target.closest('#layerDropdown')) {
        if (options.classList.contains('open')) {
            options.classList.remove('open');
        }
    }
    if (!e.target.closest('.tool__search-wrapper')) {
        document.querySelectorAll('.suggestions').forEach(s => s.classList.remove('visible'));
    }
    if (!e.target.closest('#ctx-menu')) hideCtx();
    if (!e.target.closest('#gizmo-ctx-menu')) hideGizmoCtx();
}, { passive: true });

// Graphics & Measurement State
const shapes = {
    sRefBg: L.polyline([], { interactive: false, color: 'var(--text-black)', weight: 4, opacity: 0.8 }),
    sRef: L.polyline([], { interactive: false, color: 'var(--accent-blue)', weight: 2 }),
    sOvlBg: L.polyline([], { interactive: false, color: 'var(--text-black)', weight: 4, opacity: 0.8 }),
    sOvl: L.polyline([], { interactive: false, color: 'var(--accent-yellow)', weight: 2 }),
    aRefBg: L.polygon([], { interactive: false, color: 'var(--text-black)', weight: 4, opacity: 0.8, fill: false }),
    aRef: L.polygon([], { interactive: false, color: 'var(--accent-blue)', weight: 2, fillOpacity: 0.2 }),
    aOvlBg: L.polygon([], { interactive: false, color: 'var(--text-black)', weight: 4, opacity: 0.8, fill: false }),
    aOvl: L.polygon([], { interactive: false, color: 'var(--accent-yellow)', weight: 2, fillOpacity: 0.3 }),
    bbRef: L.rectangle([[0, 0], [0, 0]], { interactive: false, fill: false, className: 'aabb-debug' }),
    bbOvl: L.rectangle([[0, 0], [0, 0]], { interactive: false, fill: false, className: 'aabb-debug' })
};

let mode = 'dist';
let masterVertices = [];
let verticesRef = [], verticesOvl = [], markersRef = [], markersOvl = [];
let refMap = null, ovlMap = null, mercAnchorRef = null, mercAnchorOvl = null;
let measureLabelRef = null;
let measureLabelOvl = null;

// Unit system: 'metric' | 'imperial'
let currentUnitSystem = localStorage.getItem('syncview-units') || 'metric';

function toggleUnits() {
    const systems = ['metric', 'imperial' ];
    const currentIdx = systems.indexOf(currentUnitSystem);
    currentUnitSystem = systems[(currentIdx + 1) % systems.length];
    localStorage.setItem('syncview-units', currentUnitSystem);
    updateUnitLabel();
    update();
    showToast(`Units: ${getUnitSystemName(currentUnitSystem)}`);
    updateSettingsValues();
}

function getUnitSystemName(system) {
    const names = { metric: 'Metric', imperial: 'Imperial', };
    return names[system] || 'Metric';
}

function updateUnitLabel() {
    const label = document.getElementById('unitLabel');
    if (label) {
        const labels = { metric: 'm', imperial: 'ft' };
        label.textContent = labels[currentUnitSystem];
    }
}

function fmt(v, t) {
    const comma = (num) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const nbsp = '\u00A0';

    if (currentUnitSystem === 'metric') {
        if (t === 'area') return v >= 1e6 ? comma((v / 1e6).toFixed(2)) + nbsp + 'km²' : comma(v.toFixed(0)) + nbsp + 'm²';
        return v >= 1000 ? comma((v / 1000).toFixed(2)) + nbsp + 'km' : comma(v.toFixed(0)) + nbsp + 'm';
    } else if (currentUnitSystem === 'imperial') {
        if (t === 'area') {
            // v is in m², convert to yd² (1 m² = 1.19599 yd²), then to mi² (1 mi² = 3,097,600 yd²)
            const yd2 = v * 1.19599;
            const mi2 = yd2 / 3097600;
            return mi2 >= 1 ? comma(mi2.toFixed(2)) + nbsp + 'mi²' : comma(yd2.toFixed(0)) + nbsp + 'yd²';
        }
        // v is in meters, convert to yards, then to miles
        const yd = v * 1.09361;
        const mi = yd / 1760;
        return mi >= 1 ? comma(mi.toFixed(2)) + nbsp + 'mi' : comma(yd.toFixed(0)) + nbsp + 'yd';
    }
    return v.toFixed(2);
}


let showAabb = false;
let suppressMapClickUntil = 0;

let mapsDisabledForLabelDrag = false;
let mapInteractionLockCount = 0;

const toMerc = (ll) => L.Projection.Mercator.project(ll);
const fromMerc = (p) => L.Projection.Mercator.unproject(p);

function getMasterMerc() {
    return masterVertices.map(v => toMerc(v.latlng));
}

function setMasterFromRefLatLng(index, newLatLng) {
    if (!refMap || !ovlMap || !verticesRef[index] || !verticesOvl[index]) return;
    
    // Convert the new reference latlng back to master coordinates
    // by inverting the reference transform
    const newRefMerc = toMerc(newLatLng);
    const baseMercMaster = getMasterMerc();
    
    // Invert the transform to get back to untransformed reference coordinates
    const invertedMerc = invertTransformMerc(newRefMerc, baseMercMaster, shapeTransforms.ref);
    const newMasterLatLng = fromMerc(invertedMerc);
    
    // Update masterVertices with the new base position
    masterVertices[index] = { latlng: newMasterLatLng };
    
    // Keep the existing transform - updateVertexPositions will apply it consistently
    // The key is that we updated masterVertices, so the shape stays consistent
}

function setMasterFromOvlLatLng(index, newLatLng) {
    if (!refMap || !ovlMap || !verticesRef[index] || !verticesOvl[index]) return;
    
    // Convert the new overlay latlng back to master coordinates
    // by inverting the overlay transform
    const newOvlMerc = toMerc(newLatLng);
    const baseMercMaster = getMasterMerc();
    
    // Get the overlay-specific base (with mercAnchor offset)
    const ovlBaseMerc = baseMercMaster.map((p) => 
        L.point(mercAnchorOvl.x + (p.x - mercAnchorRef.x), mercAnchorOvl.y + (p.y - mercAnchorRef.y))
    );
    
    // Invert the transform to get back to untransformed overlay coordinates
    const invertedOvlMerc = invertTransformMerc(newOvlMerc, ovlBaseMerc, shapeTransforms.ovl);
    
    // Now convert back to reference merc (remove the mercAnchor offset)
    const invertedRefMerc = L.point(
        mercAnchorRef.x + (invertedOvlMerc.x - mercAnchorOvl.x),
        mercAnchorRef.y + (invertedOvlMerc.y - mercAnchorOvl.y)
    );
    const newMasterLatLng = fromMerc(invertedRefMerc);
    
    // Update masterVertices with the base position
    masterVertices[index] = { latlng: newMasterLatLng };
    
    // Keep the existing overlay transform - updateVertexPositions will apply it consistently
    // The key is that we updated masterVertices, so the shape stays consistent
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


// Generic DOM element drag utility
function makeDraggable(element, handle, options = {}) {
    if (!element || !handle) return null;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    const onStart = options.onStart || (() => {});
    const onMove = options.onMove || (() => {});
    const onEnd = options.onEnd || (() => {});
    const skipSelector = options.skipSelector || null;

    function startDrag(e) {
        if (skipSelector && e.target.closest(skipSelector)) return;

        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startX = clientX;
        startY = clientY;

        const rect = element.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', stopDrag);

        onStart(e);
        e.preventDefault();
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - startX;
        const dy = clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // Boundary constraints - keep panel within viewport, accounting for UI elements
        const rect = element.getBoundingClientRect();
        const isMobile = window.innerWidth <= 767;
        const minVisible = 50;
        
        // Account for dashboard on mobile
        let bottomPadding = minVisible;
        if (isMobile) {
            const dashboard = document.querySelector('#dashboard');
            const navbarHeight = dashboard ? dashboard.offsetHeight : 56;
            bottomPadding = navbarHeight + 16; // Dashboard + margin
        }
        
        // Account for left-side tool buttons
        const leftPadding = 60; // Space for tool buttons
        const topPadding = minVisible;
        
        const maxLeft = window.innerWidth - minVisible;
        const maxTop = window.innerHeight - bottomPadding;
        const minLeft = leftPadding - rect.width;
        const minTop = topPadding - rect.height;

        newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
        newTop = Math.max(minTop, Math.min(maxTop, newTop));

        // Check if new position would overlap with shape points or labels (for info gizmo)
        if (element.id === 'info-gizmo') {
            const pointBuffer = 40;
            const markerPositions = [];
            if (refMap && verticesRef.length > 0) {
                verticesRef.forEach(v => {
                    const pt = refMap.latLngToContainerPoint(v.latlng);
                    markerPositions.push({ x: pt.x, y: pt.y });
                });
            }
            if (ovlMap && verticesOvl.length > 0) {
                verticesOvl.forEach(v => {
                    const pt = ovlMap.latLngToContainerPoint(v.latlng);
                    markerPositions.push({ x: pt.x, y: pt.y });
                });
            }
            
            // Also check measurement labels
            const labelPositions = [];
            if (measureLabelRef && refMap) {
                const labelPt = refMap.latLngToContainerPoint(measureLabelRef.getLatLng());
                labelPositions.push({ x: labelPt.x, y: labelPt.y });
            }
            if (measureLabelOvl && ovlMap) {
                const labelPt = ovlMap.latLngToContainerPoint(measureLabelOvl.getLatLng());
                labelPositions.push({ x: labelPt.x, y: labelPt.y });
            }
            
            const wouldOverlapPoints = markerPositions.some(pt => 
                pt.x >= newLeft - pointBuffer && 
                pt.x <= newLeft + rect.width + pointBuffer &&
                pt.y >= newTop - pointBuffer && 
                pt.y <= newTop + rect.height + pointBuffer
            );
            
            const wouldOverlapLabels = labelPositions.some(pt => 
                pt.x >= newLeft - pointBuffer && 
                pt.x <= newLeft + rect.width + pointBuffer &&
                pt.y >= newTop - pointBuffer && 
                pt.y <= newTop + rect.height + pointBuffer
            );
            
            // If would overlap, prevent the drag movement
            if ((wouldOverlapPoints || wouldOverlapLabels) && markerPositions.length > 0) {
                // Revert to position before this drag update
                newLeft = parseFloat(element.style.left) || initialLeft;
                newTop = parseFloat(element.style.top) || initialTop;
            }
        }

        element.style.left = newLeft + 'px';
        element.style.top = newTop + 'px';
        element.style.right = 'auto';

        onMove(newLeft, newTop, dx, dy);
    }

    function stopDrag(e) {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', drag);
        document.removeEventListener('touchend', stopDrag);
        onEnd(e);
    }

    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, { passive: false });

    return { startDrag, drag, stopDrag, isDragging: () => isDragging };
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

// State for tracking marker dragging and label positions
let isAnyMarkerDragging = false;

// Shape transforms for rotation and move operations (in Mercator coordinates)
const shapeTransforms = {
    ref: { rotation: 0, offsetMerc: L.point(0, 0), pivotMerc: null },
    ovl: { rotation: 0, offsetMerc: L.point(0, 0), pivotMerc: null }
};

// Unified gizmo state management
const GIZMO_STATE = {
    rotate: {
        active: null,
        centerMerc: null,
        startAngle: 0,
        startRotation: 0,
        originalMerc: []
    },
    move: {
        active: null,
        startLatLng: null,
        startOffsetMerc: null
    }
};

let rotateGizmoRef = null, rotateGizmoOvl = null;
let moveGizmoRef = null, moveGizmoOvl = null;

// Glyph templates - small SVG icons centered inside colored circles
const GIZMO_ICON_SIZE = 14; // Small icon inside the gizmo
const GIZMO_GLYPHS = {
    rotate: `<span class="gizmo-glyph" aria-hidden="true" style="display:grid;place-items:center;width:100%;height:100%;"><img src="images/svgs/rotate.svg" width="${GIZMO_ICON_SIZE}" height="${GIZMO_ICON_SIZE}" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`,
    move: `<span class="gizmo-glyph" aria-hidden="true" style="display:grid;place-items:center;width:100%;height:100%;"><img src="images/svgs/move.svg" width="${GIZMO_ICON_SIZE}" height="${GIZMO_ICON_SIZE}" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></span>`
};

function createGizmoIcon(type, color) {
    const isRotate = type === 'rotate';
    const svgFile = isRotate ? 'rotate.svg' : 'move.svg';
    const html = `<img src="images/svgs/${svgFile}" width="24" height="24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));${color ? `color:${color}` : ''}">`;
    
    return L.divIcon({
        className: `gizmo ${type}-gizmo`,
        html: html,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

// Lock/unlock map interactions during marker/gizmo dragging
function bindHandleInteractionLock(marker) {
    marker.on('dragstart', () => {
        mapInteractionLockCount++;
        if (refMap) refMap.dragging.disable();
        if (ovlMap) ovlMap.dragging.disable();
    });
    marker.on('dragend', () => {
        mapInteractionLockCount = Math.max(0, mapInteractionLockCount - 1);
        if (mapInteractionLockCount === 0) {
            if (refMap) refMap.dragging.enable();
            if (ovlMap) ovlMap.dragging.enable();
        }
    });
}

function ensureGizmoMarkers() {
    if (!rotateGizmoRef) {
        rotateGizmoRef = createGizmoMarker('rotate', 'ref', GIZMO_GLYPHS.rotate, {
            dragstart: (e) => startGizmoAction(e, 'rotate', 'ref'),
            drag: (e) => handleGizmoAction(e, 'rotate'),
            dragend: () => endGizmoAction('rotate')
        });
    }
    if (!rotateGizmoOvl) {
        rotateGizmoOvl = createGizmoMarker('rotate', 'ovl', GIZMO_GLYPHS.rotate, {
            dragstart: (e) => startGizmoAction(e, 'rotate', 'ovl'),
            drag: (e) => handleGizmoAction(e, 'rotate'),
            dragend: () => endGizmoAction('rotate')
        });
    }
    if (!moveGizmoRef) {
        moveGizmoRef = createGizmoMarker('move', 'ref', GIZMO_GLYPHS.move, {
            dragstart: (e) => startGizmoAction(e, 'move', 'ref'),
            drag: (e) => handleGizmoAction(e, 'move'),
            dragend: () => endGizmoAction('move')
        });
    }
    if (!moveGizmoOvl) {
        moveGizmoOvl = createGizmoMarker('move', 'ovl', GIZMO_GLYPHS.move, {
            dragstart: (e) => startGizmoAction(e, 'move', 'ovl'),
            drag: (e) => handleGizmoAction(e, 'move'),
            dragend: () => endGizmoAction('move')
        });
    }
}

// Factory for creating map gizmo markers
function createGizmoMarker(type, which, glyph, handlers) {
    const className = `gizmo gizmo-${type} gizmo-${which}`;
    const size = 20; // Fixed small size for gizmo markers
    const anchor = 10;
    const marker = L.marker([0, 0], {
        draggable: true,
        keyboard: false,
        icon: L.divIcon({ 
            className, 
            html: glyph, 
            iconSize: [size, size], 
            iconAnchor: [anchor, anchor]
        })
    });
    bindHandleInteractionLock(marker);
    if (handlers.dragstart) marker.on('dragstart', handlers.dragstart);
    if (handlers.drag) marker.on('drag', handlers.drag);
    if (handlers.dragend) marker.on('dragend', handlers.dragend);
    
    // Defer context menu binding until marker is added to map
    // Store which map this gizmo belongs to for the context menu
    marker._gizmoWhich = which;
    
    return marker;
}

// Bind context menu events to gizmo markers (right-click and long-press)
function bindGizmoContextMenu(marker, which) {
    const el = marker.getElement ? marker.getElement() : marker._icon;
    if (!el) return;
    
    let longPressTimer = null;
    let touchStartTime = 0;
    let touchMoved = false;
    const LONG_PRESS_DURATION = 600; // ms
    
    // Right-click handler (desktop)
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGizmoCtx(e, which);
    });
    
    // Touch handlers for long-press (mobile)
    el.addEventListener('touchstart', (e) => {
        touchStartTime = Date.now();
        touchMoved = false;
        
        // Start long-press timer
        longPressTimer = setTimeout(() => {
            if (!touchMoved && GIZMO_STATE.rotate.active !== which && GIZMO_STATE.move.active !== which) {
                // Prevent default to stop the context menu from showing
                e.preventDefault ? e.preventDefault() : null;
                showGizmoCtx(e, which);
            }
        }, LONG_PRESS_DURATION);
    }, { passive: true });
    
    el.addEventListener('touchmove', (e) => {
        touchMoved = true;
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });
    
    el.addEventListener('touchend', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });
    
    el.addEventListener('touchcancel', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: true });
}

// Position gizmos based on bounding box
function positionGizmos(bb, map, rotateGizmo, moveGizmo) {
    if (!bb) return;

    const topMidLL = L.latLng(bb.north, (bb.west + bb.east) / 2);
    const topMidPt = map.latLngToContainerPoint(topMidLL);
    const rotatePt = L.point(topMidPt.x, topMidPt.y - CONSTANTS.GIZMO_OFFSET_PX);

    // Move gizmo: to the right of the right AABB edge, at the vertical middle
    const rightMidLL = L.latLng((bb.north + bb.south) / 2, bb.east);
    const rightMidPt = map.latLngToContainerPoint(rightMidLL);
    const movePt = L.point(rightMidPt.x + CONSTANTS.GIZMO_OFFSET_PX, rightMidPt.y);

    const clampedRotatePt = clampToView(map, rotatePt, CONSTANTS.GIZMO_RADIUS_PX * 2);
    const clampedMovePt = clampToView(map, movePt, CONSTANTS.GIZMO_RADIUS_PX * 2);

    const topMid = map.containerPointToLatLng(clampedRotatePt);
    const rightOut = map.containerPointToLatLng(clampedMovePt);

    rotateGizmo.setLatLng(topMid);
    moveGizmo.setLatLng(rightOut);
    if (!rotateGizmo._map) {
        rotateGizmo.addTo(map);
        bindGizmoContextMenu(rotateGizmo, rotateGizmo._gizmoWhich);
    }
    if (!moveGizmo._map) {
        moveGizmo.addTo(map);
        bindGizmoContextMenu(moveGizmo, moveGizmo._gizmoWhich);
    }
}

function removeGizmos() {
    if (rotateGizmoRef && rotateGizmoRef._map) rotateGizmoRef.remove();
    if (rotateGizmoOvl && rotateGizmoOvl._map) rotateGizmoOvl.remove();
    if (moveGizmoRef && moveGizmoRef._map) moveGizmoRef.remove();
    if (moveGizmoOvl && moveGizmoOvl._map) moveGizmoOvl.remove();
}

// Unified gizmo action handlers
function startGizmoAction(e, type, which) {
    if (!refMap || !ovlMap || verticesRef.length === 0) return;

    suppressMapClickUntil = Date.now() + 400;

    const tf = which === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;

    if (type === 'rotate') {
        GIZMO_STATE.rotate.active = which;
        GIZMO_STATE.rotate.startRotation = Number(tf.rotation) || 0;

        const baseMercMaster = getMasterMerc();
        const baseMerc = which === 'ref'
            ? baseMercMaster
            : baseMercMaster.map((p) => L.point(mercAnchorOvl.x + (p.x - mercAnchorRef.x), mercAnchorOvl.y + (p.y - mercAnchorRef.y)));

        if (!tf.pivotMerc) tf.pivotMerc = centroidMercFromMerc(baseMerc);
        GIZMO_STATE.rotate.centerMerc = tf.pivotMerc;
        GIZMO_STATE.rotate.originalMerc = baseMerc;

        const startM = toMerc(e.target.getLatLng());
        GIZMO_STATE.rotate.startAngle = Math.atan2(startM.y - GIZMO_STATE.rotate.centerMerc.y, startM.x - GIZMO_STATE.rotate.centerMerc.x);
    } else if (type === 'move') {
        GIZMO_STATE.move.active = which;
        isAnyMarkerDragging = true;
        document.querySelectorAll('.measurement-label').forEach(el => el.classList.add('no-transition'));
        GIZMO_STATE.move.startLatLng = e.target.getLatLng();
        GIZMO_STATE.move.startOffsetMerc = tf.offsetMerc ? L.point(tf.offsetMerc.x, tf.offsetMerc.y) : L.point(0, 0);
    }
}

function handleGizmoAction(e, type) {
    if (type === 'rotate') {
        const state = GIZMO_STATE.rotate;
        if (!state.active || !state.centerMerc || state.originalMerc.length === 0) return;

        const currM = toMerc(e.target.getLatLng());
        const currAngle = Math.atan2(currM.y - state.centerMerc.y, currM.x - state.centerMerc.x);
        const dA = currAngle - state.startAngle;

        const tf = state.active === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
        tf.rotation = state.startRotation + dA;
    } else if (type === 'move') {
        const state = GIZMO_STATE.move;
        if (!state.active || !state.startLatLng || !state.startOffsetMerc) return;

        const curr = e.target.getLatLng();
        const s = toMerc(state.startLatLng);
        const c = toMerc(curr);
        const dX = c.x - s.x;
        const dY = c.y - s.y;

        const tf = state.active === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
        tf.offsetMerc = L.point(state.startOffsetMerc.x + dX, state.startOffsetMerc.y + dY);
    }

    update();
    scheduleUrlUpdate();
}

function endGizmoAction(type) {
    if (type === 'rotate') {
        GIZMO_STATE.rotate.active = null;
        GIZMO_STATE.rotate.centerMerc = null;
        GIZMO_STATE.rotate.startAngle = 0;
        GIZMO_STATE.rotate.originalMerc = [];
        GIZMO_STATE.rotate.startRotation = 0;
    } else if (type === 'move') {
        GIZMO_STATE.move.active = null;
        isAnyMarkerDragging = false;
        document.querySelectorAll('.measurement-label').forEach(el => el.classList.remove('no-transition'));
        GIZMO_STATE.move.startLatLng = null;
        GIZMO_STATE.move.startOffsetMerc = null;
    }
    suppressMapClickUntil = Date.now() + 400;
}

function bindGizmoDragHandlers(marker, type, mapType) {
    marker.on('dragstart', (e) => {
        lockMapInteractions();
        startGizmoAction(e, type, mapType);
    });
    
    marker.on('drag', (e) => {
        handleGizmoAction(e, type);
    });
    
    marker.on('dragend', (e) => {
        unlockMapInteractions();
        endGizmoAction(type);
    });
}

function setMode(m) {
    const prevMode = mode;
    mode = m;
    if (prevMode !== m) {
        modeChanged = true;
    }
    document.querySelectorAll('.navbar-btn').forEach(b => b.classList.toggle('active', b.id === 'btn-' + m));
    
    // Update data-active attribute for sliding animation
    const navbarGroup = document.getElementById('navbarGroup');
    if (navbarGroup) {
        navbarGroup.setAttribute('data-active', m);
    }
    
    document.querySelectorAll('.map-instance').forEach(div => div.style.cursor = 'crosshair');
    update();
    scheduleUrlUpdate();
}

function hideCtx() { if (ctxMenu) ctxMenu.style.display = 'none'; ctxMarker = null; }

function setCtxMenuMode(mode) {
    const del = document.getElementById('ctx-del-point');
    if (del) del.style.display = mode === 'point' ? '' : 'none';
}

function showCtx(e, m) {
    L.DomEvent.stopPropagation(e);
    ctxMarker = m;
    setCtxMenuMode('point');
    if (!ctxMenu) return;
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

// Gizmo Context Menu Functions
function hideGizmoCtx() {
    if (gizmoCtxMenu) gizmoCtxMenu.style.display = 'none';
    gizmoCtxWhich = null;
}

function showGizmoCtx(e, which) {
    L.DomEvent.stopPropagation(e);
    gizmoCtxWhich = which;
    if (!gizmoCtxMenu) return;
    gizmoCtxMenu.style.display = 'block';
    const clientX = e.originalEvent?.clientX ?? e.clientX ?? 0;
    const clientY = e.originalEvent?.clientY ?? e.clientY ?? 0;
    gizmoCtxMenu.style.left = clientX + 'px';
    gizmoCtxMenu.style.top = clientY + 'px';
}

function resetGizmoRotation() {
    if (!gizmoCtxWhich || !refMap) return;
    const tf = gizmoCtxWhich === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
    tf.rotation = 0;
    tf.pivotMerc = null;
    update();
    scheduleUrlUpdate();
    showToast(gizmoCtxWhich === 'ref' ? 'Reference rotation reset' : 'Overlay rotation reset');
    hideGizmoCtx();
}

function resetGizmoMove() {
    if (!gizmoCtxWhich || !refMap) return;
    const tf = gizmoCtxWhich === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
    tf.offsetMerc = L.point(0, 0);
    update();
    scheduleUrlUpdate();
    showToast(gizmoCtxWhich === 'ref' ? 'Reference move reset' : 'Overlay move reset');
    hideGizmoCtx();
}

function resetGizmoAll() {
    if (!gizmoCtxWhich || !refMap) return;
    const tf = gizmoCtxWhich === 'ref' ? shapeTransforms.ref : shapeTransforms.ovl;
    tf.rotation = 0;
    tf.offsetMerc = L.point(0, 0);
    tf.pivotMerc = null;
    update();
    scheduleUrlUpdate();
    showToast(gizmoCtxWhich === 'ref' ? 'Reference transforms reset' : 'Overlay transforms reset');
    hideGizmoCtx();
}

// Layer management helpers
function ensureLayer(map, layer, want) {
    if (!layer) return;
    if (!map) {
        if (layer._map) layer.remove();
        return;
    }
    if (want) {
        if (!layer._map) layer.addTo(map);
    } else {
        if (layer._map) layer.remove();
    }
}

function removeAllShapes() {
    Object.values(shapes).forEach((s) => {
        if (s && s._map) s.remove();
    });
}

function removeMeasureLabels() {
    if (measureLabelRef) { measureLabelRef.remove(); measureLabelRef = null; }
    if (measureLabelOvl) { measureLabelOvl.remove(); measureLabelOvl = null; }
}

function clearAll() {
    if (refMap) { markersRef.forEach(m => refMap.removeLayer(m)); markersOvl.forEach(m => ovlMap.removeLayer(m)); }
    if (measureLabelRef) { measureLabelRef.remove(); measureLabelRef = null; }
    if (measureLabelOvl) { measureLabelOvl.remove(); measureLabelOvl = null; }
    removeGizmos();
    masterVertices = [];
    verticesRef = []; verticesOvl = []; markersRef = []; markersOvl = [];
    refMap = null; ovlMap = null;
    mercAnchorRef = null; mercAnchorOvl = null;
    // Reset transforms
    shapeTransforms.ref = { rotation: 0, offsetMerc: L.point(0, 0), pivotMerc: null };
    shapeTransforms.ovl = { rotation: 0, offsetMerc: L.point(0, 0), pivotMerc: null };
    document.getElementById('label1').innerText = "Map 1"; document.getElementById('label2').innerText = "Map 2";
    update();
    scheduleUrlUpdate();
}

// Update vertex positions based on master vertices and transforms
function updateVertexPositions() {
    if (!refMap || !ovlMap || masterVertices.length === 0) return;
    
    // Get master vertices in Mercator coordinates
    const baseMerc = getMasterMerc();
    
    // Apply reference transform
    const refMerc = applyTransformMerc(baseMerc, shapeTransforms.ref);
    verticesRef = refMerc.map(p => ({ latlng: fromMerc(p) }));
    
    // Apply overlay transform (with view-space offset from mercAnchor)
    const ovlBaseMerc = baseMerc.map((p) => L.point(mercAnchorOvl.x + (p.x - mercAnchorRef.x), mercAnchorOvl.y + (p.y - mercAnchorRef.y)));
    const ovlMerc = applyTransformMerc(ovlBaseMerc, shapeTransforms.ovl);
    verticesOvl = ovlMerc.map(p => ({ latlng: fromMerc(p) }));
}

// Update marker positions on both maps
function updateMarkerPositions() {
    const pRef = verticesRef.map(v => v.latlng);
    const pOvl = verticesOvl.map(v => v.latlng);
    markersRef.forEach((m, i) => { if (pRef[i]) m.setLatLng(pRef[i]); });
    markersOvl.forEach((m, i) => { if (pOvl[i]) m.setLatLng(pOvl[i]); });
}

// Update UI button visibility based on state
function updateUiVisibility() {
    const hasPoints = masterVertices.length > 0;
    const clearBtn1 = document.getElementById('clearBtn1');
    const clearBtn2 = document.getElementById('clearBtn2');
    const backBtn1 = document.getElementById('backBtn1');
    const backBtn2 = document.getElementById('backBtn2');
    
    clearBtn1?.classList.remove('visible');
    clearBtn2?.classList.remove('visible');
    backBtn1?.classList.remove('visible');
    backBtn2?.classList.remove('visible');
    
    if (hasPoints && refMap) {
        if (refMap === map1) {
            clearBtn1?.classList.add('visible');
            backBtn1?.classList.add('visible');
        } else if (refMap === map2) {
            clearBtn2?.classList.add('visible');
            backBtn2?.classList.add('visible');
        }
    }
}

// Clamp point to stay within viewport
function clampToView(map, pt, radius) {
    const containerSize = map.getSize();
    const isMobile = window.innerWidth <= 767;
    const constrainToNav = isMobile && map === map2;
    let maxY = containerSize.y - radius;
    
    if (constrainToNav) {
        const dashboard = document.querySelector('#dashboard');
        const navbarHeight = dashboard ? dashboard.offsetHeight : 56;
        const margin = 8;
        maxY = containerSize.y - navbarHeight - radius - margin;
    }
    
    return L.point(
        Math.max(radius, Math.min(containerSize.x - radius, pt.x)),
        Math.max(radius, Math.min(maxY, pt.y))
    );
}

// Update shape layers based on mode
function updateShapes(isArea, pRef, pOvl) {
    if (isArea) {
        ensureLayer(refMap, shapes.sRefBg, false);
        ensureLayer(refMap, shapes.sRef, false);
        ensureLayer(ovlMap, shapes.sOvlBg, false);
        ensureLayer(ovlMap, shapes.sOvl, false);

        ensureLayer(refMap, shapes.aRefBg, true);
        ensureLayer(refMap, shapes.aRef, true);
        ensureLayer(ovlMap, shapes.aOvlBg, true);
        ensureLayer(ovlMap, shapes.aOvl, true);

        shapes.aRefBg.setLatLngs(pRef);
        shapes.aRef.setLatLngs(pRef);
        shapes.aOvlBg.setLatLngs(pOvl);
        shapes.aOvl.setLatLngs(pOvl);
    } else {
        ensureLayer(refMap, shapes.aRefBg, false);
        ensureLayer(refMap, shapes.aRef, false);
        ensureLayer(ovlMap, shapes.aOvlBg, false);
        ensureLayer(ovlMap, shapes.aOvl, false);

        ensureLayer(refMap, shapes.sRefBg, true);
        ensureLayer(refMap, shapes.sRef, true);
        ensureLayer(ovlMap, shapes.sOvlBg, true);
        ensureLayer(ovlMap, shapes.sOvl, true);

        shapes.sRefBg.setLatLngs(pRef);
        shapes.sRef.setLatLngs(pRef);
        shapes.sOvlBg.setLatLngs(pOvl);
        shapes.sOvl.setLatLngs(pOvl);
    }
}

// Format percentage for display
function formatPct(pct) {
    const p = Number(pct);
    const sign = p >= 0 ? '+' : '-';
    return `${sign}${Math.abs(p).toFixed(1)}%`;
}

// Create measurement label icon
function makeMeasureLabel(valueText, pctText, color) {
    return L.divIcon({
        className: 'measurement-label',
        html: `<div class="measurement-label-wrap">
            <div class="measurement-label-inner" style="background-color:${color}; border-color:rgba(0, 0, 0, 0.3);">
                <div class="measurement-label-primary" style="color:#000000">${valueText}</div>
                ${color === 'var(--accent-yellow)' ? `<div class="measurement-label-secondary" style="color:#000000">${pctText}</div>` : ''}
            </div>
        </div>`,
        iconSize: null
    });
}

// Prevent clicks on measurement labels from propagating to map
function preventLabelClick(marker) {
    const labelElement = marker?.getElement?.();
    if (!labelElement) return;
    if (labelElement.dataset?.stopprop === '1') return;
    labelElement.dataset.stopprop = '1';
    labelElement.addEventListener('click', (e) => e.stopPropagation());
    labelElement.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
}

// Check if label fits inside shape (uses Turf.js if available)
function doesLabelFitInShape(pts, map, isAreaShape) {
    if (!isAreaShape || pts.length < 3) return { fits: true, reason: 'line' };
    
    // First check: AABB size test (always works, no Turf needed)
    try {
        const bounds = L.polygon(pts).getBounds();
        const nw = map.latLngToContainerPoint(bounds.getNorthWest());
        const se = map.latLngToContainerPoint(bounds.getSouthEast());
        
        const aabbWidthPx = Math.abs(se.x - nw.x);
        const aabbHeightPx = Math.abs(se.y - nw.y);
        
        const labelWidthPx = 100;
        const labelHeightPx = 50;
        
        // If AABB is smaller than label, shape is definitely too small
        if (aabbWidthPx < labelWidthPx || aabbHeightPx < labelHeightPx) {
            return { fits: false, reason: 'too_small' };
        }
        
        // Second check: Turf.js containment test (if available)
        if (typeof turf === 'undefined' || !turf || !turf.booleanContains) {
            // No Turf.js - use AABB test as fallback
            return { fits: true, reason: 'aabb_ok' };
        }
        
        const centroid = polyCentroid(pts);
        if (!centroid) return { fits: false, reason: 'no_centroid' };
        
        const centerPt = map.latLngToContainerPoint(centroid);
        const halfWidthLatLng = map.containerPointToLatLng(L.point(centerPt.x - labelWidthPx/2, centerPt.y));
        const halfHeightLatLng = map.containerPointToLatLng(L.point(centerPt.x, centerPt.y - labelHeightPx/2));
        
        const dLng = Math.abs(centroid.lng - halfWidthLatLng.lng);
        const dLat = Math.abs(centroid.lat - halfHeightLatLng.lat);
        
        const labelRing = [
            [centroid.lng - dLng, centroid.lat - dLat],
            [centroid.lng + dLng, centroid.lat - dLat],
            [centroid.lng + dLng, centroid.lat + dLat],
            [centroid.lng - dLng, centroid.lat + dLat],
            [centroid.lng - dLng, centroid.lat - dLat]
        ];
        
        const polyRing = pts.map(p => [p.lng, p.lat]);
        if (polyRing.length > 0 && (polyRing[0][0] !== polyRing[polyRing.length-1][0] || polyRing[0][1] !== polyRing[polyRing.length-1][1])) {
            polyRing.push([polyRing[0][0], polyRing[0][1]]);
        }
        
        const labelPoly = turf.polygon([labelRing]);
        const shapePoly = turf.polygon([polyRing]);
        
        const isContained = turf.booleanContains(shapePoly, labelPoly) || turf.booleanWithin(labelPoly, shapePoly);
        
        return { fits: isContained, reason: isContained ? 'fits' : 'not_contained' };
    } catch (e) {
        // If anything fails, check AABB size as final fallback
        try {
            const bounds = L.polygon(pts).getBounds();
            const nw = map.latLngToContainerPoint(bounds.getNorthWest());
            const se = map.latLngToContainerPoint(bounds.getSouthEast());
            const width = Math.abs(se.x - nw.x);
            const height = Math.abs(se.y - nw.y);
            return { fits: width >= 100 && height >= 50, reason: 'error_fallback' };
        } catch (_) {
            return { fits: true, reason: 'complete_failure' };
        }
    }
}

// Calculate position for measurement label
function labelPoint(pts, isAreaShape, map) {
    if (!pts.length) return null;
    if (!isAreaShape) {
        const mid = lineMidpoint(pts);
        if (!mid) return null;
        const midPt = map.latLngToContainerPoint(mid);
        const clampedPt = clampToView(map, midPt, 50);
        return map.containerPointToLatLng(clampedPt);
    }
    
    // For area shapes, check if label fits inside first
    const aabb = getAabb(pts);
    const aabbCenterX = aabb ? (aabb.west + aabb.east) / 2 : null;
    
    const c = polyCentroid(pts);
    const fitCheck = doesLabelFitInShape(pts, map, isAreaShape);
    
    // Check if center position would overlap with any shape points
    let centerOverlapsPoints = false;
    if (c && pts.length > 0) {
        const labelWidth = 100;
        const labelHeight = 50;
        const pointBuffer = 15;
        const centerPt = map.latLngToContainerPoint(c);
        const proposedLeft = centerPt.x - labelWidth / 2;
        const proposedTop = centerPt.y - labelHeight / 2;
        
        // Check all points for overlap with proposed label position
        centerOverlapsPoints = pts.some(pt => 
            pt.x >= proposedLeft - pointBuffer && 
            pt.x <= proposedLeft + labelWidth + pointBuffer &&
            pt.y >= proposedTop - pointBuffer && 
            pt.y <= proposedTop + labelHeight + pointBuffer
        );
    }
    
    // If label fits inside AND doesn't overlap with points, position at centroid with AABB center X
    if (c && fitCheck.fits && !centerOverlapsPoints) {
        if (aabbCenterX !== null) {
            const targetLatLng = L.latLng(c.lat, aabbCenterX);
            const targetPt = map.latLngToContainerPoint(targetLatLng);
            const clampedPt = clampToView(map, targetPt, 50);
            return map.containerPointToLatLng(clampedPt);
        } else {
            const targetPt = map.latLngToContainerPoint(c);
            const clampedPt = clampToView(map, targetPt, 50);
            return map.containerPointToLatLng(clampedPt);
        }
    }
    
    // Label doesn't fit inside or overlaps points - position at the bottom edge of AABB, in the middle
    if (!aabb) return c || L.polygon(pts).getBounds().getCenter();
    
    // For small shapes, position label at bottom edge of AABB (centered horizontally)
    const bottomCenterPt = map.latLngToContainerPoint(L.latLng(aabb.south, aabbCenterX));
    // Add a small offset so label sits just outside the bottom edge
    const offsetPt = L.point(bottomCenterPt.x, bottomCenterPt.y + CONSTANTS.GIZMO_OFFSET_PX);
    const clampedPt = clampToView(map, offsetPt, 50);
    return map.containerPointToLatLng(clampedPt);
}

// Main update function - orchestrates all sub-updates
function update() {
    // Skip gizmo/label positioning during zoom animation to prevent desync with shapes
    // Shapes use CSS transforms during animations, but latLngToContainerPoint uses target state
    const hasPoints = masterVertices.length > 0;

    updateUiVisibility();

    // Update vertex positions from master + transforms BEFORE getting pRef/pOvl
    updateVertexPositions();

    const pRef = verticesRef.map(v => v.latlng).filter(ll => ll && typeof ll.lat === 'number' && typeof ll.lng === 'number');
    const pOvl = verticesOvl.map(v => v.latlng).filter(ll => ll && typeof ll.lat === 'number' && typeof ll.lng === 'number');

    if (!hasPoints || !refMap || !ovlMap) {
        removeAllShapes();
        removeMeasureLabels();
        return;
    }

    const isArea = mode === 'area';
    
    // Skip shape updates during zoom animation - let Leaflet handle smooth animation like markers
    if (!isZoomAnimating) {
        updateShapes(isArea, pRef, pOvl);
    }
    updateMarkerPositions();

    const isComplete = pRef.length >= (isArea ? 3 : 2);
    if (!isComplete) {
        removeMeasureLabels();
        ensureLayer(refMap, shapes.bbRef, false);
        ensureLayer(ovlMap, shapes.bbOvl, false);
        return;
    }

    // Skip gizmo/label updates during zoom animation - shapes and markers still update
    if (isZoomAnimating) return;

    const bbR = getAabb(pRef);
    const bbO = getAabb(pOvl);

    if (showAabb) {
        ensureLayer(refMap, shapes.bbRef, !!bbR);
        ensureLayer(ovlMap, shapes.bbOvl, !!bbO);
        if (bbR) shapes.bbRef.setBounds([[bbR.south, bbR.west], [bbR.north, bbR.east]]);
        if (bbO) shapes.bbOvl.setBounds([[bbO.south, bbO.west], [bbO.north, bbO.east]]);
    } else {
        ensureLayer(refMap, shapes.bbRef, false);
        ensureLayer(ovlMap, shapes.bbOvl, false);
    }

    // Update measurement labels
    const vRef = isArea ? getArea(pRef) : getDist(pRef);
    const vOvl = isArea ? getArea(pOvl) : getDist(pOvl);
    const pctDeltaVsRef = vRef > 0 ? ((vOvl - vRef) / vRef) * 100 : 0;
    const pctRef = formatPct(-pctDeltaVsRef);
    const pctOvl = formatPct(pctDeltaVsRef);

    // Check if shapes are small (label doesn't fit inside)
    const refFitCheck = doesLabelFitInShape(pRef, refMap, isArea);
    const ovlFitCheck = doesLabelFitInShape(pOvl, ovlMap, isArea);
    const isRefSmall = isArea && !refFitCheck.fits;
    const isOvlSmall = isArea && !ovlFitCheck.fits;

    // Calculate label positions - always recalculate dynamically
    const refLabelPos = labelPoint(pRef, isArea, refMap);
    const ovlLabelPos = labelPoint(pOvl, isArea, ovlMap);

    if (refLabelPos) {
        if (!measureLabelRef) {
            measureLabelRef = L.marker(refLabelPos, {
                interactive: true,
                keyboard: false,
                icon: makeMeasureLabel(fmt(vRef, mode), pctRef, 'var(--accent-blue)')
            }).addTo(refMap);
        } else {
            if (!measureLabelRef._map) measureLabelRef.addTo(refMap);
            measureLabelRef.setLatLng(refLabelPos);
            measureLabelRef.setIcon(makeMeasureLabel(fmt(vRef, mode), pctRef, 'var(--accent-blue)'));
        }
        preventLabelClick(measureLabelRef);
    }

    if (ovlLabelPos) {
        if (!measureLabelOvl) {
            measureLabelOvl = L.marker(ovlLabelPos, {
                interactive: true,
                keyboard: false,
                icon: makeMeasureLabel(fmt(vOvl, mode), pctOvl, 'var(--accent-yellow)')
            }).addTo(ovlMap);
        } else {
            if (!measureLabelOvl._map) measureLabelOvl.addTo(ovlMap);
            measureLabelOvl.setLatLng(ovlLabelPos);
            measureLabelOvl.setIcon(makeMeasureLabel(fmt(vOvl, mode), pctOvl, 'var(--accent-yellow)'));
        }
        preventLabelClick(measureLabelOvl);
    }
    
    // Update rotation and move gizmos
    ensureGizmoMarkers();
    positionGizmos(bbR, refMap, rotateGizmoRef, moveGizmoRef);
    positionGizmos(bbO, ovlMap, rotateGizmoOvl, moveGizmoOvl);
    
    // Info gizmo position is updated in a RAF loop while visible
    modeChanged = false;
}

function getArea(ll) {
    if (!Array.isArray(ll) || ll.length < 3) return 0;
    
    // Filter out invalid points
    const validPoints = ll.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPoints.length < 3) return 0;

    // If Turf is available, compute the area of the shaded (filled) regions even
    // when the polygon is self-intersecting.
    try {
        if (typeof turf !== 'undefined' && turf && typeof turf.polygon === 'function') {
            const ring = validPoints.map(p => [p.lng, p.lat]);
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
    for (let i = 0; i < validPoints.length; i++) {
        const p1 = validPoints[i], p2 = validPoints[(i + 1) % validPoints.length];
        if (!p1 || !p2 || !Number.isFinite(p1.lat) || !Number.isFinite(p1.lng) || !Number.isFinite(p2.lat) || !Number.isFinite(p2.lng)) continue;
        a += (p2.lng - p1.lng) * (Math.PI / 180) * (Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(a * R * R / 2);
}
function getDist(ll) { 
    if (!Array.isArray(ll)) return 0;
    let d = 0; 
    for (let i = 0; i < ll.length - 1; i++) {
        if (ll[i] && ll[i + 1] && typeof ll[i].distanceTo === 'function') {
            d += ll[i].distanceTo(ll[i + 1]); 
        }
    }
    return d; 
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
                
                // The closest point is in transformed space; we need to store untransformed in masterVertices
                // Invert the transform to get the base position
                const closestMerc = toMerc(closestPoint);
                const baseMercMaster = getMasterMerc();
                const untransformedMerc = invertTransformMerc(closestMerc, baseMercMaster, shapeTransforms.ref);
                const untransformedLatLng = fromMerc(untransformedMerc);
                
                // Insert new point at this position
                insertIntermediatePoint(i + 1, untransformedLatLng, src);
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
                
                // Invert the transform to get the untransformed base position
                const closestMerc = toMerc(closestPoint);
                const baseMercMaster = getMasterMerc();
                const untransformedMerc = invertTransformMerc(closestMerc, baseMercMaster, shapeTransforms.ref);
                const untransformedLatLng = fromMerc(untransformedMerc);
                
                insertIntermediatePoint(verticesRef.length, untransformedLatLng, src);
                return;
            }
        }
    }

    // If not near a line, add new point as usual
    // Get the view position (pixel coordinates) on the reference map
    const containerPoint = refMap.latLngToContainerPoint(e.latlng);
    
    // Convert that same view position to lat/lng on the overlay map
    const ovlLatLng = ovlMap.containerPointToLatLng(containerPoint);
    
    const index = masterVertices.length;
    
    // Create reference marker at the clicked geo location
    const mR = createHandleMarker(e.latlng, false, refMap, index);
    
    // Create overlay marker at the corresponding view position on overlay map
    const mO = createHandleMarker(ovlLatLng, true, ovlMap, index);
    
    // Bind drag handlers for both markers
    bindDragHandlers(mR, markersRef, setMasterFromRefLatLng);
    bindDragHandlers(mO, markersOvl, setMasterFromOvlLatLng);

    masterVertices.push({ latlng: e.latlng });
    verticesRef.push({ latlng: e.latlng });
    verticesOvl.push({ latlng: ovlLatLng });
    markersRef.push(mR);
    markersOvl.push(mO);
    
    // Update marker icons to show vertex numbers if enabled
    updateMarkerIcons();
    
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
    // Get the view position (pixel coordinates) on the reference map
    const containerPoint = refMap.latLngToContainerPoint(latlng);
    
    // Convert that same view position to lat/lng on the overlay map
    const ovlLatLng = ovlMap.containerPointToLatLng(containerPoint);
    
    // Create reference marker at the clicked geo location
    const mR = createHandleMarker(latlng, false, refMap, index);
    
    // Create overlay marker at the corresponding view position on overlay map
    const mO = createHandleMarker(ovlLatLng, true, ovlMap, index);
    
    // Bind drag handlers for both markers
    bindDragHandlers(mR, markersRef, setMasterFromRefLatLng);
    bindDragHandlers(mO, markersOvl, setMasterFromOvlLatLng);

    // Insert at the specified index
    masterVertices.splice(index, 0, { latlng: latlng });
    verticesRef.splice(index, 0, { latlng: latlng });
    verticesOvl.splice(index, 0, { latlng: ovlLatLng });
    markersRef.splice(index, 0, mR);
    markersOvl.splice(index, 0, mO);
    
    // Update indices for all markers after insertion
    updateMarkerIcons();
    
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
    setMapsInteraction(false);
}

function unlockMapInteractions() {
    mapInteractionLockCount = Math.max(0, mapInteractionLockCount - 1);
    if (mapInteractionLockCount !== 0) return;
    setMapsInteraction(true);
}

function resetMapInteractionLocks() {
    mapInteractionLockCount = 0;
    setMapsInteraction(true);
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

const MAP_METHODS = ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'];

function setMapsInteraction(enabled) {
    if (!refMap || !ovlMap) return;
    mapsDisabledForLabelDrag = !enabled;
    [refMap, ovlMap].forEach(map => {
        MAP_METHODS.forEach(m => {
            const method = enabled ? 'enable' : 'disable';
            if (map[m]?.[method]) map[m][method]();
        });
    });
}

// Context Menu Logic
let ctxMarker = null;
const ctxMenu = document.getElementById('ctx-menu');
const gizmoCtxMenu = document.getElementById('gizmo-ctx-menu');
let gizmoCtxWhich = null; // 'ref' or 'ovl'

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
        const labelPoints = activeMoveLabel === 'ref' ? 
            verticesRef.map(v => v.latlng) : verticesOvl.map(v => v.latlng);
        
        if (labelPoints.length > 0) {
            const isArea = mode === 'area';
            const newPosition = isArea ? 
                (polyCentroid(labelPoints) && pointInPolygon(polyCentroid(labelPoints), labelPoints) ? 
                    polyCentroid(labelPoints) : L.polygon(labelPoints).getBounds().getCenter()) :
                lineMidpoint(labelPoints);
            
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
}

// GeoJSON Export/Import
function exportGeoJSON() {
    if (masterVertices.length === 0) {
        showToast('No measurements to export');
        return;
    }

    const features = [];

    // Export reference shape
    if (verticesRef.length > 0) {
        const refCoords = verticesRef.map(v => [v.latlng.lng, v.latlng.lat]);
        if (mode === 'area' && refCoords.length >= 3) {
            // Close the polygon
            if (refCoords[0][0] !== refCoords[refCoords.length - 1][0] ||
                refCoords[0][1] !== refCoords[refCoords.length - 1][1]) {
                refCoords.push([...refCoords[0]]);
            }
            features.push({
                type: 'Feature',
                properties: { type: 'area', map: 'reference', color: 'blue' },
                geometry: { type: 'Polygon', coordinates: [refCoords] }
            });
        } else if (refCoords.length >= 2) {
            features.push({
                type: 'Feature',
                properties: { type: 'line', map: 'reference', color: 'blue' },
                geometry: { type: 'LineString', coordinates: refCoords }
            });
        }

        // Add points
        refCoords.forEach((coord, i) => {
            features.push({
                type: 'Feature',
                properties: { type: 'point', map: 'reference', index: i },
                geometry: { type: 'Point', coordinates: coord }
            });
        });
    }

    // Export overlay shape
    if (verticesOvl.length > 0) {
        const ovlCoords = verticesOvl.map(v => [v.latlng.lng, v.latlng.lat]);
        if (mode === 'area' && ovlCoords.length >= 3) {
            if (ovlCoords[0][0] !== ovlCoords[ovlCoords.length - 1][0] ||
                ovlCoords[0][1] !== ovlCoords[ovlCoords.length - 1][1]) {
                ovlCoords.push([...ovlCoords[0]]);
            }
            features.push({
                type: 'Feature',
                properties: { type: 'area', map: 'overlay', color: 'yellow' },
                geometry: { type: 'Polygon', coordinates: [ovlCoords] }
            });
        } else if (ovlCoords.length >= 2) {
            features.push({
                type: 'Feature',
                properties: { type: 'line', map: 'overlay', color: 'yellow' },
                geometry: { type: 'LineString', coordinates: ovlCoords }
            });
        }
    }

    const geojson = {
        type: 'FeatureCollection',
        properties: {
            mode: mode,
            created: new Date().toISOString(),
            app: 'SyncView'
        },
        features: features
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `syncview-${mode}-${new Date().toISOString().split('T')[0]}.geojson`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('GeoJSON exported');
}

// Initialize app in ruler mode
setMode('dist');
updateUnitLabel();
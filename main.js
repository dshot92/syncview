/**
 * @fileoverview Main JavaScript file for Sync View - A dual-map comparison tool
 * for measuring distances and areas between locations.
 */

// --- Constants ---

/**
 * Tile layer URLs for different map styles.
 * @type {Object<string, string>}
 */
const tiles = {
    hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    satellite: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    streets: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
};

/**
 * Order of layer keys for indexing purposes.
 * @type {string[]}
 */
const layerOrder = Object.keys(tiles);

/**
 * Helper function to retrieve CSS variable values.
 * @param {string} name - The CSS variable name.
 * @returns {string} The computed value of the CSS variable.
 */
const getCssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// --- Shape Class ---

/**
 * Represents a geometric shape that spans across two synchronized maps.
 * Stores local points relative to the origin anchor and manages positioning
 * on both origin and comparison maps.
 */
class Shape {
    /**
     * Creates a new Shape instance.
     * @param {L.LatLng|number[]} anchor - The initial anchor point (lat, lng).
     * @param {number} originMapId - ID of the origin map (1 or 2).
     * @param {L.LatLng|number[]} initialCompAnchor - Initial anchor for the comparison map.
     */
    constructor(anchor, originMapId, initialCompAnchor) {
        /** @type {number} The origin map ID (1 or 2). */
        this.origin_map = originMapId;
        /** @type {L.LatLng} The anchor point on the origin map. */
        this.origin_anchor = L.latLng(anchor);
        /** @type {L.LatLng} The anchor point on the comparison map. */
        this.comparison_anchor = L.latLng(initialCompAnchor);
        /** @type {L.Point[]} Local points relative to the origin anchor. */
        this.localPoints = [L.point(0, 0)];
        /** @type {number} Rotation angle in radians for the overlay. */
        this.overlayRotation = 0;
    }

    /**
     * Calculates the centroid of all local points.
     * @returns {L.Point} The centroid point.
     */
    getCentroid() {
        if (this.localPoints.length === 0) return L.point(0, 0);
        let x = 0, y = 0;
        this.localPoints.forEach(p => { x += p.x; y += p.y; });
        return L.point(x / this.localPoints.length, y / this.localPoints.length);
    }

    /**
     * Shifts the comparison anchor when the centroid changes.
     * @param {L.Map} map - The comparison map instance.
     * @param {L.Point} oldCentroid - The previous centroid.
     * @param {L.Point} newCentroid - The new centroid.
     */
    shiftComparisonAnchor(map, oldCentroid, newCentroid) {
        const diff = newCentroid.subtract(oldCentroid);
        const rot = this.overlayRotation;
        const sin = Math.sin(rot);
        const cos = Math.cos(rot);
        const rx = diff.x * cos - diff.y * sin;
        const ry = diff.x * sin + diff.y * cos;
        const compAnchorPx = map.project(this.comparison_anchor, AppState.REF_ZOOM);
        this.comparison_anchor = map.unproject(compAnchorPx.add(L.point(rx, ry)), AppState.REF_ZOOM);
    }

    /**
     * Adds a new point to the shape.
     * @param {L.LatLng} latlng - The latitude/longitude of the new point.
     * @param {L.Map} map - The map where the point was added.
     * @param {number} [index=-1] - Insertion index (-1 to append).
     */
    addPoint(latlng, map, index = -1) {
        const c1 = this.getCentroid();
        const anchorPx = map.project(this.origin_anchor, AppState.REF_ZOOM);
        const pointPx = map.project(latlng, AppState.REF_ZOOM);
        const rel = pointPx.subtract(anchorPx);
        if (index === -1) this.localPoints.push(rel);
        else this.localPoints.splice(index, 0, rel);
        this.shiftComparisonAnchor(map, c1, this.getCentroid());
    }

    /**
     * Updates an existing point's position.
     * @param {number} index - The index of the point to update.
     * @param {L.LatLng} newLatLng - The new latitude/longitude.
     * @param {L.Map} map - The map instance.
     */
    updatePoint(index, newLatLng, map) {
        const c1 = this.getCentroid();
        const anchorPx = map.project(this.origin_anchor, AppState.REF_ZOOM);
        const pointPx = map.project(newLatLng, AppState.REF_ZOOM);
        this.localPoints[index] = pointPx.subtract(anchorPx);
        this.shiftComparisonAnchor(map, c1, this.getCentroid());
    }

    /**
     * Removes the last point from the shape.
     * @param {L.Map} map - The map instance.
     */
    removeLastPoint(map) {
        if (this.localPoints.length === 0) return;
        const c1 = this.getCentroid();
        this.localPoints.pop();
        if (this.localPoints.length === 0) return;
        this.shiftComparisonAnchor(map, c1, this.getCentroid());
    }

    /**
     * Gets render points for a specific target map.
     * @param {L.Map} targetMap - The map to render on.
     * @param {number} targetMapId - ID of the target map (1 or 2).
     * @returns {L.LatLng[]} Array of lat/lng points for rendering.
     */
    getRenderPoints(targetMap, targetMapId) {
        const currentZoom = targetMap.getZoom();
        const scale = Math.pow(2, currentZoom - AppState.REF_ZOOM);

        // For Origin Map: Render exactly as stored (relative to origin anchor)
        if (targetMapId === this.origin_map) {
            const anchorPx = targetMap.project(this.origin_anchor, currentZoom);
            return this.localPoints.map(p => {
                return targetMap.unproject(anchorPx.add(p.multiplyBy(scale)), currentZoom);
            });
        }

        // For Comparison Map: Render centered on comparison_anchor (Handle)
        // 1. Calculate centroid of local points (unscaled)
        const centroid = this.getCentroid();

        // 2. Project comparison anchor (Handle position)
        const anchorPx = targetMap.project(this.comparison_anchor, currentZoom);

        // 3. Precompute rotation
        const rot = this.overlayRotation;
        const sin = Math.sin(rot);
        const cos = Math.cos(rot);

        return this.localPoints.map(p => {
            // Center the point relative to the centroid
            const cx = (p.x - centroid.x) * scale;
            const cy = (p.y - centroid.y) * scale;

            // Rotate the centered point
            const rx = cx * cos - cy * sin;
            const ry = cx * sin + cy * cos;

            // Add rotated offset to the handle position
            return targetMap.unproject(anchorPx.add(L.point(rx, ry)), currentZoom);
        });
    }

    /**
     * Sets the overlay position on the comparison map.
     * @param {L.LatLng} latlng - The new anchor position.
     */
    setOverlayPosition(latlng) {
        this.comparison_anchor = latlng;
    }

    /**
     * Sets the overlay rotation angle.
     * @param {number} angle - Rotation angle in radians.
     */
    setOverlayRotation(angle) {
        this.overlayRotation = angle;
    }
}

// --- Map Configuration ---

/**
 * Shared map options for both map instances.
 * @type {Object}
 */
const mapOptions = {
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120,
    inertia: true,
    inertiaDeceleration: 3000,
};

/** @type {L.Map} The first map instance. */
const map1 = L.map('map1', mapOptions).setView([51.505, -0.09], 13);
/** @type {L.Map} The second map instance. */
const map2 = L.map('map2', mapOptions).setView([40.7128, -74.0060], 13);

/**
 * Tile layer options.
 * @type {Object}
 */
const tileOptions = {
    updateWhenZooming: true,
    updateWhenIdle: false,
    keepBuffer: 4,
    minZoom: 1,
    maxZoom: 22,
    tileSize: 256,
};

/** @type {L.TileLayer} Tile layer for map 1. */
let tile1 = L.tileLayer(tiles.hybrid, { ...tileOptions }).addTo(map1);
/** @type {L.TileLayer} Tile layer for map 2. */
let tile2 = L.tileLayer(tiles.hybrid, { ...tileOptions }).addTo(map2);

// --- Pinch Zoom Synchronization ---

/** @type {L.Map|null} Currently active map during pinch gesture. */
let activePinchMap = null;
/** @type {L.Map|null} Passive map during pinch gesture. */
let passivePinchMap = null;
/** @type {number|null} Base zoom level of passive map at pinch start. */
let passiveBaseZoom = null;
/** @type {boolean} Flag to suppress bindZoom double-sync right after pinch. */
let justEndedPinch = false;

/**
 * Handles zoom events on the active map during pinch gestures.
 * Applies CSS transform scaling to the passive map for smooth visual sync.
 */
function onActiveMapZoom() {
    if (!passivePinchMap) return;
    const scale = Math.pow(2, activePinchMap.getZoom() - passiveBaseZoom);
    const size = passivePinchMap.getSize();
    const origin = L.point(size.x / 2, size.y / 2);
    const offset = origin.subtract(origin.multiplyBy(scale));
    L.DomUtil.setTransform(passivePinchMap._mapPane, offset, scale);
}

/**
 * Ends the pinch gesture, resets transforms, and synchronizes zoom levels.
 */
function endPinch() {
    if (!passivePinchMap) return;
    activePinchMap.off('zoom', onActiveMapZoom);
    const passive = passivePinchMap;
    const active = activePinchMap;
    L.DomUtil.setTransform(passive._mapPane, L.point(0, 0), 1);
    passivePinchMap = null;
    activePinchMap = null;
    passiveBaseZoom = null;
    justEndedPinch = true;
    const finalZoom = active.getZoom();
    if (Math.abs(passive.getZoom() - finalZoom) > 0.01) {
        passive.setZoom(finalZoom, { animate: false });
    }
    justEndedPinch = false;
}

// --- Event Listeners for Pinch ---

document.getElementById('app-container').addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
        if (passivePinchMap) endPinch();
        const inMap1 = e.touches[0].target.closest('#map1-wrapper') ||
            e.touches[1].target.closest('#map1-wrapper');
        activePinchMap = inMap1 ? map1 : map2;
        passivePinchMap = inMap1 ? map2 : map1;
        passiveBaseZoom = passivePinchMap.getZoom();
        activePinchMap.on('zoom', onActiveMapZoom);
    }
}, { passive: true });

document.getElementById('app-container').addEventListener('touchend', endPinch, { passive: true });
document.getElementById('app-container').addEventListener('touchcancel', endPinch, { passive: true });

// --- Fallback Zoom Sync ---

/** @type {boolean} Flag to prevent recursive zoom synchronization. */
let isSyncing = false;

/**
 * Binds zoom events between two maps for non-pinch zoom operations.
 * @param {L.Map} source - The source map to listen to.
 * @param {L.Map} target - The target map to synchronize.
 */
function bindZoom(source, target) {
    source.on('zoomend', () => {
        if (isSyncing || passivePinchMap || justEndedPinch) return;
        isSyncing = true;
        const z = source.getZoom();
        if (Math.abs(target.getZoom() - z) > 0.01) {
            target.setZoom(z, { animate: false });
        }
        isSyncing = false;
    });
}
bindZoom(map1, map2);
bindZoom(map2, map1);

// --- Application State ---

/**
 * Central application state manager.
 * @namespace
 */
const AppState = {
    /** @type {number} Reference zoom level for calculations. */
    REF_ZOOM: 20,
    /** @type {Shape|null} The current shape being edited. */
    groundTruth: null,
    /** @type {string} Current mode ('line' or 'area'). */
    mode: 'line',
    /** @type {string} Current units ('metric' or 'imperial'). */
    units: 'metric',
    /** @type {L.Marker[]} Array of vertex markers. */
    markers: [],
    /** @type {boolean} Whether to show vertex numbers. */
    showVertexNumbers: false,
    /** @type {boolean} Whether to show bounding box. */
    showBoundingBox: false,
    /** @type {boolean} Whether the move handle is being dragged. */
    isDragging: false,
    /** @type {boolean} Whether the rotate handle is being dragged. */
    isRotating: false,
    /** @type {number} Index of point being dragged (-1 if none). */
    isDraggingPoint: -1,
    /** @type {boolean} Whether a drag operation just ended. */
    isDragEnd: false,
    /** @type {number} Vertical offset for the magnifier lens. */
    lensOffset: 40,
    /** @type {boolean} Whether to show the magnifier lens. */
    showLens: true,
    /** @type {L.Map|null} The magnifier map instance. */
    magnifierMap: null,
    /** @type {L.TileLayer|null} The magnifier tile layer. */
    magnifierTile: null,

    /**
     * Initializes a new shape with the given anchor point.
     * @param {L.LatLng} anchor - The initial anchor point.
     * @param {number} originMapId - ID of the origin map (1 or 2).
     */
    init(anchor, originMapId) {
        const originMap = originMapId === 1 ? map1 : map2;
        const compMap = originMapId === 1 ? map2 : map1;
        const screenPoint = originMap.latLngToContainerPoint(anchor);
        const initialCompAnchor = compMap.containerPointToLatLng(screenPoint);
        this.groundTruth = new Shape(anchor, originMapId, initialCompAnchor);
        this.updateUI();
        requestRender();
    },

    /**
     * Sets the current mode (line or area).
     * @param {string} m - The mode to set ('line' or 'area').
     */
    setMode(m) {
        this.mode = m;
        DOM.modeGroup.setAttribute('data-mode', m);
        DOM.btnLine.classList.toggle('active', m === 'line');
        DOM.btnArea.classList.toggle('active', m === 'area');
        resetLayers();
        requestRender();
    },

    /**
     * Sets the current tile layer.
     * @param {string} l - The layer name ('hybrid', 'satellite', or 'streets').
     */
    setLayer(l) {
        map1.removeLayer(tile1); map2.removeLayer(tile2);
        tile1 = L.tileLayer(tiles[l], { ...tileOptions }).addTo(map1).bringToBack();
        tile2 = L.tileLayer(tiles[l], { ...tileOptions }).addTo(map2).bringToBack();
        map1.invalidateSize({ pan: false }); map2.invalidateSize({ pan: false });
        map1.setView(map1.getCenter(), map1.getZoom(), { animate: false });
        map2.setView(map2.getCenter(), map2.getZoom(), { animate: false });
        DOM.layerMenu.dataset.active = l;
        DOM.dropdownItems.forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-layer') === l);
        });
        setTimeout(() => DOM.layerMenu.classList.remove('show'), 400);
        DOM.layerBtn.classList.remove('active');
    },

    /**
     * Toggles between metric and imperial units.
     */
    toggleUnits() {
        this.units = this.units === 'metric' ? 'imperial' : 'metric';
        DOM.valUnits.textContent = this.units.charAt(0).toUpperCase() + this.units.slice(1);
        requestRender();
    },

    /**
     * Toggles the display of vertex numbers on markers.
     */
    toggleVertexNumbers() {
        this.showVertexNumbers = !this.showVertexNumbers;
        DOM.valVertex.textContent = this.showVertexNumbers ? 'On' : 'Off';
        this.markers.forEach((m, idx) => {
            m.setIcon(L.divIcon({
                className: 'map-point-icon',
                html: this.showVertexNumbers ? idx + 1 : ''
            }));
        });
        requestRender();
    },

    /**
     * Toggles the display of bounding boxes.
     */
    toggleBoundingBox() {
        this.showBoundingBox = !this.showBoundingBox;
        DOM.valBbox.textContent = this.showBoundingBox ? 'On' : 'Off';
        requestRender();
    },

    /**
     * Clears the current shape and resets the UI.
     */
    clear() {
        this.groundTruth = null;
        this.markers = [];
        resetLayers();
        requestRender(); this.updateUI();
    },

    /**
     * Removes the last point from the current shape.
     */
    removeLast() {
        if (!this.groundTruth) return;
        if (this.groundTruth.localPoints.length <= 1) this.clear();
        else {
            const om = this.groundTruth.origin_map;
            const map = om === 1 ? map1 : map2;
            this.groundTruth.removeLastPoint(map);

            if (this.markers.length > 0) {
                const m = this.markers.pop();
                mk1.removeLayer(m); mk2.removeLayer(m);
            }
            resetLayers();
            requestRender();
            this.updateUI();
        }
    },

    /**
     * Updates the UI based on the current application state.
     */
    updateUI() {
        const hasGt = !!this.groundTruth;
        const om = hasGt ? this.groundTruth.origin_map : 0;
        [1, 2].forEach(id => {
            DOM.backBtn[id].classList.toggle('hidden', om !== id);
            DOM.centerBtn[id].classList.toggle('hidden', om !== id);
            DOM.clearBtn[id].classList.toggle('hidden', om !== id);
            DOM.card[id].classList.toggle('visible', hasGt && this.groundTruth.localPoints.length >= 2);
            if (hasGt) {
                const color = getCssVar(om === id ? '--origin-color' : '--comp-color');
                DOM.stats[id].style.color = color;
                if (om === id) document.documentElement.style.setProperty('--shape-point-color', color);
            }
        });
    }
};

// --- DOM References ---

/**
 * Centralized DOM element references.
 * @type {Object}
 */
const DOM = {
    layerMenu: document.getElementById('layerMenu'),
    layerBtn: document.getElementById('layerBtn'),
    modeGroup: document.getElementById('mode-group'),
    btnLine: document.getElementById('btnLine'),
    btnArea: document.getElementById('btnArea'),
    magnifier: document.getElementById('magnifier'),
    shareModal: document.getElementById('share-modal'),
    settingsModal: document.getElementById('settings-modal'),
    infoModal: document.getElementById('info-modal'),
    shareUrl: document.getElementById('share-url'),
    qrcode: document.getElementById('qrcode'),
    qrLoading: document.getElementById('qr-loading'),
    qrError: document.getElementById('qr-error'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    appContainer: document.getElementById('app-container'),
    stats: [null, document.getElementById('stats1'), document.getElementById('stats2')],
    diff: [null, document.getElementById('diff1'), document.getElementById('diff2')],
    card: [null, document.getElementById('card1'), document.getElementById('card2')],
    backBtn: [null, document.getElementById('back1'), document.getElementById('back2')],
    centerBtn: [null, document.getElementById('center-btn1'), document.getElementById('center-btn2')],
    clearBtn: [null, document.getElementById('clear1'), document.getElementById('clear2')],
    searchCtrl: [null, document.getElementById('search-ctrl1'), document.getElementById('search-ctrl2')],
    searchIn: [null, document.getElementById('search-in1'), document.getElementById('search-in2')],
    searchResults: [null, document.getElementById('results1'), document.getElementById('results2')],
    resultsList: [null, document.getElementById('results-list1'), document.getElementById('results-list2')],
    searchStatus: {
        searching: [null, document.getElementById('status-searching1'), document.getElementById('status-searching2')],
        none: [null, document.getElementById('status-none1'), document.getElementById('status-none2')],
        error: [null, document.getElementById('status-error1'), document.getElementById('status-error2')]
    },
    locateBtn: [null, document.getElementById('locate-btn1'), document.getElementById('locate-btn2')],
    valUnits: document.getElementById('val-units'),
    valVertex: document.getElementById('val-vertex'),
    valBbox: document.getElementById('val-bbox'),
    dropdownItems: document.querySelectorAll('.dropdown-item')
};

// --- Layer Groups ---

/** @type {L.FeatureGroup} Feature group for shapes on map 1. */
const fg1 = L.featureGroup().addTo(map1);
/** @type {L.FeatureGroup} Marker group for map 1. */
const mk1 = L.featureGroup().addTo(map1);
/** @type {L.FeatureGroup} Bounding box group for map 1. */
const bb1 = L.featureGroup().addTo(map1);
/** @type {L.FeatureGroup} Handles layer for map 1. */
const hd1 = L.featureGroup().addTo(map1);

/** @type {L.FeatureGroup} Feature group for shapes on map 2. */
const fg2 = L.featureGroup().addTo(map2);
/** @type {L.FeatureGroup} Marker group for map 2. */
const mk2 = L.featureGroup().addTo(map2);
/** @type {L.FeatureGroup} Bounding box group for map 2. */
const bb2 = L.featureGroup().addTo(map2);
/** @type {L.FeatureGroup} Handles layer for map 2. */
const hd2 = L.featureGroup().addTo(map2);

/**
 * Handle references for rigid transformation on comparison map.
 * @type {Object}
 */
const h1 = { move: null, rotate: null, line: null };
const h2 = { move: null, rotate: null, line: null };

/** @type {L.Polyline|L.Polygon|null} Persistent shape object for map 1. */
let shape1;
/** @type {L.Polyline|L.Polygon|null} Persistent shape object for map 2. */
let shape2;
/** @type {L.Polyline|null} Persistent casing object for map 1. */
let casing1;
/** @type {L.Polyline|null} Persistent casing object for map 2. */
let casing2;
/** @type {L.Rectangle|null} Persistent bounding box for map 1. */
let bbox1;
/** @type {L.Rectangle|null} Persistent bounding box for map 2. */
let bbox2;

/**
 * Resets all layer groups and clears persistent references.
 */
function resetLayers() {
    fg1.clearLayers(); fg2.clearLayers();
    bb1.clearLayers(); bb2.clearLayers();
    mk1.clearLayers(); mk2.clearLayers();
    hd1.clearLayers(); hd2.clearLayers();
    h1.move = h1.rotate = h1.line = null;
    h2.move = h2.rotate = h2.line = null;
    shape1 = shape2 = casing1 = casing2 = bbox1 = bbox2 = null;
    AppState.markers = [];
}

// --- Rendering ---

/** @type {boolean} Whether a render is already pending. */
let renderPending = false;

/**
 * Requests a render on the next animation frame.
 */
function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
        renderAll();
        renderPending = false;
    });
}

/**
 * Renders all shapes, markers, and UI elements on both maps.
 */
function renderAll() {
    if (!AppState.groundTruth) { resetLayers(); return; }

    const pts1 = AppState.groundTruth.getRenderPoints(map1, 1);
    const pts2 = AppState.groundTruth.getRenderPoints(map2, 2);
    const om = AppState.groundTruth.origin_map;

    const color1 = getCssVar(om === 1 ? '--origin-color' : '--comp-color');
    const color2 = getCssVar(om === 2 ? '--origin-color' : '--comp-color');

    updateShape(pts1, 1, color1);
    updateShape(pts2, 2, color2);

    if (AppState.showBoundingBox) {
        updateBBox(pts1, 1);
        updateBBox(pts2, 2);
    } else {
        bb1.clearLayers(); bb2.clearLayers();
        bbox1 = bbox2 = null;
    }

    syncMarkers(om === 1 ? pts1 : pts2, om === 1 ? mk1 : mk2, om === 1 ? map1 : map2);
    syncOverlayHandles(om === 1 ? map2 : map1, om === 1 ? hd2 : hd1, om === 1 ? 2 : 1);

    const val1 = getVal(pts1); const val2 = getVal(pts2);
    DOM.stats[1].textContent = format(val1);
    DOM.stats[2].textContent = format(val2);

    const refVal = om === 1 ? val1 : val2;
    const compVal = om === 1 ? val2 : val1;
    DOM.diff[om === 1 ? 1 : 2].textContent = '';

    if (refVal > 0) {
        const pct = ((compVal - refVal) / refVal) * 100;
        const el = DOM.diff[om === 1 ? 2 : 1];
        el.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
        el.style.color = getCssVar('--comp-color');
    }
}

/**
 * Updates or creates the shape layer for a specific map.
 * @param {L.LatLng[]} pts - Array of points.
 * @param {number} id - Map ID (1 or 2).
 * @param {string} color - Color for the shape.
 */
function updateShape(pts, id, color) {
    if (pts.length < 2) return;
    const layer = id === 1 ? fg1 : fg2;
    let shape = id === 1 ? shape1 : shape2;
    let casing = id === 1 ? casing1 : casing2;

    const weight = parseInt(getCssVar('--shape-line-width')) || 3;
    const isArea = AppState.mode === 'area' && pts.length > 2;
    const factory = isArea ? L.polygon : L.polyline;

    if (!shape || (isArea && !(shape instanceof L.Polygon)) || (!isArea && shape instanceof L.Polygon)) {
        layer.clearLayers();
        casing = factory(pts, { color: getCssVar('--shape-outline-color'), weight: weight * 2, fill: false, opacity: 1, interactive: false }).addTo(layer);
        shape = factory(pts, { color, weight, fill: isArea, fillColor: color, fillOpacity: 0.25, opacity: 1, interactive: false }).addTo(layer);
        if (id === 1) { shape1 = shape; casing1 = casing; } else { shape2 = shape; casing2 = casing; }
    } else {
        shape.setLatLngs(pts);
        casing.setLatLngs(pts);
        shape.setStyle({ color, fillColor: color });
    }
}

/**
 * Updates or creates the bounding box for a specific map.
 * @param {L.LatLng[]} pts - Array of points.
 * @param {number} id - Map ID (1 or 2).
 */
function updateBBox(pts, id) {
    if (pts.length < 2) return;
    const layer = id === 1 ? bb1 : bb2;
    let bbox = id === 1 ? bbox1 : bbox2;
    const bounds = L.latLngBounds(pts);

    if (!bbox) {
        const color = getCssVar('--bbox-color');
        const weight = parseFloat(getCssVar('--bbox-width')) || 1.5;
        bbox = L.rectangle(bounds, { color, weight, dashArray: '5, 5', fill: false, interactive: false }).addTo(layer);
        if (id === 1) bbox1 = bbox; else bbox2 = bbox;
    } else {
        bbox.setBounds(bounds);
    }
}

/**
 * Synchronizes markers with the current points.
 * @param {L.LatLng[]} pts - Array of points.
 * @param {L.FeatureGroup} layer - The marker layer.
 * @param {L.Map} map - The map instance.
 */
function syncMarkers(pts, layer, map) {
    if (AppState.markers.length !== pts.length) {
        layer.clearLayers();
        AppState.markers = pts.map((p, i) => {
            const m = L.marker(p, {
                icon: L.divIcon({
                    className: 'map-point-icon',
                    html: AppState.showVertexNumbers ? i + 1 : '',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                }),
                draggable: true
            }).addTo(layer);

            m.on('dragstart', (e) => {
                AppState.isDraggingPoint = i;
                initMagnifier(map, e.target.getLatLng());
            });
            m.on('dragend', () => {
                AppState.isDraggingPoint = -1;
                hideMagnifier();
                requestRender();
            });

            m.on('drag', e => {
                const latlng = e.target.getLatLng();
                AppState.groundTruth.updatePoint(i, latlng, map);
                updateMagnifier(latlng, map);
                requestRender();
            });
            return m;
        });
        pts.forEach((p, i) => {
            if (AppState.isDraggingPoint !== i) {
                AppState.markers[i].setLatLng(p);
            }
        });
    }
}

/**
 * Synchronizes overlay handles (move and rotate) on the comparison map.
 * @param {L.Map} map - The comparison map.
 * @param {L.FeatureGroup} layer - The handles layer.
 * @param {number} mapId - Map ID (1 or 2).
 */
function syncOverlayHandles(map, layer, mapId) {
    const handles = mapId === 1 ? h1 : h2;
    const offsetDist = 80; // Constant radius in screenview space (px)

    if (!AppState.groundTruth) {
        if (handles.move) { layer.clearLayers(); handles.move = handles.rotate = handles.line = null; }
        return;
    }

    const center = AppState.groundTruth.comparison_anchor;

    // 1. Move Handle (Center)
    if (!handles.move) {
        handles.move = L.marker(center, {
            draggable: true,
            icon: L.divIcon({
                className: 'handle-icon handle-move',
                html: '<img src="images/svgs/move.svg">',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        }).addTo(layer);

        handles.move.on('dragstart', () => {
            AppState.isDragging = true;
        });
        handles.move.on('dragend', () => {
            AppState.isDragging = false;
            AppState.isDragEnd = true;
            setTimeout(() => AppState.isDragEnd = false, 100);
            requestRender();
        });
        handles.move.on('drag', e => {
            const latlng = e.target.getLatLng();
            AppState.groundTruth.setOverlayPosition(latlng);
            renderAll();
        });
    } else {
        if (!AppState.isDragging) handles.move.setLatLng(center);
    }

    // 2. Rotation Handle Calculation
    const mapZoom = map.getZoom();
    const centerPx = map.project(center, mapZoom);
    const rot = AppState.groundTruth.overlayRotation;

    // Calculate position on circle at current rotation
    const rx = Math.sin(rot) * offsetDist;
    const ry = -Math.cos(rot) * offsetDist;
    const handlePos = map.unproject(centerPx.add(L.point(rx, ry)), mapZoom);

    // 3. Rotation Handle
    if (!handles.rotate) {
        handles.rotate = L.marker(handlePos, {
            draggable: true,
            icon: L.divIcon({
                className: 'handle-icon handle-rotate',
                html: '<img src="images/svgs/rotate.svg">',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        }).addTo(layer);

        handles.rotate.on('dragstart', () => {
            AppState.isRotating = true;
        });
        handles.rotate.on('dragend', () => {
            AppState.isRotating = false;
            AppState.isDragEnd = true;
            setTimeout(() => AppState.isDragEnd = false, 100);
            requestRender();
        });

        handles.rotate.on('drag', e => {
            const latlng = e.target.getLatLng();
            const c = AppState.groundTruth.comparison_anchor;
            const cPx = map.project(c, map.getZoom());
            const mPx = map.project(e.target.getLatLng(), map.getZoom());

            // Calculate angle from center to mouse
            const angle = Math.atan2(mPx.y - cPx.y, mPx.x - cPx.x);

            // Constrain the handle position to the circle during drag
            const dx = Math.cos(angle) * offsetDist;
            const dy = Math.sin(angle) * offsetDist;
            const constrainedLatLng = map.unproject(cPx.add(L.point(dx, dy)), map.getZoom());
            e.target.setLatLng(constrainedLatLng);

            AppState.groundTruth.setOverlayRotation(angle + Math.PI / 2);
            renderAll();
        });
    } else {
        // Update position to stay on circle relative to center & rotation
        if (!AppState.isRotating) handles.rotate.setLatLng(handlePos);
    }

    // 4. Connector Line
    const linePts = [center, handlePos];
    if (!handles.line) {
        handles.line = L.polyline(linePts, {
            color: getCssVar('--accent-yellow'),
            weight: 2,
            dashArray: '5, 5',
            opacity: 0.6,
            interactive: false
        }).addTo(layer);
    } else {
        handles.line.setLatLngs(linePts);
    }
}

// --- Value Calculation & Formatting ---

/**
 * Calculates the value (distance or area) from a set of points.
 * @param {L.LatLng[]} pts - Array of points.
 * @returns {number} The calculated value in meters or square meters.
 */
function getVal(pts) {
    if (pts.length < 2) return 0;
    if (AppState.mode === 'area') {
        const ref = pts[0];
        const loc = pts.map(p => ({ x: p.distanceTo(L.latLng(p.lat, ref.lng)) * (p.lng > ref.lng ? 1 : -1), y: p.distanceTo(L.latLng(ref.lat, p.lng)) * (p.lat > ref.lat ? 1 : -1) }));
        let a = 0; for (let i = 0; i < loc.length; i++) { let j = (i + 1) % loc.length; a += loc[i].x * loc[j].y - loc[j].x * loc[i].y; }
        return Math.abs(a) / 2;
    }
    let d = 0; for (let i = 0; i < pts.length - 1; i++) d += pts[i].distanceTo(pts[i + 1]);
    return d;
}

/**
 * Formats a numeric value into a human-readable string.
 * @param {number} v - The value to format.
 * @returns {string} The formatted value with appropriate units.
 */
function format(v) {
    if (v === 0) return '---';
    const isM = AppState.units === 'metric';
    if (AppState.mode === 'area') {
        if (isM) {
            return v >= 1e6 ? (v / 1e6).toFixed(2) + ' km2' : v.toFixed(0) + ' m2';
        } else {
            const yd2 = v * 1.19599;
            return yd2 >= 3097600 ? (v * 3.861e-7).toFixed(2) + ' mi2' : yd2.toFixed(0) + ' yd2';
        }
    } else {
        if (isM) {
            return v >= 1000 ? (v / 1000).toFixed(2) + ' km' : v.toFixed(0) + ' m';
        } else {
            const yd = v * 1.09361;
            return yd >= 1760 ? (v * 0.000621371).toFixed(2) + ' mi' : yd.toFixed(0) + ' yd';
        }
    }
}

/**
 * Centers both maps on their respective shapes.
 */
function centerShapes() {
    if (!AppState.groundTruth) return;
    const pts1 = AppState.groundTruth.getRenderPoints(map1, 1);
    const pts2 = AppState.groundTruth.getRenderPoints(map2, 2);

    const bounds1 = L.latLngBounds(pts1);
    const bounds2 = L.latLngBounds(pts2);

    map1.fitBounds(bounds1, { padding: [80, 80], animate: true });
    map2.fitBounds(bounds2, { padding: [80, 80], animate: true });
}

/**
 * Determines the insertion index for a new point based on click position.
 * @param {L.LatLng} latlng - The click position.
 * @param {L.Map} m - The map instance.
 * @returns {number} The insertion index (-1 if not inserting).
 */
function getInsertIndex(latlng, m) {
    const shape = AppState.groundTruth;
    if (!shape || shape.localPoints.length < 2) return -1;
    const pts = shape.getRenderPoints(m, shape.origin_map);
    const clickPx = m.latLngToLayerPoint(latlng);
    let minDist = Infinity;
    let index = -1;
    const threshold = 15;
    const isArea = AppState.mode === 'area';
    const limit = isArea ? pts.length : pts.length - 1;
    for (let i = 0; i < limit; i++) {
        const p1 = m.latLngToLayerPoint(pts[i]);
        const p2 = m.latLngToLayerPoint(pts[(i + 1) % pts.length]);
        const closest = L.LineUtil.closestPointOnSegment(clickPx, p1, p2);
        const dist = clickPx.distanceTo(closest);
        if (dist < threshold && dist < minDist) {
            minDist = dist;
            index = i + 1;
        }
    }
    return index;
}

// --- Map Click Events ---

[map1, map2].forEach((m, i) => {
    m.on('click', e => {
        if (AppState.isDragEnd || AppState.isDragging || AppState.isRotating) return;

        if (!AppState.groundTruth) {
            AppState.init(e.latlng, i + 1);
        } else {
            const latlng = e.latlng;
            if (AppState.groundTruth.origin_map === (i + 1)) {
                // Origin map: Add or insert a new point
                const idx = getInsertIndex(latlng, m);
                AppState.groundTruth.addPoint(latlng, m, idx);
            } else {
                // Comparison map: Reposition the entire shape reference
                AppState.groundTruth.setOverlayPosition(latlng);
            }
        }
        requestRender(); AppState.updateUI();
    });
    m.on('viewreset move', () => requestRender());
});

// --- UI Functions ---

/**
 * Toggles the search control for a specific map.
 * @param {number} id - Map ID (1 or 2).
 */
function toggleSearch(id) {
    const ctrl = DOM.searchCtrl[id];
    const resDiv = DOM.searchResults[id];
    const input = DOM.searchIn[id];

    ctrl.classList.toggle('expanded');

    if (ctrl.classList.contains('expanded')) {
        input.focus();
    } else {
        resDiv.style.display = 'none';
        DOM.resultsList[id].textContent = '';
        input.value = '';
    }
}

/**
 * Toggles the layer dropdown menu.
 */
function toggleLayerMenu() {
    const isShowing = DOM.layerMenu.classList.contains('show');
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    if (!isShowing) {
        DOM.layerMenu.classList.add('show');
        DOM.layerBtn.classList.add('active');
    } else {
        DOM.layerMenu.classList.remove('show');
        DOM.layerBtn.classList.remove('active');
    }
}

/**
 * Toggles a modal's visibility.
 * @param {string} id - The modal element ID.
 * @param {boolean} s - True to show, false to hide.
 */
function toggleModal(id, s) {
    const modal = { 'share-modal': DOM.shareModal, 'settings-modal': DOM.settingsModal, 'info-modal': DOM.infoModal }[id];
    if (modal) modal.classList.toggle('show', s);
}

// --- Share State Encoding/Decoding ---

/**
 * Share Data Binary Format (Version 1)
 * URL-safe base64 encoded binary blob
 *
 * Byte Layout:
 * [0]     - Version (0x01)
 * [1]     - Flags byte:
 *           Bits 0-1: Layer (0=hybrid, 1=satellite, 2=streets)
 *           Bit 2:    Mode (0=line, 1=area)
 *           Bit 3:    Units (0=metric, 1=imperial)
 *           Bit 4:    Vertex Numbers (0=off, 1=on)
 *           Bit 5:    Bounding Box (0=off, 1=on)
 *           Bits 6-7: Reserved
 * [2-9]   - Reserved buffer (8 bytes for future settings)
 * [10-17] - Map 1 State: lat (f32), lng (f32), zoom*100 (u16)
 * [18-25] - Map 2 State: lat (f32), lng (f32), zoom*100 (u16)
 * [26]    - Has Shape flag (0=no shape, 1=has shape)
 * [27+]   - Shape Data (if present):
 *           [0]    - Origin map (1 or 2)
 *           [1-8]  - Origin anchor: lat (f32), lng (f32)
 *           [9-16] - Comparison anchor: lat (f32), lng (f32)
 *           [17-20]- Rotation (f32 radians)
 *           [21-22]- Point count (u16)
 *           [23+ ] - Points: x (f32), y (f32) each
 */

/**
 * Manages encoding and decoding of application state for sharing.
 * @namespace
 */
const ShareState = {
    /**
     * Binary helper object for encoding/decoding.
     * @type {Object}
     */
    Bin: {
        /** @type {number[]} Write buffer. */
        w: [],
        /** @type {DataView} DataView for float conversion. */
        dV: new DataView(new ArrayBuffer(8)),
        /** @type {Uint8Array|null} Read buffer. */
        r_u8: null,
        /** @type {number} Read index. */
        r_idx: 0,

        /** Resets the write buffer. */
        reset() { this.w = []; },

        /**
         * Writes an unsigned 8-bit value.
         * @param {number} v - Value to write.
         */
        wU8(v) { this.w.push(v & 0xFF); },

        /**
         * Writes an unsigned 16-bit value (big-endian).
         * @param {number} v - Value to write.
         */
        wU16(v) { this.w.push((v >> 8) & 0xFF, v & 0xFF); },

        /**
         * Writes a 32-bit float (big-endian).
         * @param {number} v - Value to write.
         */
        wF32(v) {
            this.dV.setFloat32(0, v);
            this.w.push(this.dV.getUint8(0), this.dV.getUint8(1), this.dV.getUint8(2), this.dV.getUint8(3));
        },

        /**
         * Initializes the read buffer.
         * @param {Uint8Array} u8 - Uint8Array to read from.
         */
        initRead(u8) { this.r_u8 = u8; this.r_idx = 0; },

        /**
         * Reads an unsigned 8-bit value.
         * @returns {number} The read value.
         */
        rU8() { return this.r_u8[this.r_idx++]; },

        /**
         * Reads an unsigned 16-bit value (big-endian).
         * @returns {number} The read value.
         */
        rU16() {
            const v = (this.r_u8[this.r_idx] << 8) | this.r_u8[this.r_idx + 1];
            this.r_idx += 2;
            return v;
        },

        /**
         * Reads a 32-bit float (big-endian).
         * @returns {number} The read value.
         */
        rF32() {
            this.dV.setUint8(0, this.r_u8[this.r_idx]); this.dV.setUint8(1, this.r_u8[this.r_idx + 1]);
            this.dV.setUint8(2, this.r_u8[this.r_idx + 2]); this.dV.setUint8(3, this.r_u8[this.r_idx + 3]);
            this.r_idx += 4; return this.dV.getFloat32(0);
        },

        /**
         * Converts write buffer to URL-safe base64.
         * @returns {string} Base64 encoded string.
         */
        toB64() {
            const u8 = new Uint8Array(this.w);
            let bin = '';
            for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
            return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        },

        /**
         * Decodes URL-safe base64 to Uint8Array.
         * @param {string} str - Base64 string.
         * @returns {Uint8Array} Decoded bytes.
         */
        fromB64(str) {
            str = str.replace(/-/g, '+').replace(/_/g, '/');
            while (str.length % 4) str += '=';
            const bin = atob(str);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            return u8;
        }
    },

    /**
     * Encodes the current application state.
     * @returns {string|null} Base64 encoded state or null on error.
     */
    encode() {
        try {
            this.Bin.reset();
            // 1. Version (0x01)
            this.Bin.wU8(1);

            // 2. Flags
            let lIdx = layerOrder.indexOf(document.getElementById('layerMenu').dataset.active);
            if (lIdx === -1) lIdx = 0;
            const mBit = AppState.mode === 'area' ? 1 : 0;
            const uBit = AppState.units === 'imperial' ? 1 : 0;
            const vBit = AppState.showVertexNumbers ? 1 : 0;
            const bBit = AppState.showBoundingBox ? 1 : 0;

            const flags = (lIdx & 0x03) | ((mBit & 1) << 2) | ((uBit & 1) << 3) | ((vBit & 1) << 4) | ((bBit & 1) << 5);
            this.Bin.wU8(flags);

            // 3. Reserved buffer (8 bytes for future settings)
            for (let i = 0; i < 8; i++) {
                this.Bin.wU8(0);
            }

            // 4. Map 1 State
            const c1 = map1.getCenter();
            this.Bin.wF32(c1.lat); this.Bin.wF32(c1.lng);
            this.Bin.wU16(Math.round(map1.getZoom() * 100));

            // 5. Map 2 State
            const c2 = map2.getCenter();
            this.Bin.wF32(c2.lat); this.Bin.wF32(c2.lng);
            this.Bin.wU16(Math.round(map2.getZoom() * 100));

            // 6. Shape Data
            if (AppState.groundTruth) {
                this.Bin.wU8(1); // Has shape
                const gt = AppState.groundTruth;
                this.Bin.wU8(gt.origin_map);
                this.Bin.wF32(gt.origin_anchor.lat); this.Bin.wF32(gt.origin_anchor.lng);
                this.Bin.wF32(gt.comparison_anchor.lat); this.Bin.wF32(gt.comparison_anchor.lng);
                this.Bin.wF32(gt.overlayRotation);
                this.Bin.wU16(gt.localPoints.length);
                gt.localPoints.forEach(p => {
                    this.Bin.wF32(p.x); this.Bin.wF32(p.y);
                });
            } else {
                this.Bin.wU8(0); // No shape
            }

            return this.Bin.toB64();
        } catch (e) {
            console.error("Encoding error:", e);
            return null;
        }
    },

    /**
     * Decodes and applies a shared state string.
     * @param {string} str - Base64 encoded state.
     */
    decode(str) {
        try {
            const u8 = this.Bin.fromB64(str);
            this.Bin.initRead(u8);

            const ver = this.Bin.rU8();
            if (ver !== 1) { console.warn("Unsupported state version:", ver); return; }

            const flags = this.Bin.rU8();
            const lIdx = flags & 0x03;
            const mBit = (flags >> 2) & 1;
            const uBit = (flags >> 3) & 1;
            const vBit = (flags >> 4) & 1;
            const bBit = (flags >> 5) & 1;

            // Skip reserved buffer (8 bytes for future settings)
            for (let i = 0; i < 8; i++) this.Bin.rU8();

            // Apply Settings
            const layerName = layerOrder[lIdx] || 'hybrid';
            AppState.setLayer(layerName);
            AppState.setMode(mBit === 1 ? 'area' : 'line');
            if ((uBit === 1 && AppState.units === 'metric') || (uBit === 0 && AppState.units === 'imperial')) AppState.toggleUnits();
            if ((vBit === 1 && !AppState.showVertexNumbers) || (vBit === 0 && AppState.showVertexNumbers)) AppState.toggleVertexNumbers();
            if ((bBit === 1 && !AppState.showBoundingBox) || (bBit === 0 && AppState.showBoundingBox)) AppState.toggleBoundingBox();

            // Map 1
            const lat1 = this.Bin.rF32(); const lng1 = this.Bin.rF32();
            const z1 = this.Bin.rU16() / 100;
            map1.setView([lat1, lng1], z1, { animate: false });

            // Map 2
            const lat2 = this.Bin.rF32(); const lng2 = this.Bin.rF32();
            const z2 = this.Bin.rU16() / 100;
            map2.setView([lat2, lng2], z2, { animate: false });

            // Shape
            const hasShape = this.Bin.rU8();
            if (hasShape === 1) {
                const om = this.Bin.rU8();
                const oaLat = this.Bin.rF32(); const oaLng = this.Bin.rF32();
                const caLat = this.Bin.rF32(); const caLng = this.Bin.rF32();
                const rot = this.Bin.rF32();
                const count = this.Bin.rU16();

                AppState.clear();
                AppState.init([oaLat, oaLng], om);

                const gt = AppState.groundTruth;
                gt.comparison_anchor = L.latLng(caLat, caLng);
                gt.overlayRotation = rot;

                // Read points
                gt.localPoints = [];
                for (let i = 0; i < count; i++) {
                    const x = this.Bin.rF32();
                    const y = this.Bin.rF32();
                    gt.localPoints.push(L.point(x, y));
                }

                requestRender();
                AppState.updateUI();
            } else {
                AppState.clear();
            }

        } catch (e) {
            console.error("Decoding error:", e);
        }
    }
};

/**
 * Shares the current view by encoding state and opening share dialog.
 */
function shareCurrentView() {
    const code = ShareState.encode();
    if (!code) return;

    const url = new URL(window.location.href);
    url.searchParams.set('s', code);
    const strUrl = url.toString();

    // Update local history so we don't lose state on refresh
    window.history.replaceState({}, '', strUrl);

    // Strict detection: if it's mobile AND has navigator.share, ONLY use that.
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        window.matchMedia("(max-width: 768px)").matches;

    if (isMobile) {
        if (navigator.share) {
            navigator.share({ title: 'Sync View', url: strUrl }).catch(() => { });
        } else {
            // Mobile fallback: just copy the link
            copyToClipboard(strUrl);
        }
        return;
    }

    // Desktop logic: show custom QR/copy modal
    openShareModal(strUrl);
}

/**
 * Opens the share modal with QR code.
 * @param {string} url - The URL to share.
 */
function openShareModal(url) {
    toggleModal('share-modal', true);
    if (DOM.shareUrl) DOM.shareUrl.innerText = url;

    if (DOM.qrcode) {
        DOM.qrcode.textContent = '';
        DOM.qrLoading.classList.remove('hidden');
        DOM.qrError.classList.add('hidden');

        setTimeout(() => {
            try {
                new QRCode(DOM.qrcode, {
                    text: url,
                    width: 200,
                    height: 200,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.M
                });
                DOM.qrLoading.classList.add('hidden');
            } catch (e) {
                DOM.qrLoading.classList.add('hidden');
                DOM.qrError.classList.remove('hidden');
            }
        }, 50);
    }

    if (DOM.btnCopyLink) {
        DOM.btnCopyLink.onclick = () => {
            copyToClipboard(url);
            const span = DOM.btnCopyLink.querySelector('span');
            if (span) {
                const originalText = span.innerText;
                span.innerText = 'COPIED!';
                setTimeout(() => {
                    span.innerText = originalText;
                    toggleModal('share-modal', false);
                }, 1000);
            }
        };
    }
}

/**
 * Copies text to the clipboard.
 * @param {string} text - The text to copy.
 */
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(fallbackCopy);
    } else {
        fallbackCopy();
    }

    function fallbackCopy() {
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        try { document.execCommand('copy') } catch (e) { }
        document.body.removeChild(el);
    }
}

// --- Global Event Listeners ---

// Global click to close dropdowns
window.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-container')) {
        document.getElementById('layerMenu').classList.remove('show');
        document.getElementById('layerBtn').classList.remove('active');
    }
    // Close search if clicked outside its wrapper
    [1, 2].forEach(id => {
        const ctrl = document.getElementById(`search-ctrl${id}`);
        if (!ctrl || !ctrl.classList.contains('expanded')) return;
        const wrapper = ctrl.closest('.search-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            toggleSearch(id);
        }
    });
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
    const target = e.target.tagName.toLowerCase();
    const isInput = target === 'input' || target === 'textarea';

    if (e.key === 'Escape') {
        let searchWasOpen = false;
        [1, 2].forEach(id => {
            const ctrl = document.getElementById(`search-ctrl${id}`);
            if (ctrl && ctrl.classList.contains('expanded')) {
                toggleSearch(id);
                searchWasOpen = true;
            }
        });
        if (searchWasOpen) return;

        const openModal = document.querySelector('.modal-overlay.show');
        if (openModal) {
            toggleModal(openModal.id, false);
            return;
        }

        if (!isInput) AppState.clear();
        else e.target.blur();
        return;
    }

    if (isInput) return;
    if (e.key.toLowerCase() === 'l') AppState.setMode('line');
    if (e.key.toLowerCase() === 'a') AppState.setMode('area');
    if (e.key.toLowerCase() === 'u') AppState.toggleUnits();
    if (e.key.toLowerCase() === 'v') AppState.toggleVertexNumbers();
    if (e.key.toLowerCase() === 'b') AppState.toggleBoundingBox();
    if (e.key === 'Delete' || e.key === 'Backspace') AppState.removeLast();
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        AppState.removeLast();
    }
});

// --- Search Functionality ---

/**
 * Handles search input and fetches results from Photon API.
 * @param {Event} e - The input event.
 * @param {number} id - Map ID (1 or 2).
 */
async function handleSearch(e, id) {
    const q = e.target.value.trim();
    const resDiv = DOM.searchResults[id];
    const listDiv = DOM.resultsList[id];
    const sSearching = DOM.searchStatus.searching[id];
    const sNone = DOM.searchStatus.none[id];
    const sError = DOM.searchStatus.error[id];

    const hideStatus = () => {
        sSearching.classList.add('hidden');
        sNone.classList.add('hidden');
        sError.classList.add('hidden');
    };

    if (q.length < 2) {
        resDiv.style.display = 'none';
        listDiv.textContent = '';
        hideStatus();
        return;
    }

    listDiv.textContent = '';
    hideStatus();
    sSearching.classList.remove('hidden');
    resDiv.style.display = 'flex';

    try {
        const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`);
        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();
        hideStatus();

        if (!data.features || data.features.length === 0) {
            sNone.classList.remove('hidden');
            return;
        }

        data.features.forEach(feature => {
            const p = feature.properties;
            const coords = feature.geometry.coordinates;

            const nameParts = [p.name, p.street, p.city, p.country].filter(Boolean);
            const uniqueParts = [...new Set(nameParts)];
            const label = uniqueParts.join(', ');

            const d = document.createElement('div');
            d.className = 'result-item';
            d.textContent = label;
            d.onclick = () => {
                (id === 1 ? map1 : map2).setView([coords[1], coords[0]], 15);
                toggleSearch(id);
            };
            listDiv.appendChild(d);
        });
    } catch (err) {
        console.error('Search error:', err);
        hideStatus();
        sError.classList.remove('hidden');
    }
}

/**
 * Debounced search function to limit API calls.
 * @type {Function}
 */
const debouncedSearch = ((fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; })(handleSearch, 400);

// --- Magnifier (Lens) Functions ---

/**
 * Initializes the magnifier lens at a specific location.
 * @param {L.Map} sourceMap - The map where the lens is activated.
 * @param {L.LatLng} latlng - The center position for the lens.
 */
function initMagnifier(sourceMap, latlng) {
    if (!AppState.showLens) return;
    DOM.magnifier.style.display = 'block';

    if (!AppState.magnifierMap) {
        AppState.magnifierMap = L.map('magnifier', {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            inertia: false
        });
        const currentLayer = DOM.layerMenu.dataset.active || 'hybrid';
        AppState.magnifierTile = L.tileLayer(tiles[currentLayer], { ...tileOptions }).addTo(AppState.magnifierMap);
    }

    AppState.magnifierMap.invalidateSize({ pan: false });

    const currentLayer = DOM.layerMenu.dataset.active || 'hybrid';
    AppState.magnifierTile.setUrl(tiles[currentLayer]);

    const targetZoom = Math.min(sourceMap.getZoom() + 2, 22);
    AppState.magnifierMap.setView(latlng, targetZoom, { animate: false });
    updateMagnifier(latlng, sourceMap);
}

/**
 * Updates the magnifier position and zoom level.
 * @param {L.LatLng} latlng - The center position.
 * @param {L.Map} sourceMap - The source map for coordinate conversion.
 */
function updateMagnifier(latlng, sourceMap) {
    if (!AppState.showLens || !AppState.magnifierMap) return;
    const p = sourceMap.latLngToContainerPoint(latlng);
    const mapRect = sourceMap.getContainer().getBoundingClientRect();
    const globalX = p.x + mapRect.left;
    const globalY = p.y + mapRect.top;
    const lensSize = 140;
    DOM.magnifier.style.left = (globalX - lensSize / 2) + 'px';
    DOM.magnifier.style.top = (globalY - lensSize - AppState.lensOffset) + 'px';
    const targetZoom = Math.min(sourceMap.getZoom() + 2, 22);
    AppState.magnifierMap.setView(latlng, targetZoom, { animate: false });
}

/**
 * Hides the magnifier lens.
 */
function hideMagnifier() {
    DOM.magnifier.style.display = 'none';
}

// --- Device Location ---

/**
 * Locates the user's device and centers the specified map on their position.
 * @param {number} id - Map ID (1 or 2).
 */
function locateDevice(id) {
    const btn = DOM.locateBtn[id];
    if (btn) btn.classList.add('loading');
    navigator.geolocation.getCurrentPosition(
        p => {
            (id === 1 ? map1 : map2).setView([p.coords.latitude, p.coords.longitude], 15);
            if (btn) btn.classList.remove('loading');
        },
        err => {
            console.error(err);
            if (btn) btn.classList.remove('loading');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// --- Initialization ---

/**
 * Initializes the application on window load.
 * Decodes shared state from URL if present.
 */
window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('s');
    if (code) {
        setTimeout(() => ShareState.decode(code), 100);
    }
});

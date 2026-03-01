/**
 * @fileoverview Main JavaScript file for Sync View - A dual-map comparison tool
 * for measuring distances and areas between locations.
 */

// --- Constants ---

/**
 * Application configuration constants.
 * @namespace CONFIG
 */
const CONFIG = {
    DEBOUNCE_DELAY: 400,
    ROTATE_HANDLE_OFFSET: 80,
    LENS_SIZE: 140,
    LENS_OFFSET: 40,
    INSERT_THRESHOLD: 15,
    MAX_ZOOM: 22,
    REF_ZOOM: 20,
    PADDING: [80, 80],
    DEFAULT_CENTER_ZOOM: 13,
    GEOLOCATION_ZOOM: 15,
    SEARCH_ZOOM: 15,
};

/**
 * Tile layer URLs for different map styles.
 * @type {Object.<string, string>}
 */
const tiles = {
    hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    satellite: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    streets: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
};

/**
 * Layer order array for cycling through tile styles.
 * @type {string[]}
 */
const layerOrder = Object.keys(tiles);

/**
 * Gets a CSS custom property value.
 * @param {string} name - CSS variable name.
 * @returns {string} The CSS variable value.
 */
const getCssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// --- Shape Class ---

/**
 * Represents a geometric shape spanning two synchronized maps.
 * Stores local points relative to an origin anchor and manages positioning
 * on both origin and comparison maps with rotation support.
 */
class Shape {
    /**
     * Creates a new Shape.
     * @param {L.LatLng|number[]} anchor - Origin anchor point [lat, lng].
     * @param {number} originMapId - Map ID where shape was created (1 or 2).
     * @param {L.LatLng|number[]} initialCompAnchor - Initial comparison anchor.
     */
    constructor(anchor, originMapId, initialCompAnchor) {
        this.origin_map = originMapId;
        this.origin_anchor = L.latLng(anchor);
        this.comparison_anchor = L.latLng(initialCompAnchor);
        this.localPoints = [L.point(0, 0)];
        this.overlayRotation = 0;
    }

    /**
     * Calculates the centroid of the shape's local points.
     * @returns {L.Point} The centroid point.
     */
    getCentroid() {
        if (this.localPoints.length === 0) return L.point(0, 0);
        let x = 0, y = 0;
        this.localPoints.forEach(p => { x += p.x; y += p.y; });
        return L.point(x / this.localPoints.length, y / this.localPoints.length);
    }

    /**
     * Shifts the comparison anchor based on centroid change and rotation.
     * @param {L.Map} map - Leaflet map instance.
     * @param {L.Point} oldCentroid - Previous centroid.
     * @param {L.Point} newCentroid - New centroid.
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
     * Adds a point to the shape.
     * @param {L.LatLng} latlng - Point coordinates.
     * @param {L.Map} map - Leaflet map instance.
     * @param {number} [index=-1] - Insertion index, -1 to append.
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
     * @param {number} index - Point index to update.
     * @param {L.LatLng} newLatLng - New coordinates.
     * @param {L.Map} map - Leaflet map instance.
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
     * @param {L.Map} map - Leaflet map instance.
     */
    removeLastPoint(map) {
        if (this.localPoints.length === 0) return;
        const c1 = this.getCentroid();
        this.localPoints.pop();
        if (this.localPoints.length === 0) return;
        this.shiftComparisonAnchor(map, c1, this.getCentroid());
    }

    /**
     * Gets rendered points for a specific map with rotation applied.
     * @param {L.Map} targetMap - Target Leaflet map.
     * @param {number} targetMapId - Target map ID (1 or 2).
     * @returns {L.LatLng[]} Array of rendered points.
     */
    getRenderPoints(targetMap, targetMapId) {
        const currentZoom = targetMap.getZoom();
        const scale = Math.pow(2, currentZoom - AppState.REF_ZOOM);

        if (targetMapId === this.origin_map) {
            const anchorPx = targetMap.project(this.origin_anchor, currentZoom);
            return this.localPoints.map(p => targetMap.unproject(anchorPx.add(p.multiplyBy(scale)), currentZoom));
        }

        const centroid = this.getCentroid();
        const anchorPx = targetMap.project(this.comparison_anchor, currentZoom);
        const rot = this.overlayRotation;
        const sin = Math.sin(rot);
        const cos = Math.cos(rot);

        return this.localPoints.map(p => {
            const cx = (p.x - centroid.x) * scale;
            const cy = (p.y - centroid.y) * scale;
            const rx = cx * cos - cy * sin;
            const ry = cx * sin + cy * cos;
            return targetMap.unproject(anchorPx.add(L.point(rx, ry)), currentZoom);
        });
    }

    /**
     * Sets the overlay position on the comparison map.
     * @param {L.LatLng} latlng - New anchor position.
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

// --- Map Manager Class ---

/**
 * Manages map layers, shapes, and handles for a single map instance.
 * Consolidates feature groups, persistent references, and rendering logic.
 */
class MapManager {
    /**
     * Creates a MapManager for a map.
     * @param {number} id - Map ID (1 or 2).
     * @param {L.Map} map - Leaflet map instance.
     */
    constructor(id, map) {
        this.id = id;
        this.map = map;
        this.layers = {
            shapes: L.featureGroup().addTo(map),
            markers: L.featureGroup().addTo(map),
            bbox: L.featureGroup().addTo(map),
            handles: L.featureGroup().addTo(map)
        };
        this.refs = { shape: null, casing: null, bbox: null, handles: { move: null, rotate: null, line: null } };
    }

    /**
     * Clears all layers and resets references.
     */
    clear() {
        Object.values(this.layers).forEach(l => l.clearLayers());
        this.refs = { shape: null, casing: null, bbox: null, handles: { move: null, rotate: null, line: null } };
    }

    /**
     * Updates the shape visualization on the map.
     * @param {L.LatLng[]} pts - Points to render.
     * @param {string} color - Stroke/fill color.
     * @param {boolean} isArea - Whether to render as polygon (area) or polyline.
     * @param {number} weight - Line weight in pixels.
     */
    updateShape(pts, color, isArea, weight) {
        if (pts.length < 2) return;
        const factory = isArea ? L.polygon : L.polyline;
        const { shapes } = this.layers;
        let { shape, casing } = this.refs;

        if (!shape || (isArea && !(shape instanceof L.Polygon)) || (!isArea && shape instanceof L.Polygon)) {
            shapes.clearLayers();
            casing = factory(pts, { color: getCssVar('--shape-outline-color'), weight: weight * 2, fill: false, opacity: 1, interactive: false }).addTo(shapes);
            shape = factory(pts, { color, weight, fill: isArea, fillColor: color, fillOpacity: 0.25, opacity: 1, interactive: false }).addTo(shapes);
            this.refs.shape = shape;
            this.refs.casing = casing;
        } else {
            shape.setLatLngs(pts);
            casing.setLatLngs(pts);
            shape.setStyle({ color, fillColor: color });
        }
    }

    /**
     * Updates the bounding box rectangle.
     * @param {L.LatLng[]} pts - Points to bound.
     */
    updateBBox(pts) {
        if (pts.length < 2) return;
        const { bbox } = this.layers;
        let { bbox: bboxRect } = this.refs;
        const bounds = L.latLngBounds(pts);

        if (!bboxRect) {
            bboxRect = L.rectangle(bounds, { color: getCssVar('--bbox-color'), weight: parseFloat(getCssVar('--bbox-width')) || 1.5, dashArray: '5, 5', fill: false, interactive: false }).addTo(bbox);
            this.refs.bbox = bboxRect;
        } else {
            bboxRect.setBounds(bounds);
        }
    }
}

// --- Map Configuration ---

/**
 * Default map options for both map instances.
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

/**
 * First map instance (origin map).
 * @type {L.Map}
 */
const map1 = L.map('map1', mapOptions).setView([51.505, -0.09], CONFIG.DEFAULT_CENTER_ZOOM);

/**
 * Second map instance (comparison map).
 * @type {L.Map}
 */
const map2 = L.map('map2', mapOptions).setView([40.7128, -74.0060], CONFIG.DEFAULT_CENTER_ZOOM);

/**
 * Map manager instances for both maps.
 * @type {Object.<number, MapManager>}
 */
const mapManagers = {
    1: new MapManager(1, map1),
    2: new MapManager(2, map2)
};

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
    detectRetina: true,
};

/**
 * Tile layer for map1.
 * @type {L.TileLayer}
 */
let tile1 = L.tileLayer(tiles.hybrid, { ...tileOptions }).addTo(map1);

/**
 * Tile layer for map2.
 * @type {L.TileLayer}
 */
let tile2 = L.tileLayer(tiles.hybrid, { ...tileOptions }).addTo(map2);

// --- Pinch Zoom Synchronization ---

/**
 * Pinch zoom state machine to prevent race conditions.
 * @type {Object}
 */
const PinchState = {
    activeMap: null,
    passiveMap: null,
    passiveBaseZoom: null,
    justEnded: false,

    /**
     * Starts a pinch gesture.
     * @param {L.Map} active - The map being touched.
     * @param {L.Map} passive - The other map.
     */
    start(active, passive) {
        if (this.activeMap) this.end();
        this.activeMap = active;
        this.passiveMap = passive;
        this.passiveBaseZoom = passive.getZoom();
        this.activeMap.on('zoom', this.onZoom);
    },

    /**
     * Handles zoom during active pinch.
     */
    onZoom: () => {
        if (!PinchState.passiveMap) return;
        const scale = Math.pow(2, PinchState.activeMap.getZoom() - PinchState.passiveBaseZoom);
        const size = PinchState.passiveMap.getSize();
        const origin = L.point(size.x / 2, size.y / 2);
        const offset = origin.subtract(origin.multiplyBy(scale));
        L.DomUtil.setTransform(PinchState.passiveMap._mapPane, offset, scale);
    },

    /**
     * Ends the pinch gesture and synchronizes final zoom levels.
     */
    end() {
        if (!PinchState.passiveMap) return;
        PinchState.activeMap.off('zoom', PinchState.onZoom);
        const passive = PinchState.passiveMap;
        const active = PinchState.activeMap;
        L.DomUtil.setTransform(passive._mapPane, L.point(0, 0), 1);
        PinchState.activeMap = null;
        PinchState.passiveMap = null;
        PinchState.passiveBaseZoom = null;
        PinchState.justEnded = true;
        const finalZoom = active.getZoom();
        if (Math.abs(passive.getZoom() - finalZoom) > 0.01) {
            passive.setZoom(finalZoom, { animate: false });
        }
        setTimeout(() => { PinchState.justEnded = false; }, 50);
    }
};

document.getElementById('app-container').addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
        const inMap1 = e.touches[0].target.closest('#map1-wrapper') || e.touches[1].target.closest('#map1-wrapper');
        const active = inMap1 ? map1 : map2;
        const passive = inMap1 ? map2 : map1;
        PinchState.start(active, passive);
    }
}, { passive: true });

document.getElementById('app-container').addEventListener('touchend', () => PinchState.end(), { passive: true });
document.getElementById('app-container').addEventListener('touchcancel', () => PinchState.end(), { passive: true });

// --- Fallback Zoom Sync ---

/**
 * Flag to prevent recursive zoom synchronization.
 * @type {boolean}
 */
let isSyncing = false;

/**
 * Binds zoom synchronization between two maps.
 * @param {L.Map} source - Source map to listen for zoom events.
 * @param {L.Map} target - Target map to sync zoom to.
 */
function bindZoom(source, target) {
    source.on('zoomend', () => {
        if (isSyncing || PinchState.passiveMap || PinchState.justEnded) return;
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
 * @namespace AppState
 */
const AppState = {
    REF_ZOOM: CONFIG.REF_ZOOM,
    groundTruth: null,
    mode: 'line',
    units: 'metric',
    markers: [],
    showVertexNumbers: false,
    showBoundingBox: false,
    isDragging: false,
    isRotating: false,
    isDraggingPoint: -1,
    isDragEnd: false,
    lensOffset: CONFIG.LENS_OFFSET,
    showLens: true,
    magnifierMap: null,
    magnifierTile: null,

    /**
     * Initializes the application state with a new shape.
     * @param {L.LatLng} anchor - Initial anchor point.
     * @param {number} originMapId - Map ID where shape is created (1 or 2).
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
     * Sets the measurement mode (line or area).
     * @param {string} m - Mode to set ('line' or 'area').
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
     * Sets the tile layer for both maps.
     * @param {string} l - Layer key from tiles object.
     */
    setLayer(l) {
        map1.removeLayer(tile1); map2.removeLayer(tile2);
        tile1 = L.tileLayer(tiles[l], { ...tileOptions }).addTo(map1).bringToBack();
        tile2 = L.tileLayer(tiles[l], { ...tileOptions }).addTo(map2).bringToBack();
        map1.invalidateSize({ pan: false }); map2.invalidateSize({ pan: false });
        map1.setView(map1.getCenter(), map1.getZoom(), { animate: false });
        map2.setView(map2.getCenter(), map2.getZoom(), { animate: false });
        DOM.layerMenu.dataset.active = l;
        DOM.dropdownItems.forEach(item => item.classList.toggle('active', item.getAttribute('data-layer') === l));
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
     * Toggles display of vertex numbers on markers.
     */
    toggleVertexNumbers() {
        this.showVertexNumbers = !this.showVertexNumbers;
        DOM.valVertex.textContent = this.showVertexNumbers ? 'On' : 'Off';
        this.markers.forEach((m, idx) => {
            m.setIcon(L.divIcon({ className: 'map-point-icon', html: this.showVertexNumbers ? idx + 1 : '' }));
        });
        requestRender();
    },

    /**
     * Toggles display of bounding box around shapes.
     */
    toggleBoundingBox() {
        this.showBoundingBox = !this.showBoundingBox;
        DOM.valBbox.textContent = this.showBoundingBox ? 'On' : 'Off';
        requestRender();
    },

    /**
     * Clears the current shape and resets state.
     */
    clear() {
        this.groundTruth = null;
        this.markers = [];
        resetLayers();
        requestRender(); this.updateUI();
    },

    /**
     * Removes the last point from the shape or clears if only one point.
     */
    removeLast() {
        if (!this.groundTruth) return;
        if (this.groundTruth.localPoints.length <= 1) {
            this.clear();
        } else {
            const om = this.groundTruth.origin_map;
            const map = om === 1 ? map1 : map2;
            this.groundTruth.removeLastPoint(map);

            if (this.markers.length > 0) {
                const m = this.markers.pop();
                mapManagers[1].layers.markers.removeLayer(m);
                mapManagers[2].layers.markers.removeLayer(m);
            }
            resetLayers();
            requestRender();
            this.updateUI();
        }
    },

    /**
     * Updates the UI based on current state.
     */
    updateUI() {
        const hasGt = !!this.groundTruth;
        const om = hasGt ? this.groundTruth.origin_map : 0;
        [1, 2].forEach(id => {
            const els = DOM.maps[id];
            els.backBtn.classList.toggle('hidden', om !== id);
            els.centerBtn.classList.toggle('hidden', om !== id);
            els.clearBtn.classList.toggle('hidden', om !== id);
            els.card.classList.toggle('visible', hasGt && this.groundTruth.localPoints.length >= 2);
            if (hasGt) {
                const color = getCssVar(om === id ? '--origin-color' : '--comp-color');
                els.stats.style.color = color;
                if (om === id) document.documentElement.style.setProperty('--shape-point-color', color);
            }
        });
    }
};

// --- DOM References ---

/**
 * Centralized DOM element references.
 * @namespace DOM
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
    valUnits: document.getElementById('val-units'),
    valVertex: document.getElementById('val-vertex'),
    valBbox: document.getElementById('val-bbox'),
    dropdownItems: document.querySelectorAll('.dropdown-item'),
    maps: {
        1: {
            stats: document.getElementById('stats1'),
            diff: document.getElementById('diff1'),
            card: document.getElementById('card1'),
            backBtn: document.getElementById('back1'),
            centerBtn: document.getElementById('center-btn1'),
            clearBtn: document.getElementById('clear1'),
            searchCtrl: document.getElementById('search-ctrl1'),
            searchIn: document.getElementById('search-in1'),
            searchResults: document.getElementById('results1'),
            resultsList: document.getElementById('results-list1'),
            searchStatus: {
                searching: document.getElementById('status-searching1'),
                none: document.getElementById('status-none1'),
                error: document.getElementById('status-error1')
            },
            locateBtn: document.getElementById('locate-btn1')
        },
        2: {
            stats: document.getElementById('stats2'),
            diff: document.getElementById('diff2'),
            card: document.getElementById('card2'),
            backBtn: document.getElementById('back2'),
            centerBtn: document.getElementById('center-btn2'),
            clearBtn: document.getElementById('clear2'),
            searchCtrl: document.getElementById('search-ctrl2'),
            searchIn: document.getElementById('search-in2'),
            searchResults: document.getElementById('results2'),
            resultsList: document.getElementById('results-list2'),
            searchStatus: {
                searching: document.getElementById('status-searching2'),
                none: document.getElementById('status-none2'),
                error: document.getElementById('status-error2')
            },
            locateBtn: document.getElementById('locate-btn2')
        }
    }
};

// --- Layer Management ---

/**
 * Resets all map layers and clears markers.
 */
function resetLayers() {
    [1, 2].forEach(id => mapManagers[id].clear());
    AppState.markers = [];
}

// --- Rendering ---

/**
 * Flag to prevent multiple render requests.
 * @type {boolean}
 */
let renderPending = false;

/**
 * Requests a render frame if not already pending.
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
 * Renders all shapes, markers, handles, and updates stats.
 */
function renderAll() {
    if (!AppState.groundTruth) { resetLayers(); return; }

    const gt = AppState.groundTruth;
    const om = gt.origin_map;
    const isArea = AppState.mode === 'area' && gt.localPoints.length > 2;
    const weight = parseInt(getCssVar('--shape-line-width')) || 3;

    const mapData = [1, 2].map(id => {
        const map = id === 1 ? map1 : map2;
        const pts = gt.getRenderPoints(map, id);
        const color = getCssVar(om === id ? '--origin-color' : '--comp-color');
        return { id, map, pts, color };
    });

    mapData.forEach(({ id, pts, color }) => {
        mapManagers[id].updateShape(pts, color, isArea, weight);
    });

    if (AppState.showBoundingBox) {
        mapData.forEach(({ id, pts }) => mapManagers[id].updateBBox(pts));
    } else {
        [1, 2].forEach(id => {
            mapManagers[id].layers.bbox.clearLayers();
            mapManagers[id].refs.bbox = null;
        });
    }

    const originData = mapData.find(d => d.id === om);
    const compData = mapData.find(d => d.id !== om);
    syncMarkers(originData.pts, mapManagers[om].layers.markers, originData.map);
    syncOverlayHandles(compData.map, mapManagers[compData.id].layers.handles, compData.id);

    const [refVal, compVal] = [originData.pts, compData.pts].map(getVal);
    DOM.maps[om].stats.textContent = format(refVal);
    DOM.maps[compData.id].stats.textContent = format(compVal);
    DOM.maps[om].diff.textContent = '';

    if (refVal > 0) {
        const pct = ((compVal - refVal) / refVal) * 100;
        const el = DOM.maps[compData.id].diff;
        el.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
        el.style.color = getCssVar('--comp-color');
    }
}

/**
 * Synchronizes markers with shape points.
 * @param {L.LatLng[]} pts - Points to create markers for.
 * @param {L.FeatureGroup} layer - Layer to add markers to.
 * @param {L.Map} map - Leaflet map instance.
 */
function syncMarkers(pts, layer, map) {
    if (AppState.markers.length !== pts.length) {
        layer.clearLayers();
        AppState.markers.forEach(m => m.off()); // Clear old listeners
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
    }
    pts.forEach((p, i) => {
        if (AppState.isDraggingPoint !== i) {
            AppState.markers[i].setLatLng(p);
        }
    });
}

/**
 * Synchronizes overlay handles (move, rotate) for comparison map.
 * @param {L.Map} map - Leaflet map instance.
 * @param {L.FeatureGroup} layer - Layer to add handles to.
 * @param {number} mapId - Map ID (1 or 2).
 */
function syncOverlayHandles(map, layer, mapId) {
    const mm = mapManagers[mapId];
    const handles = mm.refs.handles;
    const offsetDist = CONFIG.ROTATE_HANDLE_OFFSET;

    if (!AppState.groundTruth) {
        if (handles.move) { layer.clearLayers(); handles.move = handles.rotate = handles.line = null; }
        return;
    }

    const center = AppState.groundTruth.comparison_anchor;

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

        handles.move.on('dragstart', () => AppState.isDragging = true);
        handles.move.on('dragend', () => {
            AppState.isDragging = false;
            AppState.isDragEnd = true;
            setTimeout(() => AppState.isDragEnd = false, 100);
            requestRender();
        });
        handles.move.on('drag', e => {
            AppState.groundTruth.setOverlayPosition(e.target.getLatLng());
            renderAll();
        });
    } else if (!AppState.isDragging) {
        handles.move.setLatLng(center);
    }

    const mapZoom = map.getZoom();
    const centerPx = map.project(center, mapZoom);
    const rot = AppState.groundTruth.overlayRotation;

    const rx = Math.sin(rot) * offsetDist;
    const ry = -Math.cos(rot) * offsetDist;
    const handlePos = map.unproject(centerPx.add(L.point(rx, ry)), mapZoom);

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

        handles.rotate.on('dragstart', () => AppState.isRotating = true);
        handles.rotate.on('dragend', () => {
            AppState.isRotating = false;
            AppState.isDragEnd = true;
            setTimeout(() => AppState.isDragEnd = false, 100);
            requestRender();
        });

        handles.rotate.on('drag', e => {
            const c = AppState.groundTruth.comparison_anchor;
            const cPx = map.project(c, map.getZoom());
            const mPx = map.project(e.target.getLatLng(), map.getZoom());
            const angle = Math.atan2(mPx.y - cPx.y, mPx.x - cPx.x);
            const dx = Math.cos(angle) * offsetDist;
            const dy = Math.sin(angle) * offsetDist;
            e.target.setLatLng(map.unproject(cPx.add(L.point(dx, dy)), map.getZoom()));
            AppState.groundTruth.setOverlayRotation(angle + Math.PI / 2);
            renderAll();
        });
    } else if (!AppState.isRotating) {
        handles.rotate.setLatLng(handlePos);
    }

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
 * Calculates distance or area from a set of points.
 * @param {L.LatLng[]} pts - Array of points.
 * @returns {number} Distance in meters or area in square meters.
 */
function getVal(pts) {
    if (pts.length < 2) return 0;
    if (AppState.mode === 'area') {
        const ref = pts[0];
        const loc = pts.map(p => ({ x: p.distanceTo(L.latLng(p.lat, ref.lng)) * (p.lng > ref.lng ? 1 : -1), y: p.distanceTo(L.latLng(ref.lat, p.lng)) * (p.lat > ref.lat ? 1 : -1) }));
        let a = 0;
        for (let i = 0; i < loc.length; i++) { let j = (i + 1) % loc.length; a += loc[i].x * loc[j].y - loc[j].x * loc[i].y; }
        return Math.abs(a) / 2;
    }
    let d = 0;
    for (let i = 0; i < pts.length - 1; i++) d += pts[i].distanceTo(pts[i + 1]);
    return d;
}

/**
 * Formats a numeric value with appropriate units.
 * @param {number} v - Value to format.
 * @returns {string} Formatted value with units.
 */
function format(v) {
    if (v === 0) return '---';
    const isM = AppState.units === 'metric';
    if (AppState.mode === 'area') {
        if (isM) return v >= 1e6 ? (v / 1e6).toFixed(2) + ' km2' : v.toFixed(0) + ' m2';
        const yd2 = v * 1.19599;
        return yd2 >= 3097600 ? (v * 3.861e-7).toFixed(2) + ' mi2' : yd2.toFixed(0) + ' yd2';
    } else {
        if (isM) return v >= 1000 ? (v / 1000).toFixed(2) + ' km' : v.toFixed(0) + ' m';
        const yd = v * 1.09361;
        return yd >= 1760 ? (v * 0.000621371).toFixed(2) + ' mi' : yd.toFixed(0) + ' yd';
    }
}

/**
 * Centers both maps on their respective shapes.
 */
function centerShapes() {
    if (!AppState.groundTruth) return;
    [1, 2].forEach((id, idx) => {
        const map = id === 1 ? map1 : map2;
        const pts = AppState.groundTruth.getRenderPoints(map, id);
        map.fitBounds(L.latLngBounds(pts), { padding: CONFIG.PADDING, animate: true });
    });
}

/**
 * Finds the best index to insert a new point along an edge.
 * @param {L.LatLng} latlng - Click position.
 * @param {L.Map} m - Leaflet map instance.
 * @returns {number} Insertion index or -1 if no edge nearby.
 */
function getInsertIndex(latlng, m) {
    const shape = AppState.groundTruth;
    if (!shape || shape.localPoints.length < 2) return -1;
    const pts = shape.getRenderPoints(m, shape.origin_map);
    const clickPx = m.latLngToLayerPoint(latlng);
    let minDist = Infinity, index = -1;
    const threshold = CONFIG.INSERT_THRESHOLD;
    const isArea = AppState.mode === 'area';
    const limit = isArea ? pts.length : pts.length - 1;
    for (let i = 0; i < limit; i++) {
        const p1 = m.latLngToLayerPoint(pts[i]);
        const p2 = m.latLngToLayerPoint(pts[(i + 1) % pts.length]);
        const closest = L.LineUtil.closestPointOnSegment(clickPx, p1, p2);
        const dist = clickPx.distanceTo(closest);
        if (dist < threshold && dist < minDist) { minDist = dist; index = i + 1; }
    }
    return index;
}

// --- Map Click Events ---

[map1, map2].forEach((m, i) => {
    m.on('click', e => {
        if (AppState.isDragEnd || AppState.isDragging || AppState.isRotating) return;
        if (!AppState.groundTruth) {
            AppState.init(e.latlng, i + 1);
        } else if (AppState.groundTruth.origin_map === (i + 1)) {
            AppState.groundTruth.addPoint(e.latlng, m, getInsertIndex(e.latlng, m));
        } else {
            AppState.groundTruth.setOverlayPosition(e.latlng);
        }
        requestRender(); AppState.updateUI();
    });
    m.on('viewreset move', () => requestRender());
});

// --- UI Functions ---

/**
 * Toggles the search control for a map.
 * @param {number} id - Map ID (1 or 2).
 */
function toggleSearch(id) {
    const els = DOM.maps[id];
    els.searchCtrl.classList.toggle('expanded');
    if (els.searchCtrl.classList.contains('expanded')) {
        els.searchIn.focus();
    } else {
        els.searchResults.style.display = 'none';
        els.resultsList.textContent = '';
        els.searchIn.value = '';
    }
}

/**
 * Toggles the layer dropdown menu.
 */
function toggleLayerMenu() {
    const isShowing = DOM.layerMenu.classList.contains('show');
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    DOM.layerMenu.classList.toggle('show', !isShowing);
    DOM.layerBtn.classList.toggle('active', !isShowing);
}

/**
 * Toggles a modal's visibility.
 * @param {string} id - Modal ID.
 * @param {boolean} s - Show or hide.
 */
function toggleModal(id, s) {
    const modal = { 'share-modal': DOM.shareModal, 'settings-modal': DOM.settingsModal, 'info-modal': DOM.infoModal }[id];
    if (modal) modal.classList.toggle('show', s);
}

// --- Share State Encoding/Decoding ---

/**
 * Manages encoding/decoding of application state for URL sharing.
 * @namespace ShareState
 */
const ShareState = {
    Bin: {
        /** @type {number[]} */
        w: [],
        /** @type {DataView} */
        dV: new DataView(new ArrayBuffer(8)),
        /** @type {Uint8Array|null} */
        r_u8: null,
        /** @type {number} */
        r_idx: 0,

        reset() { this.w = []; },
        wU8(v) { this.w.push(v & 0xFF); },
        wU16(v) { this.w.push((v >> 8) & 0xFF, v & 0xFF); },
        wF32(v) {
            this.dV.setFloat32(0, v);
            this.w.push(this.dV.getUint8(0), this.dV.getUint8(1), this.dV.getUint8(2), this.dV.getUint8(3));
        },
        initRead(u8) { this.r_u8 = u8; this.r_idx = 0; },
        rU8() { return this.r_u8[this.r_idx++]; },
        rU16() {
            const v = (this.r_u8[this.r_idx] << 8) | this.r_u8[this.r_idx + 1];
            this.r_idx += 2;
            return v;
        },
        rF32() {
            this.dV.setUint8(0, this.r_u8[this.r_idx]); this.dV.setUint8(1, this.r_u8[this.r_idx + 1]);
            this.dV.setUint8(2, this.r_u8[this.r_idx + 2]); this.dV.setUint8(3, this.r_u8[this.r_idx + 3]);
            this.r_idx += 4; return this.dV.getFloat32(0);
        },
        /** Converts buffer to base64 string.
         * @returns {string} Base64 encoded string.
         */
        toB64() {
            const u8 = new Uint8Array(this.w);
            let bin = '';
            for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
            return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        },
        /** Decodes base64 string to Uint8Array.
         * @param {string} str - Base64 string.
         * @returns {Uint8Array} Decoded array.
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
     * Encodes current application state to base64 string.
     * @returns {string|null} Encoded state or null on error.
     */
    encode() {
        try {
            this.Bin.reset();
            this.Bin.wU8(1);

            let lIdx = layerOrder.indexOf(document.getElementById('layerMenu').dataset.active);
            if (lIdx === -1) lIdx = 0;
            const flags = (lIdx & 0x03) |
                ((AppState.mode === 'area' ? 1 : 0) << 2) |
                ((AppState.units === 'imperial' ? 1 : 0) << 3) |
                ((AppState.showVertexNumbers ? 1 : 0) << 4) |
                ((AppState.showBoundingBox ? 1 : 0) << 5);
            this.Bin.wU8(flags);

            for (let i = 0; i < 8; i++) this.Bin.wU8(0);

            const c1 = map1.getCenter();
            this.Bin.wF32(c1.lat); this.Bin.wF32(c1.lng);
            this.Bin.wU16(Math.round(map1.getZoom() * 100));

            const c2 = map2.getCenter();
            this.Bin.wF32(c2.lat); this.Bin.wF32(c2.lng);
            this.Bin.wU16(Math.round(map2.getZoom() * 100));

            if (AppState.groundTruth) {
                this.Bin.wU8(1);
                const gt = AppState.groundTruth;
                this.Bin.wU8(gt.origin_map);
                this.Bin.wF32(gt.origin_anchor.lat); this.Bin.wF32(gt.origin_anchor.lng);
                this.Bin.wF32(gt.comparison_anchor.lat); this.Bin.wF32(gt.comparison_anchor.lng);
                this.Bin.wF32(gt.overlayRotation);
                this.Bin.wU16(gt.localPoints.length);
                gt.localPoints.forEach(p => { this.Bin.wF32(p.x); this.Bin.wF32(p.y); });
            } else {
                this.Bin.wU8(0);
            }

            return this.Bin.toB64();
        } catch (e) {
            console.error("Encoding error:", e);
            return null;
        }
    },

    /**
     * Decodes base64 string and restores application state.
     * @param {string} str - Encoded state string.
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

            for (let i = 0; i < 8; i++) this.Bin.rU8();

            AppState.setLayer(layerOrder[lIdx] || 'hybrid');
            AppState.setMode(mBit === 1 ? 'area' : 'line');
            if ((uBit === 1 && AppState.units === 'metric') || (uBit === 0 && AppState.units === 'imperial')) AppState.toggleUnits();
            if ((vBit === 1 && !AppState.showVertexNumbers) || (vBit === 0 && AppState.showVertexNumbers)) AppState.toggleVertexNumbers();
            if ((bBit === 1 && !AppState.showBoundingBox) || (bBit === 0 && AppState.showBoundingBox)) AppState.toggleBoundingBox();

            map1.setView([this.Bin.rF32(), this.Bin.rF32()], this.Bin.rU16() / 100, { animate: false });
            map2.setView([this.Bin.rF32(), this.Bin.rF32()], this.Bin.rU16() / 100, { animate: false });

            if (this.Bin.rU8() === 1) {
                const om = this.Bin.rU8();
                AppState.clear();
                AppState.init([this.Bin.rF32(), this.Bin.rF32()], om);
                const gt = AppState.groundTruth;
                gt.comparison_anchor = L.latLng(this.Bin.rF32(), this.Bin.rF32());
                gt.overlayRotation = this.Bin.rF32();
                gt.localPoints = [];
                for (let i = 0, count = this.Bin.rU16(); i < count; i++) {
                    gt.localPoints.push(L.point(this.Bin.rF32(), this.Bin.rF32()));
                }
                requestRender();
                AppState.updateUI();
            } else {
                AppState.clear();
            }
        } catch (e) {
            console.error("Decoding error:", e);
            AppState.clear();
            alert('Failed to load shared view. Starting fresh.');
        }
    }
};

/**
 * Shares current view by encoding state and opening share dialog.
 */
function shareCurrentView() {
    const code = ShareState.encode();
    if (!code) return;

    const url = new URL(window.location.href);
    url.searchParams.set('s', code);
    const strUrl = url.toString();
    window.history.replaceState({}, '', strUrl);

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        window.matchMedia("(max-width: 768px)").matches;

    if (isMobile) {
        if (navigator.share) {
            navigator.share({ title: 'Sync View', url: strUrl }).catch(() => { });
        } else {
            copyToClipboard(strUrl);
        }
        return;
    }

    openShareModal(strUrl);
}

/**
 * Opens the share modal with QR code.
 * @param {string} url - URL to share.
 */
function openShareModal(url) {
    toggleModal('share-modal', true);
    if (DOM.shareUrl) DOM.shareUrl.innerText = url;

    if (DOM.qrcode) {
        DOM.qrcode.textContent = '';
        DOM.qrLoading.classList.remove('hidden');
        DOM.qrError.classList.add('hidden');

        requestAnimationFrame(() => {
            try {
                new QRCode(DOM.qrcode, { text: url, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
                DOM.qrLoading.classList.add('hidden');
            } catch (e) {
                DOM.qrLoading.classList.add('hidden');
                DOM.qrError.classList.remove('hidden');
            }
        });
    }

    if (DOM.btnCopyLink) {
        DOM.btnCopyLink.onclick = () => {
            copyToClipboard(url);
            const span = DOM.btnCopyLink.querySelector('span');
            if (span) {
                const originalText = span.innerText;
                span.innerText = 'COPIED!';
                setTimeout(() => { span.innerText = originalText; toggleModal('share-modal', false); }, 1000);
            }
        };
    }
}

/**
 * Copies text to clipboard with fallback.
 * @param {string} text - Text to copy.
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
        try { document.execCommand('copy'); } catch (e) { }
        document.body.removeChild(el);
    }
}

// --- Global Event Listeners ---

/**
 * Closes layer menu when clicking outside.
 * @param {MouseEvent} e - Click event.
 */
function handleLayerMenuClick(e) {
    if (!e.target.closest('.dropdown-container')) {
        DOM.layerMenu.classList.remove('show');
        DOM.layerBtn.classList.remove('active');
    }
}

/**
 * Closes search when clicking outside search wrapper.
 * @param {MouseEvent} e - Click event.
 */
function handleSearchClick(e) {
    [1, 2].forEach(id => {
        const ctrl = DOM.maps[id].searchCtrl;
        if (!ctrl || !ctrl.classList.contains('expanded')) return;
        const wrapper = ctrl.closest('.search-wrapper');
        if (wrapper && !wrapper.contains(e.target)) toggleSearch(id);
    });
}

window.addEventListener('click', (e) => {
    handleLayerMenuClick(e);
    handleSearchClick(e);
});

window.addEventListener('keydown', (e) => {
    const target = e.target.tagName.toLowerCase();
    const isInput = target === 'input' || target === 'textarea';

    if (e.key === 'Escape') {
        let searchWasOpen = false;
        [1, 2].forEach(id => {
            if (DOM.maps[id].searchCtrl?.classList.contains('expanded')) {
                toggleSearch(id);
                searchWasOpen = true;
            }
        });
        if (searchWasOpen) return;

        const openModal = document.querySelector('.modal-overlay.show');
        if (openModal) { toggleModal(openModal.id, false); return; }

        if (!isInput) AppState.clear();
        else e.target.blur();
        return;
    }

    if (isInput) return;
    const key = e.key.toLowerCase();
    if (key === 'l') AppState.setMode('line');
    if (key === 'a') AppState.setMode('area');
    if (key === 'u') AppState.toggleUnits();
    if (key === 'v') AppState.toggleVertexNumbers();
    if (key === 'b') AppState.toggleBoundingBox();
    if (e.key === 'Delete' || e.key === 'Backspace') AppState.removeLast();
    if (key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        AppState.removeLast();
    }
});

// --- Search Functionality ---

/**
 * Handles search query and displays results.
 * @param {Event} e - Input event.
 * @param {number} id - Map ID (1 or 2).
 */
async function handleSearch(e, id) {
    const q = e.target.value.trim();
    const els = DOM.maps[id];

    const hideStatus = () => {
        els.searchStatus.searching.classList.add('hidden');
        els.searchStatus.none.classList.add('hidden');
        els.searchStatus.error.classList.add('hidden');
    };

    if (q.length < 2) {
        els.searchResults.style.display = 'none';
        els.resultsList.textContent = '';
        hideStatus();
        return;
    }

    els.resultsList.textContent = '';
    hideStatus();
    els.searchStatus.searching.classList.remove('hidden');
    els.searchResults.style.display = 'flex';

    try {
        const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`);
        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();
        hideStatus();

        if (!data.features || data.features.length === 0) {
            els.searchStatus.none.classList.remove('hidden');
            return;
        }

        data.features.forEach(feature => {
            const p = feature.properties;
            const coords = feature.geometry.coordinates;
            const label = [...new Set([p.name, p.street, p.city, p.country].filter(Boolean))].join(', ');

            const d = document.createElement('div');
            d.className = 'result-item';
            d.textContent = label;
            d.onclick = () => {
                (id === 1 ? map1 : map2).setView([coords[1], coords[0]], CONFIG.SEARCH_ZOOM);
                toggleSearch(id);
            };
            els.resultsList.appendChild(d);
        });
    } catch (err) {
        console.error('Search error:', err);
        hideStatus();
        els.searchStatus.error.classList.remove('hidden');
    }
}

/**
 * Debounced search function.
 * @param {Event} event - Input event.
 * @param {number} id - Map ID (1 or 2).
 */
let searchTimeout;
function debouncedSearch(event, id) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleSearch(event, id), CONFIG.DEBOUNCE_DELAY);
}

// --- Magnifier (Lens) Functions ---

/**
 * Initializes the magnifier lens at a specific location.
 * @param {L.Map} sourceMap - Map where lens is activated.
 * @param {L.LatLng} latlng - Center position for the lens.
 */
function initMagnifier(sourceMap, latlng) {
    if (!AppState.showLens) return;
    DOM.magnifier.style.display = 'block';

    if (!AppState.magnifierMap) {
        AppState.magnifierMap = L.map('magnifier', {
            zoomControl: false, attributionControl: false, dragging: false,
            touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false,
            boxZoom: false, inertia: false
        });
        const currentLayer = DOM.layerMenu.dataset.active || 'hybrid';
        AppState.magnifierTile = L.tileLayer(tiles[currentLayer], { ...tileOptions }).addTo(AppState.magnifierMap);
    }

    AppState.magnifierMap.invalidateSize({ pan: false });
    const currentLayer = DOM.layerMenu.dataset.active || 'hybrid';
    AppState.magnifierTile.setUrl(tiles[currentLayer]);
    const targetZoom = Math.min(sourceMap.getZoom() + 2, CONFIG.MAX_ZOOM);
    AppState.magnifierMap.setView(latlng, targetZoom, { animate: false });
    updateMagnifier(latlng, sourceMap);
}

/**
 * Updates magnifier position and zoom level.
 * @param {L.LatLng} latlng - Center position.
 * @param {L.Map} sourceMap - Source map for coordinate conversion.
 */
function updateMagnifier(latlng, sourceMap) {
    if (!AppState.showLens || !AppState.magnifierMap) return;
    const p = sourceMap.latLngToContainerPoint(latlng);
    const mapRect = sourceMap.getContainer().getBoundingClientRect();
    const globalX = p.x + mapRect.left;
    const globalY = p.y + mapRect.top;
    const lensSize = CONFIG.LENS_SIZE;
    DOM.magnifier.style.left = (globalX - lensSize / 2) + 'px';
    DOM.magnifier.style.top = (globalY - lensSize - AppState.lensOffset) + 'px';
    AppState.magnifierMap.setView(latlng, Math.min(sourceMap.getZoom() + 2, CONFIG.MAX_ZOOM), { animate: false });
}

/**
 * Hides the magnifier lens.
 */
function hideMagnifier() {
    DOM.magnifier.style.display = 'none';
}

// --- Device Location ---

/**
 * Locates user's device and centers the specified map.
 * @param {number} id - Map ID (1 or 2).
 */
function locateDevice(id) {
    const btn = DOM.maps[id].locateBtn;
    if (btn) btn.classList.add('loading');
    navigator.geolocation.getCurrentPosition(
        p => {
            (id === 1 ? map1 : map2).setView([p.coords.latitude, p.coords.longitude], CONFIG.GEOLOCATION_ZOOM);
            if (btn) btn.classList.remove('loading');
        },
        err => {
            console.error(err);
            if (btn) {
                btn.classList.remove('loading');
                btn.classList.add('error');
                setTimeout(() => btn.classList.remove('error'), 2000);
            }
            const messages = {
                1: 'Permission denied. Enable location access.',
                2: 'Position unavailable. Try again.',
                3: 'Location timeout. Check GPS signal.'
            };
            alert(messages[err.code] || 'Unable to get location.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// --- Initialization ---

/**
 * Sets up all event listeners for UI elements.
 */
function initEventListeners() {
    // Search buttons
    document.getElementById('search-btn1')?.addEventListener('click', () => toggleSearch(1));
    document.getElementById('search-btn2')?.addEventListener('click', () => toggleSearch(2));

    // Locate buttons
    document.getElementById('locate-btn1')?.addEventListener('click', () => locateDevice(1));
    document.getElementById('locate-btn2')?.addEventListener('click', () => locateDevice(2));

    // Map control buttons
    document.getElementById('center-btn1')?.addEventListener('click', centerShapes);
    document.getElementById('center-btn2')?.addEventListener('click', centerShapes);
    document.getElementById('back1')?.addEventListener('click', () => AppState.removeLast());
    document.getElementById('back2')?.addEventListener('click', () => AppState.removeLast());
    document.getElementById('clear1')?.addEventListener('click', () => AppState.clear());
    document.getElementById('clear2')?.addEventListener('click', () => AppState.clear());

    // Global bar buttons
    document.getElementById('settings-btn')?.addEventListener('click', () => toggleModal('settings-modal', true));
    document.getElementById('layerBtn')?.addEventListener('click', toggleLayerMenu);
    document.getElementById('btnLine')?.addEventListener('click', () => AppState.setMode('line'));
    document.getElementById('btnArea')?.addEventListener('click', () => AppState.setMode('area'));
    document.getElementById('share-btn')?.addEventListener('click', shareCurrentView);
    document.getElementById('center-global-btn')?.addEventListener('click', centerShapes);
    document.getElementById('info-btn')?.addEventListener('click', () => toggleModal('info-modal', true));

    // Layer dropdown items
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const layer = item.getAttribute('data-layer');
            if (layer) AppState.setLayer(layer);
        });
    });

    // Settings rows
    document.getElementById('row-units')?.addEventListener('click', () => AppState.toggleUnits());
    document.getElementById('row-vertex')?.addEventListener('click', () => AppState.toggleVertexNumbers());
    document.getElementById('row-bbox')?.addEventListener('click', () => AppState.toggleBoundingBox());

    // Modal close buttons and overlay clicks
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) toggleModal(modal.id, false);
        });
    });
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay');
            if (modal) toggleModal(modal.id, false);
        });
    });
}

window.addEventListener('load', () => {
    initEventListeners();
    const code = new URLSearchParams(window.location.search).get('s');
    if (code) setTimeout(() => ShareState.decode(code), 100);
});

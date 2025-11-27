
// --- CONFIGURACIÓN ---
const SB_URL = "https://fihiksdyshhpydzanwlf.supabase.co";
const SB_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpaGlrc2R5c2hocHlkemFud2xmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxODY4MzUsImV4cCI6MjA3OTc2MjgzNX0.ur-ISSzXVTqKLx_ed_VEeGX0HaPh-J6tALWQwwJW14Y";
const BUCKET_NAME = "donde_peter";
const BASE_API = `${SB_URL}/rest/v1`;
const AUTH_API = `${SB_URL}/auth/v1`;
const STORAGE_PUBLIC_BASE = `${SB_URL}/storage/v1/object/public/${BUCKET_NAME}`;

// Empresa / Factura
const COMPANY_NAME = "Daniela Torregroza.";
const COMPANY_NIT = "NIT 900.000.000-0";
const COMPANY_ADDRESS = "Calle Ejemplo 123, Ciudad";
const COMPANY_PHONE = "+57 300 000 0000";
const COMPANY_EMAIL = "facturacion@mitienda.com";
const COMPANY_LOGO_URL = `${STORAGE_PUBLIC_BASE}/favicon.png`;

// --- ESTADO GLOBAL ---
let sessionToken = localStorage.getItem('admin_token');
let currentProduct = null;
let shiftData = {
    start: localStorage.getItem('shift_start_time'),
    active: !!localStorage.getItem('shift_start_time')
};
let modalExistingImages = [];
let modalNewFiles = [];
let orderSearchTimeout = null;

// -------------------------------
// HELPERS BÁSICOS (deben existir temprano)
// -------------------------------
function updateShiftUI() {
    const statusEl = document.getElementById('shift-status');
    const btnOpen = document.getElementById('btn-open-shift');
    const btnClose = document.getElementById('btn-close-shift');
    const summary = document.getElementById('shift-summary-view');
    if (!statusEl || !btnOpen || !btnClose || !summary) return;
    if (shiftData.active) {
        statusEl.textContent = 'ABIERTO';
        statusEl.className = 'px-3 py-1 rounded-full text-xs font-bold bg-green-200 text-green-800';
        btnOpen.disabled = true;
        btnOpen.classList.add('opacity-50', 'cursor-not-allowed');
        btnClose.disabled = false;
        btnClose.classList.remove('opacity-50', 'cursor-not-allowed');
        summary.classList.remove('hidden');
    } else {
        statusEl.textContent = 'CERRADO';
        statusEl.className = 'px-3 py-1 rounded-full text-xs font-bold bg-gray-200 text-gray-600';
        btnOpen.disabled = false;
        btnOpen.classList.remove('opacity-50', 'cursor-not-allowed');
        btnClose.disabled = true;
        btnClose.classList.add('opacity-50', 'cursor-not-allowed');
        summary.classList.add('hidden');
    }
}

function updateShiftStartDisplay() {
    const display = document.getElementById('shift-start-time-display');
    if (!display) return;
    const span = display.querySelector('span');
    if (!span) return;
    span.textContent = shiftData.start ? new Date(shiftData.start).toLocaleString('es-CO') : '--:--';
}

function formatCurrency(value) {
    try { const n = Number(value) || 0; return n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
    catch { return value; }
}

function escapeHtml(s = '') {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function debounce(fn, wait) { let t; return function(...a){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,a), wait); }; }

// -------------------------------
// FETCH helper
// -------------------------------
async function fetchAPI(url, options = {}) {
    const headers = {
        'apikey': SB_ANON_KEY,
        'Authorization': sessionToken ? `Bearer ${sessionToken}` : `Bearer ${SB_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Prefer': 'return=representation',
        ...(options.headers || {})
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        const text = await res.text();
        console.error(`Fetch error ${res.status} for ${url}:`, text);
        if (res.status === 401 || res.status === 403) { handleLogout(); throw new Error(`Acceso no autorizado (${res.status}).`); }
        try { const json = JSON.parse(text); throw json; } catch { throw new Error(text || `Error API ${res.status}`); }
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
}

// -------------------------------
// INICIALIZACIÓN DOM
// -------------------------------
document.addEventListener('DOMContentLoaded', () => {
    if (sessionToken) initDashboard(); else showView('login-view');

    // Auth
    document.getElementById('login-btn')?.addEventListener('click', handleLogin);
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

    // Productos
    document.getElementById('product-search')?.addEventListener('input', debounce(loadProducts, 500));
    document.getElementById('stock-filter')?.addEventListener('change', loadProducts);
    document.getElementById('btn-add-product')?.addEventListener('click', () => openProductModal(null));
    document.getElementById('btn-cancel-product')?.addEventListener('click', closeProductModal);
    document.getElementById('btn-save-product')?.addEventListener('click', saveProduct);

    // Turno
    document.getElementById('btn-open-shift')?.addEventListener('click', openShift);
    document.getElementById('btn-close-shift')?.addEventListener('click', closeShift);

    // Contabilidad
    document.getElementById('btn-register-expense')?.addEventListener('click', () => registerExpense(false));
    document.getElementById('btn-export-data')?.addEventListener('click', openExportModal);
    document.getElementById('btn-filter-report')?.addEventListener('click', filterAccountingReport);

    // Modal images
    const fileInput = document.getElementById('p-image-file');
    if (fileInput) fileInput.multiple = true;
    const urlInput = document.getElementById('p-image-url');
    if (urlInput) urlInput.style.display = 'none';
    ensurePreviewContainer();
    document.getElementById('p-image-file')?.addEventListener('change', handleImagePreview);

    // Delegated clicks
    document.addEventListener('click', globalClickHandler);

    updateShiftUI();
    updateShiftStartDisplay();

    if (sessionToken) {
        loadProducts();
        loadOrders();
        switchTab('productos');
    }
});

// -------------------------------
// AUTENTICACIÓN
// -------------------------------
async function handleLogin() {
    const email = document.getElementById('email')?.value || '';
    const password = document.getElementById('password')?.value || '';
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('login-error');

    btn.textContent = 'Verificando...'; btn.disabled = true; if (errEl) errEl.classList.add('hidden');
    try {
        const res = await fetch(`${AUTH_API}/token?grant_type=password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON_KEY },
            body: JSON.stringify({ email, password })
        });
        const text = await res.text();
        const data = JSON.parse(text);
        if (!res.ok) throw new Error(data?.error_description || data?.msg || 'Error autenticación');
        sessionToken = data.access_token;
        localStorage.setItem('admin_token', sessionToken);
        initDashboard();
    } catch (err) {
        if (errEl) { errEl.textContent = `Fallo al iniciar sesión: ${err.message}`; errEl.classList.remove('hidden'); }
        else alert('Fallo al iniciar sesión: ' + err.message);
    } finally {
        btn.textContent = 'Ingresar'; btn.disabled = false;
    }
}

function handleLogout() {
    sessionToken = null;
    localStorage.removeItem('admin_token');
    showView('login-view');
}

// -------------------------------
// DASHBOARD INIT
// -------------------------------
function initDashboard() {
    showView('dashboard-view');
    loadProducts();
    loadOrders();
    switchTab('productos');
}

// -------------------------------
// PRODUCTS (sin cambios salvo tamaños/colores)
// -------------------------------
async function loadProducts() {
    const search = (document.getElementById('product-search')?.value || '').toLowerCase();
    const stockFilter = document.getElementById('stock-filter')?.value || 'all';
    const tableBody = document.getElementById('products-list');
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="loader"></div> Cargando...</td></tr>';

    let query = `${BASE_API}/products?select=*&order=id.desc`;
    if (stockFilter === 'out') query += '&stock=eq.0';
    if (stockFilter === 'low') query += '&stock=lt.5';

    try {
        const data = await fetchAPI(query);
        let products = Array.isArray(data) ? data : [];
        if (search) products = products.filter(p => (p.name || '').toLowerCase().includes(search) || ((p.category || '').toLowerCase().includes(search)));
        renderProductTable(products);
        updateCategoryDatalist(products);
    } catch (err) {
        console.error('Error cargando productos:', err);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-red-500 py-4">Error cargando productos. Revisa consola.</td></tr>`;
    }
}

function renderProductTable(products) {
    const tableBody = document.getElementById('products-list');
    if (!tableBody) return;
    const rows = (products || []).map(p => {
        const img = (p.image && Array.isArray(p.image) && p.image.length > 0) ? p.image[0] : 'https://placehold.co/40';
        const stockClass = (p.stock || 0) < 5 ? 'text-red-600 font-bold' : 'text-green-600';
        const price = Number(p.price || 0);
        return `
        <tr class="hover:bg-gray-50 border-b">
            <td class="px-6 py-4"><img src="${escapeHtml(img)}" alt="${escapeHtml(p.name||'')}" class="w-10 h-10 rounded object-cover"></td>
            <td class="px-6 py-4 font-medium text-gray-900">${escapeHtml(p.name||'')}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${escapeHtml(p.category || '-')}</td>
            <td class="px-6 py-4 text-sm font-bold">$${formatCurrency(price)}</td>
            <td class="px-6 py-4 text-sm ${stockClass}">${p.stock ?? 0}</td>
            <td class="px-6 py-4 text-sm font-medium">
                <button data-product-id="${p.id}" class="edit-product-btn text-indigo-600 hover:text-indigo-900 mr-3"><i class="fas fa-edit"></i></button>
                <button data-product-id="${p.id}" class="delete-product-btn text-red-600 hover:text-red-900"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
    tableBody.innerHTML = rows || '<tr><td colspan="6" class="text-center py-4 text-gray-500">No hay productos encontrados.</td></tr>';
}

function updateCategoryDatalist(products) {
    try {
        const categories = [...new Set((products || []).map(p => p.category).filter(Boolean))];
        const datalist = document.getElementById('category-list');
        if (!datalist) return;
        datalist.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
    } catch (err) { console.error('Error updating datalist:', err); }
}

// -------------------------------
// PRODUCT MODAL MULTI-IMAGE & TALLAS/COLORS NORMALIZACIÓN
// -------------------------------
function ensurePreviewContainer() {
    const singleImg = document.getElementById('p-image-preview');
    if (singleImg) singleImg.style.display = 'none';
    let previews = document.getElementById('p-image-previews');
    if (!previews) {
        previews = document.createElement('div');
        previews.id = 'p-image-previews';
        previews.className = 'flex flex-wrap gap-2 mb-2';
        const fileInput = document.getElementById('p-image-file');
        if (singleImg && singleImg.parentNode) singleImg.parentNode.insertBefore(previews, fileInput);
        else document.querySelector('#product-modal .border')?.appendChild(previews);
    }
}

function renderImagePreviews() {
    const container = document.getElementById('p-image-previews');
    if (!container) return;
    container.innerHTML = '';

    modalExistingImages.forEach((url, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'relative w-20 h-20 rounded overflow-hidden border';
        wrapper.innerHTML = `
            <img src="${escapeHtml(url)}" class="object-cover w-full h-full">
            <button data-type="existing" data-index="${idx}" class="remove-image-btn absolute top-0 right-0 bg-white text-red-600 rounded-full p-1 m-1 text-xs">×</button>
        `;
        container.appendChild(wrapper);
    });

    modalNewFiles.forEach((file, idx) => {
        const url = URL.createObjectURL(file);
        const wrapper = document.createElement('div');
        wrapper.className = 'relative w-20 h-20 rounded overflow-hidden border';
        wrapper.innerHTML = `
            <img src="${escapeHtml(url)}" class="object-cover w-full h-full">
            <button data-type="new" data-index="${idx}" class="remove-image-btn absolute top-0 right-0 bg-white text-red-600 rounded-full p-1 m-1 text-xs">×</button>
        `;
        container.appendChild(wrapper);
    });
}

// Normalize sizes/colors for display in the modal input
function normalizeArrayFieldForDisplay(value) {
    // value can be:
    // - Array -> join with ', '
    // - JSON string like '["28","29"]' -> parse and join
    // - Postgres array literal like '{28,29,39}' or '{"S","M"}' -> remove braces and quotes
    // - CSV string already -> trim and return
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'string') {
        const s = value.trim();
        // JSON array?
        if (s.startsWith('[') && s.endsWith(']')) {
            try {
                const parsed = JSON.parse(s);
                if (Array.isArray(parsed)) return parsed.join(', ');
            } catch (e) { /* fallthrough */ }
        }
        // Postgres array literal {a,b} possibly with quotes
        if (s.startsWith('{') && s.endsWith('}')) {
            const inside = s.slice(1, -1);
            // remove quotes around elements and return comma-separated
            const elems = inside.split(',').map(el => el.replace(/^"+|"+$/g, '').trim()).filter(Boolean);
            return elems.join(', ');
        }
        // Already CSV (or single value)
        return s;
    }
    return '';
}

// Convert the input value (CSV string) to a clean CSV string to send to backend (no brackets/quotes)
function normalizeFieldToCsvString(inputValue) {
    // inputValue expected from input.value (string)
    if (!inputValue && inputValue !== '') return '';
    // split by comma, trim, filter empties, then join by comma (no spaces)
    const arr = String(inputValue).split(',').map(s => s.trim()).filter(Boolean);
    // return a simple CSV string without quotes or braces
    return arr.join(',');
}

// Open modal: populate sizes/colors normalized
function openProductModal(product = null) {
    currentProduct = product;
    modalExistingImages = [];
    modalNewFiles = [];

    document.getElementById('modal-title').textContent = product ? 'Editar Producto' : 'Nuevo Producto';
    document.getElementById('p-name').value = product?.name || '';
    document.getElementById('p-desc').value = product?.description || '';
    document.getElementById('p-category').value = product?.category || '';
    document.getElementById('p-price').value = product?.price ?? '';
    document.getElementById('p-stock').value = product?.stock ?? '';
    document.getElementById('p-featured').checked = !!product?.featured;
    document.getElementById('p-offer').checked = !!product?.isOffer;

    // sizes/colors: normalize to display friendly string
    document.getElementById('p-sizes').value = normalizeArrayFieldForDisplay(product?.sizes) || '';
    document.getElementById('p-colors').value = normalizeArrayFieldForDisplay(product?.colors) || '';

    if (product?.image && Array.isArray(product.image)) modalExistingImages = [...product.image];
    else modalExistingImages = [];

    const fileInput = document.getElementById('p-image-file');
    if (fileInput) fileInput.value = '';
    renderImagePreviews();
    document.getElementById('product-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('p-name').focus(), 150);
}

function closeProductModal() {
    document.getElementById('product-modal').classList.add('hidden');
    currentProduct = null;
    modalExistingImages = [];
    modalNewFiles = [];
    renderImagePreviews();
}

function handleImagePreview(e) {
    const files = Array.from(e.target.files || []);
    modalNewFiles = modalNewFiles.concat(files);
    renderImagePreviews();
}

// -------------------------------
// SAVE PRODUCT: sizes/colors saved as CSV strings (no quotes/brackets)
// -------------------------------
async function uploadImageFile(file) {
    if (!file) throw new Error('Archivo inválido');
    const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-\.]/g, '');
    const path = `products/${Date.now()}_${safeName}`;
    const uploadUrl = `${SB_URL}/storage/v1/object/${BUCKET_NAME}/${encodeURIComponent(path)}`;
    const headers = {
        'apikey': SB_ANON_KEY,
        'Authorization': sessionToken ? `Bearer ${sessionToken}` : `Bearer ${SB_ANON_KEY}`,
        'Content-Type': file.type || 'application/octet-stream'
    };
    const res = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
    if (!res.ok) {
        const t = await res.text();
        console.error('Error subiendo imagen:', res.status, t);
        throw new Error('Fallo al subir imagen. Revisa permisos del bucket.');
    }
    return `${STORAGE_PUBLIC_BASE}/${encodeURIComponent(path)}`;
}

async function uploadMultipleFiles(files) {
    if (!files || files.length === 0) return [];
    const uploads = await Promise.all(files.map(f => uploadImageFile(f)));
    return uploads;
}

async function saveProduct() {
    const btn = document.getElementById('btn-save-product');
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        // Subir nuevas imágenes si las hay
        const uploadedUrls = await uploadMultipleFiles(modalNewFiles);
        const finalImages = [...modalExistingImages, ...uploadedUrls];

        // Normalize sizes/colors to CSV strings (no brackets/quotes)
        const sizesCsv = normalizeFieldToCsvString(document.getElementById('p-sizes').value);
        const colorsCsv = normalizeFieldToCsvString(document.getElementById('p-colors').value);

        const productData = {
            name: document.getElementById('p-name').value,
            description: document.getElementById('p-desc').value,
            category: document.getElementById('p-category').value,
            price: parseFloat(document.getElementById('p-price').value) || 0,
            stock: parseInt(document.getElementById('p-stock').value) || 0,
            featured: document.getElementById('p-featured').checked,
            isOffer: document.getElementById('p-offer').checked,
            // Save as CSV strings
            sizes: sizesCsv,
            colors: colorsCsv,
            image: finalImages
        };

        let url = `${BASE_API}/products`;
        let method = 'POST';
        if (currentProduct && currentProduct.id) { url += `?id=eq.${currentProduct.id}`; method = 'PATCH'; }

        await fetchAPI(url, { method, body: JSON.stringify(productData) });

        closeProductModal();
        loadProducts();
    } catch (err) {
        alert('Error guardando producto: ' + (err.message || err));
        console.error('Error guardando producto:', err);
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
}


async function loadOrders(searchTerm = '') {
    // implementation omitted for brevity in this snippet; assume unchanged
    // but present in your actual admin.js (loadOrders/renderOrdersList/confirmOrder/printInvoice...)
    try {
        // existing logic...
        // For safety call existing loadOrders if present in global scope.
        if (typeof window.__originalLoadOrders === 'function') {
            return window.__originalLoadOrders(searchTerm);
        }
    } catch (e) { console.error(e); }
}

function openShift() { /* existing implementation in your file */ }
function closeShift() { /* existing implementation in your file */ }
function registerExpense() { /* existing implementation in your file */ }
function loadShiftExpenses() { /* existing implementation in your file */ }
function updateShiftSummary() { /* existing implementation in your file */ }
function printInvoice(orderId) { /* existing implementation in your file */ }
function loadAccountingExpenses() { /* existing implementation in your file */ }
function filterAccountingReport() { /* existing implementation in your file */ }
function openExportModal() { /* existing implementation in your file */ }

// -------------------------------
// Delegation and helpers
// -------------------------------
function globalClickHandler(e) {
    const removeImgBtn = e.target.closest('.remove-image-btn');
    if (removeImgBtn) {
        const type = removeImgBtn.dataset.type;
        const idx = Number(removeImgBtn.dataset.index);
        if (type === 'existing') modalExistingImages.splice(idx, 1);
        else modalNewFiles.splice(idx, 1);
        renderImagePreviews();
        return;
    }
    // Let other handlers from your existing admin.js remain (confirm order, delete expense, etc.)
}

// -------------------------------
// UTIL: abrir/ocultar vistas
// -------------------------------
function showView(viewId) {
    ['login-view','dashboard-view'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
}

function switchTab(tabId) {
    ['productos','pedidos','contabilidad','turno'].forEach(t => {
        document.getElementById(`section-${t}`)?.classList.add('hidden');
        const tab = document.getElementById(`tab-${t}`);
        if (tab) { tab.classList.remove('bg-indigo-50','text-indigo-700'); tab.classList.add('text-gray-600'); }
    });
    document.getElementById(`section-${tabId}`)?.classList.remove('hidden');
    const activeTab = document.getElementById(`tab-${tabId}`);
    if (activeTab) { activeTab.classList.add('bg-indigo-50','text-indigo-700'); activeTab.classList.remove('text-gray-600'); }
}

// -------------------------------
// EXPORTAR funciones que tu HTML utiliza
// -------------------------------
window.switchTab = switchTab;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.saveProduct = saveProduct;
window.deleteProduct = deleteProduct;
window.updateShiftUI = updateShiftUI;
window.updateShiftStartDisplay = updateShiftStartDisplay;


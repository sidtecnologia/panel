

// --- CONFIGURACIÓN ---
const SB_URL = "https://ndqzyplsiqigsynweihk.supabase.co";
const SB_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kcXp5cGxzaXFpZ3N5bndlaWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODQyOTQ4MiwiZXhwIjoyMDc0MDA1NDgyfQ.LYocdE6jGG5B-0n_2Ke0nUpkrAKC7iBBRV7RmgjATD8";
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
// UI Helpers that must exist early
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
    document.getElementById('btn-close-shift')?.addEventListener('click', closeShift); // opens modal for confirmation

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

    // Delegated click handler
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
// AUTH
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
// PRODUCTS
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
// PRODUCT MODAL (multi-image)
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
    document.getElementById('p-sizes').value = Array.isArray(product?.sizes) ? product.sizes.join(', ') : (product?.sizes || '');
    document.getElementById('p-colors').value = Array.isArray(product?.colors) ? product.colors.join(', ') : (product?.colors || '');
    if (product?.image && Array.isArray(product.image)) modalExistingImages = [...product.image];
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
        const uploadedUrls = await uploadMultipleFiles(modalNewFiles);
        const finalImages = [...modalExistingImages, ...uploadedUrls];

        const productData = {
            name: document.getElementById('p-name').value,
            description: document.getElementById('p-desc').value,
            category: document.getElementById('p-category').value,
            price: parseFloat(document.getElementById('p-price').value) || 0,
            stock: parseInt(document.getElementById('p-stock').value) || 0,
            featured: document.getElementById('p-featured').checked,
            isOffer: document.getElementById('p-offer').checked,
            sizes: document.getElementById('p-sizes').value.split(',').map(s => s.trim()).filter(Boolean),
            colors: document.getElementById('p-colors').value.split(',').map(s => s.trim()).filter(Boolean),
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

async function deleteProduct(id) {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;
    try {
        await fetchAPI(`${BASE_API}/products?id=eq.${id}`, { method: 'DELETE' });
        loadProducts();
    } catch (err) {
        alert('No se pudo eliminar: ' + (err.message || JSON.stringify(err)));
        console.error(err);
    }
}

async function fetchProductById(id) {
    const data = await fetchAPI(`${BASE_API}/products?id=eq.${id}&select=*`);
    if (!Array.isArray(data) || data.length === 0) throw new Error('Producto no encontrado');
    return data[0];
}

// -------------------------------
// PEDIDOS: pendientes desde orders; historial desde orders_confirmed
// - Evitamos ordenar por confirmed_at en la query (puede no existir). Ordenamos en cliente.
// - Añadimos buscador para pedidos.
// -------------------------------
async function loadOrders(searchTerm = '') {
    try {
        ensureOrdersSearchInput();

        // Traer pendientes y historial sin forzar order by confirmed_at que puede no existir
        const pending = await fetchAPI(`${BASE_API}/orders?select=*&limit=1000`);
        const history = await fetchAPI(`${BASE_API}/orders_confirmed?select=*&limit=1000`);

        // Aplicar búsqueda cliente-lado
        const st = (searchTerm || document.getElementById('order-search')?.value || '').toLowerCase().trim();
        const filterFn = (o) => {
            if (!st) return true;
            const fields = [];
            fields.push(o.customer_name || '');
            fields.push(o.customer_address || '');
            fields.push(o.customer_document || '');
            fields.push(o.created_at || '');
            if (Array.isArray(o.order_items)) {
                fields.push(...o.order_items.map(it => `${it.name || ''} ${it.size || ''} ${it.color || ''}`));
            }
            const hay = fields.join(' ').toLowerCase();
            return hay.includes(st);
        };

        const pendingFiltered = Array.isArray(pending) ? pending.filter(filterFn) : [];
        const historyFiltered = Array.isArray(history) ? history.filter(filterFn) : [];

        // Ordenar historial en cliente por confirmed_at / dispatch_date / created_at desc (más reciente primero)
        historyFiltered.sort((a, b) => {
            const ta = new Date(a.confirmed_at || a.dispatch_date || a.created_at || 0).getTime();
            const tb = new Date(b.confirmed_at || b.dispatch_date || b.created_at || 0).getTime();
            return tb - ta;
        });

        renderOrdersList(pendingFiltered, 'orders-pending-list', true);
        renderOrdersList(historyFiltered, 'orders-history-list', false);

        updateShiftSummary();
    } catch (err) {
        console.error('Error cargando pedidos:', err);
        document.getElementById('orders-pending-list').innerHTML = '<p class="text-red-500 text-sm">Error cargando pendientes. Revisa consola.</p>';
        document.getElementById('orders-history-list').innerHTML = '<p class="text-red-500 text-sm">Error cargando historial. Revisa consola.</p>';
    }
}

function ensureOrdersSearchInput() {
    if (document.getElementById('order-search')) return;
    const pedidosSection = document.getElementById('section-pedidos');
    if (!pedidosSection) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-4 flex gap-2';
    wrapper.innerHTML = `
        <input id="order-search" placeholder="Buscar pedidos por cliente, fecha, producto..." class="px-4 py-2 border rounded-lg w-full">
        <button id="order-search-clear" class="px-3 py-2 bg-gray-200 rounded">Limpiar</button>
    `;
    pedidosSection.insertBefore(wrapper, pedidosSection.firstChild);
    document.getElementById('order-search')?.addEventListener('input', (e) => {
        clearTimeout(orderSearchTimeout);
        orderSearchTimeout = setTimeout(() => loadOrders(e.target.value), 400);
    });
    document.getElementById('order-search-clear')?.addEventListener('click', () => {
        document.getElementById('order-search').value = '';
        loadOrders('');
    });
}

function renderOrdersList(orders, containerId, isPending) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!orders || orders.length === 0) { container.innerHTML = '<p class="text-gray-400 text-sm">No hay pedidos.</p>'; return; }

    container.innerHTML = orders.map(o => {
        const items = o.order_items || [];
        const itemsHtml = Array.isArray(items) ? items.map(i => `<div class="text-xs text-gray-600">${i.qty}x ${escapeHtml(i.name||'')} ${escapeHtml(i.size||'')} ${escapeHtml(i.color||'')}</div>`).join('') : '<span class="text-xs text-red-500">Error formato items</span>';

        let actions = '';
        if (isPending) {
            actions = `
                <div class="mt-3 flex gap-2">
                    <button data-order-id="${o.id}" class="confirm-order-btn bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs hover:bg-blue-200">Confirmar</button>
                    <button data-order-id="${o.id}" class="cancel-order-btn bg-red-100 text-red-700 px-3 py-1 rounded text-xs hover:bg-red-200">Cancelar</button>
                </div>
            `;
        } else {
            actions = `
                <div class="mt-2 flex items-center justify-between">
                    <div class="text-xs font-bold text-gray-500">Estado: ${escapeHtml(o.order_status || '')}</div>
                    <div class="flex gap-2">
                        <button data-order-id="${o.id}" class="print-invoice-btn bg-indigo-600 text-white px-3 py-1 rounded text-xs hover:bg-indigo-700">Imprimir Factura</button>
                    </div>
                </div>
            `;
        }

        return `
        <div class="bg-gray-50 p-4 rounded border ${isPending ? 'order-card-pending' : 'order-card-dispatched'}">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h4 class="font-bold text-gray-800">${escapeHtml(o.customer_name || 'Cliente')}</h4>
                    <p class="text-xs text-gray-500">${new Date(o.created_at || o.time || Date.now()).toLocaleString('es-CO')}</p>
                </div>
                <span class="font-bold text-indigo-600">$${formatCurrency(o.total_amount || 0)}</span>
            </div>
            <div class="text-sm text-gray-700 mb-2"><i class="fas fa-map-marker-alt text-gray-400"></i> ${escapeHtml(o.customer_address || '-')}</div>
            <div class="border-t border-gray-200 pt-2 space-y-1">${itemsHtml}</div>
            ${actions}
        </div>`;
    }).join('');
}

// Confirmar pedido: PATCH order_status only (no confirmed_at) to avoid schema errors
async function confirmOrder(id) {
    try {
        await fetchAPI(`${BASE_API}/orders?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ order_status: 'Confirmado' }) });
        // Give DB trigger time to move to orders_confirmed if configured
        setTimeout(() => loadOrders(), 700);
    } catch (err) {
        alert('Error al confirmar pedido: ' + (err.message || JSON.stringify(err)));
        console.error('confirmOrder error:', err);
    }
}

async function updatePendingOrderStatus(id, status) {
    try {
        await fetchAPI(`${BASE_API}/orders?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ order_status: status }) });
        loadOrders();
    } catch (err) {
        alert('Error actualizando estado: ' + (err.message || JSON.stringify(err)));
        console.error(err);
    }
}

async function dispatchOrder(id) {
    if (!confirm('Confirmar despacho de este pedido?')) return;
    try {
        await fetchAPI(`${BASE_API}/orders_confirmed?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ order_status: 'Despachado', dispatch_date: new Date().toISOString() })
        });
        loadOrders();
        alert('Pedido marcado como despachado.');
    } catch (err) {
        alert('Error al despachar: ' + (err.message || JSON.stringify(err)));
        console.error(err);
    }
}

// -------------------------------
// FACTURA CON LOGO
// -------------------------------
async function printInvoice(orderId) {
    try {
        let data = await fetchAPI(`${BASE_API}/orders_confirmed?id=eq.${orderId}&select=*`);
        if (!Array.isArray(data) || data.length === 0) {
            data = await fetchAPI(`${BASE_API}/orders?id=eq.${orderId}&select=*`);
            if (!Array.isArray(data) || data.length === 0) throw new Error('Pedido no encontrado.');
        }
        const order = data[0];
        const items = Array.isArray(order.order_items) ? order.order_items : [];
        const subtotal = items.reduce((s, it) => s + ((it.qty || 0) * (it.price || it.unit_price || 0)), 0);
        const taxRate = order.tax_rate ?? 0;
        const taxAmount = subtotal * (taxRate / 100);
        const total = order.total_amount ?? (subtotal + taxAmount);

        const invoiceHtml = `
            <html>
            <head><title>Factura - ${escapeHtml(order.id || '')}</title>
            <style>body{font-family:Arial;padding:20px;color:#111}.header{display:flex;justify-content:space-between;margin-bottom:20px}.logo{max-width:200px;max-height:60px;object-fit:contain}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px}</style>
            </head>
            <body>
                <div class="header">
                    <div>
                        <img src="${escapeHtml(COMPANY_LOGO_URL)}" alt="Logo" class="logo"><br>
                        <strong>${escapeHtml(COMPANY_NAME)}</strong><br>
                        ${escapeHtml(COMPANY_ADDRESS)}<br>
                        ${escapeHtml(COMPANY_NIT)}<br>
                        Tel: ${escapeHtml(COMPANY_PHONE)} - ${escapeHtml(COMPANY_EMAIL)}
                    </div>
                    <div style="text-align:right">
                        <h3>Factura</h3>
                        <div>No: ${escapeHtml(order.id || 'N/A')}</div>
                        <div>Fecha: ${new Date(order.created_at || order.confirmed_at || Date.now()).toLocaleString('es-CO')}</div>
                    </div>
                </div>

                <div><strong>Cliente:</strong> ${escapeHtml(order.customer_name || '')}<br><strong>Dirección:</strong> ${escapeHtml(order.customer_address || '')}</div>

                <table><thead><tr><th>Cant</th><th>Descripción</th><th>V.Unit</th><th>Total</th></tr></thead><tbody>
                ${items.map(it => `<tr><td>${it.qty||0}</td><td>${escapeHtml(it.name||'')}</td><td>$${formatCurrency(it.price||it.unit_price||0)}</td><td>$${formatCurrency((it.qty||0)*(it.price||it.unit_price||0))}</td></tr>`).join('')}
                </tbody></table>

                <div style="float:right;margin-top:10px">
                    <div>Subtotal: $${formatCurrency(subtotal)}</div>
                    <div>Impuesto (${taxRate}%): $${formatCurrency(taxAmount)}</div>
                    <div><strong>Total: $${formatCurrency(total)}</strong></div>
                </div>

                <div style="clear:both;margin-top:120px;font-size:12px;color:#666">Documento válido como factura. Gracias por su compra.</div>
            </body>
            </html>
        `;
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) throw new Error('No se pudo abrir la ventana de impresión (bloqueador?)');
        w.document.write(invoiceHtml);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 500);
    } catch (err) {
        alert('Error generando factura: ' + (err.message || JSON.stringify(err)));
        console.error('printInvoice error:', err);
    }
}

// -------------------------------
// TURNOS y CIERRE (modal de cierre imprimible)
// -------------------------------
function openShift() {
    if (shiftData.active) return;
    const now = new Date().toISOString();
    localStorage.setItem('shift_start_time', now);
    shiftData.active = true; shiftData.start = now;
    updateShiftUI(); updateShiftStartDisplay();
    alert('Turno abierto correctamente.');
    loadShiftExpenses(); updateShiftSummary();
}

async function closeShift() {
    if (!shiftData.active) return alert('No hay un turno abierto.');
    try {
        await showCloseShiftModal();
    } catch (err) {
        // Cancelado por usuario u otro error
        console.info('Cierre de turno cancelado o falló:', err);
    }
}

async function showCloseShiftModal() {
    const startISO = shiftData.start;
    const startDate = new Date(startISO);

    const [confirmed, orders, expenses] = await Promise.allSettled([
        fetchAPI(`${BASE_API}/orders_confirmed?select=*&limit=1000`),
        fetchAPI(`${BASE_API}/orders?select=*&limit=1000`),
        fetchAPI(`${BASE_API}/out_money?time=gte.${encodeURIComponent(startISO)}&select=*&limit=1000`)
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : []));

    const allOrders = [];
    if (Array.isArray(confirmed)) allOrders.push(...confirmed);
    if (Array.isArray(orders)) allOrders.push(...orders);

    const validOrders = allOrders.filter(o => {
        const d = o.dispatch_date || o.confirmed_at || o.created_at || o.time;
        if (!d) return false;
        return new Date(d) >= startDate;
    });

    const totalSales = validOrders.reduce((s,o) => s + (o.total_amount || 0), 0);
    const totalExpenses = Array.isArray(expenses) ? expenses.reduce((s,e) => s + (e.cant || 0), 0) : 0;
    const net = totalSales - totalExpenses;

    // Productos agregados
    const productMap = {};
    validOrders.forEach(o => {
        const items = o.order_items || [];
        items.forEach(it => {
            const key = `${it.name||'Item'}|${it.size||''}|${it.color||''}`;
            if (!productMap[key]) productMap[key] = { name: it.name||'Item', size: it.size||'', color: it.color||'', qty: 0, revenue: 0, unit: it.price||it.unit_price||0 };
            productMap[key].qty += (it.qty || 0);
            productMap[key].revenue += (it.qty || 0) * (it.price || it.unit_price || 0);
        });
    });

    // Crear modal
    const modalId = `close-shift-modal-${Date.now()}`;
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 flex items-start md:items-center justify-center modal-overlay';
    modal.id = modalId;
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-auto p-6">
            <div class="flex justify-between items-start mb-4">
                <div>
                    <h2 class="text-2xl font-bold">Cierre de Turno</h2>
                    <p class="text-sm text-gray-500">Inicio del turno: ${startDate.toLocaleString('es-CO')}</p>
                </div>
                <div class="flex gap-2">
                    <button id="${modalId}-print" class="px-3 py-2 bg-indigo-600 text-white rounded">Imprimir Resumen</button>
                    <button id="${modalId}-confirm" class="px-3 py-2 bg-green-600 text-white rounded">Cerrar Turno y Limpiar</button>
                    <button id="${modalId}-cancel" class="px-3 py-2 bg-gray-200 rounded">Cancelar</button>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div class="p-4 border rounded">
                    <div class="text-sm text-gray-500">Ventas del Turno</div>
                    <div class="text-2xl font-bold text-green-600">$${formatCurrency(totalSales)}</div>
                </div>
                <div class="p-4 border rounded">
                    <div class="text-sm text-gray-500">Egresos del Turno</div>
                    <div class="text-2xl font-bold text-red-600">-$${formatCurrency(totalExpenses)}</div>
                </div>
                <div class="p-4 border rounded">
                    <div class="text-sm text-gray-500">Neto</div>
                    <div class="text-2xl font-bold text-indigo-600">$${formatCurrency(net)}</div>
                </div>
            </div>

            <div class="mb-4">
                <h3 class="font-bold mb-2">Resumen de Pedidos (${validOrders.length})</h3>
                <div id="${modalId}-orders" class="space-y-2 max-h-48 overflow-auto border rounded p-2">
                    ${validOrders.map(o => `
                        <div class="p-2 bg-gray-50 rounded flex justify-between items-start">
                            <div>
                                <div class="font-medium">${escapeHtml(o.customer_name || 'Cliente')}</div>
                                <div class="text-xs text-gray-500">${new Date(o.created_at || o.confirmed_at || o.time).toLocaleString('es-CO')}</div>
                                <div class="text-xs text-gray-600">${Array.isArray(o.order_items) ? o.order_items.map(i => `${i.qty}x ${escapeHtml(i.name || '')}`).join(', ') : ''}</div>
                            </div>
                            <div class="font-bold text-indigo-600">$${formatCurrency(o.total_amount || 0)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="mb-4">
                <h3 class="font-bold mb-2">Productos vendidos</h3>
                <div class="max-h-48 overflow-auto border rounded p-2">
                    <table class="min-w-full text-sm">
                        <thead><tr><th class="text-left">Producto</th><th class="text-left">Talla/Color</th><th class="text-right">Cantidad</th><th class="text-right">Ingresos</th></tr></thead>
                        <tbody>
                            ${Object.values(productMap).map(p => `
                                <tr>
                                    <td>${escapeHtml(p.name)}</td>
                                    <td>${escapeHtml((p.size || '') + ' ' + (p.color || ''))}</td>
                                    <td class="text-right">${p.qty}</td>
                                    <td class="text-right">$${formatCurrency(p.revenue)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="text-right mt-4">
                <small class="text-gray-500">Al confirmar, el turno se cerrará y se limpiarán los datos del turno en la UI.</small>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });
    const onKey = (ev) => { if (ev.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    document.getElementById(`${modalId}-print`)?.addEventListener('click', () => {
        const content = modal.querySelector('div > div').outerHTML;
        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) return alert('No se pudo abrir la ventana de impresión (bloqueador?).');
        win.document.write(`<html><head><title>Resumen Turno</title><style>body{font-family:Arial;padding:20px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px}</style></head><body><h2>Resumen de Turno - ${startDate.toLocaleString('es-CO')}</h2>${content}</body></html>`);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 500);
    });

    return new Promise((resolve, reject) => {
        document.getElementById(`${modalId}-confirm`)?.addEventListener('click', () => {
            localStorage.removeItem('shift_start_time');
            shiftData.active = false;
            shiftData.start = null;
            updateShiftUI();
            updateShiftStartDisplay();
            document.getElementById('shift-summary-sales').textContent = '$0';
            document.getElementById('shift-summary-expenses').textContent = '$0';
            document.getElementById('shift-summary-net').textContent = '$0';
            document.getElementById('shift-expenses-list').innerHTML = '';
            modal.remove();
            document.removeEventListener('keydown', onKey);
            resolve();
        });
        document.getElementById(`${modalId}-cancel`)?.addEventListener('click', () => {
            modal.remove();
            document.removeEventListener('keydown', onKey);
            reject(new Error('Cancelado por usuario'));
        });
    });
}

// -------------------------------
// EGRESOS (contabilidad) y eliminación
// -------------------------------
async function loadAccountingExpenses() {
    const list = document.getElementById('accounting-expenses-list');
    if (list) list.innerHTML = '<li>Cargando gastos históricos...</li>';
    try {
        const expenses = await fetchAPI(`${BASE_API}/out_money?order=id.desc&limit=200`);
        if (Array.isArray(expenses)) {
            list.innerHTML = expenses.map(e => {
                const date = new Date(e.time).toLocaleDateString('es-CO');
                return `<li class="flex justify-between border-b py-2 text-sm items-center">
                    <div class="w-3/4"><span class="text-gray-500 mr-2">${date}</span> ${escapeHtml(e.detail || '')}</div>
                    <div class="flex items-center gap-2">
                        <div class="text-red-600 font-bold">-$${formatCurrency(e.cant || 0)}</div>
                        <button data-expense-id="${e.id}" class="delete-expense-btn px-2 py-1 bg-gray-100 rounded text-xs text-red-600 hover:bg-red-100">Eliminar</button>
                    </div>
                </li>`;
            }).join('');
        } else list.innerHTML = '<li>No hay egresos registrados.</li>';
    } catch (err) {
        console.error(err);
        if (list) list.innerHTML = '<li>Error al cargar los gastos históricos.</li>';
    }
}

async function deleteExpense(id) {
    if (!confirm('¿Eliminar este registro de egreso? Esta acción no puede deshacerse.')) return;
    try {
        await fetchAPI(`${BASE_API}/out_money?id=eq.${id}`, { method: 'DELETE' });
        loadAccountingExpenses();
    } catch (err) {
        alert('No se pudo eliminar el egreso: ' + (err.message || JSON.stringify(err)));
        console.error('deleteExpense error:', err);
    }
}

// -------------------------------
// CONTABILIDAD: filtrar y export modal
// -------------------------------
async function filterAccountingReport() {
    const startDate = document.getElementById('report-start-date')?.value;
    const endDate = document.getElementById('report-end-date')?.value;
    if (!startDate || !endDate) { alert('Selecciona rango de fechas'); return; }
    const startISO = new Date(startDate + 'T00:00:00').toISOString();
    const endISO = new Date(endDate + 'T23:59:59.999').toISOString();

    try {
        const [confirmed, expenses] = await Promise.allSettled([
            fetchAPI(`${BASE_API}/orders_confirmed?select=*&limit=2000`),
            fetchAPI(`${BASE_API}/out_money?select=*&limit=2000`)
        ]).then(r => r.map(x => x.status === 'fulfilled' ? x.value : []));

        const startT = new Date(startISO).getTime();
        const endT = new Date(endISO).getTime();

        const filteredOrders = (Array.isArray(confirmed) ? confirmed : []).filter(o => {
            const dates = [o.created_at, o.confirmed_at, o.dispatch_date, o.time].filter(Boolean);
            if (dates.length === 0) return false;
            return dates.some(d => { const t = new Date(d).getTime(); return !isNaN(t) && t >= startT && t <= endT; });
        });

        const filteredExpenses = (Array.isArray(expenses) ? expenses : []).filter(e => {
            const t = new Date(e.time).getTime();
            return !isNaN(t) && t >= startT && t <= endT;
        });

        const salesTotal = filteredOrders.reduce((s,o) => s + (o.total_amount || 0), 0);
        const expensesTotal = filteredExpenses.reduce((s,e) => s + (e.cant || 0), 0);

        document.getElementById('summary-sales-historical').textContent = `$${formatCurrency(salesTotal)}`;
        document.getElementById('summary-expenses-historical').textContent = `-$${formatCurrency(expensesTotal)}`;
        document.getElementById('summary-net-historical').textContent = `$${formatCurrency(salesTotal - expensesTotal)}`;
    } catch (err) {
        console.error('Error filtrando contabilidad:', err);
        alert('Error al filtrar datos. Revisa consola.');
    }
}

function openExportModal() {
    const modalId = `export-modal-${Date.now()}`;
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center modal-overlay';
    modal.id = modalId;
    modal.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold">Exportar Datos</h3>
                <button id="${modalId}-close" class="px-2 py-1 bg-gray-100 rounded">Cerrar</button>
            </div>
            <div class="space-y-4">
                <div><label class="block font-medium">Rango de fechas</label>
                    <div class="flex gap-2 mt-1">
                        <input type="date" id="${modalId}-start" class="px-3 py-2 border rounded w-full">
                        <input type="date" id="${modalId}-end" class="px-3 py-2 border rounded w-full">
                    </div>
                </div>
                <div><label class="block font-medium">Qué exportar</label>
                    <div class="flex gap-4 mt-2">
                        <label><input type="checkbox" id="${modalId}-opt-orders" checked> Pedidos (orders_confirmed)</label>
                        <label><input type="checkbox" id="${modalId}-opt-expenses" checked> Egresos (out_money)</label>
                    </div>
                </div>
                <div class="text-right"><button id="${modalId}-export" class="px-4 py-2 bg-green-600 text-white rounded">Exportar CSV</button></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.remove(); });
    document.getElementById(`${modalId}-close`)?.addEventListener('click', () => modal.remove());
    document.addEventListener('keydown', function escClose(ev) { if (ev.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escClose); } });

    document.getElementById(`${modalId}-export`)?.addEventListener('click', async () => {
        const startDate = document.getElementById(`${modalId}-start`)?.value;
        const endDate = document.getElementById(`${modalId}-end`)?.value;
        const optOrders = document.getElementById(`${modalId}-opt-orders`)?.checked;
        const optExpenses = document.getElementById(`${modalId}-opt-expenses`)?.checked;
        if (!optOrders && !optExpenses) return alert('Selecciona al menos una opción para exportar.');

        let ordersPromise = Promise.resolve([]);
        let expensesPromise = Promise.resolve([]);

        if (optOrders) {
            let q = `${BASE_API}/orders_confirmed?select=*`;
            if (startDate) q += `&created_at=gte.${encodeURIComponent(new Date(startDate + 'T00:00:00').toISOString())}`;
            if (endDate) q += `&created_at=lte.${encodeURIComponent(new Date(endDate + 'T23:59:59.999').toISOString())}`;
            ordersPromise = fetchAPI(q);
        }
        if (optExpenses) {
            let q = `${BASE_API}/out_money?select=*`;
            if (startDate) q += `&time=gte.${encodeURIComponent(new Date(startDate + 'T00:00:00').toISOString())}`;
            if (endDate) q += `&time=lte.${encodeURIComponent(new Date(endDate + 'T23:59:59.999').toISOString())}`;
            expensesPromise = fetchAPI(q);
        }

        try {
            const [ordersData, expensesData] = await Promise.all([ordersPromise, expensesPromise]);
            let csv = "data:text/csv;charset=utf-8,Tipo,Fecha,Monto,Detalle\n";
            if (Array.isArray(ordersData)) ordersData.forEach(o => csv += `Venta,${new Date(o.created_at || o.confirmed_at || Date.now()).toISOString()},${o.total_amount || 0},"Pedido ${(o.customer_name||'').replace(/"/g,'""')}"\n`);
            if (Array.isArray(expensesData)) expensesData.forEach(e => csv += `Egreso,${new Date(e.time).toISOString()},-${e.cant || 0},"${(e.detail||'').replace(/"/g,'""')}"\n`);
            const encoded = encodeURI(csv);
            const link = document.createElement('a'); link.href = encoded; link.download = 'export_contabilidad.csv'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
            modal.remove();
            alert('Export realizado: export_contabilidad.csv');
        } catch (err) {
            alert('Error exportando: ' + (err.message || JSON.stringify(err)));
            console.error('Export error:', err);
        }
    });
}

// -------------------------------
// TURN SUMMARY / EXPENSES helpers
// -------------------------------
async function registerExpense(isShiftExpense) {
    let amountEl, descEl;
    if (isShiftExpense) {
        if (!shiftData.active) return alert('Debes abrir un turno primero para registrar un egreso de caja.');
        amountEl = document.getElementById('shift-expense-amount');
        descEl = document.getElementById('shift-expense-desc');
    } else {
        amountEl = document.getElementById('expense-amount');
        descEl = document.getElementById('expense-desc');
    }
    const amount = parseFloat(amountEl?.value);
    const desc = descEl?.value;
    if (!amount || !desc) return alert('Completa los datos del gasto');

    try {
        await fetchAPI(`${BASE_API}/out_money`, { method: 'POST', body: JSON.stringify({ cant: amount, detail: desc, name: 'Admin', time: new Date().toISOString() }) });
        if (amountEl) amountEl.value = ''; if (descEl) descEl.value = '';
        if (isShiftExpense) { loadShiftExpenses(); updateShiftSummary(); } else loadAccountingExpenses();
    } catch (err) {
        alert('Error registrando gasto: ' + (err.message || JSON.stringify(err)));
        console.error(err);
    }
}

async function loadShiftExpenses() {
    if (!shiftData.active) return;
    const list = document.getElementById('shift-expenses-list');
    if (list) list.innerHTML = '<li>Cargando gastos...</li>';
    try {
        const start = shiftData.start;
        const expenses = await fetchAPI(`${BASE_API}/out_money?time=gte.${start}&order=id.desc`);
        let totalExpenses = 0;
        if (Array.isArray(expenses)) {
            list.innerHTML = expenses.map(e => { totalExpenses += (e.cant || 0); return `<li class="flex justify-between border-b py-1 text-sm"><span>${escapeHtml(e.detail || '')}</span><span class="text-red-600 font-bold">-$${formatCurrency(e.cant || 0)}</span></li>`; }).join('');
        } else list.innerHTML = '<li>No hay gastos en este turno.</li>';
        document.getElementById('shift-summary-expenses').textContent = `$${formatCurrency(totalExpenses)}`;
        updateShiftSummary(totalExpenses);
    } catch (err) {
        console.error(err);
        if (list) list.innerHTML = '<li>Error al cargar los gastos del turno.</li>';
    }
}

async function updateShiftSummary(currentExpenses = null) {
    if (!shiftData.active) return;
    if (currentExpenses === null) {
        await loadShiftExpenses();
        const text = document.getElementById('shift-summary-expenses').textContent.replace('$','').replace(/\./g,'').replace(/,/g,'.');
        currentExpenses = parseFloat(text) || 0;
    }

    try {
        const [confirmed, orders] = await Promise.allSettled([
            fetchAPI(`${BASE_API}/orders_confirmed?select=*&limit=1000`),
            fetchAPI(`${BASE_API}/orders?select=*&limit=1000`)
        ]).then(r => r.map(x => x.status === 'fulfilled' ? x.value : []));

        const all = [];
        if (Array.isArray(confirmed)) all.push(...confirmed);
        if (Array.isArray(orders)) all.push(...orders);

        const startObj = new Date(shiftData.start);
        const valid = all.filter(o => {
            const d = o.dispatch_date || o.confirmed_at || o.created_at || o.time;
            if (!d) return false;
            try { return new Date(d) >= startObj; } catch { return false; }
        });

        const totalSales = valid.reduce((s,o) => s + (o.total_amount || 0), 0);
        document.getElementById('shift-summary-sales').textContent = `$${formatCurrency(totalSales)}`;
        calculateNet(totalSales, currentExpenses, 'shift-summary-net');
    } catch (err) {
        console.error('Error calculando resumen de turno:', err);
        calculateNet(0, currentExpenses, 'shift-summary-net');
    }
}

function calculateNet(sales, expenses, elementId) {
    const net = (sales || 0) - (expenses || 0);
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = `$${formatCurrency(net)}`;
    el.classList.remove('text-red-600', 'text-green-600');
    if (net < 0) el.classList.add('text-red-600'); else el.classList.add('text-green-600');
}

// -------------------------------
// Misc helpers and delegation
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
    if (tabId === 'pedidos') loadOrders();
    if (tabId === 'turno') { updateShiftUI(); loadShiftExpenses(); updateShiftSummary(); }
    if (tabId === 'contabilidad') loadAccountingExpenses();
}

function globalClickHandler(e) {
    const editBtn = e.target.closest('.edit-product-btn');
    if (editBtn) { const pid = editBtn.dataset.productId; if (pid) fetchProductById(pid).then(prod => openProductModal(prod)).catch(err => { alert('Error al obtener producto: ' + err.message); console.error(err); }); return; }

    const delBtn = e.target.closest('.delete-product-btn');
    if (delBtn) { const pid = delBtn.dataset.productId; if (pid) deleteProduct(pid); return; }

    const confirmBtn = e.target.closest('.confirm-order-btn');
    if (confirmBtn) { const oid = confirmBtn.dataset.orderId; if (oid) confirmOrder(oid); return; }

    const cancelBtn = e.target.closest('.cancel-order-btn');
    if (cancelBtn) { const oid = cancelBtn.dataset.orderId; if (oid) updatePendingOrderStatus(oid, 'Cancelado'); return; }

    const dispatchBtn = e.target.closest('.dispatch-order-btn');
    if (dispatchBtn) { const oid = dispatchBtn.dataset.orderId; if (oid) dispatchOrder(oid); return; }

    const printBtn = e.target.closest('.print-invoice-btn');
    if (printBtn) { const oid = printBtn.dataset.orderId; if (oid) printInvoice(oid); return; }

    const delExpenseBtn = e.target.closest('.delete-expense-btn');
    if (delExpenseBtn) { const eid = delExpenseBtn.dataset.expenseId; if (eid) deleteExpense(eid); return; }

    const removeImgBtn = e.target.closest('.remove-image-btn');
    if (removeImgBtn) {
        const type = removeImgBtn.dataset.type; const idx = Number(removeImgBtn.dataset.index);
        if (type === 'existing') modalExistingImages.splice(idx, 1); else modalNewFiles.splice(idx, 1);
        renderImagePreviews();
        return;
    }
}

// Inicial load de egresos
loadAccountingExpenses();

// Exponer funciones globales (compatibilidad con HTML inline)
window.switchTab = switchTab;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.saveProduct = saveProduct;
window.deleteProduct = deleteProduct;
window.dispatchOrder = dispatchOrder;
window.updatePendingOrderStatus = updatePendingOrderStatus;
window.openShift = openShift;
window.closeShift = closeShift;
window.registerExpense = registerExpense;
window.exportData = openExportModal;
window.printInvoice = printInvoice;
window.confirmOrder = confirmOrder;
window.deleteExpense = deleteExpense;
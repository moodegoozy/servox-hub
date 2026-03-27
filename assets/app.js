const STORAGE_KEY = 'internet-admin-data-v1';
const credentials = { username: 'admin', password: 'admin123' };

const state = {
  cities: [],
  customers: [],
  selectedCityId: null,
};

const elements = {
  loginCard: document.getElementById('loginCard'),
  dashboard: document.getElementById('dashboard'),
  loginForm: document.getElementById('loginForm'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  userActions: document.getElementById('userActions'),
  logoutBtn: document.getElementById('logoutBtn'),
  addCityBtn: document.getElementById('addCityBtn'),
  cityList: document.getElementById('cityList'),
  selectedCityLabel: document.getElementById('selectedCityLabel'),
  customerForm: document.getElementById('customerForm'),
  customerName: document.getElementById('customerName'),
  serviceStart: document.getElementById('serviceStart'),
  customerList: document.getElementById('customerList'),
  toast: document.getElementById('toast'),
  cityItemTemplate: document.getElementById('cityItemTemplate'),
  customerItemTemplate: document.getElementById('customerItemTemplate'),
};

function init() {
  loadData();
  bindLogin();
  bindCities();
  bindCustomers();
  autoFillToday();
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.cities = parsed.cities || [];
      state.customers = parsed.customers || [];
      state.selectedCityId = parsed.selectedCityId || null;
    } catch (e) {
      console.error('تعذر قراءة البيانات', e);
    }
  }
}

function persistData() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      cities: state.cities,
      customers: state.customers,
      selectedCityId: state.selectedCityId,
    })
  );
}

function bindLogin() {
  elements.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = elements.username.value.trim();
    const pass = elements.password.value.trim();
    if (user === credentials.username && pass === credentials.password) {
      elements.loginCard.hidden = true;
      elements.dashboard.hidden = false;
      elements.userActions.hidden = false;
      render();
      showToast('تم تسجيل الدخول بنجاح');
    } else {
      showToast('بيانات الدخول غير صحيحة');
    }
  });

  elements.logoutBtn.addEventListener('click', () => {
    elements.loginCard.hidden = false;
    elements.dashboard.hidden = true;
    elements.userActions.hidden = true;
    elements.password.value = '';
  });
}

function bindCities() {
  elements.addCityBtn.addEventListener('click', () => {
    const name = prompt('اسم المدينة الجديدة:');
    if (!name) return;
    const city = { id: crypto.randomUUID(), name: name.trim() };
    state.cities.push(city);
    if (!state.selectedCityId) {
      state.selectedCityId = city.id;
    }
    persistData();
    render();
    showToast('تمت إضافة المدينة');
  });
}

function bindCustomers() {
  elements.customerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.selectedCityId) {
      showToast('اختر مدينة أولاً لإضافة العملاء');
      return;
    }
    const name = elements.customerName.value.trim();
    const start = elements.serviceStart.value;
    if (!name || !start) return;

    const customer = {
      id: crypto.randomUUID(),
      cityId: state.selectedCityId,
      name,
      startDate: start,
      lastPayment: start,
    };

    state.customers.push(customer);
    persistData();
    elements.customerForm.reset();
    autoFillToday();
    render();
    showToast('تمت إضافة العميل');
  });
}

function render() {
  renderCities();
  renderCustomers();
}

function renderCities() {
  elements.cityList.innerHTML = '';
  if (!state.cities.length) {
    elements.cityList.innerHTML = '<p class="muted">لا توجد مدن بعد. أضف مدينة للبدء.</p>';
    elements.selectedCityLabel.textContent = 'اختر مدينة لعرض العملاء';
    return;
  }

  state.cities.forEach((city) => {
    const cityNode = elements.cityItemTemplate.content.firstElementChild.cloneNode(true);
    cityNode.querySelector('.city-name').textContent = city.name;
    const count = state.customers.filter((c) => c.cityId === city.id).length;
    cityNode.querySelector('.city-count').textContent = count;

    cityNode.querySelector('.select-city').addEventListener('click', () => {
      state.selectedCityId = city.id;
      persistData();
      renderCustomers();
      elements.selectedCityLabel.textContent = `المدينة الحالية: ${city.name}`;
    });

    cityNode.querySelector('.edit-city').addEventListener('click', () => {
      const name = prompt('تعديل اسم المدينة:', city.name);
      if (!name) return;
      city.name = name.trim();
      if (state.selectedCityId === city.id) {
        elements.selectedCityLabel.textContent = `المدينة الحالية: ${city.name}`;
      }
      persistData();
      renderCities();
      showToast('تم تحديث اسم المدينة');
    });

    elements.cityList.appendChild(cityNode);
  });

  if (state.selectedCityId) {
    const selected = state.cities.find((c) => c.id === state.selectedCityId);
    elements.selectedCityLabel.textContent = selected
      ? `المدينة الحالية: ${selected.name}`
      : 'اختر مدينة لعرض العملاء';
  }
}

function renderCustomers() {
  elements.customerList.innerHTML = '';

  if (!state.selectedCityId) {
    elements.customerList.innerHTML = '<p class="muted">اختر مدينة لعرض العملاء.</p>';
    return;
  }

  const customers = state.customers.filter((c) => c.cityId === state.selectedCityId);
  if (!customers.length) {
    elements.customerList.innerHTML = '<p class="muted">لا يوجد عملاء في هذه المدينة حتى الآن.</p>';
    return;
  }

  customers
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    .forEach((customer) => {
      const node = elements.customerItemTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector('.customer-name').textContent = customer.name;
      node.querySelector('.customer-start').textContent = formatDate(customer.startDate);
      node.querySelector('.customer-last-payment').textContent = formatDate(customer.lastPayment);

      const { status, label, expirationText } = computeStatus(customer);
      const badge = node.querySelector('.status-badge');
      badge.textContent = label;
      badge.classList.add(status);
      node.querySelector('.expiration').textContent = expirationText;

      node.querySelector('.mark-paid').addEventListener('click', () => {
        customer.lastPayment = new Date().toISOString().slice(0, 10);
        persistData();
        renderCustomers();
        showToast(`تم تسجيل سداد للعميل ${customer.name}`);
      });

      elements.customerList.appendChild(node);
    });
}

function computeStatus(customer) {
  const expiration = addMonths(new Date(customer.lastPayment), 1);
  const today = new Date();
  const diffDays = Math.floor((expiration - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'expired', label: 'منتهي', expirationText: 'انتهى الاشتراك' };
  }
  if (diffDays <= 5) {
    return { status: 'warning', label: 'يحتاج تجديد', expirationText: `متبقي ${diffDays} يوم` };
  }
  return { status: 'active', label: 'نشط', expirationText: `متبقي ${diffDays} يوم` };
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function autoFillToday() {
  const today = new Date().toISOString().slice(0, 10);
  elements.serviceStart.value = today;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  elements.toast.classList.add('show');
  setTimeout(() => {
    elements.toast.classList.remove('show');
    elements.toast.hidden = true;
  }, 2200);
}

init();

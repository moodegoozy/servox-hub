# أمر جاهز: إضافة تبويب "الأبراج" (Towers) — طبق الأصل

انسخ كامل هذا الملف والصقه لـ Claude Code (أو أي وكيل) داخل **المشروع الثاني**.
هو تعليمات مكتفية بذاتها لإضافة تبويب "الأبراج" مطابقاً تماماً للنسخة الأصلية.

> ⚠️ هذا مشروع React + TypeScript + Vite، كل المنطق في ملف واحد ضخم `frontend/src/App.tsx`،
> والتنسيقات في `frontend/src/index.css`. حافظ على النصوص العربية واتجاه RTL. لا تعِد هيكلة الكود —
> فقط أضِف الكتل التالية في أماكنها المحددة عبر البحث عن نص الربط (anchor) المذكور.
> لكل خطوة: ابحث عن نص الربط، ثم أدرج الكود الجديد. لا تكرر الإدراج إن وُجد التبويب مسبقاً.

---

## الخطوة 1 — الأنواع + ثابت الحالات
**نقطة الربط:** ابحث عن `const MONTHS_AR = [` في `frontend/src/App.tsx`، وأدرج قبله مباشرة (بعد تعريف `type Card`):

```ts
type TowerStatus = 'working' | 'not-working' | 'cancelled';

type Tower = {
  id: string;
  deviceName: string;
  ipNumber?: string;
  cityId: string;
  towerNumber?: string;
  status: TowerStatus;
  info?: string;
  image?: string; // صورة البرج كـ data URL مضغوطة
  createdAt?: string;
};
```

وبعد سطر `const MONTHS_AR = [...]` مباشرة، أضِف:

```ts
const TOWER_STATUS: Record<TowerStatus, { label: string; icon: string; cls: string }> = {
  'working': { label: 'يعمل', icon: '🟢', cls: 'working' },
  'not-working': { label: 'لا يعمل', icon: '🔴', cls: 'not-working' },
  'cancelled': { label: 'ملغي', icon: '⚫', cls: 'cancelled' },
};
```

---

## الخطوة 2 — إضافة التبويب لنوع `activeTab`
**نقطة الربط:** ابحث عن `const [activeTab, setActiveTab] = useState<` وأضِف `| 'towers'` إلى نهاية الـ union قبل `>(`.
مثال (النسخة الأصلية تنتهي بـ `... | 'cards'`):

```ts
// قبل:
const [activeTab, setActiveTab] = useState<'dashboard' | 'invoices' | 'yearly' | 'revenues' | 'discounts' | 'suspended' | 'expenses' | 'microtik' | 'customers-db' | 'cards'>('dashboard');
// بعد: أضِف | 'towers' قبل علامة >
... | 'customers-db' | 'cards' | 'towers'>('dashboard');
```

---

## الخطوة 3 — متغيّرات الحالة (State)
**نقطة الربط:** ابحث عن `const selectedCity = useMemo(` وأدرج قبله مباشرة:

```ts
  // نظام الأبراج
  const [towers, setTowers] = useState<Tower[]>([]);
  const [showAddTowerForm, setShowAddTowerForm] = useState(false);
  const [towerDeviceName, setTowerDeviceName] = useState('');
  const [towerIpNumber, setTowerIpNumber] = useState('');
  const [towerCityId, setTowerCityId] = useState('');
  const [towerNumber, setTowerNumber] = useState('');
  const [towerStatus, setTowerStatus] = useState<TowerStatus>('working');
  const [towerInfo, setTowerInfo] = useState('');
  const [towerImage, setTowerImage] = useState('');
  const [towerImageLoading, setTowerImageLoading] = useState(false);
  const [towerSearch, setTowerSearch] = useState('');
  const [towerFilterCityId, setTowerFilterCityId] = useState<string | null>(null);
  const [towerStatusFilter, setTowerStatusFilter] = useState<'all' | TowerStatus>('all');
  const [editingTower, setEditingTower] = useState<Tower | null>(null);
  const [showEditTowerModal, setShowEditTowerModal] = useState(false);
  const [editTowerImageLoading, setEditTowerImageLoading] = useState(false);
  const [towerDeleteConfirm, setTowerDeleteConfirm] = useState<Tower | null>(null);
  const [towerDeletePassword, setTowerDeletePassword] = useState('');
  const [towerDeleteLoading, setTowerDeleteLoading] = useState(false);
  const [towerImagePreview, setTowerImagePreview] = useState<string | null>(null);
```

> إن لم تجد `const selectedCity = useMemo(`، أدرج هذه الكتلة بعد آخر تعريف `useState` في مكوّن `App` مباشرة.

---

## الخطوة 4 — الدوال (ضغط الصور + CRUD)
**نقطة الربط:** ابحث عن دالة `printCardsReportPdf` (أو تعليق `// دالة طباعة تقرير البطاقات PDF`) وأدرج هذه الكتلة **قبلها مباشرة** (أي بعد نهاية دالة `confirmDeleteCard`). إن لم توجد، أدرجها بعد أي دالة async أخرى داخل المكوّن:

```ts
  // === نظام الأبراج ===
  // ضغط الصورة وتحويلها إلى data URL بحجم مناسب للتخزين في Firestore
  const compressImage = (file: File, maxDim = 1000, quality = 0.72): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas context unavailable')); return; }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('image load failed'));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error('file read failed'));
      reader.readAsDataURL(file);
    });

  const handleTowerImageFile = async (file: File | undefined, forEdit = false) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setToastMessage('يجب اختيار ملف صورة'); return; }
    try {
      if (forEdit) setEditTowerImageLoading(true); else setTowerImageLoading(true);
      const dataUrl = await compressImage(file);
      if (forEdit) {
        setEditingTower(prev => (prev ? { ...prev, image: dataUrl } : prev));
      } else {
        setTowerImage(dataUrl);
      }
    } catch {
      setToastMessage('خطأ في معالجة الصورة');
    } finally {
      if (forEdit) setEditTowerImageLoading(false); else setTowerImageLoading(false);
    }
  };

  const resetTowerForm = () => {
    setTowerDeviceName('');
    setTowerIpNumber('');
    setTowerCityId('');
    setTowerNumber('');
    setTowerStatus('working');
    setTowerInfo('');
    setTowerImage('');
  };

  const addTower = async () => {
    if (!towerDeviceName.trim()) { setToastMessage('أدخل اسم الجهاز'); return; }
    if (!towerCityId) { setToastMessage('اختر المدينة'); return; }
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const towerData: Record<string, unknown> = {
        deviceName: towerDeviceName.trim(),
        cityId: towerCityId,
        status: towerStatus,
        createdAt: todayISO(),
      };
      if (towerIpNumber.trim()) towerData.ipNumber = towerIpNumber.trim();
      if (towerNumber.trim()) towerData.towerNumber = towerNumber.trim();
      if (towerInfo.trim()) towerData.info = towerInfo.trim();
      if (towerImage) towerData.image = towerImage;

      await setDoc(doc(db, 'towers', id), towerData);
      resetTowerForm();
      setShowAddTowerForm(false);
      setToastMessage(`تم إضافة البرج: ${towerData.deviceName}`);
    } catch (error) {
      setToastMessage('خطأ في إضافة البرج');
      console.error(error);
    }
  };

  // بناء بيانات البرج للحفظ (بدون المفتاح id ودون الحقول الفارغة)
  const buildTowerDoc = (tower: Tower): Record<string, unknown> => {
    const data: Record<string, unknown> = {
      deviceName: tower.deviceName.trim(),
      cityId: tower.cityId,
      status: tower.status,
    };
    if (tower.ipNumber && tower.ipNumber.trim()) data.ipNumber = tower.ipNumber.trim();
    if (tower.towerNumber && tower.towerNumber.trim()) data.towerNumber = tower.towerNumber.trim();
    if (tower.info && tower.info.trim()) data.info = tower.info.trim();
    if (tower.image) data.image = tower.image;
    if (tower.createdAt) data.createdAt = tower.createdAt;
    return data;
  };

  // تغيير حالة الجهاز يدوياً (يعمل → لا يعمل → ملغي → ...)
  const cycleTowerStatus = async (tower: Tower) => {
    const order: TowerStatus[] = ['working', 'not-working', 'cancelled'];
    const next = order[(order.indexOf(tower.status) + 1) % order.length];
    try {
      await setDoc(doc(db, 'towers', tower.id), { ...buildTowerDoc(tower), status: next });
      setToastMessage(`حالة ${tower.deviceName}: ${TOWER_STATUS[next].label}`);
    } catch (error) {
      setToastMessage('خطأ في تغيير الحالة');
      console.error(error);
    }
  };

  const openEditTower = (tower: Tower) => {
    setEditingTower({ ...tower });
    setShowEditTowerModal(true);
  };

  const saveEditedTower = async () => {
    if (!editingTower) return;
    if (!editingTower.deviceName.trim()) { setToastMessage('أدخل اسم الجهاز'); return; }
    if (!editingTower.cityId) { setToastMessage('اختر المدينة'); return; }
    try {
      await setDoc(doc(db, 'towers', editingTower.id), buildTowerDoc(editingTower));
      setToastMessage(`تم تعديل البرج: ${editingTower.deviceName.trim()}`);
      setShowEditTowerModal(false);
      setEditingTower(null);
    } catch (error) {
      setToastMessage('خطأ في تعديل البرج');
      console.error(error);
    }
  };

  const confirmDeleteTower = async () => {
    if (!towerDeleteConfirm || !towerDeletePassword.trim()) { setToastMessage('أدخل كلمة المرور'); return; }
    setTowerDeleteLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
      const credential = EmailAuthProvider.credential(user.email, towerDeletePassword);
      await reauthenticateWithCredential(user, credential);
      await deleteDoc(doc(db, 'towers', towerDeleteConfirm.id));
      setToastMessage(`تم حذف البرج: ${towerDeleteConfirm.deviceName}`);
      setTowerDeleteConfirm(null);
      setTowerDeletePassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في التحقق');
        console.error(error);
      }
    } finally {
      setTowerDeleteLoading(false);
    }
  };
```

> تأكد أن الاستيرادات التالية موجودة أعلى الملف (موجودة أصلاً في النسخة الأصلية):
> `setDoc, doc, deleteDoc, onSnapshot, collection` من `firebase/firestore` و
> `EmailAuthProvider, reauthenticateWithCredential` من `firebase/auth`، وأن `todayISO` معرّفة.

---

## الخطوة 5 — اشتراك Firestore + التنظيف
**نقطة الربط:** ابحث عن اشتراك مجموعة cards:

```ts
    // Listen to cards collection
    const unsubscribeCards = onSnapshot(collection(db, 'cards'), (snapshot) => {
      const cardsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Card));
      setCards(cardsData);
    });
```

أضِف **بعده مباشرة**:

```ts
    // Listen to towers collection
    const unsubscribeTowers = onSnapshot(collection(db, 'towers'), (snapshot) => {
      const towersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tower));
      setTowers(towersData);
    });
```

ثم في دالة التنظيف `return () => { ... }` لنفس الـ `useEffect`، أضِف السطر `unsubscribeTowers();` بعد `unsubscribeCards();`.

---

## الخطوة 6 — زر التبويب
**نقطة الربط:** ابحث عن زر تبويب البطاقات:

```tsx
        <button className={`tab-btn ${activeTab === 'cards' ? 'active' : ''}`} onClick={() => setActiveTab('cards')}>البطاقات</button>
```

أضِف **بعده مباشرة**:

```tsx
        <button className={`tab-btn ${activeTab === 'towers' ? 'active' : ''}`} onClick={() => setActiveTab('towers')}>الأبراج</button>
```

---

## الخطوة 7 — تعطيل البحث العلوي في تبويب الأبراج
في مربّع البحث العلوي أضِف `|| activeTab === 'towers'` إلى الشرطين:

- في الـ `placeholder`: ابحث عن `activeTab === 'expenses' || activeTab === 'microtik' || activeTab === 'cards'` (السطر الذي يليه `? 'البحث غير متاح`) وأضِف `|| activeTab === 'towers'`.
- في خاصية `disabled` لنفس الـ input: نفس الشيء — أضِف `|| activeTab === 'towers'`.

---

## الخطوة 8 — قسم واجهة التبويب (JSX)
**نقطة الربط:** ابحث عن نهاية قسم البطاقات المتبوعة بتعليق نافذة النقل:

```tsx
        })()}

      {/* Transfer Customer Modal */}
```

أدرج قسم الأبراج **بين** `})()}` وسطر `{/* Transfer Customer Modal */}`:

```tsx
        {activeTab === 'towers' && (() => {
          let list = towerFilterCityId ? towers.filter(t => t.cityId === towerFilterCityId) : towers;
          if (towerStatusFilter !== 'all') list = list.filter(t => t.status === towerStatusFilter);
          if (towerSearch.trim()) {
            const q = towerSearch.trim().toLowerCase();
            list = list.filter(t =>
              t.deviceName.toLowerCase().includes(q) ||
              (t.ipNumber && t.ipNumber.toLowerCase().includes(q)) ||
              (t.towerNumber && t.towerNumber.toLowerCase().includes(q))
            );
          }
          const sorted = [...list].sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'ar'));
          const total = towers.length;
          const workingCount = towers.filter(t => t.status === 'working').length;
          const notWorkingCount = towers.filter(t => t.status === 'not-working').length;
          const cancelledCount = towers.filter(t => t.status === 'cancelled').length;

          return (
          <div className="section towers-section">
            {/* Hero */}
            <div className="towers-hero">
              <div className="towers-hero-content">
                <div className="towers-hero-icon">📡</div>
                <div>
                  <h2 className="towers-hero-title">إدارة الأبراج</h2>
                  <p className="towers-hero-subtitle">متابعة أجهزة الأبراج وحالتها في جميع المدن</p>
                </div>
              </div>
              <div className="towers-hero-actions">
                <button className="towers-add-btn" onClick={() => setShowAddTowerForm(v => !v)}>
                  {showAddTowerForm ? '✕ إغلاق' : '+ إضافة برج'}
                </button>
              </div>
            </div>

            {/* Stats — clickable filters */}
            <div className="towers-stats">
              <div className={`towers-stat-card towers-stat-total ${towerStatusFilter === 'all' ? 'active' : ''}`} onClick={() => setTowerStatusFilter('all')}>
                <div className="towers-stat-icon">📡</div>
                <div className="towers-stat-info">
                  <div className="towers-stat-value">{total}</div>
                  <div className="towers-stat-label">إجمالي الأبراج</div>
                </div>
              </div>
              <div className={`towers-stat-card towers-stat-working ${towerStatusFilter === 'working' ? 'active' : ''}`} onClick={() => setTowerStatusFilter(towerStatusFilter === 'working' ? 'all' : 'working')}>
                <div className="towers-stat-icon">🟢</div>
                <div className="towers-stat-info">
                  <div className="towers-stat-value">{workingCount}</div>
                  <div className="towers-stat-label">يعمل</div>
                </div>
              </div>
              <div className={`towers-stat-card towers-stat-down ${towerStatusFilter === 'not-working' ? 'active' : ''}`} onClick={() => setTowerStatusFilter(towerStatusFilter === 'not-working' ? 'all' : 'not-working')}>
                <div className="towers-stat-icon">🔴</div>
                <div className="towers-stat-info">
                  <div className="towers-stat-value">{notWorkingCount}</div>
                  <div className="towers-stat-label">لا يعمل</div>
                </div>
              </div>
              <div className={`towers-stat-card towers-stat-cancelled ${towerStatusFilter === 'cancelled' ? 'active' : ''}`} onClick={() => setTowerStatusFilter(towerStatusFilter === 'cancelled' ? 'all' : 'cancelled')}>
                <div className="towers-stat-icon">⚫</div>
                <div className="towers-stat-info">
                  <div className="towers-stat-value">{cancelledCount}</div>
                  <div className="towers-stat-label">ملغي</div>
                </div>
              </div>
            </div>

            {/* Add Tower Form */}
            {showAddTowerForm && (
              <div className="towers-form-wrapper">
                <div className="towers-form">
                  <div className="towers-form-layout">
                    <div className="tower-image-uploader">
                      <label className="tower-image-drop">
                        {towerImage ? (
                          <img src={towerImage} className="tower-image-preview-img" alt="صورة البرج" />
                        ) : (
                          <div className="tower-image-placeholder">
                            <span className="tower-image-placeholder-icon">🖼️</span>
                            <span>{towerImageLoading ? 'جارٍ المعالجة...' : 'اضغط لاختيار صورة البرج'}</span>
                          </div>
                        )}
                        <input type="file" accept="image/*" hidden onChange={(e) => handleTowerImageFile(e.target.files?.[0])} />
                      </label>
                      {towerImage && <button type="button" className="tower-image-remove" onClick={() => setTowerImage('')}>✕ إزالة الصورة</button>}
                    </div>
                    <div className="towers-form-grid">
                      <div className="cards-field">
                        <label>اسم الجهاز</label>
                        <input type="text" value={towerDeviceName} onChange={(e) => setTowerDeviceName(e.target.value)} placeholder="مثال: راوتر البرج الرئيسي" />
                      </div>
                      <div className="cards-field">
                        <label>IP NUMBER</label>
                        <input type="text" dir="ltr" value={towerIpNumber} onChange={(e) => setTowerIpNumber(e.target.value)} placeholder="192.168.1.1" />
                      </div>
                      <div className="cards-field">
                        <label>المدينة</label>
                        <select value={towerCityId} onChange={(e) => setTowerCityId(e.target.value)}>
                          <option value="">-- اختر المدينة --</option>
                          {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="cards-field">
                        <label>رقم البرج</label>
                        <input type="text" value={towerNumber} onChange={(e) => setTowerNumber(e.target.value)} placeholder="مثال: T-12" />
                      </div>
                      <div className="cards-field">
                        <label>حالة الجهاز</label>
                        <select value={towerStatus} onChange={(e) => setTowerStatus(e.target.value as TowerStatus)}>
                          <option value="working">يعمل</option>
                          <option value="not-working">لا يعمل</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                      </div>
                      <div className="cards-field cards-field-wide">
                        <label>معلومات الجهاز <span style={{ opacity: 0.5 }}>(اختياري)</span></label>
                        <textarea value={towerInfo} onChange={(e) => setTowerInfo(e.target.value)} placeholder="تفاصيل إضافية عن الجهاز أو البرج..." rows={3} />
                      </div>
                    </div>
                  </div>
                  <button className="cards-submit-btn" onClick={addTower}>📡 إضافة البرج</button>
                </div>
              </div>
            )}

            {/* Toolbar: search + city filter */}
            <div className="towers-toolbar">
              <div className="cards-search-wrapper towers-search">
                <span className="cards-search-icon">🔍</span>
                <input
                  type="text"
                  className="cards-search-input"
                  placeholder="ابحث باسم الجهاز أو IP أو رقم البرج..."
                  value={towerSearch}
                  onChange={(e) => setTowerSearch(e.target.value)}
                />
                {towerSearch && <button className="cards-search-clear" onClick={() => setTowerSearch('')}>✕</button>}
              </div>
              <select className="cards-select" value={towerFilterCityId ?? ''} onChange={(e) => setTowerFilterCityId(e.target.value || null)}>
                <option value="">كل المدن</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Grid */}
            {sorted.length === 0 ? (
              <div className="cards-empty">
                <div className="cards-empty-icon">📡</div>
                <p>{towers.length === 0 ? 'لا توجد أبراج بعد — اضغط "إضافة برج" للبدء' : 'لا توجد أبراج مطابقة للفلتر'}</p>
              </div>
            ) : (
              <div className="towers-grid">
                {sorted.map(tower => {
                  const city = cities.find(c => c.id === tower.cityId);
                  const st = TOWER_STATUS[tower.status];
                  return (
                    <div key={tower.id} className={`tower-card status-${st.cls}`}>
                      <div className="tower-card-image" onClick={() => tower.image && setTowerImagePreview(tower.image)} style={{ cursor: tower.image ? 'zoom-in' : 'default' }}>
                        {tower.image ? (
                          <img src={tower.image} alt={tower.deviceName} />
                        ) : (
                          <div className="tower-card-noimage">📡</div>
                        )}
                        <span className={`tower-status-badge ${st.cls}`}>{st.icon} {st.label}</span>
                      </div>
                      <div className="tower-card-body">
                        <h3 className="tower-card-name">{tower.deviceName}</h3>
                        <div className="tower-card-meta">
                          <div className="tower-meta-row">
                            <span className="tower-meta-label">المدينة</span>
                            <span className="tower-meta-value">{city?.name || '—'}</span>
                          </div>
                          <div className="tower-meta-row">
                            <span className="tower-meta-label">رقم البرج</span>
                            <span className="tower-meta-value">{tower.towerNumber || '—'}</span>
                          </div>
                          <div className="tower-meta-row">
                            <span className="tower-meta-label">IP</span>
                            <span className="tower-meta-value ltr">{tower.ipNumber || '—'}</span>
                          </div>
                        </div>
                        {tower.info && <p className="tower-card-info">{tower.info}</p>}
                        <div className="tower-card-actions">
                          <button className="tower-action-status" onClick={() => cycleTowerStatus(tower)} title="تغيير حالة الجهاز">🔄 الحالة</button>
                          <button className="tower-action-edit" onClick={() => openEditTower(tower)}>✏️ تعديل</button>
                          <button className="tower-action-delete" onClick={() => setTowerDeleteConfirm(tower)} title="حذف">🗑️</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })()}
```

> إن لم تجد `{/* Transfer Customer Modal */}`، أدرج القسم أعلاه بعد آخر قسم `{activeTab === '...' && (` مباشرةً وقبل النوافذ (modals) في نهاية الـ JSX.

---

## الخطوة 9 — النوافذ (Modals): تعديل + حذف + معاينة الصورة
**نقطة الربط:** ابحث عن سطر التوست في نهاية الـ JSX:

```tsx
      {toastMessage && <div className="toast">{toastMessage}</div>}
```

أدرج **قبله مباشرة**:

```tsx
      {/* Edit Tower Modal */}
      {showEditTowerModal && editingTower && (
        <div className="modal-overlay" onClick={() => { setShowEditTowerModal(false); setEditingTower(null); }}>
          <div className="modal tower-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تعديل معلومات الجهاز</h3>
              <button onClick={() => { setShowEditTowerModal(false); setEditingTower(null); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="tower-image-uploader">
                <label className="tower-image-drop">
                  {editingTower.image ? (
                    <img src={editingTower.image} className="tower-image-preview-img" alt="صورة البرج" />
                  ) : (
                    <div className="tower-image-placeholder">
                      <span className="tower-image-placeholder-icon">🖼️</span>
                      <span>{editTowerImageLoading ? 'جارٍ المعالجة...' : 'اضغط لاختيار صورة البرج'}</span>
                    </div>
                  )}
                  <input type="file" accept="image/*" hidden onChange={(e) => handleTowerImageFile(e.target.files?.[0], true)} />
                </label>
                {editingTower.image && <button type="button" className="tower-image-remove" onClick={() => setEditingTower(prev => (prev ? { ...prev, image: '' } : prev))}>✕ إزالة الصورة</button>}
              </div>
              <div className="edit-field">
                <label>اسم الجهاز</label>
                <input type="text" className="input" value={editingTower.deviceName} onChange={(e) => setEditingTower({ ...editingTower, deviceName: e.target.value })} />
              </div>
              <div className="edit-field">
                <label>IP NUMBER</label>
                <input type="text" dir="ltr" className="input" value={editingTower.ipNumber || ''} onChange={(e) => setEditingTower({ ...editingTower, ipNumber: e.target.value })} />
              </div>
              <div className="edit-field">
                <label>المدينة</label>
                <select className="input" value={editingTower.cityId} onChange={(e) => setEditingTower({ ...editingTower, cityId: e.target.value })}>
                  <option value="">-- اختر المدينة --</option>
                  {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="edit-field">
                <label>رقم البرج</label>
                <input type="text" className="input" value={editingTower.towerNumber || ''} onChange={(e) => setEditingTower({ ...editingTower, towerNumber: e.target.value })} />
              </div>
              <div className="edit-field">
                <label>حالة الجهاز</label>
                <select className="input" value={editingTower.status} onChange={(e) => setEditingTower({ ...editingTower, status: e.target.value as TowerStatus })}>
                  <option value="working">يعمل</option>
                  <option value="not-working">لا يعمل</option>
                  <option value="cancelled">ملغي</option>
                </select>
              </div>
              <div className="edit-field">
                <label>معلومات الجهاز</label>
                <textarea className="input" rows={3} value={editingTower.info || ''} onChange={(e) => setEditingTower({ ...editingTower, info: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setShowEditTowerModal(false); setEditingTower(null); }} className="btn secondary">إلغاء</button>
              <button onClick={saveEditedTower} className="btn primary">حفظ التعديلات</button>
            </div>
          </div>
        </div>
      )}

      {/* Tower Delete Confirm Modal */}
      {towerDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setTowerDeleteConfirm(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>حذف برج</h3>
              <button onClick={() => setTowerDeleteConfirm(null)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                هل تريد حذف البرج <strong>{towerDeleteConfirm.deviceName}</strong>؟
              </p>
              <div className="edit-field">
                <label>أدخل كلمة المرور للتأكيد</label>
                <input
                  type="password"
                  value={towerDeletePassword}
                  onChange={(e) => setTowerDeletePassword(e.target.value)}
                  placeholder="كلمة المرور"
                  onKeyDown={(e) => e.key === 'Enter' && confirmDeleteTower()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setTowerDeleteConfirm(null)} className="btn secondary">إلغاء</button>
              <button onClick={confirmDeleteTower} className="btn danger" disabled={towerDeleteLoading}>
                {towerDeleteLoading ? 'جاري الحذف...' : 'حذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tower Image Preview Lightbox */}
      {towerImagePreview && (
        <div className="tower-lightbox" onClick={() => setTowerImagePreview(null)}>
          <button className="tower-lightbox-close" onClick={() => setTowerImagePreview(null)}>×</button>
          <img src={towerImagePreview} alt="صورة البرج" className="tower-lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
```

---

## الخطوة 10 — التنسيقات (CSS)
أضِف الكتلة التالية في **نهاية** ملف `frontend/src/index.css`:

```css
/* ==========================================================================
   نظام الأبراج — Towers
   ========================================================================== */
.towers-section {
  max-width: 1200px;
  margin: 0 auto;
}

/* Hero */
.towers-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 28px 32px;
  background: linear-gradient(135deg, #0f172a 0%, #14304a 55%, #0e7490 130%);
  border-radius: 20px;
  margin-bottom: 24px;
  position: relative;
  overflow: hidden;
}

.towers-hero::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -15%;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(6, 182, 212, 0.18) 0%, transparent 70%);
  border-radius: 50%;
}

.towers-hero-content {
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 1;
}

.towers-hero-icon {
  font-size: 34px;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
}

.towers-hero-title {
  color: #f0f9ff;
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}

.towers-hero-subtitle {
  color: #a5c9d8;
  font-size: 14px;
  margin: 4px 0 0;
}

.towers-hero-actions {
  z-index: 1;
}

.towers-add-btn {
  padding: 12px 28px;
  background: linear-gradient(135deg, #06b6d4 0%, #0ea5e9 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-family: 'Cairo', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(14, 165, 233, 0.4);
}

.towers-add-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(14, 165, 233, 0.5);
}

/* Stats */
.towers-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.towers-stat-card {
  padding: 18px 20px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}

.towers-stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.towers-stat-card.active {
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.25);
}

.towers-stat-total {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  border-color: #bfdbfe;
}
.towers-stat-working {
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  border-color: #a7f3d0;
}
.towers-stat-down {
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border-color: #fecaca;
}
.towers-stat-cancelled {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-color: #e2e8f0;
}

.towers-stat-icon {
  font-size: 24px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.towers-stat-value {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.1;
}

.towers-stat-label {
  font-size: 13px;
  color: var(--text-light);
  font-weight: 600;
  margin-top: 2px;
}

/* Add / Edit form */
.towers-form-wrapper {
  animation: cardSlideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  margin-bottom: 24px;
}

.towers-form {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
}

.towers-form-layout {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
  align-items: flex-start;
}

.towers-form-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  align-content: start;
}

/* Image uploader */
.tower-image-uploader {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tower-image-drop {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border: 2px dashed var(--border);
  border-radius: 14px;
  background: var(--input-bg, #fafbfc);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
  position: relative;
}

.tower-image-drop:hover {
  border-color: #06b6d4;
  background: rgba(6, 182, 212, 0.05);
}

.tower-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-light);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  padding: 12px;
}

.tower-image-placeholder-icon {
  font-size: 38px;
  opacity: 0.7;
}

.tower-image-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tower-image-remove {
  padding: 8px;
  background: var(--danger-bg);
  color: var(--danger-text);
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: 'Cairo', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.2s;
}

.tower-image-remove:hover { filter: brightness(0.95); }

/* Textareas inside towers forms */
.cards-field textarea,
.towers-section textarea,
.tower-edit-modal textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  font-family: 'Cairo', sans-serif;
  font-size: 14px;
  color: var(--text);
  background: var(--input-bg, #fafbfc);
  resize: vertical;
  min-height: 76px;
  transition: all 0.2s;
}

.cards-field textarea:focus,
.towers-section textarea:focus,
.tower-edit-modal textarea:focus {
  outline: none;
  border-color: #06b6d4;
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.12);
}

/* Toolbar */
.towers-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 22px;
  flex-wrap: wrap;
}

.towers-search {
  flex: 1;
  min-width: 220px;
  margin-bottom: 0;
}

/* Grid */
.towers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 18px;
}

.tower-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s, box-shadow 0.2s;
  display: flex;
  flex-direction: column;
}

.tower-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
}

.tower-card.status-working { border-top: 4px solid #10b981; }
.tower-card.status-not-working { border-top: 4px solid #ef4444; }
.tower-card.status-cancelled { border-top: 4px solid #94a3b8; }

.tower-card-image {
  position: relative;
  height: 180px;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tower-card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tower-card-noimage {
  font-size: 54px;
  opacity: 0.55;
  filter: grayscale(0.2);
}

.tower-status-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  backdrop-filter: blur(6px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.tower-status-badge.working { background: rgba(16, 185, 129, 0.92); }
.tower-status-badge.not-working { background: rgba(239, 68, 68, 0.92); }
.tower-status-badge.cancelled { background: rgba(100, 116, 139, 0.92); }

.tower-card-body {
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.tower-card-name {
  font-size: 17px;
  font-weight: 800;
  color: var(--text);
  margin: 0;
}

.tower-card-meta {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.tower-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
}

.tower-meta-label {
  color: var(--text-light);
  font-weight: 600;
}

.tower-meta-value {
  color: var(--text);
  font-weight: 700;
  text-align: left;
  word-break: break-word;
}

.tower-meta-value.ltr {
  direction: ltr;
  font-family: 'Courier New', monospace;
}

.tower-card-info {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-light);
  background: var(--bg-flat, #f8fafc);
  border-radius: 10px;
  padding: 10px 12px;
}

.tower-card-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 4px;
}

.tower-action-status,
.tower-action-edit {
  flex: 1;
  padding: 9px 10px;
  border: none;
  border-radius: 10px;
  font-family: 'Cairo', sans-serif;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.2s, transform 0.15s;
}

.tower-action-status {
  background: linear-gradient(135deg, #06b6d4 0%, #0ea5e9 100%);
  color: #fff;
}

.tower-action-edit {
  background: var(--primary-glow);
  color: var(--primary);
}

.tower-action-status:hover,
.tower-action-edit:hover { transform: translateY(-1px); filter: brightness(1.05); }

.tower-action-delete {
  width: 40px;
  border: none;
  border-radius: 10px;
  background: var(--danger-bg);
  color: var(--danger-text);
  font-size: 15px;
  cursor: pointer;
  transition: filter 0.2s;
}

.tower-action-delete:hover { filter: brightness(0.95); }

/* Edit modal */
.tower-edit-modal {
  max-width: 520px;
  width: 92%;
  max-height: 90vh;
  overflow-y: auto;
}

.tower-edit-modal .tower-image-uploader {
  width: 100%;
  margin-bottom: 16px;
}

.tower-edit-modal .tower-image-drop {
  aspect-ratio: 16 / 9;
}

/* Image lightbox */
.tower-lightbox {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(2, 6, 23, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: cardSlideDown 0.2s ease;
}

.tower-lightbox-img {
  max-width: 92vw;
  max-height: 88vh;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  object-fit: contain;
}

.tower-lightbox-close {
  position: absolute;
  top: 20px;
  left: 24px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.2s;
}

.tower-lightbox-close:hover { background: rgba(255, 255, 255, 0.24); }

/* --- Dark theme --- */
[data-theme="dark"] .towers-stat-card {
  background: var(--card) !important;
  border-color: var(--border) !important;
}
[data-theme="dark"] .towers-stat-total { border-color: rgba(59, 130, 246, 0.35) !important; }
[data-theme="dark"] .towers-stat-working { border-color: rgba(16, 185, 129, 0.35) !important; }
[data-theme="dark"] .towers-stat-down { border-color: rgba(239, 68, 68, 0.35) !important; }
[data-theme="dark"] .towers-stat-cancelled { border-color: rgba(148, 163, 184, 0.3) !important; }
[data-theme="dark"] .towers-stat-icon { background: rgba(15, 23, 42, 0.6); }

[data-theme="dark"] .towers-form {
  background: rgba(15, 23, 42, 0.8) !important;
  border-color: rgba(6, 182, 212, 0.2) !important;
}

[data-theme="dark"] .tower-image-drop {
  background: rgba(15, 23, 42, 0.6);
  border-color: rgba(6, 182, 212, 0.3);
}

[data-theme="dark"] .cards-field textarea,
[data-theme="dark"] .towers-section textarea,
[data-theme="dark"] .tower-edit-modal textarea {
  background: rgba(15, 23, 42, 0.6) !important;
  border-color: rgba(6, 182, 212, 0.3) !important;
  color: #e2e8f0 !important;
}

[data-theme="dark"] .tower-card {
  background: rgba(15, 23, 42, 0.8) !important;
  border-color: var(--border) !important;
}

[data-theme="dark"] .tower-card-info {
  background: rgba(15, 23, 42, 0.6) !important;
}

[data-theme="dark"] .tower-action-edit {
  background: rgba(99, 102, 241, 0.2);
  color: var(--primary-light);
}

/* Responsive */
@media (max-width: 720px) {
  .towers-hero { flex-direction: column; gap: 16px; text-align: center; }
  .towers-stats { grid-template-columns: repeat(2, 1fr); }
  .towers-form-layout { flex-direction: column; }
  .tower-image-uploader { width: 100%; }
}
```

---

## الخطوة 11 — قواعد Firestore
في ملف `firestore.rules`، وداخل `match /databases/{database}/documents { ... }`، أضِف مجموعة الأبراج (بعد كتلة `match /cards/...` مثلاً):

```
    match /towers/{towerId} {
      allow read, write: if request.auth != null;
    }
```

---

## الخطوة 12 — التحقق والبناء والنشر
من مجلد `frontend`:

```bash
npm install        # تأكد أن firebase و html2pdf.js ضمن dependencies في package.json
npm run lint       # tsc --noEmit — يجب أن يمر بدون أخطاء متعلقة بالأبراج
npm run build
```

> إن ظهر خطأ "Cannot find module 'firebase/...'": أضِف إلى `frontend/package.json` ضمن `dependencies`:
> `"firebase": "^12.16.0"` و `"html2pdf.js": "^0.14.0"` ثم `npm install`.

ثم النشر (من جذر المشروع):

```bash
firebase deploy --only firestore:rules --project <PROJECT_ID>
firebase deploy --only hosting --project <PROJECT_ID>
```

استبدل `<PROJECT_ID>` بمعرّف مشروع Firebase الثاني (موجود في `.firebaserc`).

---

## ملخص السلوك (للتحقق النهائي)
- تبويب "الأبراج" يظهر في شريط التبويبات.
- زر "إضافة برج" يفتح نموذجاً فيه: صورة البرج، اسم الجهاز، IP NUMBER، المدينة (قائمة من المدن المضافة)، رقم البرج، حالة الجهاز (يعمل/لا يعمل/ملغي)، معلومات الجهاز.
- كل برج يظهر كبطاقة مع صورته وشارة الحالة الملوّنة، وأزرار: تغيير الحالة (🔄)، تعديل (✏️)، حذف (🗑️ محمي بكلمة المرور).
- بطاقات إحصائية علوية قابلة للنقر كفلاتر + بحث + فلتر بالمدينة + معاينة الصورة بالضغط عليها.
- الصور تُضغط في المتصفح وتُخزَّن كـ data URL داخل مجموعة `towers` في Firestore.
```

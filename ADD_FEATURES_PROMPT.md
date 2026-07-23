# أمر جاهز: نقل الإضافات الجديدة (البصمة + البروفايل + واتساب + الشات العام)

انسخ كامل هذا الملف والصقه لـ Claude Code (أو أي وكيل) داخل **النسخة الأخرى** من المشروع.
هو تعليمات مكتفية بذاتها لإضافة أربع ميزات مطابقة للنسخة الأصلية.

> ⚠️ هذا مشروع React + TypeScript + Vite، كل المنطق في ملف واحد ضخم `frontend/src/App.tsx`،
> والتنسيقات في `frontend/src/index.css`. حافظ على النصوص العربية واتجاه RTL. **لا تعِد هيكلة الكود** —
> فقط أضِف الكتل في أماكنها المحددة عبر البحث عن نص الربط (anchor) المذكور.
> لا تكرر الإدراج إن وُجدت الميزة مسبقاً.

**الترتيب مُلزَم:** الجزء 1 (البصمة) أولاً لأن الأجزاء 2 و3 تعتمد عليه.

**فهرس الأجزاء**
1. الدخول بالبصمة / Face ID
2. صفحة البروفايل (الاسم + البريد + كلمة المرور + إظهارها بالبصمة)
3. تأكيد بالبصمة في كل نوافذ كلمة المرور
4. تبويب واتساب
5. الشات العام (رسائل + وسائط + ملفات + تثبيت + حذف + احتفاظ ٣ أشهر)
6. القواعد والبناء والنشر

---
---

# الجزء 1 — الدخول بالبصمة / Face ID

الفكرة: WebAuthn مع امتداد **PRF** يشتقّ مفتاح تشفير من عتاد الجهاز، يُشفَّر به كلمة مرور الحساب
وتُحفظ محلياً. لا تُفكّ إلا بنجاح البصمة على **نفس الجهاز**. لا حاجة لأي باك-إند.

## 1.1 — الاستيرادات
**نقطة الربط:** سطر استيراد `firebase/auth` أعلى `App.tsx`. تأكد أنه يحتوي:

```ts
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updateProfile, updatePassword, verifyBeforeUpdateEmail } from 'firebase/auth';
```

## 1.2 — دوال WebAuthn (مستوى الوحدة)
**نقطة الربط:** ابحث عن `const todayISO = () =>` وأدرج بعده مباشرة:

```ts
// ===== الدخول بالبصمة / Face ID (WebAuthn + امتداد PRF) =====
// البصمة تشتقّ مفتاحاً من عتاد الجهاز يُشفَّر به كلمة المرور محلياً (AES-GCM)،
// فلا تُفكّ إلا بنجاح البصمة على هذا الجهاز نفسه. التخزين محلي فقط (localStorage).
const BIO_KEY = 'servox_biometric';
type BioStore = { credId: string; email: string; salt: string; iv: string; ct: string };

const bufToB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64ToBuf = (b64: string): ArrayBuffer => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;

const getBioStore = (): BioStore | null => {
  try { const s = localStorage.getItem(BIO_KEY); return s ? (JSON.parse(s) as BioStore) : null; } catch { return null; }
};
const clearBioStore = () => localStorage.removeItem(BIO_KEY);

// هل يدعم الجهاز/المتصفح مُصادقاً حيوياً (Face ID / Windows Hello / بصمة)؟
const isBioSupported = async (): Promise<boolean> => {
  try {
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
};

const aesKeyFromPrf = (prf: ArrayBuffer) =>
  crypto.subtle.importKey('raw', prf, 'AES-GCM', false, ['encrypt', 'decrypt']);

// استدعاء get() للحصول على ناتج PRF (بصمة) من مُعرّف بيانات الاعتماد
const evalPrf = async (credId: string, salt: Uint8Array): Promise<ArrayBuffer | null> => {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [{ type: 'public-key', id: b64ToBuf(credId) }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } as any,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return null;
  const results = (assertion.getClientExtensionResults() as any).prf?.results?.first as ArrayBuffer | undefined;
  return results ?? null;
};

// تسجيل بصمة جديدة على هذا الجهاز + تشفير كلمة المرور بها
const registerBiometric = async (email: string, password: string): Promise<void> => {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'SERVOX', id: window.location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email, displayName: email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } as any,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('no-cred');
  const credId = bufToB64(cred.rawId);

  // بعض المتصفحات تُرجع ناتج PRF في create()، وبعضها يحتاج get() إضافياً
  let prf = ((cred.getClientExtensionResults() as any).prf?.results?.first as ArrayBuffer | undefined) ?? null;
  if (!prf) prf = await evalPrf(credId, salt);
  if (!prf) throw new Error('no-prf');

  const key = await aesKeyFromPrf(prf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password));

  const store: BioStore = { credId, email, salt: bufToB64(salt.buffer), iv: bufToB64(iv.buffer), ct: bufToB64(ct) };
  localStorage.setItem(BIO_KEY, JSON.stringify(store));
};

// فك التشفير واسترجاع بيانات الدخول عبر البصمة
const unlockBiometric = async (): Promise<{ email: string; password: string } | null> => {
  const store = getBioStore();
  if (!store) return null;
  const prf = await evalPrf(store.credId, new Uint8Array(b64ToBuf(store.salt)));
  if (!prf) throw new Error('no-prf');
  const key = await aesKeyFromPrf(prf);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(store.iv)) }, key, b64ToBuf(store.ct));
  return { email: store.email, password: new TextDecoder().decode(pt) };
};
```

## 1.3 — الحالات (State)
**نقطة الربط:** بعد `const [darkMode, setDarkMode] = useState(...)` أضِف:

```ts
  // الدخول بالبصمة / Face ID
  const [bioAvailable, setBioAvailable] = useState(false); // الجهاز يدعم مُصادقاً حيوياً
  const [bioEnabled, setBioEnabled] = useState(() => getBioStore() !== null); // بصمة مسجّلة على هذا الجهاز
  const [bioBusy, setBioBusy] = useState(false);
  const [bioSetupModal, setBioSetupModal] = useState(false);
  const [bioSetupPassword, setBioSetupPassword] = useState('');
```

## 1.4 — فحص الدعم عند التحميل
**نقطة الربط:** بعد `useEffect` الخاص بـ `onAuthStateChanged` أضِف:

```ts
  // فحص دعم البصمة على هذا الجهاز
  useEffect(() => {
    isBioSupported().then(setBioAvailable);
  }, []);
```

## 1.5 — الدوال
**نقطة الربط:** بعد دالة `handleLogout` أضِف:

```ts
  // تسجيل الدخول بالبصمة (فك تشفير بيانات الدخول المحفوظة على الجهاز)
  const handleBioLogin = async () => {
    setBioBusy(true);
    try {
      const creds = await unlockBiometric();
      if (!creds) { setToastMessage('لا توجد بصمة مسجّلة على هذا الجهاز'); return; }
      await signInWithEmailAndPassword(auth, creds.email, creds.password);
      setToastMessage('تم الدخول بالبصمة');
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') setToastMessage('أُلغيت عملية البصمة');
      else if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') {
        clearBioStore();
        setBioEnabled(false);
        setToastMessage('تغيّرت كلمة المرور — أعد تفعيل البصمة');
      } else if (e?.message === 'no-prf') setToastMessage('متصفحك لا يدعم الدخول الآمن بالبصمة');
      else setToastMessage('تعذّر الدخول بالبصمة');
      console.error(e);
    } finally {
      setBioBusy(false);
    }
  };

  // تفعيل البصمة على هذا الجهاز (يتحقق من كلمة المرور ثم يشفّرها بالبصمة)
  const confirmEnableBiometric = async () => {
    const user = auth.currentUser;
    if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
    if (!bioSetupPassword.trim()) { setToastMessage('أدخل كلمة المرور'); return; }
    setBioBusy(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, bioSetupPassword);
      await reauthenticateWithCredential(user, credential);
      await registerBiometric(user.email, bioSetupPassword);
      setBioEnabled(true);
      setBioSetupModal(false);
      setBioSetupPassword('');
      setToastMessage('تم تفعيل الدخول بالبصمة على هذا الجهاز');
    } catch (e: any) {
      if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') setToastMessage('كلمة المرور غير صحيحة');
      else if (e?.name === 'NotAllowedError') setToastMessage('أُلغيت عملية البصمة');
      else if (e?.message === 'no-prf') setToastMessage('متصفحك لا يدعم الدخول الآمن بالبصمة (PRF)');
      else setToastMessage('تعذّر تفعيل البصمة');
      console.error(e);
    } finally {
      setBioBusy(false);
    }
  };

  // إلغاء البصمة من هذا الجهاز
  const disableBiometric = () => {
    clearBioStore();
    setBioEnabled(false);
    setToastMessage('تم إلغاء الدخول بالبصمة من هذا الجهاز');
  };
```

## 1.6 — زر الدخول بالبصمة في شاشة الدخول
**نقطة الربط:** بعد `</form>` في شاشة تسجيل الدخول (`if (!isAuthenticated)`) أضِف:

```tsx
          {bioAvailable && bioEnabled && (
            <button type="button" className="bio-login-btn" onClick={handleBioLogin} disabled={bioBusy}>
              <span className="bio-login-icon">👤</span>
              <span>{bioBusy ? 'جارٍ التحقق...' : 'دخول بالبصمة / Face ID'}</span>
            </button>
          )}
```

## 1.7 — نافذة تفعيل البصمة
**نقطة الربط:** قبل `{toastMessage && <div className="toast">` الأخيرة أضِف:

```tsx
      {/* Enable Biometric Modal — تفعيل الدخول بالبصمة */}
      {bioSetupModal && (
        <div className="modal-overlay" onClick={() => { setBioSetupModal(false); setBioSetupPassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>👤 تفعيل الدخول بالبصمة</h3>
              <button onClick={() => { setBioSetupModal(false); setBioSetupPassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '16px' }}>
                لتفعيل الدخول بالبصمة على هذا الجهاز، أدخل كلمة المرور للتأكيد. ستُشفَّر وتُحفظ محلياً على هذا الجهاز فقط، ولا تُفكّ إلا ببصمتك.
              </p>
              <div className="edit-field">
                <label>كلمة المرور</label>
                <input type="password" placeholder="كلمة المرور" value={bioSetupPassword}
                  onChange={(e) => setBioSetupPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmEnableBiometric()} autoFocus />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setBioSetupModal(false); setBioSetupPassword(''); }} className="btn secondary">إلغاء</button>
              <button onClick={confirmEnableBiometric} className="btn primary" disabled={bioBusy}>
                {bioBusy ? 'جارٍ التفعيل...' : 'تفعيل'}
              </button>
            </div>
          </div>
        </div>
      )}
```

## 1.8 — التنسيقات
```css
/* زر الدخول بالبصمة / Face ID */
.bio-login-btn {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; padding: 14px 24px; margin-top: 14px;
  font-size: 15px; font-weight: 700; font-family: 'Cairo', sans-serif;
  color: var(--primary, #6366f1); background: var(--primary-glow, #eef2ff);
  border: 1.5px solid var(--primary, #6366f1); border-radius: 16px;
  cursor: pointer; transition: transform 0.2s, filter 0.2s;
}
.bio-login-btn:hover { transform: translateY(-2px); filter: brightness(1.03); }
.bio-login-btn:disabled { opacity: 0.6; cursor: default; transform: none; }
.bio-login-icon { font-size: 20px; }

[data-theme="dark"] .bio-login-btn {
  color: var(--primary-light, #a5b4fc);
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.5);
}
```

---
---

# الجزء 2 — صفحة البروفايل

## 2.1 — الحالات
**نقطة الربط:** بعد حالات البصمة (1.3) أضِف:

```ts
  // صفحة البروفايل
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileNameBusy, setProfileNameBusy] = useState(false);
  const [profileNewEmail, setProfileNewEmail] = useState('');
  const [profileEmailPassword, setProfileEmailPassword] = useState('');
  const [profileEmailBusy, setProfileEmailBusy] = useState(false);
  const [profileCurrentPassword, setProfileCurrentPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileConfirmPassword, setProfileConfirmPassword] = useState('');
  const [profilePasswordBusy, setProfilePasswordBusy] = useState(false);
  // إظهار/إخفاء كلمات المرور في البروفايل
  const [showProfileEmailPw, setShowProfileEmailPw] = useState(false);
  const [showProfileCurPw, setShowProfileCurPw] = useState(false);
  const [showProfileNewPw, setShowProfileNewPw] = useState(false);
  const [showProfileConfPw, setShowProfileConfPw] = useState(false);
  const [revealedCurrentPassword, setRevealedCurrentPassword] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
```

## 2.2 — الدوال
**نقطة الربط:** بعد `disableBiometric` أضِف:

```ts
  const openProfile = () => {
    setProfileName(auth.currentUser?.displayName || '');
    setProfileNewEmail(''); setProfileEmailPassword('');
    setProfileCurrentPassword(''); setProfileNewPassword(''); setProfileConfirmPassword('');
    setRevealedCurrentPassword(null);
    setShowProfileEmailPw(false); setShowProfileCurPw(false); setShowProfileNewPw(false); setShowProfileConfPw(false);
    setShowProfileModal(true);
  };

  const closeProfile = () => {
    setShowProfileModal(false);
    setRevealedCurrentPassword(null);
  };

  // عرض كلمة المرور الحالية عبر البصمة (تُفكّ من التخزين المشفّر على الجهاز)
  const revealCurrentPassword = async () => {
    setRevealBusy(true);
    try {
      const creds = await unlockBiometric();
      if (!creds) { setToastMessage('لا توجد بصمة مسجّلة على هذا الجهاز'); return; }
      setRevealedCurrentPassword(creds.password);
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') setToastMessage('أُلغيت عملية البصمة');
      else if (e?.message === 'no-prf') setToastMessage('متصفحك لا يدعم الكشف الآمن بالبصمة');
      else setToastMessage('تعذّر عرض كلمة المرور');
      console.error(e);
    } finally {
      setRevealBusy(false);
    }
  };

  // حفظ اسم الحساب
  const saveProfileName = async () => {
    const user = auth.currentUser;
    if (!user) { setToastMessage('خطأ في المصادقة'); return; }
    if (!profileName.trim()) { setToastMessage('أدخل الاسم'); return; }
    setProfileNameBusy(true);
    try {
      await updateProfile(user, { displayName: profileName.trim() });
      setToastMessage('تم تحديث الاسم');
    } catch (e) { setToastMessage('تعذّر تحديث الاسم'); console.error(e); }
    finally { setProfileNameBusy(false); }
  };

  // تغيير البريد (يرسل رابط تأكيد للبريد الجديد ثم يُحدَّث بعد الضغط عليه)
  const saveProfileEmail = async (pwOverride?: string) => {
    const user = auth.currentUser;
    if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
    if (!profileNewEmail.trim()) { setToastMessage('أدخل البريد الجديد'); return; }
    if (!(pwOverride ?? profileEmailPassword).trim()) { setToastMessage('أدخل كلمة المرور الحالية'); return; }
    setProfileEmailBusy(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? profileEmailPassword);
      await reauthenticateWithCredential(user, credential);
      await verifyBeforeUpdateEmail(user, profileNewEmail.trim());
      setToastMessage('أُرسل رابط تأكيد إلى البريد الجديد — افتحه لإتمام التغيير');
      setProfileNewEmail(''); setProfileEmailPassword('');
    } catch (e: any) {
      if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') setToastMessage('كلمة المرور غير صحيحة');
      else if (e?.code === 'auth/invalid-email') setToastMessage('البريد الجديد غير صحيح');
      else if (e?.code === 'auth/email-already-in-use') setToastMessage('البريد مستخدم بالفعل');
      else setToastMessage('تعذّر تغيير البريد');
      console.error(e);
    } finally { setProfileEmailBusy(false); }
  };

  // تغيير كلمة المرور (يُلغي البصمة لأنها تعتمد على كلمة المرور القديمة)
  const saveProfilePassword = async (pwOverride?: string) => {
    const user = auth.currentUser;
    if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
    if (!(pwOverride ?? profileCurrentPassword).trim() || !profileNewPassword.trim()) { setToastMessage('أدخل كلمة المرور الحالية والجديدة'); return; }
    if (profileNewPassword.length < 6) { setToastMessage('كلمة المرور الجديدة قصيرة (٦ أحرف على الأقل)'); return; }
    if (profileNewPassword !== profileConfirmPassword) { setToastMessage('تأكيد كلمة المرور غير مطابق'); return; }
    setProfilePasswordBusy(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? profileCurrentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, profileNewPassword);
      if (getBioStore()) { clearBioStore(); setBioEnabled(false); }
      setProfileCurrentPassword(''); setProfileNewPassword(''); setProfileConfirmPassword('');
      setToastMessage('تم تغيير كلمة المرور' + (bioEnabled ? ' — أعد تفعيل البصمة' : ''));
    } catch (e: any) {
      if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') setToastMessage('كلمة المرور الحالية غير صحيحة');
      else if (e?.code === 'auth/weak-password') setToastMessage('كلمة المرور الجديدة ضعيفة');
      else setToastMessage('تعذّر تغيير كلمة المرور');
      console.error(e);
    } finally { setProfilePasswordBusy(false); }
  };
```

## 2.3 — أيقونة البروفايل في الهيدر
**نقطة الربط:** في `<header className="app-header">`، **قبل** زر «تسجيل خروج» مباشرة:

```tsx
        <button className="profile-avatar-btn" onClick={openProfile} title="حسابي — الاسم والبريد وكلمة المرور">
          {(auth.currentUser?.displayName || auth.currentUser?.email || '؟').trim().charAt(0).toUpperCase()}
        </button>
```

## 2.4 — نافذة البروفايل
**نقطة الربط:** قبل نافذة تفعيل البصمة (1.7):

```tsx
      {/* Profile Modal — صفحة حساب المستخدم */}
      {showProfileModal && (
        <div className="modal-overlay" onClick={closeProfile}>
          <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>👤 حساب المستخدم</h3>
              <button onClick={closeProfile} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="profile-hero">
                <div className="profile-hero-avatar">
                  {(auth.currentUser?.displayName || auth.currentUser?.email || '؟').trim().charAt(0).toUpperCase()}
                </div>
                <div className="profile-hero-info">
                  <strong>{auth.currentUser?.displayName || 'بدون اسم'}</strong>
                  <span className="small" dir="ltr">{auth.currentUser?.email}</span>
                </div>
              </div>

              {/* الاسم */}
              <div className="profile-section">
                <div className="section-title-small">الاسم</div>
                <div className="profile-row">
                  <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="اسم الحساب" />
                  <button className="btn primary" onClick={saveProfileName} disabled={profileNameBusy}>
                    {profileNameBusy ? '...' : 'حفظ'}
                  </button>
                </div>
              </div>

              {/* البريد الإلكتروني */}
              <div className="profile-section">
                <div className="section-title-small">البريد الإلكتروني</div>
                <p className="small" style={{ opacity: 0.7, margin: '0 0 8px' }}>الحالي: <span dir="ltr">{auth.currentUser?.email}</span></p>
                <input type="email" dir="ltr" value={profileNewEmail} onChange={(e) => setProfileNewEmail(e.target.value)} placeholder="البريد الجديد" />
                <div className="password-input-wrap">
                  <input type={showProfileEmailPw ? 'text' : 'password'} value={profileEmailPassword} onChange={(e) => setProfileEmailPassword(e.target.value)} placeholder="كلمة المرور الحالية للتأكيد" />
                  <button type="button" className="password-eye" onClick={() => setShowProfileEmailPw(v => !v)} tabIndex={-1}>{showProfileEmailPw ? '🙈' : '👁️'}</button>
                </div>
                {bioConfirmBtn(saveProfileEmail)}
                <button className="btn primary profile-full-btn" onClick={() => saveProfileEmail()} disabled={profileEmailBusy}>
                  {profileEmailBusy ? 'جارٍ الإرسال...' : 'تغيير البريد'}
                </button>
                <p className="small" style={{ opacity: 0.6, margin: '8px 0 0' }}>سيُرسل رابط تأكيد إلى البريد الجديد، ويُحدَّث بعد فتحه.</p>
              </div>

              {/* كلمة المرور */}
              <div className="profile-section">
                <div className="section-title-small">كلمة المرور</div>
                {/* كلمة المرور الحالية — تُعرض بالبصمة فقط (Firebase لا يخزّنها) */}
                {bioEnabled ? (
                  <div className="profile-reveal-row">
                    <div className="profile-reveal-field">
                      <span className="small" style={{ opacity: 0.7 }}>كلمة المرور الحالية</span>
                      <span className="profile-reveal-value" dir="ltr">{revealedCurrentPassword ?? '••••••••'}</span>
                    </div>
                    {revealedCurrentPassword ? (
                      <button className="btn secondary btn-sm" onClick={() => setRevealedCurrentPassword(null)}>🙈 إخفاء</button>
                    ) : (
                      <button className="btn secondary btn-sm" onClick={revealCurrentPassword} disabled={revealBusy}>{revealBusy ? '...' : '👆 إظهار بالبصمة'}</button>
                    )}
                  </div>
                ) : (
                  <p className="small" style={{ opacity: 0.6, margin: '0 0 10px' }}>🔒 لعرض كلمة المرور الحالية، فعّل الدخول بالبصمة (لأسباب أمنية لا يخزّن Firebase كلمة المرور، فلا يمكن استرجاعها بدونها).</p>
                )}
                <div className="password-input-wrap">
                  <input type={showProfileCurPw ? 'text' : 'password'} value={profileCurrentPassword} onChange={(e) => setProfileCurrentPassword(e.target.value)} placeholder="كلمة المرور الحالية" />
                  <button type="button" className="password-eye" onClick={() => setShowProfileCurPw(v => !v)} tabIndex={-1}>{showProfileCurPw ? '🙈' : '👁️'}</button>
                </div>
                <div className="password-input-wrap">
                  <input type={showProfileNewPw ? 'text' : 'password'} value={profileNewPassword} onChange={(e) => setProfileNewPassword(e.target.value)} placeholder="كلمة المرور الجديدة" />
                  <button type="button" className="password-eye" onClick={() => setShowProfileNewPw(v => !v)} tabIndex={-1}>{showProfileNewPw ? '🙈' : '👁️'}</button>
                </div>
                <div className="password-input-wrap">
                  <input type={showProfileConfPw ? 'text' : 'password'} value={profileConfirmPassword} onChange={(e) => setProfileConfirmPassword(e.target.value)} placeholder="تأكيد كلمة المرور الجديدة" />
                  <button type="button" className="password-eye" onClick={() => setShowProfileConfPw(v => !v)} tabIndex={-1}>{showProfileConfPw ? '🙈' : '👁️'}</button>
                </div>
                {bioConfirmBtn(saveProfilePassword)}
                <button className="btn primary profile-full-btn" onClick={() => saveProfilePassword()} disabled={profilePasswordBusy}>
                  {profilePasswordBusy ? 'جارٍ التغيير...' : 'تغيير كلمة المرور'}
                </button>
                {bioEnabled && <p className="small" style={{ opacity: 0.6, margin: '8px 0 0' }}>ملاحظة: تغيير كلمة المرور سيُلغي الدخول بالبصمة على هذا الجهاز، فأعد تفعيله بعدها.</p>}
              </div>

              {/* الدخول بالبصمة */}
              {bioAvailable && (
                <div className="profile-section">
                  <div className="section-title-small">الدخول بالبصمة / Face ID</div>
                  {bioEnabled ? (
                    <>
                      <p className="small" style={{ opacity: 0.7, margin: '0 0 10px' }}>✅ البصمة مفعّلة على هذا الجهاز — يمكنك الدخول بها وعرض كلمة المرور.</p>
                      <button className="btn secondary profile-full-btn" onClick={disableBiometric}>🔒 إلغاء البصمة من هذا الجهاز</button>
                    </>
                  ) : (
                    <>
                      <p className="small" style={{ opacity: 0.7, margin: '0 0 10px' }}>فعّل الدخول بالبصمة على هذا الجهاز كبديل لكلمة المرور.</p>
                      <button className="btn primary profile-full-btn" onClick={() => { setBioSetupPassword(''); setBioSetupModal(true); }}>👤 تفعيل البصمة</button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={closeProfile} className="btn secondary">إغلاق</button>
            </div>
          </div>
        </div>
      )}
```

## 2.5 — التنسيقات
```css
/* أيقونة البروفايل في الهيدر */
.profile-avatar-btn {
  flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%; border: none;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: #fff;
  font-family: 'Cairo', sans-serif; font-size: 18px; font-weight: 800; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(79, 70, 229, 0.35); transition: transform 0.2s, filter 0.2s;
}
.profile-avatar-btn:hover { transform: translateY(-2px) scale(1.05); filter: brightness(1.05); }

.profile-modal { max-width: 460px; }
.profile-hero { display: flex; align-items: center; gap: 14px; padding: 14px; margin-bottom: 18px; border-radius: 14px; background: var(--bg-flat, #f8fafc); }
.profile-hero-avatar {
  width: 56px; height: 56px; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: #fff;
  font-size: 24px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.profile-hero-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.profile-hero-info strong { font-size: 16px; }
.profile-hero-info span { overflow: hidden; text-overflow: ellipsis; }

.profile-section { padding: 14px 0; border-top: 1px solid var(--border, #e2e8f0); }
.profile-section input { width: 100%; margin-bottom: 8px; }
.profile-row { display: flex; gap: 8px; align-items: stretch; }
.profile-row input { flex: 1; margin-bottom: 0; }
.profile-full-btn { width: 100%; }

/* إظهار/إخفاء كلمة المرور */
.password-input-wrap { position: relative; }
.password-input-wrap input { width: 100%; padding-left: 40px; }
.password-eye {
  position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
  border: none; background: transparent; cursor: pointer; font-size: 15px; padding: 4px; opacity: 0.7;
}
.password-eye:hover { opacity: 1; }

/* عرض كلمة المرور الحالية بالبصمة */
.profile-reveal-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; margin-bottom: 12px; border-radius: 10px; background: var(--bg-flat, #f8fafc); }
.profile-reveal-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.profile-reveal-value { font-weight: 800; font-size: 15px; letter-spacing: 1px; }

[data-theme="dark"] .profile-hero,
[data-theme="dark"] .profile-reveal-row { background: rgba(15, 23, 42, 0.5); }
[data-theme="dark"] .profile-section { border-color: var(--border); }
```

---
---

# الجزء 3 — تأكيد بالبصمة في كل نوافذ كلمة المرور

بدل كتابة كلمة المرور في كل نافذة محمية، يظهر زر «👆 بالبصمة» ينفّذ العملية مباشرة.

## 3.1 — الدوال المساعدة
**نقطة الربط:** بعد `disableBiometric` أضِف:

```ts
  // جلب كلمة المرور المخزّنة عبر البصمة — بديل عن كتابتها يدوياً في النوافذ المحمية
  const getBioPassword = async (): Promise<string | null> => {
    if (!bioEnabled) { setToastMessage('فعّل الدخول بالبصمة أولاً من البروفايل'); return null; }
    setBioBusy(true);
    try {
      const creds = await unlockBiometric();
      if (!creds) { setToastMessage('لا توجد بصمة مسجّلة على هذا الجهاز'); return null; }
      return creds.password;
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') setToastMessage('أُلغيت عملية البصمة');
      else if (e?.message === 'no-prf') setToastMessage('متصفحك لا يدعم البصمة الآمنة');
      else setToastMessage('تعذّر التحقق بالبصمة');
      console.error(e);
      return null;
    } finally { setBioBusy(false); }
  };

  // زر «تأكيد بالبصمة» — يُعرض داخل كل نافذة تطلب كلمة مرور الحساب
  const bioConfirmBtn = (run: (pw: string) => void) => (
    bioAvailable && bioEnabled ? (
      <button type="button" className="btn bio-confirm-btn" disabled={bioBusy}
        title="تأكيد ببصمة الوجه بدل كتابة كلمة المرور"
        onClick={async () => { const pw = await getBioPassword(); if (pw) run(pw); }}>
        {bioBusy ? '...' : '👆 بالبصمة'}
      </button>
    ) : null
  );
```

## 3.2 — تعديل دوال إعادة المصادقة
لكل دالة تستدعي `reauthenticateWithCredential` (عدا `confirmEnableBiometric` — هي من تُنشئ البصمة فتحتاج كلمة المرور الحقيقية) طبّق **٣ تعديلات**:

```ts
// 1) التوقيع
const confirmX = async (pwOverride?: string) => {
// 2) الحارس
  if (!existing || !(pwOverride ?? xPassword).trim()) { ... }
// 3) بيانات الاعتماد
  const credential = EmailAuthProvider.credential(user.email, pwOverride ?? xPassword);
```

**الدوال في النسخة الأصلية ومتغيّراتها:**

| الدالة | متغيّر كلمة المرور |
|---|---|
| `confirmDelete` | `deletePassword` |
| `confirmEditPassword` | `editPassword` |
| `confirmTransferCustomer` | `transferPassword` |
| `confirmDeleteTower` | `towerDeletePassword` |
| `confirmTowerEditPassword` | `towerEditPassword` |
| `confirmUnlinkCustomer` | `unlinkPassword` |
| `confirmFinanceDelete` | `financeDeletePassword` |
| `confirmEditFinance` | `editFinancePassword` |
| `confirmDiscountDelete` | `discountDeletePassword` |
| `confirmDeleteCard` | `cardDeletePassword` |
| `saveProfileEmail` | `profileEmailPassword` |
| `saveProfilePassword` | `profileCurrentPassword` |

> ⚠️ **خطأ لا بد من تفاديه:** بعد إضافة الوسيط، أي ربط مباشر مثل `onClick={confirmDelete}`
> سيمرّر **كائن حدث الفأرة** كـ«كلمة مرور» ويكسر التحقق. حوّلها كلها إلى:
> `onClick={() => confirmDelete()}`. الـ type-check سيكشفها إن نسيتها.

## 3.3 — إضافة الزر في كل نافذة
قبل زر التأكيد في كل نافذة أضِف `{bioConfirmBtn(confirmX)}`، مثال:

```tsx
{bioConfirmBtn(confirmDelete)}<button onClick={() => confirmDelete()} className="btn danger" disabled={deleteLoading}>
```

## 3.4 — التنسيقات
```css
.bio-confirm-btn {
  background: var(--primary-glow, #eef2ff); color: var(--primary);
  border: 1.5px solid var(--primary, #6366f1); font-weight: 800; white-space: nowrap;
}
.bio-confirm-btn:hover { filter: brightness(1.04); transform: translateY(-1px); }
.bio-confirm-btn:disabled { opacity: 0.6; transform: none; cursor: default; }
[data-theme="dark"] .bio-confirm-btn {
  background: rgba(99, 102, 241, 0.18); border-color: rgba(99, 102, 241, 0.5); color: var(--primary-light, #a5b4fc);
}
```

---
---

# الجزء 4 — تبويب واتساب

إرسال رسائل تذكير بالسداد عبر روابط **wa.me** (تفتح واتساب برسالة جاهزة، والمستخدم يضغط إرسال).
لا يحتاج WhatsApp Business API ولا باك-إند.

## 4.1 — القوالب والدوال (مستوى الوحدة)
**نقطة الربط:** بعد `const todayISO = () =>`:

```ts
// ===== رسائل واتساب للعملاء =====
// القوالب تستخدم متغيّرات: {الاسم} {المدينة} {الجوال} {المبلغ}
const WA_TEMPLATES: { id: string; title: string; body: string }[] = [
  { id: 'reminder', title: 'تذكير ودّي بالسداد',
    body: 'مرحباً {الاسم} 👋\nنذكّركم بسداد اشتراك الإنترنت بمبلغ {المبلغ} ﷼.\nنشكر لكم تعاونكم 🌐' },
  { id: 'due', title: 'مبلغ مستحق',
    body: 'عميلنا العزيز {الاسم} ({المدينة})\nلديكم مبلغ مستحق قدره {المبلغ} ﷼ على اشتراك الإنترنت.\nيرجى السداد في أقرب وقت، وشكراً لكم.' },
  { id: 'thanks', title: 'شكر بعد السداد',
    body: 'شكراً لك {الاسم} 🌟\nتم استلام سداد اشتراككم بنجاح. نتمنى لكم تجربة إنترنت ممتازة 🌐' },
];
const WA_CUSTOM_KEY = 'servox_wa_custom_template';

// تحويل رقم الجوال إلى صيغة واتساب الدولية (السعودية افتراضاً)
const normalizePhone = (raw?: string): string => {
  if (!raw) return '';
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.startsWith('0')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
};

// تعبئة متغيّرات القالب ببيانات العميل
const fillTemplate = (body: string, vars: { name: string; city: string; phone: string; amount: string }): string =>
  body.replace(/\{الاسم\}/g, vars.name)
      .replace(/\{المدينة\}/g, vars.city)
      .replace(/\{الجوال\}/g, vars.phone)
      .replace(/\{المبلغ\}/g, vars.amount);
```

## 4.2 — التبويب في نوع `activeTab`
أضِف `| 'whatsapp'` إلى نهاية الـ union في `const [activeTab, setActiveTab] = useState<...>`.

## 4.3 — الحالات
```ts
  // تبويب واتساب
  const [waCityId, setWaCityId] = useState<string | null>(null);
  const [waStatusFilter, setWaStatusFilter] = useState<'all' | 'paid' | 'unpaid' | 'partial'>('unpaid');
  const [waSelected, setWaSelected] = useState<string[]>([]);
  const [waTemplateId, setWaTemplateId] = useState<string>(WA_TEMPLATES[0].id);
  const [waCustomTemplate, setWaCustomTemplate] = useState<string>(() => localStorage.getItem(WA_CUSTOM_KEY) || 'مرحباً {الاسم} 👋\nنذكّركم بسداد مبلغ {المبلغ} ﷼ لمدينة {المدينة}.');
  const [waAmount, setWaAmount] = useState('');
  const [waQueue, setWaQueue] = useState<string[]>([]);
  const [waQueuePos, setWaQueuePos] = useState(0);
  const [waMonth, setWaMonth] = useState(0); // 0 = الحالة العامة، 1-12 = شهر محدد
  const [waYear, setWaYear] = useState(new Date().getFullYear());
  const [waSearch, setWaSearch] = useState('');
```

## 4.4 — زر التبويب
```tsx
        <button className={`tab-btn ${activeTab === 'whatsapp' ? 'active' : ''}`} onClick={() => setActiveTab('whatsapp')}>واتساب</button>
```

## 4.5 — قسم التبويب
**نقطة الربط:** بعد آخر قسم تبويب وقبل النوافذ (modals):

```tsx
        {activeTab === 'whatsapp' && (() => {
          // حالة السداد: للشهر المختار إن حُدّد شهر، وإلا الحالة العامة للعميل
          const statusOf = (c: Customer): 'paid' | 'partial' | 'discounted' | 'unpaid' => {
            if (waMonth > 0) {
              const key = `${waYear}-${String(waMonth).padStart(2, '0')}`;
              const m = c.monthlyPayments?.[key];
              return m === 'paid' ? 'paid' : m === 'partial' ? 'partial' : m === 'discounted' ? 'discounted' : 'unpaid';
            }
            return c.paymentStatus === 'paid' ? 'paid' : c.paymentStatus === 'partial' ? 'partial' : c.paymentStatus === 'discounted' ? 'discounted' : 'unpaid';
          };
          const statusMatch = (c: Customer) => waStatusFilter === 'all' || statusOf(c) === waStatusFilter;
          // بحث بالاسم أو رقم الجوال أو IP Number أو اسم المستخدم
          const q = waSearch.trim().toLowerCase();
          const qDigits = q.replace(/\D/g, '');
          const searchMatch = (c: Customer) => {
            if (!q) return true;
            return c.name.toLowerCase().includes(q)
              || (!!qDigits && !!c.phone && c.phone.replace(/\D/g, '').includes(qDigits))
              || (!!c.ipNumber && c.ipNumber.toLowerCase().includes(q))
              || (!!c.userName && c.userName.toLowerCase().includes(q));
          };
          const waCustomers = customers
            .filter(c => (!waCityId || c.cityId === waCityId) && statusMatch(c) && searchMatch(c))
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
          const selectedSet = new Set(waSelected);
          const templateBody = waTemplateId === 'custom' ? waCustomTemplate : (WA_TEMPLATES.find(t => t.id === waTemplateId)?.body || '');
          const buildMsg = (c: Customer) => {
            const cityName = cities.find(ct => ct.id === c.cityId)?.name || '';
            const amount = waAmount.trim() || (c.subscriptionValue != null ? String(c.subscriptionValue) : '');
            return fillTemplate(templateBody, { name: c.name, city: cityName, phone: c.phone || '', amount });
          };
          const waLink = (c: Customer) => `https://wa.me/${normalizePhone(c.phone)}?text=${encodeURIComponent(buildMsg(c))}`;
          const toggleOne = (id: string) => setWaSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
          // العملاء الموقوفون مؤقتاً لا يُرسَل لهم حتى يُرفع الإيقاف
          const sendableIds = waCustomers.filter(c => !c.isSuspended).map(c => c.id);
          const allSelected = sendableIds.length > 0 && sendableIds.every(id => selectedSet.has(id));
          const toggleAll = () => setWaSelected(allSelected ? [] : sendableIds);
          const selectedCustomers = waCustomers.filter(c => selectedSet.has(c.id) && !c.isSuspended);
          const suspendedCount = waCustomers.filter(c => c.isSuspended).length;
          const queueActive = waQueue.length > 0 && waQueuePos < waQueue.length;
          const startQueue = () => {
            const ids = selectedCustomers.map(c => c.id);
            if (ids.length === 0) return;
            setWaQueue(ids); setWaQueuePos(1);
            window.open(waLink(selectedCustomers[0]), '_blank');
          };
          const sendNext = () => {
            const c = customers.find(x => x.id === waQueue[waQueuePos]);
            if (c) window.open(waLink(c), '_blank');
            setWaQueuePos(p => p + 1);
          };

          return (
          <div className="section wa-section">
            <div className="wa-hero">
              <div className="wa-hero-icon">💬</div>
              <div>
                <h2 className="wa-hero-title">رسائل واتساب للعملاء</h2>
                <p className="wa-hero-subtitle">ذكّر عملاءك بالسداد برسالة جاهزة تُعبّأ تلقائياً باسم العميل ومدينته وجواله والمبلغ</p>
              </div>
            </div>

            {/* القالب */}
            <div className="wa-panel">
              <div className="wa-panel-title">📝 القالب</div>
              <div className="wa-templates">
                {WA_TEMPLATES.map(t => (
                  <button key={t.id} className={`wa-template-chip ${waTemplateId === t.id ? 'active' : ''}`} onClick={() => setWaTemplateId(t.id)}>{t.title}</button>
                ))}
                <button className={`wa-template-chip ${waTemplateId === 'custom' ? 'active' : ''}`} onClick={() => setWaTemplateId('custom')}>✏️ قالب مخصص</button>
              </div>
              {waTemplateId === 'custom' ? (
                <div className="wa-custom-wrap">
                  <textarea className="wa-custom-area" value={waCustomTemplate} onChange={(e) => setWaCustomTemplate(e.target.value)} rows={4} placeholder="اكتب قالبك مستخدماً المتغيّرات..." />
                  <button className="btn secondary btn-sm" onClick={() => { localStorage.setItem(WA_CUSTOM_KEY, waCustomTemplate); setToastMessage('تم حفظ القالب المخصص'); }}>💾 حفظ القالب</button>
                </div>
              ) : (
                <div className="wa-template-preview">{templateBody}</div>
              )}
              <div className="wa-vars-hint">المتغيّرات التلقائية: <code>{'{الاسم}'}</code> <code>{'{المدينة}'}</code> <code>{'{الجوال}'}</code> <code>{'{المبلغ}'}</code></div>
              <div className="wa-amount-row">
                <label>المبلغ:</label>
                <input type="number" value={waAmount} onChange={(e) => setWaAmount(e.target.value)} placeholder="اتركه فارغاً لاستخدام قيمة اشتراك كل عميل" />
              </div>
            </div>

            {/* الفلاتر */}
            <div className="wa-toolbar">
              <div className="cards-search-wrapper wa-search">
                <span className="cards-search-icon">🔍</span>
                <input type="text" className="cards-search-input" placeholder="ابحث بالاسم أو رقم الجوال أو IP Number..."
                  value={waSearch} onChange={(e) => setWaSearch(e.target.value)} />
                {waSearch && <button className="cards-search-clear" onClick={() => setWaSearch('')}>✕</button>}
              </div>
              <select className="cards-select" value={waCityId ?? ''} onChange={(e) => { setWaCityId(e.target.value || null); setWaSelected([]); }}>
                <option value="">كل المدن</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="wa-status-filters">
                {([['all', 'الكل'], ['unpaid', 'ما سدد'], ['paid', 'سدد'], ['partial', 'جزئي']] as const).map(([k, label]) => (
                  <button key={k} className={`wa-status-btn ${waStatusFilter === k ? 'active' : ''}`} onClick={() => { setWaStatusFilter(k); setWaSelected([]); }}>{label}</button>
                ))}
              </div>
            </div>

            {/* فلتر الشهر */}
            <div className="wa-toolbar wa-month-toolbar">
              <label className="wa-month-label">الشهر:</label>
              <select className="cards-select" value={waMonth} onChange={(e) => { setWaMonth(Number(e.target.value)); setWaSelected([]); }}>
                <option value={0}>الحالة العامة (بدون شهر)</option>
                {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select className="cards-select" value={waYear} onChange={(e) => { setWaYear(Number(e.target.value)); setWaSelected([]); }} disabled={waMonth === 0}>
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {waMonth > 0 && <span className="wa-month-hint">الفلترة حسب سداد {MONTHS_AR[waMonth - 1]} {waYear}</span>}
            </div>

            {/* شريط الإرسال للمحددين */}
            {selectedCustomers.length > 0 && (
              <div className="wa-send-bar">
                {!queueActive ? (
                  <button className="wa-bulk-btn" onClick={startQueue}>📤 إرسال للمحددين ({selectedCustomers.length}) تِباعاً</button>
                ) : (
                  <>
                    <span className="wa-queue-progress">إرسال {waQueuePos} من {waQueue.length}</span>
                    <button className="wa-bulk-btn" onClick={sendNext}>▶ التالي</button>
                    <button className="btn secondary btn-sm" onClick={() => { setWaQueue([]); setWaQueuePos(0); }}>إيقاف</button>
                  </>
                )}
                <span className="wa-send-hint">يفتح محادثة كل عميل برسالته جاهزة — اضغط إرسال داخل واتساب ثم «التالي».</span>
              </div>
            )}

            {/* قائمة العملاء */}
            {waCustomers.length === 0 ? (
              <div className="cards-empty"><div className="cards-empty-icon">💬</div><p>لا يوجد عملاء مطابقون للفلتر</p></div>
            ) : (
              <>
                <div className="wa-list-head">
                  <label className="wa-checkbox-label">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    تحديد الكل ({sendableIds.length})
                  </label>
                  <span className="wa-selected-count">
                    المحدد: {selectedCustomers.length}
                    {suspendedCount > 0 && <span className="wa-suspended-note"> • {suspendedCount} موقوف مؤقتاً (لا يُرسل لهم)</span>}
                  </span>
                </div>
                <div className="wa-list">
                  {waCustomers.map(c => {
                    const cityName = cities.find(ct => ct.id === c.cityId)?.name || '—';
                    const hasPhone = !!normalizePhone(c.phone);
                    const suspended = !!c.isSuspended;
                    return (
                      <div key={c.id} className={`wa-row ${selectedSet.has(c.id) && !suspended ? 'selected' : ''} ${suspended ? 'suspended' : ''}`}>
                        <label className="wa-checkbox-label">
                          <input type="checkbox" checked={selectedSet.has(c.id) && !suspended} onChange={() => toggleOne(c.id)} disabled={suspended} />
                        </label>
                        <div className="wa-row-info">
                          <strong>{suspended && '⛔ '}{c.name}</strong>
                          <span className="small">{cityName} • {c.phone || 'بدون جوال'}</span>
                        </div>
                        {suspended ? (
                          <span className="wa-suspended-badge" title="لا يمكن الإرسال حتى يُرفع الإيقاف المؤقت">موقوف مؤقتاً</span>
                        ) : hasPhone ? (
                          <a className="wa-send-btn" href={waLink(c)} target="_blank" rel="noopener noreferrer">📱 إرسال</a>
                        ) : (
                          <span className="wa-nophone">لا يوجد جوال</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          );
        })()}
```

## 4.6 — التنسيقات
```css
/* ===== تبويب واتساب ===== */
.wa-hero { display: flex; align-items: center; gap: 16px; padding: 20px 22px; margin-bottom: 18px; border-radius: 18px; background: linear-gradient(135deg, #25d366 0%, #128c7e 100%); color: #fff; }
.wa-hero-icon { font-size: 40px; }
.wa-hero-title { margin: 0; font-size: 22px; font-weight: 800; }
.wa-hero-subtitle { margin: 4px 0 0; font-size: 13px; opacity: 0.92; }

.wa-panel { padding: 18px; margin-bottom: 16px; border: 1px solid var(--border, #e2e8f0); border-radius: 16px; background: var(--bg-flat, #f8fafc); }
.wa-panel-title { font-size: 15px; font-weight: 800; margin-bottom: 12px; color: var(--text); }

.wa-templates { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.wa-template-chip { padding: 8px 14px; border-radius: 999px; border: 1.5px solid var(--border, #e2e8f0); background: var(--bg, #fff); color: var(--text); font-family: 'Cairo', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.15s; }
.wa-template-chip.active { background: #25d366; border-color: #25d366; color: #fff; }

.wa-custom-wrap { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.wa-custom-area { width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--border, #e2e8f0); font-family: 'Cairo', sans-serif; font-size: 14px; resize: vertical; background: var(--bg, #fff); color: var(--text); }
.wa-template-preview { white-space: pre-wrap; padding: 12px 14px; border-radius: 12px; background: var(--bg, #fff); border: 1px dashed var(--border, #e2e8f0); font-size: 14px; line-height: 1.7; color: var(--text); }
.wa-vars-hint { margin-top: 10px; font-size: 12px; color: var(--text-light); }
.wa-vars-hint code { background: var(--primary-glow, #eef2ff); color: var(--primary); padding: 2px 6px; border-radius: 6px; font-size: 12px; margin: 0 2px; }
.wa-amount-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.wa-amount-row label { font-weight: 700; font-size: 13px; white-space: nowrap; }
.wa-amount-row input { flex: 1; min-width: 200px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--border, #e2e8f0); font-family: 'Cairo', sans-serif; background: var(--bg, #fff); color: var(--text); }

.wa-toolbar { display: flex; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.wa-search { flex: 1; min-width: 240px; }
.wa-status-filters { display: flex; gap: 6px; flex-wrap: wrap; }
.wa-status-btn { padding: 8px 16px; border-radius: 10px; border: 1.5px solid var(--border, #e2e8f0); background: var(--bg, #fff); color: var(--text); font-family: 'Cairo', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.15s; }
.wa-status-btn.active { background: #128c7e; border-color: #128c7e; color: #fff; }

.wa-month-toolbar { align-items: center; }
.wa-month-label { font-weight: 800; font-size: 13px; white-space: nowrap; }
.wa-month-hint { font-size: 12px; font-weight: 700; color: #128c7e; background: rgba(37, 211, 102, 0.12); padding: 5px 10px; border-radius: 8px; }

.wa-send-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 16px; margin-bottom: 14px; border-radius: 14px; background: rgba(37, 211, 102, 0.1); border: 1px solid rgba(37, 211, 102, 0.3); }
.wa-bulk-btn { padding: 10px 18px; border: none; border-radius: 12px; background: #25d366; color: #fff; font-family: 'Cairo', sans-serif; font-size: 14px; font-weight: 800; cursor: pointer; transition: filter 0.2s, transform 0.15s; }
.wa-bulk-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
.wa-queue-progress { font-weight: 800; color: #128c7e; }
.wa-send-hint { font-size: 12px; color: var(--text-light); flex: 1; min-width: 180px; }

.wa-list-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 4px; margin-bottom: 8px; }
.wa-checkbox-label { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; cursor: pointer; }
.wa-checkbox-label input { width: 18px; height: 18px; cursor: pointer; accent-color: #25d366; }
.wa-selected-count { font-size: 13px; color: var(--text-light); font-weight: 700; }

.wa-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
.wa-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: var(--bg-flat, #f8fafc); border: 1px solid var(--border, #e2e8f0); }
.wa-row.selected { border-color: #25d366; background: rgba(37, 211, 102, 0.08); }
.wa-row.suspended { opacity: 0.6; border-style: dashed; background: rgba(239, 68, 68, 0.06); }
.wa-row-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.wa-row-info strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wa-send-btn { flex-shrink: 0; padding: 8px 14px; border-radius: 10px; background: #25d366; color: #fff; font-size: 13px; font-weight: 800; text-decoration: none; transition: filter 0.2s, transform 0.15s; }
.wa-send-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
.wa-nophone { flex-shrink: 0; font-size: 12px; color: var(--danger-text, #b91c1c); opacity: 0.8; }
.wa-suspended-badge { flex-shrink: 0; font-size: 12px; font-weight: 800; color: var(--danger-text, #b91c1c); background: var(--danger-bg, rgba(239, 68, 68, 0.12)); padding: 6px 10px; border-radius: 8px; white-space: nowrap; }
.wa-suspended-note { color: var(--danger-text, #b91c1c); font-weight: 700; }

[data-theme="dark"] .wa-panel,
[data-theme="dark"] .wa-row { background: rgba(15, 23, 42, 0.5); border-color: var(--border); }
[data-theme="dark"] .wa-custom-area,
[data-theme="dark"] .wa-template-preview,
[data-theme="dark"] .wa-template-chip,
[data-theme="dark"] .wa-status-btn,
[data-theme="dark"] .wa-amount-row input { background: rgba(15, 23, 42, 0.6); border-color: var(--border); }
[data-theme="dark"] .wa-month-hint { background: rgba(37, 211, 102, 0.18); color: #4ade80; }
[data-theme="dark"] .wa-row.suspended { background: rgba(239, 68, 68, 0.1); }

@media (max-width: 720px) { .wa-list { grid-template-columns: 1fr; } }
```

---
---

# الجزء 5 — الشات العام

شات بين حسابات الإدارة: رسائل + صور + فيديو + ملفات، مع تثبيت، وحذف من المرسل،
وحذف تلقائي بعد ٣ أشهر، وعدّاد غير مقروء مستقل لكل حساب.

## 5.1 — الاستيرادات
```ts
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
```
وفي `frontend/src/firebase.ts` تأكد من:
```ts
import { getStorage } from 'firebase/storage';
export const storage = getStorage(firebaseApp);
```

## 5.2 — النوع والثوابت (مستوى الوحدة)
```ts
type ChatMessage = {
  id: string;
  senderEmail: string;
  senderName?: string;
  text?: string;
  mediaUrl?: string;
  mediaPath?: string; // مسار الملف في Storage (لحذفه لاحقاً)
  mediaType?: 'image' | 'video' | 'file';
  fileName?: string;
  fileSize?: number;
  createdAt: number;
  pinned?: boolean; // المثبّتة لا تُحذف تلقائياً
};

// مدة الاحتفاظ برسائل الشات — ٣ أشهر
const CHAT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// مفتاح «آخر قراءة» — مستقل لكل حساب على هذا الجهاز
const chatReadKey = (email?: string | null) => `servox_chat_lastread_${email || 'anon'}`;

const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileIcon = (name?: string): string => {
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return '🎵';
  if (['txt', 'md'].includes(ext)) return '📄';
  return '📎';
};

const isMobileDevice = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// iOS لا يعرض «حفظ الفيديو/الصورة» إلا إذا عرف النوع من الـ MIME والامتداد
const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
};

const prepareFile = async (url: string, name: string, kind?: 'image' | 'video' | 'file'): Promise<File | null> => {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  let type = blob.type;
  if (!type || type === 'application/octet-stream') {
    type = kind === 'video' ? 'video/mp4' : kind === 'image' ? 'image/jpeg' : 'application/octet-stream';
  }
  let fileName = name || 'file';
  if (!/\.[a-z0-9]{2,5}$/i.test(fileName)) {
    const ext = MIME_EXT[type] || (kind === 'video' ? 'mp4' : kind === 'image' ? 'jpg' : '');
    if (ext) fileName = `${fileName}.${ext}`;
  }
  return new File([blob], fileName, { type });
};

const anchorDownload = (file: File) => {
  const objUrl = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = objUrl; a.download = file.name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
};
```

## 5.3 — الحالات
```ts
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatUploading, setChatUploading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatCleanupDone = useRef(false);
  const [chatLastRead, setChatLastRead] = useState(0);
  const [chatDeleteConfirm, setChatDeleteConfirm] = useState<ChatMessage | null>(null);
  const [chatUploadProgress, setChatUploadProgress] = useState(0);
  const [chatUploadName, setChatUploadName] = useState('');
  const [chatDownloadingId, setChatDownloadingId] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<{ file: File; url: string } | null>(null);

  // تعليم رسائل الشات كمقروءة للحساب الحالي
  const markChatRead = () => {
    const now = Date.now();
    localStorage.setItem(chatReadKey(auth.currentUser?.email), String(now));
    setChatLastRead(now);
  };

  // عدد الرسائل غير المقروءة — رسائل الآخرين الأحدث من آخر قراءة
  const chatUnreadCount = useMemo(
    () => chatMessages.filter(m => m.createdAt > chatLastRead && m.senderEmail !== auth.currentUser?.email).length,
    [chatMessages, chatLastRead]
  );
```

## 5.4 — الاشتراك والتأثيرات
**داخل** `useEffect` اشتراكات Firestore أضِف مستمع الشات وأعِد `unsubscribeChat()` في التنظيف:

```ts
    const unsubscribeChat = onSnapshot(collection(db, 'chat'), (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      msgs.sort((a, b) => a.createdAt - b.createdAt);
      setChatMessages(msgs);
    });
```

وأضِف هذه التأثيرات:

```ts
  // التمرير لآخر رسالة + اعتبارها مقروءة عند فتح الشات
  useEffect(() => {
    if (showChat) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      markChatRead();
    }
  }, [chatMessages, showChat]);

  // تحميل آخر قراءة للحساب الحالي
  useEffect(() => {
    if (!isAuthenticated) return;
    const saved = Number(localStorage.getItem(chatReadKey(auth.currentUser?.email)) || 0);
    setChatLastRead(saved);
  }, [isAuthenticated]);

  // تنظيف الرسائل الأقدم من ٣ أشهر — مرة واحدة بعد التحميل
  useEffect(() => {
    if (!isAuthenticated || chatCleanupDone.current || chatMessages.length === 0) return;
    chatCleanupDone.current = true;
    cleanupOldChat(chatMessages);
  }, [isAuthenticated, chatMessages]);
```

## 5.5 — الدوال
```ts
  // إرسال رسالة نصية
  const sendChatMessage = async () => {
    const user = auth.currentUser;
    if (!user || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      await setDoc(doc(db, 'chat', id), {
        senderEmail: user.email || '', senderName: user.displayName || '', text, createdAt: Date.now(),
      });
    } catch (e) { setToastMessage('تعذّر إرسال الرسالة'); console.error(e); }
  };

  // إرسال صورة أو فيديو أو أي ملف (يُرفع إلى Firebase Storage مع تتبّع التقدّم)
  const sendChatMedia = async (file?: File) => {
    if (!file) return;
    const user = auth.currentUser;
    if (!user) return;
    const isVideo = file.type.startsWith('video');
    const isImage = file.type.startsWith('image');
    const kind: 'image' | 'video' | 'file' = isVideo ? 'video' : isImage ? 'image' : 'file';
    const maxMB = isVideo ? 50 : isImage ? 10 : 25;
    if (file.size > maxMB * 1024 * 1024) {
      setToastMessage(`الحجم أكبر من ${maxMB}MB (${kind === 'video' ? 'فيديو' : kind === 'image' ? 'صورة' : 'ملف'})`);
      return;
    }
    setChatUploading(true); setChatUploadProgress(0); setChatUploadName(file.name);
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const path = `chat/${id}_${file.name.replace(/[^\w.\-]/g, '_')}`;
      const sRef = storageRef(storage, path);
      const task = uploadBytesResumable(sRef, file);
      task.on('state_changed', (snap) => {
        setChatUploadProgress(snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0);
      });
      await task;
      const url = await getDownloadURL(task.snapshot.ref);
      await setDoc(doc(db, 'chat', id), {
        senderEmail: user.email || '', senderName: user.displayName || '',
        mediaUrl: url, mediaPath: path, mediaType: kind,
        fileName: file.name, fileSize: file.size, createdAt: Date.now(),
      });
    } catch (e) {
      setToastMessage('تعذّر رفع الملف — تأكد من تفعيل Firebase Storage');
      console.error(e);
    } finally {
      setChatUploading(false); setChatUploadProgress(0); setChatUploadName('');
    }
  };

  // تحميل مرفق — على الجوال يفتح قائمة النظام لحفظه في الصور/الملفات
  const handleDownload = async (m: ChatMessage, fallbackName: string) => {
    if (!m.mediaUrl) return;
    const url = m.mediaUrl;
    setChatDownloadingId(m.id);
    try {
      const file = await prepareFile(url, m.fileName || fallbackName, m.mediaType);
      if (!file) { window.open(url, '_blank'); return; }
      const nav = navigator as any;
      if (isMobileDevice() && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: file.name });
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          setPendingSave({ file, url }); // Safari أبطل الإيماءة ⇒ زر حفظ بلمسة جديدة
        }
        return;
      }
      anchorDownload(file);
    } catch { window.open(url, '_blank'); }
    finally { setChatDownloadingId(null); }
  };

  const savePendingFile = async () => {
    if (!pendingSave) return;
    const nav = navigator as any;
    try { await nav.share({ files: [pendingSave.file], title: pendingSave.file.name }); }
    catch (err: any) { if (err?.name !== 'AbortError') window.open(pendingSave.url, '_blank'); }
    finally { setPendingSave(null); }
  };

  // حذف رسالة أرسلها المستخدم نفسه (مع ملف الوسائط)
  const deleteChatMessage = async (m: ChatMessage) => {
    try {
      if (m.mediaUrl || m.mediaPath) {
        try { await deleteObject(storageRef(storage, m.mediaPath || m.mediaUrl!)); }
        catch (err) { console.warn('تعذّر حذف ملف الوسائط', err); }
      }
      await deleteDoc(doc(db, 'chat', m.id));
      setChatDeleteConfirm(null);
      setToastMessage('تم حذف الرسالة');
    } catch (e) { setToastMessage('تعذّر حذف الرسالة'); console.error(e); }
  };

  // تثبيت/إلغاء تثبيت رسالة — المثبّتة محميّة من الحذف التلقائي
  const toggleChatPin = async (m: ChatMessage) => {
    try {
      const { id, ...rest } = m;
      const data: Record<string, unknown> = {};
      Object.entries(rest).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') data[k] = v; });
      if (m.pinned) delete data.pinned; else data.pinned = true;
      await setDoc(doc(db, 'chat', id), data);
      setToastMessage(m.pinned ? 'أُلغي التثبيت — ستُحذف تلقائياً بعد ٣ أشهر' : '📌 تم التثبيت — لن تُحذف تلقائياً');
    } catch (e) { setToastMessage('تعذّر تغيير التثبيت'); console.error(e); }
  };

  // حذف الرسائل الأقدم من ٣ أشهر (عدا المثبّتة) مع ملفات الوسائط
  const cleanupOldChat = async (messages: ChatMessage[]) => {
    const cutoff = Date.now() - CHAT_RETENTION_MS;
    const expired = messages.filter(m => !m.pinned && m.createdAt < cutoff);
    if (expired.length === 0) return;
    let removed = 0;
    for (const m of expired) {
      try {
        if (m.mediaUrl || m.mediaPath) {
          try { await deleteObject(storageRef(storage, m.mediaPath || m.mediaUrl!)); }
          catch (err) { console.warn('تعذّر حذف ملف الوسائط', err); }
        }
        await deleteDoc(doc(db, 'chat', m.id));
        removed++;
      } catch (e) { console.error('تعذّر حذف رسالة قديمة', e); }
    }
    if (removed > 0) setToastMessage(`🧹 حُذفت ${removed} رسالة أقدم من ٣ أشهر`);
  };
```

## 5.6 — زر الشات في الهيدر
**نقطة الربط:** في الهيدر بعد زر تبديل السمة:

```tsx
        <button className="chat-toggle-btn" onClick={() => { setShowChat(true); markChatRead(); }} title="الشات العام بين حسابات الإدارة">
          💬
          {chatUnreadCount > 0 && <span className="chat-toggle-count">{chatUnreadCount}</span>}
        </button>
```

## 5.7 — نافذة الشات
```tsx
      {/* Chat Modal — الشات العام بين حسابات الإدارة */}
      {showChat && (
        <div className="modal-overlay chat-overlay" onClick={() => setShowChat(false)}>
          <div className="chat-window" onClick={(e) => e.stopPropagation()}>
            <div className="chat-header">
              <div className="chat-header-title">
                💬 الشات العام
                <span className="chat-retention-hint">الرسائل تُحذف تلقائياً بعد ٣ أشهر — ثبّت المهم 📌</span>
              </div>
              <button onClick={() => setShowChat(false)} className="modal-close">×</button>
            </div>
            <div className="chat-messages">
              {chatMessages.length === 0 ? (
                <div className="chat-empty">لا توجد رسائل بعد — ابدأ المحادثة 👋</div>
              ) : (
                chatMessages.map(m => {
                  const mine = m.senderEmail === auth.currentUser?.email;
                  return (
                    <div key={m.id} className={`chat-msg ${mine ? 'mine' : 'other'} ${m.pinned ? 'pinned' : ''}`}>
                      {!mine && <div className="chat-msg-sender">{m.senderName || m.senderEmail}</div>}
                      {m.pinned && <div className="chat-pinned-badge">📌 مثبّتة — لا تُحذف تلقائياً</div>}
                      {m.text && <div className="chat-msg-text">{m.text}</div>}
                      {m.mediaUrl && m.mediaType === 'image' && (
                        <div className="chat-media-wrap">
                          <img className="chat-msg-media" src={m.mediaUrl} alt="صورة" onClick={() => window.open(m.mediaUrl, '_blank')} />
                          <button className="chat-download-btn" disabled={chatDownloadingId === m.id} onClick={() => handleDownload(m, 'image.jpg')}>
                            {chatDownloadingId === m.id ? '... جارٍ' : '⬇️ تحميل'}
                          </button>
                        </div>
                      )}
                      {m.mediaUrl && m.mediaType === 'video' && (
                        <div className="chat-media-wrap">
                          <video className="chat-msg-media" src={m.mediaUrl} controls />
                          <button className="chat-download-btn" disabled={chatDownloadingId === m.id} onClick={() => handleDownload(m, 'video.mp4')}>
                            {chatDownloadingId === m.id ? '... جارٍ' : '⬇️ تحميل'}
                          </button>
                        </div>
                      )}
                      {m.mediaUrl && m.mediaType === 'file' && (
                        <button className="chat-file-card" disabled={chatDownloadingId === m.id} onClick={() => handleDownload(m, 'file')}>
                          <span className="chat-file-icon">{fileIcon(m.fileName)}</span>
                          <span className="chat-file-info">
                            <span className="chat-file-name">{m.fileName || 'ملف'}</span>
                            <span className="chat-file-size">
                              {formatFileSize(m.fileSize)} • {chatDownloadingId === m.id ? 'جارٍ التحميل...' : 'اضغط للتحميل'}
                            </span>
                          </span>
                          <span className="chat-file-dl">{chatDownloadingId === m.id ? '⏳' : '⬇️'}</span>
                        </button>
                      )}
                      <div className="chat-msg-footer">
                        <span className="chat-msg-time">{new Date(m.createdAt).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
                        <span className="chat-msg-actions">
                          <button className={`chat-pin-btn ${m.pinned ? 'active' : ''}`} onClick={() => toggleChatPin(m)}
                            title={m.pinned ? 'إلغاء التثبيت' : 'تثبيت الرسالة (تمنع حذفها التلقائي)'}>📌</button>
                          {mine && <button className="chat-del-btn" onClick={() => setChatDeleteConfirm(m)} title="حذف رسالتي">🗑️</button>}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
            {pendingSave && (
              <div className="chat-save-bar">
                <span className="chat-save-text">الملف جاهز — اضغط للحفظ في جهازك</span>
                <button className="chat-save-btn" onClick={savePendingFile}>💾 حفظ في الجهاز</button>
                <button className="chat-save-close" onClick={() => setPendingSave(null)}>✕</button>
              </div>
            )}
            {chatUploading && (
              <div className="chat-upload-progress">
                <div className="chat-upload-head">
                  <span className="chat-upload-name">📤 {chatUploadName}</span>
                  <span className="chat-upload-pct">{chatUploadProgress}%</span>
                </div>
                <div className="chat-upload-track">
                  <div className="chat-upload-fill" style={{ width: `${chatUploadProgress}%` }} />
                </div>
              </div>
            )}
            <div className="chat-input-bar">
              <label className="chat-attach" title="إرسال صورة أو فيديو أو ملف">
                📎
                <input type="file" hidden disabled={chatUploading} onChange={(e) => { sendChatMedia(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <input type="text" className="chat-text-input"
                placeholder={chatUploading ? 'جارٍ رفع الملف...' : 'اكتب رسالة...'}
                value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChatMessage(); }} disabled={chatUploading} />
              <button className="chat-send" onClick={sendChatMessage} disabled={!chatInput.trim() || chatUploading}>إرسال</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Delete Confirm — تأكيد حذف رسالة */}
      {chatDeleteConfirm && (
        <div className="modal-overlay modal-overlay-top" onClick={() => setChatDeleteConfirm(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>حذف الرسالة</h3>
              <button onClick={() => setChatDeleteConfirm(null)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                هل تريد حذف هذه الرسالة نهائياً؟
                {chatDeleteConfirm.text && <><br /><strong className="chat-del-preview">«{chatDeleteConfirm.text.slice(0, 80)}{chatDeleteConfirm.text.length > 80 ? '…' : ''}»</strong></>}
                {chatDeleteConfirm.mediaUrl && <><br /><small style={{ opacity: 0.7 }}>سيُحذف الملف المرفق أيضاً.</small></>}
              </p>
            </div>
            <div className="modal-footer">
              <button onClick={() => setChatDeleteConfirm(null)} className="btn secondary">إلغاء</button>
              <button onClick={() => deleteChatMessage(chatDeleteConfirm)} className="btn danger">حذف</button>
            </div>
          </div>
        </div>
      )}
```

## 5.8 — التنسيقات
```css
/* ===== الشات العام ===== */
.chat-toggle-btn { position: relative; width: 46px; height: 46px; border: none; border-radius: 14px; background: var(--primary-glow, #eef2ff); font-size: 22px; cursor: pointer; flex-shrink: 0; transition: transform 0.2s, filter 0.2s; }
.chat-toggle-btn:hover { transform: translateY(-2px); filter: brightness(1.05); }
.chat-toggle-count { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }

.chat-overlay { align-items: flex-end; justify-content: flex-start; padding: 0; }
.chat-window { display: flex; flex-direction: column; width: 100%; max-width: 440px; height: min(80vh, 640px); margin: 20px; border-radius: 18px; background: var(--bg, #fff); overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
.chat-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 16px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: #fff; }
.chat-header-title { font-size: 16px; font-weight: 800; }
.chat-retention-hint { display: block; font-size: 11px; font-weight: 600; opacity: 0.75; margin-top: 2px; }
.chat-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: var(--bg-flat, #f8fafc); }
.chat-empty { margin: auto; color: var(--text-light); font-size: 14px; }
.chat-msg { max-width: 82%; padding: 9px 12px; border-radius: 14px; background: var(--bg, #fff); border: 1px solid var(--border, #e2e8f0); }
.chat-msg.mine { align-self: flex-start; background: var(--primary-glow, #eef2ff); border-color: transparent; }
.chat-msg.other { align-self: flex-end; }
.chat-msg.pinned { border: 1.5px solid #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12); }
.chat-msg-sender { font-size: 11px; font-weight: 800; color: var(--primary); margin-bottom: 3px; }
.chat-msg-text { font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.chat-msg-media { max-width: 100%; max-height: 240px; border-radius: 10px; margin-top: 6px; cursor: zoom-in; display: block; }
.chat-msg-time { font-size: 10px; color: var(--text-light); }
.chat-pinned-badge { font-size: 11px; font-weight: 800; color: #b45309; background: rgba(245, 158, 11, 0.15); border-radius: 8px; padding: 3px 8px; margin-bottom: 6px; display: inline-block; }
.chat-msg-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
.chat-msg-actions { display: flex; align-items: center; gap: 2px; }
.chat-pin-btn, .chat-del-btn { border: none; background: transparent; cursor: pointer; font-size: 13px; line-height: 1; padding: 3px 5px; border-radius: 6px; opacity: 0.35; filter: grayscale(1); transition: opacity 0.15s, filter 0.15s, background 0.15s; }
.chat-pin-btn:hover { opacity: 0.8; filter: grayscale(0); background: rgba(245, 158, 11, 0.15); }
.chat-pin-btn.active { opacity: 1; filter: grayscale(0); }
.chat-del-btn:hover { opacity: 1; filter: grayscale(0); background: rgba(239, 68, 68, 0.15); }
.chat-del-preview { display: inline-block; margin-top: 8px; color: var(--text-light); font-weight: 700; }

.chat-input-bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border, #e2e8f0); background: var(--bg, #fff); }
.chat-attach { font-size: 20px; cursor: pointer; padding: 4px 6px; }
.chat-text-input { flex: 1; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border, #e2e8f0); font-family: 'Cairo', sans-serif; background: var(--bg, #fff); color: var(--text); }
.chat-send { padding: 10px 16px; border: none; border-radius: 12px; background: var(--primary); color: #fff; font-family: 'Cairo', sans-serif; font-weight: 800; cursor: pointer; }
.chat-send:disabled { opacity: 0.5; cursor: default; }

/* ملفات ووسائط */
.chat-media-wrap { position: relative; display: inline-block; max-width: 100%; }
.chat-download-btn { position: absolute; bottom: 8px; left: 8px; padding: 5px 10px; border: none; border-radius: 8px; background: rgba(0,0,0,0.65); color: #fff; font-family: 'Cairo', sans-serif; font-size: 11px; font-weight: 700; cursor: pointer; opacity: 0; transition: opacity 0.2s, background 0.2s; }
.chat-media-wrap:hover .chat-download-btn { opacity: 1; }
.chat-download-btn:hover { background: rgba(0,0,0,0.85); }
.chat-download-btn:disabled { opacity: 0.8; cursor: wait; }
/* على الشاشات اللمسية لا يوجد hover — أظهر الزر دائماً */
@media (hover: none), (max-width: 720px) { .chat-download-btn { opacity: 1; } }

.chat-file-card { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 280px; padding: 10px 12px; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; background: rgba(255,255,255,0.85); font-family: 'Cairo', sans-serif; cursor: pointer; text-align: right; transition: filter 0.2s, transform 0.15s; }
.chat-file-card:hover { transform: translateY(-1px); filter: brightness(0.97); }
.chat-file-card:disabled { opacity: 0.7; cursor: wait; transform: none; }
.chat-file-icon { font-size: 26px; flex-shrink: 0; }
.chat-file-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.chat-file-name { font-size: 13px; font-weight: 800; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-file-size { font-size: 11px; color: var(--text-light); }
.chat-file-dl { font-size: 16px; flex-shrink: 0; opacity: 0.7; }

/* شريط «حفظ في الجهاز» (iOS) */
.chat-save-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid rgba(37,211,102,0.4); background: rgba(37,211,102,0.12); }
.chat-save-text { flex: 1; font-size: 12px; font-weight: 700; color: var(--text); }
.chat-save-btn { padding: 8px 14px; border: none; border-radius: 10px; background: #25d366; color: #fff; font-family: 'Cairo', sans-serif; font-size: 13px; font-weight: 800; cursor: pointer; white-space: nowrap; }
.chat-save-close { border: none; background: transparent; cursor: pointer; font-size: 15px; opacity: 0.6; padding: 4px 6px; }

/* شريط تقدّم الرفع */
.chat-upload-progress { padding: 10px 14px; border-top: 1px solid var(--border, #e2e8f0); background: var(--bg-flat, #f8fafc); }
.chat-upload-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.chat-upload-name { font-size: 12px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-upload-pct { font-size: 12px; font-weight: 800; color: var(--primary); flex-shrink: 0; }
.chat-upload-track { height: 8px; border-radius: 999px; background: var(--border, #e2e8f0); overflow: hidden; }
.chat-upload-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #6366f1 0%, #4f46e5 100%); transition: width 0.2s ease; }

[data-theme="dark"] .chat-window { background: #0f172a; }
[data-theme="dark"] .chat-messages { background: rgba(15,23,42,0.6); }
[data-theme="dark"] .chat-msg { background: rgba(15,23,42,0.9); border-color: var(--border); }
[data-theme="dark"] .chat-msg.mine { background: rgba(99,102,241,0.2); }
[data-theme="dark"] .chat-input-bar { background: #0f172a; border-color: var(--border); }
[data-theme="dark"] .chat-file-card { background: rgba(15,23,42,0.7); border-color: var(--border); }
[data-theme="dark"] .chat-pinned-badge { color: #fbbf24; background: rgba(245,158,11,0.2); }
[data-theme="dark"] .chat-upload-progress { background: rgba(15,23,42,0.6); border-color: var(--border); }
[data-theme="dark"] .chat-upload-track { background: rgba(148,163,184,0.25); }

@media (max-width: 720px) { .chat-window { max-width: 100%; height: 100vh; margin: 0; border-radius: 0; } }
```

---
---

# الجزء 6 — القواعد والبناء والنشر

## 6.1 — قواعد Firestore
في `firestore.rules` داخل `match /databases/{database}/documents`:

```
    match /chat/{msgId} {
      allow read, write: if request.auth != null;
    }
```

> لا تُقيّد الحذف على صاحب الرسالة فقط، وإلا تعطّل **التنظيف التلقائي** الذي يحذف رسائل الجميع بعد ٣ أشهر.

## 6.2 — قواعد Storage
أنشئ `storage.rules`:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    // وسائط الشات — قراءة/كتابة لأي مستخدم مسجّل دخول
    match /chat/{fileName} {
      allow read, write: if request.auth != null;
    }
  }
}
```

وأضِف في `firebase.json`:
```json
  "storage": { "rules": "storage.rules" }
```

> ⚠️ **يجب تفعيل Firebase Storage يدوياً أولاً** من Console ← Storage ← **Get Started**
> (قد يتطلب خطة Blaze). بدونه يفشل النشر برسالة `Firebase Storage has not been set up`.
> مسار الرفع `chat/<id>_<name>` مقطع واحد فيطابق `{fileName}` — لا تستخدم مسارات متداخلة.

## 6.3 — البناء والنشر
```bash
cd frontend && npm install && npm run lint && npm run build
cd .. && firebase deploy --only hosting,firestore:rules,storage --project <PROJECT_ID>
```

> **مهم:** أوامر `firebase deploy` تفشل أحياناً بخطأ شبكي عابر
> (`Failed to make request to ...googleapis.com`). **أعِد المحاولة عدة مرات** — تنجح غالباً
> خلال ٢-٣ محاولات. لا تستنتج أن الأمر معطّل من فشل واحد.

---

## ملخص السلوك (للتحقق النهائي)

**البصمة / Face ID**
- زر «دخول بالبصمة» في شاشة الدخول (يظهر فقط إن كانت مفعّلة على الجهاز).
- التفعيل/الإلغاء من داخل نافذة البروفايل.
- زر «👆 بالبصمة» في كل نافذة تطلب كلمة مرور الحساب.
- تغيير كلمة المرور يُلغي البصمة تلقائياً (لأنها تخزّن القديمة).

**البروفايل**
- أيقونة دائرية بأول حرف من الاسم/البريد بجانب زر تسجيل الخروج.
- تعديل الاسم، تغيير البريد (برابط تأكيد)، تغيير كلمة المرور.
- عرض كلمة المرور الحالية بالبصمة (نجوم + «إظهار بالبصمة»)، وأيقونة عين لكل حقل.

**واتساب**
- قوالب جاهزة + قالب مخصص محفوظ محلياً، بمتغيّرات تُعبّأ تلقائياً.
- فلترة بالمدينة وحالة السداد والشهر، وبحث بالاسم/الجوال/IP.
- الموقوفون مؤقتاً معطّلون تماماً (لا تحديد ولا إرسال).
- إرسال فردي أو متتابع للمحددين عبر wa.me.

**الشات**
- رسائل + صور + فيديو + أي ملف، مع شريط تقدّم للرفع.
- تحميل الوسائط والملفات (وعلى الجوال يفتح قائمة النظام للحفظ في الصور/الملفات).
- تثبيت الرسائل المهمة (📌) فلا تُحذف تلقائياً.
- المرسل يحذف رسالته (مع ملفها).
- حذف تلقائي لما هو أقدم من ٣ أشهر عدا المثبّتة.
- عدّاد غير مقروء مستقل لكل حساب، يُصفَّر عند فتح الشات.

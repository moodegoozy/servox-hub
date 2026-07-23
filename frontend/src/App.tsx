import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential, updateProfile, updatePassword, verifyBeforeUpdateEmail } from 'firebase/auth';
import { collection, doc, getDocs, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from './firebase';

type City = {
  id: string;
  name: string;
};

type AdditionalRouter = {
  userName: string;
  ipNumber: string;
};

type Customer = {
  id: string;
  cityId: string;
  name: string;
  phone?: string;
  startDate?: string;
  subscriptionValue?: number;
  subscriptionPaid?: number;
  setupFeeTotal?: number;
  setupFeePaid?: number;
  ipNumber?: string;
  userName?: string;
  additionalRouters?: AdditionalRouter[];
  lap?: string;
  site?: string;
  notes?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'partial' | 'discounted';
  monthlyPayments?: { [yearMonth: string]: 'paid' | 'partial' | 'pending' | 'discounted' };
  monthlyPartialAmounts?: { [yearMonth: string]: number };
  hasDiscount?: boolean;
  discountAmount?: number;
  isSuspended?: boolean;
  suspendedDate?: string;
  isExempt?: boolean;
  towerId?: string; // البرج التابع له العميل
};

type Expense = {
  id: string;
  name: string;
  description?: string;
  amount: number;
  date: string;
  month: number;
  year: number;
};

type Income = {
  id: string;
  name: string;
  description?: string;
  amount: number;
  date: string;
  month: number;
  year: number;
};

type Card = {
  id: string;
  cardNumber: string;
  package: string;
  value: number;
  date: string;
  month: number;
  year: number;
  note?: string;
};

type ChatMessage = {
  id: string;
  senderEmail: string;
  senderName?: string;
  text?: string;
  mediaUrl?: string;
  mediaPath?: string; // مسار الملف في Storage (لحذفه لاحقاً)
  mediaType?: 'image' | 'video' | 'file';
  fileName?: string; // اسم الملف الأصلي (للملفات العامة والتحميل)
  fileSize?: number; // حجم الملف بالبايت
  createdAt: number;
  pinned?: boolean; // الرسائل المثبّتة لا تُحذف تلقائياً
};

// مدة الاحتفاظ برسائل الشات — ٣ أشهر، ثم تُحذف تلقائياً عدا المثبّتة
const CHAT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// مفتاح «آخر قراءة» للشات — مستقل لكل حساب على هذا الجهاز
const chatReadKey = (email?: string | null) => `servox_chat_lastread_${email || 'anon'}`;

// تنسيق حجم الملف بصيغة مقروءة
const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// أيقونة تناسب امتداد الملف
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

// تحميل ملف/وسائط — يجلبه كـ blob ليُحفظ باسمه، ويفتحه في تبويب جديد إن منع CORS ذلك
const downloadFile = async (url: string, name: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, '_blank'); // بديل آمن
  }
};

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

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const TOWER_STATUS: Record<TowerStatus, { label: string; icon: string; cls: string }> = {
  'working': { label: 'يعمل', icon: '🟢', cls: 'working' },
  'not-working': { label: 'لا يعمل', icon: '🔴', cls: 'not-working' },
  'cancelled': { label: 'ملغي', icon: '⚫', cls: 'cancelled' },
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// ===== رسائل واتساب للعملاء =====
// القوالب تستخدم متغيّرات: {الاسم} {المدينة} {الجوال} {المبلغ}
const WA_TEMPLATES: { id: string; title: string; body: string }[] = [
  {
    id: 'reminder',
    title: 'تذكير ودّي بالسداد',
    body: 'مرحباً {الاسم} 👋\nنذكّركم بسداد اشتراك الإنترنت بمبلغ {المبلغ} ﷼.\nنشكر لكم تعاونكم 🌐',
  },
  {
    id: 'due',
    title: 'مبلغ مستحق',
    body: 'عميلنا العزيز {الاسم} ({المدينة})\nلديكم مبلغ مستحق قدره {المبلغ} ﷼ على اشتراك الإنترنت.\nيرجى السداد في أقرب وقت، وشكراً لكم.',
  },
  {
    id: 'thanks',
    title: 'شكر بعد السداد',
    body: 'شكراً لك {الاسم} 🌟\nتم استلام سداد اشتراككم بنجاح. نتمنى لكم تجربة إنترنت ممتازة 🌐',
  },
];
const WA_CUSTOM_KEY = 'servox_wa_custom_template';

// تحويل رقم الجوال إلى صيغة واتساب الدولية (السعودية افتراضاً)
const normalizePhone = (raw?: string): string => {
  if (!raw) return '';
  let d = raw.replace(/\D/g, ''); // أرقام فقط
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('966')) return d;
  if (d.startsWith('0')) return '966' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '966' + d;
  return d;
};

// تعبئة متغيّرات القالب ببيانات العميل
const fillTemplate = (body: string, vars: { name: string; city: string; phone: string; amount: string }): string =>
  body
    .replace(/\{الاسم\}/g, vars.name)
    .replace(/\{المدينة\}/g, vars.city)
    .replace(/\{الجوال\}/g, vars.phone)
    .replace(/\{المبلغ\}/g, vars.amount);

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

const formatDate = (value: string) => {
  const date = new Date(value);
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
};

function App() {
  const [cities, setCities] = useState<City[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [startDate, setStartDate] = useState('');
  const [subscriptionValue, setSubscriptionValue] = useState('');
  const [setupFeeTotal, setSetupFeeTotal] = useState('');
  const [setupFeePaid, setSetupFeePaid] = useState('');
  const [ipNumber, setIpNumber] = useState('');
  const [userName, setUserName] = useState('');
  const [additionalRouterCount, setAdditionalRouterCount] = useState(0);
  const [additionalRouters, setAdditionalRouters] = useState<AdditionalRouter[]>([]);
  const [lap, setLap] = useState('');
  const [site, setSite] = useState('');
  const [notes, setNotes] = useState('');
  const [customerTowerId, setCustomerTowerId] = useState(''); // البرج المختار في فورم إضافة العميل
  const [toastMessage, setToastMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'invoices' | 'yearly' | 'revenues' | 'discounts' | 'suspended' | 'expenses' | 'customers-db' | 'pool' | 'towers' | 'whatsapp'>('dashboard');
  // مخزن اليوزرات والـ IP
  const [poolCityIds, setPoolCityIds] = useState<string[]>([]);
  const [poolSearch, setPoolSearch] = useState('');
  const [poolFilter, setPoolFilter] = useState<'all' | 'free' | 'used' | 'dup' | 'suspended'>('all');
  const [poolModal, setPoolModal] = useState<{ kind: 'user' | 'ip'; value: string; customers: Customer[] } | null>(null);
  const POOL_SIZE = 300;
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [yearlyCityId, setYearlyCityId] = useState<string | null>(null);
  const [invoiceCityId, setInvoiceCityId] = useState<string | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState(new Date().getMonth() + 1);
  const [invoiceYear, setInvoiceYear] = useState(new Date().getFullYear());
  const [revenuesCityId, setRevenuesCityId] = useState<string | null>(null);
  const [revenuesYear, setRevenuesYear] = useState(new Date().getFullYear());
  const [revenuesMonth, setRevenuesMonth] = useState(new Date().getMonth() + 1);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [confirmStatusChange, setConfirmStatusChange] = useState<{customer: Customer; newStatus: 'paid' | 'unpaid' | 'partial' | 'discounted'; yearMonth?: string} | null>(null);
  const [partialPaymentAmount, setPartialPaymentAmount] = useState('');
  const [paymentTypeChoice, setPaymentTypeChoice] = useState<'partial' | 'discounted'>('partial');
  const [paymentMonth, setPaymentMonth] = useState(new Date().getMonth() + 1);
  const [paymentYear, setPaymentYear] = useState(new Date().getFullYear());
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('datahub-theme') === 'dark');
  // الدخول بالبصمة / Face ID
  const [bioAvailable, setBioAvailable] = useState(false); // الجهاز يدعم مُصادقاً حيوياً
  const [bioEnabled, setBioEnabled] = useState(() => getBioStore() !== null); // بصمة مسجّلة على هذا الجهاز
  const [bioBusy, setBioBusy] = useState(false);
  const [bioSetupModal, setBioSetupModal] = useState(false);
  const [bioSetupPassword, setBioSetupPassword] = useState('');
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
  const [revealedCurrentPassword, setRevealedCurrentPassword] = useState<string | null>(null); // كلمة المرور الحالية المكشوفة بالبصمة
  const [revealBusy, setRevealBusy] = useState(false);
  // تبويب واتساب
  const [waCityId, setWaCityId] = useState<string | null>(null);
  const [waStatusFilter, setWaStatusFilter] = useState<'all' | 'paid' | 'unpaid' | 'partial'>('unpaid');
  const [waSelected, setWaSelected] = useState<string[]>([]);
  const [waTemplateId, setWaTemplateId] = useState<string>(WA_TEMPLATES[0].id);
  const [waCustomTemplate, setWaCustomTemplate] = useState<string>(() => localStorage.getItem(WA_CUSTOM_KEY) || 'مرحباً {الاسم} 👋\nنذكّركم بسداد مبلغ {المبلغ} ﷼ لمدينة {المدينة}.');
  const [waAmount, setWaAmount] = useState('');
  const [waQueue, setWaQueue] = useState<string[]>([]); // طابور الإرسال المتتابع للمحددين
  const [waQueuePos, setWaQueuePos] = useState(0);
  const [waMonth, setWaMonth] = useState(0); // 0 = الحالة العامة، 1-12 = شهر محدد
  const [waYear, setWaYear] = useState(new Date().getFullYear());
  const [waSearch, setWaSearch] = useState(''); // بحث بالاسم أو الجوال أو IP
  // الشات العام بين حسابات الإدارة
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatUploading, setChatUploading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatCleanupDone = useRef(false); // يضمن تشغيل التنظيف مرة واحدة لكل جلسة
  const [chatLastRead, setChatLastRead] = useState(0); // آخر وقت قراءة للشات — مستقل لكل حساب
  const [chatDeleteConfirm, setChatDeleteConfirm] = useState<ChatMessage | null>(null); // تأكيد حذف رسالة

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
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{type: 'city' | 'customer'; id: string; name: string} | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAddCustomerForm, setShowAddCustomerForm] = useState(false);
  const [editPasswordModal, setEditPasswordModal] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [pendingEditCustomer, setPendingEditCustomer] = useState<Customer | null>(null);
  const [transferModal, setTransferModal] = useState(false);
  const [transferCustomer, setTransferCustomer] = useState<Customer | null>(null);
  const [transferCityId, setTransferCityId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [discountCustomerId, setDiscountCustomerId] = useState('');
  const [discountType, setDiscountType] = useState<'amount' | 'percentage'>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [discountSearch, setDiscountSearch] = useState('');
  const [discountMonth, setDiscountMonth] = useState(new Date().getMonth() + 1);
  const [discountYear, setDiscountYear] = useState(new Date().getFullYear());
  const [transferPassword, setTransferPassword] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);

  // ميكروتيك - حالة النموذج والنتيجة
  const [mikroIP, setMikroIP] = useState('');
  const [mikroUser, setMikroUser] = useState('');
  const [mikroPass, setMikroPass] = useState('');
  const [mikroLoading, setMikroLoading] = useState(false);
  const [mikroMsg, setMikroMsg] = useState('');
  // Cloud NAT IP from backend (Cloud Run)
  const [cloudNatIp, setCloudNatIp] = useState<string>('جارٍ التحميل...');
  
  // ميكروتيك داشبورد - حالة متقدمة
  const [mikroConnected, setMikroConnected] = useState(false);
  const [mikroDashboard, setMikroDashboard] = useState<{
    identity: string;
    system: { uptime?: string; version?: string; cpuLoad?: string; freeMemory?: string; totalMemory?: string; architecture?: string; boardName?: string };
    routerboard: { model?: string; serialNumber?: string; firmware?: string };
    secrets: { id: string; name: string; service: string; profile: string; remoteAddress?: string; disabled: boolean }[];
    activeConnections: { id: string; name: string; service: string; callerId?: string; address?: string; uptime?: string }[];
    interfaces: { id: string; name: string; type: string; running: boolean; disabled: boolean }[];
  } | null>(null);
  const [mikroProfiles, setMikroProfiles] = useState<{ id: string; name: string; localAddress?: string; remoteAddress?: string; rateLimit?: string }[]>([]);
  const [mikroTab, setMikroTab] = useState<'overview' | 'secrets' | 'active' | 'interfaces'>('overview');
  const [showAddSecretModal, setShowAddSecretModal] = useState(false);
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretPassword, setNewSecretPassword] = useState('');
  const [newSecretProfile, setNewSecretProfile] = useState('');
  const [newSecretRemoteAddress, setNewSecretRemoteAddress] = useState('');
  const [secretSearch, setSecretSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const fetchCloudNatIp = async () => {
    try {
      const base = (import.meta.env.VITE_BACKEND_URL as string) || 'https://mikrotik-api-923854285496.europe-west1.run.app';
      const res = await fetch(`${base.replace(/\/$/, '')}/ip`);
      const data = await res.json();
      setCloudNatIp(data?.egressIp || 'غير متوفر');
    } catch (err) {
      setCloudNatIp('خطأ');
    }
  };

  // whether to use cloud NAT as mikro IP
  const [useCloudNat, setUseCloudNat] = useState(false);

  // المصروفات
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseName, setExpenseName] = useState('');
  const [showPendingRevenues, setShowPendingRevenues] = useState(false);
  const [showPaidRevenues, setShowPaidRevenues] = useState(false);
  const [showPartialRevenues, setShowPartialRevenues] = useState(false);
  const [showExemptList, setShowExemptList] = useState(false);
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayISO());
  
  // الإيرادات اليدوية
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [incomeName, setIncomeName] = useState('');
  const [incomeDescription, setIncomeDescription] = useState('');
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeDate, setIncomeDate] = useState(todayISO());
  const [financeMonth, setFinanceMonth] = useState(new Date().getMonth() + 1);
  const [financeYear, setFinanceYear] = useState(new Date().getFullYear());
  const [suspendSearch, setSuspendSearch] = useState('');
  const [yearlySearch, setYearlySearch] = useState('');
  
  // نظام حذف المصروفات والإيرادات مع كلمة المرور
  const [financeDeleteConfirm, setFinanceDeleteConfirm] = useState<{type: 'expense' | 'income'; item: Expense | Income} | null>(null);
  const [financeDeletePassword, setFinanceDeletePassword] = useState('');
  const [financeDeleteLoading, setFinanceDeleteLoading] = useState(false);
  
  // نظام حذف الخصومات مع كلمة المرور
  const [discountDeleteConfirm, setDiscountDeleteConfirm] = useState<Customer | null>(null);
  const [discountDeletePassword, setDiscountDeletePassword] = useState('');
  const [discountDeleteLoading, setDiscountDeleteLoading] = useState(false);
  
  // قاعدة العملاء - فلتر وبحث
  const [customersDbCityId, setCustomersDbCityId] = useState<string | null>(null);
  const [customersDbSearch, setCustomersDbSearch] = useState('');
  
  // تعديل المصروفات والإيرادات
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  const [showEditExpenseModal, setShowEditExpenseModal] = useState(false);
  const [showEditIncomeModal, setShowEditIncomeModal] = useState(false);
  
  // تأكيد تعديل المصروفات/الإيرادات بكلمة مرور
  const [pendingEditExpense, setPendingEditExpense] = useState<Expense | null>(null);
  const [pendingEditIncome, setPendingEditIncome] = useState<Income | null>(null);
  const [editFinancePassword, setEditFinancePassword] = useState('');
  const [editFinanceLoading, setEditFinanceLoading] = useState(false);

  // نظام البطاقات
  const [cards, setCards] = useState<Card[]>([]);
  const [cardNumber, setCardNumber] = useState('');
  const [cardPackage, setCardPackage] = useState('');
  const [cardValue, setCardValue] = useState('');
  const [cardDate, setCardDate] = useState(todayISO());
  const [cardNote, setCardNote] = useState('');
  const [cardsMonth, setCardsMonth] = useState(new Date().getMonth() + 1);
  const [cardsYear, setCardsYear] = useState(new Date().getFullYear());
  const [cardDeleteConfirm, setCardDeleteConfirm] = useState<Card | null>(null);
  const [cardDeletePassword, setCardDeletePassword] = useState('');
  const [cardDeleteLoading, setCardDeleteLoading] = useState(false);
  const [showAddCardForm, setShowAddCardForm] = useState(false);
  const [cardSearch, setCardSearch] = useState('');
  const [showReportFilters, setShowReportFilters] = useState(false);
  const [reportMonth, setReportMonth] = useState(0); // 0 = الكل
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportPackage, setReportPackage] = useState(''); // '' = الكل
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
  const [towerCustomersModal, setTowerCustomersModal] = useState<Tower | null>(null); // نافذة مستخدمي البرج
  const [pendingEditTower, setPendingEditTower] = useState<Tower | null>(null); // البرج المنتظر تأكيد كلمة المرور لتعديله
  const [towerEditPasswordModal, setTowerEditPasswordModal] = useState(false);
  const [towerEditPassword, setTowerEditPassword] = useState('');
  const [towerEditLoading, setTowerEditLoading] = useState(false);
  const [pendingUnlinkCustomer, setPendingUnlinkCustomer] = useState<Customer | null>(null); // العميل المنتظر تأكيد كلمة المرور لإزالته من البرج
  const [unlinkPassword, setUnlinkPassword] = useState('');
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const selectedCity = useMemo(
    () => cities.find((city) => city.id === selectedCityId) ?? null,
    [cities, selectedCityId]
  );

  const filteredCustomers = useMemo(
    () =>
      selectedCityId
        ? customers.filter((c) => c.cityId === selectedCityId)
        : [],
    [customers, selectedCityId]
  );

  const invoiceFilteredCustomers = useMemo(
    () => {
      let filtered = invoiceCityId
        ? customers.filter((c) => c.cityId === invoiceCityId)
        : [];
      
      if (invoiceSearch.trim()) {
        const query = invoiceSearch.trim().toLowerCase();
        filtered = filtered.filter((c) => 
          c.name.toLowerCase().includes(query) || 
          (c.phone && c.phone.includes(query)) ||
          (c.userName && c.userName.toLowerCase().includes(query))
        );
      }
      
      return filtered;
    },
    [customers, invoiceCityId, invoiceSearch]
  );

  const revenuesData = useMemo(() => {
    const yearMonth = `${revenuesYear}-${String(revenuesMonth).padStart(2, '0')}`;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const isFutureMonth = revenuesYear > currentYear || 
      (revenuesYear === currentYear && revenuesMonth > currentMonth);

    // استثناء العملاء الموقوفين والمعفيين من الحسابات
    const cityCustomers = revenuesCityId
      ? customers.filter((c) => c.cityId === revenuesCityId && c.subscriptionValue && !c.isSuspended && !c.isExempt)
      : customers.filter((c) => c.subscriptionValue && !c.isSuspended && !c.isExempt);

    const paid = cityCustomers.filter((c) => {
      if (isFutureMonth) return false;
      const monthStatus = c.monthlyPayments?.[yearMonth];
      return monthStatus === 'paid';
    });

    const partial = cityCustomers.filter((c) => {
      if (isFutureMonth) return false;
      const monthStatus = c.monthlyPayments?.[yearMonth];
      return monthStatus === 'partial';
    });

    const pending = cityCustomers.filter((c) => {
      if (isFutureMonth) return true;
      const monthStatus = c.monthlyPayments?.[yearMonth];
      return monthStatus === 'pending' || monthStatus === undefined;
    });

    const paidAmount = paid.reduce((sum, c) => sum + (c.subscriptionValue || 0), 0);
    const partialAmount = partial.reduce((sum, c) => sum + (c.subscriptionPaid || 0), 0);
    const pendingAmount = pending.reduce((sum, c) => sum + (c.subscriptionValue || 0), 0);

    return { paid, partial, pending, paidAmount, partialAmount, pendingAmount };
  }, [customers, revenuesCityId, revenuesYear, revenuesMonth]);

  // دالة البحث الديناميكية حسب التبويب المفتوح
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.trim().toLowerCase();
    
    // البحث في العملاء حسب التبويب
    let filteredList = customers;
    
    // تصفية حسب التبويب الحالي
    switch (activeTab) {
      case 'dashboard':
        // في لوحة التحكم، البحث في المدينة المختارة
        if (selectedCityId) {
          filteredList = customers.filter(c => c.cityId === selectedCityId);
        }
        break;
      case 'yearly':
        // متابعة الاشتراكات - البحث في المدينة المختارة
        if (yearlyCityId) {
          filteredList = customers.filter(c => c.cityId === yearlyCityId);
        }
        break;
      case 'invoices':
        // الفواتير - البحث في المدينة المختارة
        if (invoiceCityId) {
          filteredList = customers.filter(c => c.cityId === invoiceCityId);
        }
        break;
      case 'revenues':
        // الإيرادات - البحث في المدينة المختارة
        if (revenuesCityId) {
          filteredList = customers.filter(c => c.cityId === revenuesCityId);
        }
        break;
      case 'discounts':
        // الخصومات - البحث في العملاء الذين لديهم خصم
        filteredList = customers.filter(c => c.hasDiscount);
        break;
      case 'suspended':
        // الموقوفين - البحث في العملاء الموقوفين
        filteredList = customers.filter(c => c.isSuspended);
        break;
    }
    
    return filteredList.filter((c) => 
      c.name.toLowerCase().includes(query) || 
      (c.phone && c.phone.includes(query)) ||
      (c.userName && c.userName.toLowerCase().includes(query))
    );
  }, [customers, searchQuery, activeTab, selectedCityId, yearlyCityId, invoiceCityId, revenuesCityId]);

  // دالة الانتقال للعميل حسب التبويب
  const navigateToCustomer = (customer: Customer) => {
    // تحديث المدينة المختارة حسب التبويب الحالي
    switch (activeTab) {
      case 'dashboard':
        setSelectedCityId(customer.cityId);
        setSelectedCustomer(customer);
        setShowCustomerModal(true);
        break;
      case 'yearly':
        setYearlyCityId(null);
        setTimeout(() => {
          const element = document.getElementById(`customer-${customer.id}`);
          if (element) {
            element.classList.add('highlight');
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => element.classList.remove('highlight'), 2000);
          }
        }, 100);
        return;
      case 'invoices':
        setInvoiceCityId(customer.cityId);
        break;
      case 'revenues':
        setRevenuesCityId(customer.cityId);
        break;
      case 'discounts':
      case 'suspended':
        // في هذه التبويبات، نفتح تفاصيل العميل
        setSelectedCustomer(customer);
        setShowCustomerModal(true);
        break;
      default:
        setSelectedCityId(customer.cityId);
        setSelectedCustomer(customer);
        setShowCustomerModal(true);
    }
    
    setSearchQuery('');
    
    // تمرير للعميل
    setTimeout(() => {
      const element = document.getElementById(`customer-${customer.id}`);
      if (element) {
        element.classList.add('highlight');
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => element.classList.remove('highlight'), 2000);
      }
    }, 100);
  };

  // دالة حساب عدد الأيام من تاريخ بدء الاشتراك
  const getDaysSinceStart = (startDate?: string): number => {
    if (!startDate) return 0;
    try {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) return 0;
      const today = new Date();
      start.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      const diffTime = today.getTime() - start.getTime();
      const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return days >= 0 ? days : 0;
    } catch {
      return 0;
    }
  };

  // حساب عدد الأيام منذ بداية الشهر الحالي
  const getDaysSinceMonthStart = (startDate?: string): number => {
    if (!startDate) return 0;
    try {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) return 0;
      const today = new Date();
      const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      
      // إذا كان تاريخ البدء قبل بداية الشهر الحالي، نحسب من بداية الشهر
      const effectiveStart = start < currentMonthStart ? currentMonthStart : start;
      
      effectiveStart.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      
      const diffTime = today.getTime() - effectiveStart.getTime();
      const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return days >= 0 ? days : 0;
    } catch {
      return 0;
    }
  };

  // الفواتير المستحقة - العملاء الذين مر عليهم 30 يوم في الشهر الحالي ولم يدفعوا بعد
  const dueInvoices = useMemo(() => {
    const today = new Date();
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    return customers.filter(c => {
      if (!c.startDate) return false;
      // استثناء العملاء الموقوفين والمعفيين
      if (c.isSuspended) return false;
      if (c.isExempt) return false;
      
      // إذا كان الشهر الحالي مدفوع، لا يظهر في الجدول
      const monthStatus = c.monthlyPayments?.[currentYearMonth];
      if (monthStatus === 'paid') return false;
      
      const days = getDaysSinceMonthStart(c.startDate);
      return days >= 30;
    });
  }, [customers]);

  // دالة تطبيق الخصم
  const applyDiscount = async () => {
    if (!discountCustomerId) {
      setToastMessage('اختر العميل أولاً');
      return;
    }
    if (!discountValue || parseFloat(discountValue) <= 0) {
      setToastMessage('أدخل قيمة الخصم');
      return;
    }

    const customer = customers.find(c => c.id === discountCustomerId);
    if (!customer) {
      setToastMessage('العميل غير موجود');
      return;
    }

    const currentValue = customer.subscriptionValue || 0;
    let newValue: number;
    let discountAmount: number;

    if (discountType === 'percentage') {
      const percentage = parseFloat(discountValue);
      if (percentage > 100) {
        setToastMessage('النسبة لا يمكن أن تتجاوز 100%');
        return;
      }
      discountAmount = (currentValue * percentage) / 100;
      newValue = currentValue - discountAmount;
    } else {
      discountAmount = parseFloat(discountValue);
      if (discountAmount > currentValue) {
        setToastMessage('قيمة الخصم أكبر من قيمة الاشتراك');
        return;
      }
      newValue = currentValue - discountAmount;
    }

    try {
      const updatedCustomer = {
        ...customer,
        subscriptionValue: newValue,
        hasDiscount: true,
        discountAmount: (customer.discountAmount || 0) + discountAmount,
      };
      
      await setDoc(doc(db, 'customers', customer.id), updatedCustomer);
      
      setCustomers(customers.map(c => 
        c.id === customer.id ? updatedCustomer : c
      ));
      
      setToastMessage(`تم تطبيق خصم ${discountAmount.toFixed(0)} ﷼ على ${customer.name}. القيمة الجديدة: ${newValue.toFixed(0)} ﷼`);
      setDiscountCustomerId('');
      setDiscountValue('');
    } catch (error) {
      setToastMessage('خطأ في تطبيق الخصم');
      console.error(error);
    }
  };

  // دالة إزالة الخصم (تطلب كلمة المرور)
  const handleRemoveDiscount = (customer: Customer) => {
    if (!customer.hasDiscount || !customer.discountAmount) {
      setToastMessage('هذا العميل ليس لديه خصم');
      return;
    }
    setDiscountDeleteConfirm(customer);
  };

  const executeRemoveDiscount = async (customer: Customer) => {
    const newValue = (customer.subscriptionValue || 0) + (customer.discountAmount || 0);
    
    try {
      const updatedCustomer = {
        ...customer,
        subscriptionValue: newValue,
        hasDiscount: false,
        discountAmount: 0,
      };
      
      await setDoc(doc(db, 'customers', customer.id), updatedCustomer);
      
      setCustomers(customers.map(c => 
        c.id === customer.id ? updatedCustomer : c
      ));
      
      setToastMessage(`تم إزالة الخصم من ${customer.name}. القيمة الجديدة: ${newValue.toFixed(0)} ﷼`);
    } catch (error) {
      setToastMessage('خطأ في إزالة الخصم');
      console.error(error);
    }
  };

  const confirmDiscountDelete = async (pwOverride?: string) => {
    if (!discountDeleteConfirm || !(pwOverride ?? discountDeletePassword).trim()) {
      setToastMessage('أدخل كلمة المرور');
      return;
    }

    setDiscountDeleteLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        setToastMessage('خطأ في المصادقة');
        return;
      }

      // التحقق من كلمة المرور
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? discountDeletePassword);
      await reauthenticateWithCredential(user, credential);

      // تنفيذ إزالة الخصم
      await executeRemoveDiscount(discountDeleteConfirm);

      setDiscountDeleteConfirm(null);
      setDiscountDeletePassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في التحقق');
        console.error(error);
      }
    } finally {
      setDiscountDeleteLoading(false);
    }
  };

  // دالة إيقاف/تفعيل العميل
  const toggleSuspend = async (customer: Customer) => {
    try {
      const newIsSuspended = !customer.isSuspended;
      const updatedCustomer: Customer = {
        ...customer,
        isSuspended: newIsSuspended,
        suspendedDate: newIsSuspended ? todayISO() : '',
      };
      
      await setDoc(doc(db, 'customers', customer.id), updatedCustomer);
      
      setCustomers(customers.map(c => 
        c.id === customer.id ? updatedCustomer : c
      ));
      
      const action = newIsSuspended ? 'إيقاف' : 'تفعيل';
      setToastMessage(`تم ${action} ${customer.name}`);
    } catch (error) {
      setToastMessage('خطأ في تغيير حالة العميل');
      console.error(error);
    }
  };

  // دالة إضافة مصروف
  const addExpense = async () => {
    if (!expenseName.trim()) {
      setToastMessage('أدخل اسم المصروف');
      return;
    }
    if (!expenseAmount || parseFloat(expenseAmount) <= 0) {
      setToastMessage('أدخل قيمة المصروف');
      return;
    }

    try {
      const date = new Date(expenseDate);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      
      const expenseData: Record<string, unknown> = {
        id,
        name: expenseName.trim(),
        amount: parseFloat(expenseAmount),
        date: expenseDate,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      };
      
      if (expenseDescription.trim()) {
        expenseData.description = expenseDescription.trim();
      }

      await setDoc(doc(db, 'expenses', id), expenseData);
      
      setExpenseName('');
      setExpenseDescription('');
      setExpenseAmount('');
      setExpenseDate(todayISO());
      
      setToastMessage(`تم إضافة المصروف: ${expenseName.trim()}`);
    } catch (error) {
      setToastMessage('خطأ في إضافة المصروف');
      console.error(error);
    }
  };

  // دالة حذف مصروف (تطلب كلمة المرور)
  const handleDeleteExpense = (expense: Expense) => {
    setFinanceDeleteConfirm({ type: 'expense', item: expense });
  };

  const executeDeleteExpense = async (expense: Expense) => {
    try {
      await deleteDoc(doc(db, 'expenses', expense.id));
      setExpenses(expenses.filter(e => e.id !== expense.id));
      setToastMessage(`تم حذف المصروف: ${expense.name}`);
    } catch (error) {
      setToastMessage('خطأ في حذف المصروف');
      console.error(error);
    }
  };

  // دالة تعديل مصروف
  const saveEditedExpense = async () => {
    if (!editingExpense) return;
    
    try {
      const date = new Date(editingExpense.date);
      const updatedExpense = {
        ...editingExpense,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      };
      
      await setDoc(doc(db, 'expenses', editingExpense.id), updatedExpense);
      setToastMessage(`تم تعديل المصروف: ${editingExpense.name}`);
      setShowEditExpenseModal(false);
      setEditingExpense(null);
    } catch (error) {
      setToastMessage('خطأ في تعديل المصروف');
      console.error(error);
    }
  };

  // دوال الإيرادات اليدوية
  const addIncome = async () => {
    if (!incomeName.trim()) {
      setToastMessage('أدخل اسم الإيراد');
      return;
    }
    if (!incomeAmount || parseFloat(incomeAmount) <= 0) {
      setToastMessage('أدخل قيمة الإيراد');
      return;
    }

    try {
      const date = new Date(incomeDate);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      
      const incomeData: Record<string, unknown> = {
        id,
        name: incomeName.trim(),
        amount: parseFloat(incomeAmount),
        date: incomeDate,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      };
      
      if (incomeDescription.trim()) {
        incomeData.description = incomeDescription.trim();
      }

      await setDoc(doc(db, 'incomes', id), incomeData);
      
      setIncomeName('');
      setIncomeDescription('');
      setIncomeAmount('');
      setIncomeDate(todayISO());
      
      setToastMessage(`تم إضافة الإيراد: ${incomeName.trim()}`);
    } catch (error) {
      setToastMessage('خطأ في إضافة الإيراد');
      console.error(error);
    }
  };

  const handleDeleteIncome = (income: Income) => {
    setFinanceDeleteConfirm({ type: 'income', item: income });
  };

  const executeDeleteIncome = async (income: Income) => {
    try {
      await deleteDoc(doc(db, 'incomes', income.id));
      setIncomes(incomes.filter(i => i.id !== income.id));
      setToastMessage(`تم حذف الإيراد: ${income.name}`);
    } catch (error) {
      setToastMessage('خطأ في حذف الإيراد');
      console.error(error);
    }
  };

  // دالة تعديل إيراد
  const saveEditedIncome = async () => {
    if (!editingIncome) return;
    
    try {
      const date = new Date(editingIncome.date);
      const updatedIncome = {
        ...editingIncome,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      };
      
      await setDoc(doc(db, 'incomes', editingIncome.id), updatedIncome);
      setToastMessage(`تم تعديل الإيراد: ${editingIncome.name}`);
      setShowEditIncomeModal(false);
      setEditingIncome(null);
    } catch (error) {
      setToastMessage('خطأ في تعديل الإيراد');
      console.error(error);
    }
  };

  // دالة تأكيد تعديل المصروفات/الإيرادات مع كلمة المرور
  const confirmEditFinance = async (pwOverride?: string) => {
    if ((!pendingEditExpense && !pendingEditIncome) || !(pwOverride ?? editFinancePassword).trim()) {
      setToastMessage('أدخل كلمة المرور');
      return;
    }

    setEditFinanceLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        setToastMessage('خطأ في المصادقة');
        setEditFinanceLoading(false);
        return;
      }

      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? editFinancePassword);
      await reauthenticateWithCredential(user, credential);

      // فتح modal التعديل
      if (pendingEditExpense) {
        setEditingExpense(pendingEditExpense);
        setShowEditExpenseModal(true);
        setPendingEditExpense(null);
      } else if (pendingEditIncome) {
        setEditingIncome(pendingEditIncome);
        setShowEditIncomeModal(true);
        setPendingEditIncome(null);
      }
      setEditFinancePassword('');
    } catch {
      setToastMessage('كلمة المرور غير صحيحة');
    } finally {
      setEditFinanceLoading(false);
    }
  };

  // === نظام البطاقات ===
  const addCard = async () => {
    if (!cardNumber.trim()) { setToastMessage('أدخل رقم البطاقة'); return; }
    if (!cardPackage.trim()) { setToastMessage('أدخل الباقة'); return; }
    if (!cardValue || parseFloat(cardValue) <= 0) { setToastMessage('أدخل قيمة البطاقة'); return; }

    try {
      const date = new Date(cardDate);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const cardData: Record<string, unknown> = {
        id,
        cardNumber: cardNumber.trim(),
        package: cardPackage.trim(),
        value: parseFloat(cardValue),
        date: cardDate,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      };
      if (cardNote.trim()) cardData.note = cardNote.trim();

      await setDoc(doc(db, 'cards', id), cardData);
      setCardNumber(''); setCardPackage(''); setCardValue(''); setCardDate(todayISO()); setCardNote('');
      setShowAddCardForm(false);
      setToastMessage(`تم إضافة البطاقة: ${cardNumber.trim()}`);
    } catch {
      setToastMessage('خطأ في إضافة البطاقة');
    }
  };

  const confirmDeleteCard = async (pwOverride?: string) => {
    if (!cardDeleteConfirm || !(pwOverride ?? cardDeletePassword).trim()) { setToastMessage('أدخل كلمة المرور'); return; }
    setCardDeleteLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? cardDeletePassword);
      await reauthenticateWithCredential(user, credential);
      await deleteDoc(doc(db, 'cards', cardDeleteConfirm.id));
      setCards(cards.filter(c => c.id !== cardDeleteConfirm.id));
      setToastMessage(`تم حذف البطاقة: ${cardDeleteConfirm.cardNumber}`);
      setCardDeleteConfirm(null); setCardDeletePassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else { setToastMessage('خطأ في التحقق'); }
    } finally { setCardDeleteLoading(false); }
  };

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
    setPendingEditTower(tower);
    setTowerEditPassword('');
    setTowerEditPasswordModal(true);
  };

  // التحقق من كلمة مرور الحساب قبل فتح نافذة تعديل البرج
  const confirmTowerEditPassword = async (pwOverride?: string) => {
    if (!pendingEditTower || !(pwOverride ?? towerEditPassword).trim()) {
      setToastMessage('أدخل كلمة المرور');
      return;
    }
    setTowerEditLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? towerEditPassword);
      await reauthenticateWithCredential(user, credential);
      setEditingTower({ ...pendingEditTower });
      setShowEditTowerModal(true);
      setTowerEditPasswordModal(false);
      setPendingEditTower(null);
      setTowerEditPassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في التحقق');
        console.error(error);
      }
    } finally {
      setTowerEditLoading(false);
    }
  };

  // التحقق من كلمة مرور الحساب قبل إزالة عميل من البرج
  const confirmUnlinkCustomer = async (pwOverride?: string) => {
    if (!pendingUnlinkCustomer || !(pwOverride ?? unlinkPassword).trim()) {
      setToastMessage('أدخل كلمة المرور');
      return;
    }
    setUnlinkLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? unlinkPassword);
      await reauthenticateWithCredential(user, credential);
      await setCustomerTower(pendingUnlinkCustomer, '');
      setPendingUnlinkCustomer(null);
      setUnlinkPassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في التحقق');
        console.error(error);
      }
    } finally {
      setUnlinkLoading(false);
    }
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

  const confirmDeleteTower = async (pwOverride?: string) => {
    if (!towerDeleteConfirm || !(pwOverride ?? towerDeletePassword).trim()) { setToastMessage('أدخل كلمة المرور'); return; }
    setTowerDeleteLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? towerDeletePassword);
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

  // دالة طباعة تقرير البطاقات PDF مع فلاتر
  const printCardsReportPdf = async () => {
    const html2pdf = (await import('html2pdf.js')).default;
    
    let reportCards = reportMonth === 0
      ? cards.filter(c => c.year === reportYear)
      : cards.filter(c => c.month === reportMonth && c.year === reportYear);
    
    if (reportPackage) {
      reportCards = reportCards.filter(c => c.package === reportPackage);
    }
    
    if (reportCards.length === 0) { setToastMessage('لا توجد بطاقات بهذا الفلتر'); return; }
    
    const sortedCards = [...reportCards].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const totalRevenue = reportCards.reduce((sum, c) => sum + c.value, 0);
    const uniquePackages = [...new Set(reportCards.map(c => c.package))];
    const packageStats = uniquePackages.map(pkg => {
      const pkgCards = reportCards.filter(c => c.package === pkg);
      return { name: pkg, count: pkgCards.length, total: pkgCards.reduce((s, c) => s + c.value, 0) };
    }).sort((a, b) => b.total - a.total);

    const periodLabel = reportMonth === 0 ? `سنة ${reportYear}` : `${MONTHS_AR[reportMonth - 1]} ${reportYear}`;
    const monthName = reportMonth === 0 ? `سنة_${reportYear}` : MONTHS_AR[reportMonth - 1];
    const logoUrl = window.location.origin + '/logo.png';
    
    const pdfHTML = `
      <html dir="rtl">
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Cairo', sans-serif; direction: rtl; background: #fff; color: #334155; padding: 20px 28px; }
          
          .report-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 20px; margin-bottom: 18px;
            background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
          }
          .header-right { display: flex; align-items: center; gap: 12px; }
          .report-logo { height: 40px; }
          .header-text {}
          .report-title { font-size: 16px; font-weight: 800; color: #1e293b; line-height: 1.3; }
          .report-subtitle { font-size: 11px; color: #94a3b8; font-weight: 600; }
          .report-period { 
            background: #fff7ed; color: #ea580c; padding: 5px 16px; 
            border-radius: 8px; font-size: 13px; font-weight: 700; 
          }
          
          .summary-row { 
            display: flex; gap: 10px; margin-bottom: 16px; 
          }
          .summary-item {
            flex: 1; text-align: center; padding: 10px 8px;
            border: 1px solid #e2e8f0; border-radius: 8px; background: #fff;
          }
          .summary-value { font-size: 18px; font-weight: 800; color: #1e293b; }
          .summary-value.green { color: #059669; }
          .summary-label { font-size: 10px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
          
          .section-title { font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; }
          
          .pkg-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
          .pkg-chip {
            padding: 6px 14px; background: #f0fdf4; border: 1px solid #bbf7d0;
            border-radius: 6px; font-size: 11px; text-align: center;
          }
          .pkg-chip-name { font-weight: 700; color: #166534; }
          .pkg-chip-info { color: #64748b; font-size: 10px; }
          
          table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
          thead { background: #f1f5f9; }
          th { 
            padding: 8px 10px; font-size: 11px; font-weight: 700; color: #475569; 
            text-align: center; border: 1px solid #e2e8f0; 
          }
          td { 
            padding: 7px 10px; text-align: center; font-size: 12px; 
            border: 1px solid #e2e8f0; color: #334155;
          }
          tbody tr:nth-child(even) { background: #f8fafc; }
          .td-num { color: #94a3b8; font-size: 10px; }
          .td-card { font-family: 'Courier New', monospace; font-weight: 700; font-size: 12px; }
          .td-pkg { color: #ea580c; font-weight: 700; font-size: 11px; }
          .td-value { font-weight: 800; color: #059669; }
          .td-note { color: #94a3b8; font-size: 11px; }
          
          tfoot td { 
            background: #f1f5f9; font-weight: 800; 
            border: 1px solid #e2e8f0; padding: 9px 10px; 
          }
          .total-label { color: #475569; font-size: 12px; }
          .total-value { color: #059669; font-size: 15px; font-weight: 800; }
          
          .report-footer {
            text-align: center; padding: 10px 0; margin-top: 8px;
            border-top: 1px solid #e2e8f0; color: #cbd5e1; font-size: 9px;
          }
        </style>
      </head>
      <body>
        <div class="report-header">
          <div class="header-right">
            <img src="${logoUrl}" class="report-logo" crossorigin="anonymous" />
            <div class="header-text">
              <div class="report-title">تقرير مبيعات البطاقات</div>
              <div class="report-subtitle">Servox Cards Report</div>
            </div>
          </div>
          <div class="report-period">${periodLabel}${reportPackage ? ` — ${reportPackage}` : ''}</div>
        </div>
        
        <div class="summary-row">
          <div class="summary-item">
            <div class="summary-value">${reportCards.length}</div>
            <div class="summary-label">عدد البطاقات</div>
          </div>
          <div class="summary-item">
            <div class="summary-value green">${totalRevenue.toLocaleString()} ﷼</div>
            <div class="summary-label">إجمالي الإيرادات</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${uniquePackages.length}</div>
            <div class="summary-label">عدد الباقات</div>
          </div>
          <div class="summary-item">
            <div class="summary-value green">${reportCards.length > 0 ? Math.round(totalRevenue / reportCards.length).toLocaleString() : 0} ﷼</div>
            <div class="summary-label">متوسط القيمة</div>
          </div>
        </div>

        ${packageStats.length > 0 ? `
        <div class="section-title">إيرادات حسب الباقة</div>
        <div class="pkg-row">
          ${packageStats.map(pkg => `
            <div class="pkg-chip">
              <div class="pkg-chip-name">${pkg.name}</div>
              <div class="pkg-chip-info">${pkg.count} بطاقة — ${pkg.total.toLocaleString()} ﷼</div>
            </div>
          `).join('')}
        </div>
        ` : ''}
        
        <div class="section-title">سجل البطاقات المباعة</div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>رقم البطاقة</th>
                <th>الباقة</th>
                <th>القيمة</th>
                <th>التاريخ</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              ${sortedCards.map((card, idx) => `
                <tr>
                  <td class="td-num">${idx + 1}</td>
                  <td class="td-card">${card.cardNumber}</td>
                  <td><span class="td-pkg">${card.package}</span></td>
                  <td class="td-value">${card.value.toLocaleString()} ﷼</td>
                  <td>${formatDate(card.date)}</td>
                  <td class="td-note">${card.note || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" class="total-label">الإجمالي</td>
                <td class="total-value">${totalRevenue.toLocaleString()} ﷼</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        
        <div class="report-footer">
          Servox — ${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </body>
      </html>
    `;
    
    const options = {
      margin: [8, 4, 8, 4] as [number, number, number, number],
      filename: `تقرير_البطاقات_${monthName}_${reportYear}${reportPackage ? '_' + reportPackage : ''}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
    };
    
    // إزالة الثيم الداكن مؤقتاً أثناء إنشاء PDF
    const savedTheme = document.documentElement.getAttribute('data-theme');
    if (savedTheme === 'dark') document.documentElement.removeAttribute('data-theme');
    html2pdf().set(options).from(pdfHTML).save();
    if (savedTheme === 'dark') setTimeout(() => document.documentElement.setAttribute('data-theme', 'dark'), 500);
    setToastMessage('جاري تحميل التقرير...');
    setShowReportFilters(false);
  };

  // دالة طباعة قاعدة العملاء PDF
  const printCustomersDbPdf = async () => {
    const html2pdf = (await import('html2pdf.js')).default;
    
    let filtered = customersDbCityId 
      ? customers.filter(c => c.cityId === customersDbCityId)
      : customers;
    if (customersDbSearch.trim()) {
      const query = customersDbSearch.trim().toLowerCase();
      filtered = filtered.filter(c => 
        c.name.toLowerCase().includes(query) ||
        (c.phone && c.phone.includes(query)) ||
        (c.userName && c.userName.toLowerCase().includes(query)) ||
        (c.ipNumber && c.ipNumber.includes(query))
      );
    }

    const selectedCityName = customersDbCityId 
      ? cities.find(c => c.id === customersDbCityId)?.name || 'جميع المدن'
      : 'جميع المدن';

    const tableRows = filtered.map((customer, index) => {
      const city = cities.find(c => c.id === customer.cityId);
      const statusText = customer.paymentStatus === 'paid' ? 'مدفوع' : customer.paymentStatus === 'partial' ? 'جزئي' : customer.paymentStatus === 'discounted' ? 'مدفوع بخصم' : 'غير مسدد';
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${customer.name}</td>
          <td>${city?.name || '-'}</td>
          <td>${customer.phone || '-'}</td>
          <td>${customer.userName || '-'}</td>
          <td>${customer.ipNumber || '-'}</td>
          <td>${customer.subscriptionValue || 0} ﷼</td>
          <td>${statusText}</td>
        </tr>
      `;
    }).join('');

    const pdfHTML = `
      <html dir="rtl">
        <head>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
            body { font-family: 'Cairo', sans-serif; padding: 20px; }
            .header { text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #e5e7eb; }
            .logo-container { display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 10px; }
            .company-name { font-size: 26px; font-weight: 700; color: #ea580c; letter-spacing: 1px; }
            .arrows { font-size: 22px; color: #fb923c; font-weight: bold; }
            h1 { text-align: center; color: #1a1a2e; margin-bottom: 5px; margin-top: 0; }
            .subtitle { text-align: center; color: #666; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #ddd; padding: 6px 4px; text-align: center; }
            th { background-color: #1a1a2e; color: white; }
            tr:nth-child(even) { background-color: #f8f9fa; }
            tr { page-break-inside: avoid; break-inside: avoid; }
            thead { display: table-header-group; }
            tbody { display: table-row-group; }
            .footer { text-align: center; margin-top: 20px; color: #888; font-size: 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo-container" style="direction: ltr;">
              <img src="${window.location.origin}/logo.png" style="height: 50px;" crossorigin="anonymous" />
            </div>
            <h1>📋 قاعدة العملاء</h1>
          </div>
          <p class="subtitle">${selectedCityName} - إجمالي: ${filtered.length} عميل</p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>الاسم</th>
                <th>المدينة</th>
                <th>الجوال</th>
                <th>Username</th>
                <th>IP</th>
                <th>الاشتراك</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
          <p class="footer">تم الطباعة بتاريخ: ${new Date().toLocaleDateString('ar-EG')}</p>
        </body>
      </html>
    `;

    const options = {
      margin: 10,
      filename: `قاعدة_العملاء_${selectedCityName}_${new Date().toISOString().split('T')[0]}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'landscape' as const }
    };

    // إزالة الثيم الداكن مؤقتاً أثناء إنشاء PDF
    const savedTheme2 = document.documentElement.getAttribute('data-theme');
    if (savedTheme2 === 'dark') document.documentElement.removeAttribute('data-theme');
    html2pdf().set(options).from(pdfHTML).save();
    if (savedTheme2 === 'dark') setTimeout(() => document.documentElement.setAttribute('data-theme', 'dark'), 500);
  };

  // دالة تأكيد الحذف للمصروفات والإيرادات
  const confirmFinanceDelete = async (pwOverride?: string) => {
    if (!financeDeleteConfirm || !(pwOverride ?? financeDeletePassword).trim()) {
      setToastMessage('أدخل كلمة المرور');
      return;
    }

    setFinanceDeleteLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        setToastMessage('خطأ في المصادقة');
        return;
      }

      // التحقق من كلمة المرور
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? financeDeletePassword);
      await reauthenticateWithCredential(user, credential);

      // تنفيذ الحذف
      if (financeDeleteConfirm.type === 'expense') {
        await executeDeleteExpense(financeDeleteConfirm.item as Expense);
      } else {
        await executeDeleteIncome(financeDeleteConfirm.item as Income);
      }

      setFinanceDeleteConfirm(null);
      setFinanceDeletePassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في التحقق');
        console.error(error);
      }
    } finally {
      setFinanceDeleteLoading(false);
    }
  };

  // Listen for auth state changes (persist login on refresh)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // فحص دعم البصمة على هذا الجهاز
  useEffect(() => {
    isBioSupported().then(setBioAvailable);
  }, []);

  // التمرير لأسفل الشات عند وصول رسائل جديدة أو فتحه
  useEffect(() => {
    if (showChat) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      markChatRead(); // الشات مفتوح ⇒ الرسائل تُعتبر مقروءة
    }
  }, [chatMessages, showChat]);

  // تحميل آخر قراءة للحساب الحالي (مستقل لكل حساب)
  useEffect(() => {
    if (!isAuthenticated) return;
    const saved = Number(localStorage.getItem(chatReadKey(auth.currentUser?.email)) || 0);
    setChatLastRead(saved);
  }, [isAuthenticated]);

  // تنظيف رسائل الشات الأقدم من ٣ أشهر — مرة واحدة بعد تحميل الرسائل
  useEffect(() => {
    if (!isAuthenticated || chatCleanupDone.current || chatMessages.length === 0) return;
    chatCleanupDone.current = true;
    cleanupOldChat(chatMessages);
  }, [isAuthenticated, chatMessages]);

  // Load data from Firestore on mount
  useEffect(() => {
    if (!isAuthenticated) return;

    setLoading(true);

    // مقارن عربي للترتيب الأبجدي (يدعم الأرقام داخل النصوص)
    const arCollator = new Intl.Collator('ar', { sensitivity: 'base', numeric: true });
    const byName = <T extends { name?: string }>(a: T, b: T) => arCollator.compare(a.name || '', b.name || '');

    // Listen to cities collection
    const unsubscribeCities = onSnapshot(collection(db, 'cities'), (snapshot) => {
      const citiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as City));
      citiesData.sort(byName);
      setCities(citiesData);
    });

    // Listen to customers collection
    const unsubscribeCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      const customersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      customersData.sort(byName);
      setCustomers(customersData);
      setLoading(false);
    });

    // Listen to expenses collection
    const unsubscribeExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => {
      const expensesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
      expensesData.sort(byName);
      setExpenses(expensesData);
    });

    // Listen to incomes collection
    const unsubscribeIncomes = onSnapshot(collection(db, 'incomes'), (snapshot) => {
      const incomesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Income));
      incomesData.sort(byName);
      setIncomes(incomesData);
    });

    // Listen to cards collection
    const unsubscribeCards = onSnapshot(collection(db, 'cards'), (snapshot) => {
      const cardsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Card));
      cardsData.sort(byName);
      setCards(cardsData);
    });

    // Listen to towers collection
    const unsubscribeTowers = onSnapshot(collection(db, 'towers'), (snapshot) => {
      const towersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Tower));
      setTowers(towersData);
    });

    // الشات العام
    const unsubscribeChat = onSnapshot(collection(db, 'chat'), (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
      msgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setChatMessages(msgs);
    });

    return () => {
      unsubscribeCities();
      unsubscribeCustomers();
      unsubscribeExpenses();
      unsubscribeIncomes();
      unsubscribeCards();
      unsubscribeTowers();
      unsubscribeChat();
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 2200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Dark mode effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('datahub-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Handle additional router count change
  const handleAdditionalRouterCountChange = (count: number) => {
    setAdditionalRouterCount(count);
    const newRouters: AdditionalRouter[] = [];
    for (let i = 0; i < count; i++) {
      newRouters.push(additionalRouters[i] || { userName: '', ipNumber: '' });
    }
    setAdditionalRouters(newRouters);
  };

  const updateAdditionalRouter = (index: number, field: 'userName' | 'ipNumber', value: string) => {
    const updated = [...additionalRouters];
    updated[index] = { ...updated[index], [field]: value };
    setAdditionalRouters(updated);
  };

  const handleAddCity = async (e: FormEvent) => {
    e.preventDefault();
    const cityName = (e.target as HTMLFormElement).elements.namedItem('cityName') as HTMLInputElement;
    if (!cityName.value.trim()) {
      setToastMessage('أدخل اسم المدينة');
      return;
    }

    const newCity: City = { id: Math.random().toString(36).slice(2), name: cityName.value };
    
    try {
      await setDoc(doc(db, 'cities', newCity.id), { name: newCity.name });
      setToastMessage(`تم إضافة المدينة: ${cityName.value}`);
      cityName.value = '';
    } catch (error) {
      setToastMessage('خطأ في إضافة المدينة');
      console.error(error);
    }
  };

  const handleDeleteCity = (cityId: string) => {
    const city = cities.find(c => c.id === cityId);
    setDeleteConfirm({ type: 'city', id: cityId, name: city?.name || '' });
  };

  const executeDeleteCity = async (cityId: string) => {
    try {
      // Delete city
      await deleteDoc(doc(db, 'cities', cityId));
      
      // Delete all customers in this city
      const cityCustomers = customers.filter(c => c.cityId === cityId);
      for (const customer of cityCustomers) {
        await deleteDoc(doc(db, 'customers', customer.id));
      }
      
      if (selectedCityId === cityId) {
        setSelectedCityId(null);
      }
      
      setToastMessage('تم حذف المدينة');
    } catch (error) {
      setToastMessage('خطأ في حذف المدينة');
      console.error(error);
    }
  };

  const handleAddCustomer = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCityId) {
      setToastMessage('اختر مدينة أولاً');
      return;
    }

    if (!customerName.trim()) {
      setToastMessage('أدخل اسم العميل');
      return;
    }

    // التحقق من عدم تكرار userName في نفس المدينة
    if (userName) {
      const existingUserName = customers.find(
        c => c.cityId === selectedCityId && c.userName === userName
      );
      if (existingUserName) {
        setToastMessage(`User Name "${userName}" موجود مسبقاً في هذه المدينة للعميل: ${existingUserName.name}`);
        return;
      }
    }

    // التحقق من عدم تكرار ipNumber في نفس المدينة
    if (ipNumber) {
      const existingIpNumber = customers.find(
        c => c.cityId === selectedCityId && c.ipNumber === ipNumber
      );
      if (existingIpNumber) {
        setToastMessage(`IP Number "${ipNumber}" موجود مسبقاً في هذه المدينة للعميل: ${existingIpNumber.name}`);
        return;
      }
    }

    const customerId = Math.random().toString(36).slice(2);
    
    // Build customer data without undefined values (Firestore doesn't accept undefined)
    const customerData: Record<string, unknown> = {
      cityId: selectedCityId,
      name: customerName,
      paymentStatus: 'unpaid',
    };
    
    if (customerPhone) customerData.phone = customerPhone;
    if (startDate) customerData.startDate = startDate;
    if (subscriptionValue) customerData.subscriptionValue = parseFloat(subscriptionValue);
    if (setupFeeTotal) customerData.setupFeeTotal = parseFloat(setupFeeTotal);
    if (setupFeePaid) customerData.setupFeePaid = parseFloat(setupFeePaid);
    if (ipNumber) customerData.ipNumber = ipNumber;
    if (userName) customerData.userName = userName;
    if (additionalRouters.length > 0) customerData.additionalRouters = additionalRouters;
    if (lap) customerData.lap = lap;
    if (site) customerData.site = site;
    if (notes) customerData.notes = notes;
    if (customerTowerId) customerData.towerId = customerTowerId;

    try {
      await setDoc(doc(db, 'customers', customerId), customerData);
      setToastMessage(`تم إضافة العميل: ${customerName}`);
      
      setCustomerName('');
      setCustomerPhone('');
      setStartDate('');
      setSubscriptionValue('');
      setSetupFeeTotal('');
      setSetupFeePaid('');
      setIpNumber('');
      setUserName('');
      setAdditionalRouterCount(0);
      setAdditionalRouters([]);
      setLap('');
      setSite('');
      setNotes('');
      setCustomerTowerId('');
    } catch (error) {
      setToastMessage('خطأ في إضافة العميل');
      console.error(error);
    }
  };

  const handleDeleteCustomer = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    setDeleteConfirm({ type: 'customer', id: customerId, name: customer?.name || '' });
  };

  const executeDeleteCustomer = async (customerId: string) => {
    try {
      await deleteDoc(doc(db, 'customers', customerId));
      setToastMessage('تم حذف العميل');
    } catch (error) {
      setToastMessage('خطأ في حذف العميل');
      console.error(error);
    }
  };

  const confirmDelete = async (pwOverride?: string) => {
    if (!deleteConfirm || !(pwOverride ?? deletePassword).trim()) {
      setToastMessage('أدخل كلمة المرور');
      return;
    }

    setDeleteLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        setToastMessage('خطأ في المصادقة');
        return;
      }

      // التحقق من كلمة المرور
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? deletePassword);
      await reauthenticateWithCredential(user, credential);

      // تنفيذ الحذف
      if (deleteConfirm.type === 'city') {
        await executeDeleteCity(deleteConfirm.id);
      } else {
        await executeDeleteCustomer(deleteConfirm.id);
      }

      setDeleteConfirm(null);
      setDeletePassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في التحقق');
        console.error(error);
      }
    } finally {
      setDeleteLoading(false);
    }
  };

  // دالة تبديل حالة الإعفاء
  const toggleExemptStatus = async (customer: Customer) => {
    try {
      const newExemptStatus = !customer.isExempt;
      await setDoc(doc(db, 'customers', customer.id), { isExempt: newExemptStatus }, { merge: true });
      setToastMessage(newExemptStatus ? `تم إعفاء العميل: ${customer.name}` : `تم إلغاء إعفاء العميل: ${customer.name}`);
    } catch (error) {
      setToastMessage('خطأ في تحديث حالة الإعفاء');
      console.error(error);
    }
  };

  const handleTogglePaymentStatus = (customer: Customer, newStatus: 'paid' | 'unpaid' | 'partial' | 'discounted') => {
    if (newStatus === 'paid') {
      // فتح نافذة الدفع الموحدة مع تحديد الشهر والمبلغ
      const now = new Date();
      const curMonth = now.getMonth() + 1;
      const curYear = now.getFullYear();
      setPaymentMonth(curMonth);
      setPaymentYear(curYear);
      // تعبئة آخر مبلغ مدخل للشهر الحالي إن وجد
      const curYearMonth = `${curYear}-${String(curMonth).padStart(2, '0')}`;
      const lastAmount = customer.monthlyPartialAmounts?.[curYearMonth];
      if (lastAmount) {
        setPartialPaymentAmount(String(lastAmount));
      } else {
        setPartialPaymentAmount(String(customer.subscriptionValue || ''));
      }
      setPaymentTypeChoice('partial'); // reset choice
      setConfirmStatusChange({ customer, newStatus: 'paid' });
    } else if (newStatus === 'partial') {
      setConfirmStatusChange({ customer, newStatus });
      setPartialPaymentAmount(String(customer.subscriptionPaid || ''));
      setPaymentTypeChoice('partial');
    } else {
      setConfirmStatusChange({ customer, newStatus });
      setPartialPaymentAmount('');
    }
  };

  const confirmPaymentStatusChange = async () => {
    if (!confirmStatusChange) return;
    
    try {
      // استخدم الشهر المحدد من النافذة أو من yearMonth
      let yearMonth = confirmStatusChange.yearMonth;
      if (!yearMonth) {
        yearMonth = `${paymentYear}-${String(paymentMonth).padStart(2, '0')}`;
      }
      
      // تحديد الحالة تلقائياً بناءً على المبلغ المدفوع
      const paidAmount = parseFloat(partialPaymentAmount) || 0;
      const subscriptionValue = confirmStatusChange.customer.subscriptionValue || 0;
      let finalStatus: 'paid' | 'unpaid' | 'partial' | 'discounted' = confirmStatusChange.newStatus;
      
      // إذا كان الطلب هو دفع (من زر مدفوع) نحدد الحالة تلقائياً
      if (confirmStatusChange.newStatus === 'paid' || confirmStatusChange.newStatus === 'partial' || confirmStatusChange.newStatus === 'discounted') {
        if (paidAmount <= 0) {
          finalStatus = 'unpaid';
        } else if (paidAmount < subscriptionValue) {
          // استخدم اختيار المستخدم (جزئي أو خصم)
          finalStatus = paymentTypeChoice;
        } else {
          finalStatus = 'paid';
        }
      }
      
      const updatedPayments = { ...(confirmStatusChange.customer.monthlyPayments || {}) };
      // Convert unpaid to pending for monthlyPayments
      const monthlyStatus = finalStatus === 'unpaid' ? 'pending' : finalStatus;
      updatedPayments[yearMonth] = monthlyStatus as 'paid' | 'partial' | 'pending' | 'discounted';
      
      // تحديد paymentStatus بناءً على الشهر الحالي
      const today = new Date();
      const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      const isCurrentMonth = yearMonth === currentYearMonth;
      
      const updatedCustomer: Customer = {
        ...confirmStatusChange.customer,
        monthlyPayments: updatedPayments as Record<string, 'paid' | 'partial' | 'pending' | 'discounted'>,
      };
      
      // تحديث paymentStatus فقط إذا كان الشهر الحالي
      if (isCurrentMonth) {
        updatedCustomer.paymentStatus = finalStatus;
      }
      
      // حفظ المبلغ الجزئي لكل شهر
      const updatedPartialAmounts = { ...(confirmStatusChange.customer.monthlyPartialAmounts || {}) };
      if ((finalStatus === 'partial' || finalStatus === 'discounted') && paidAmount > 0) {
        updatedCustomer.subscriptionPaid = paidAmount;
        updatedPartialAmounts[yearMonth] = paidAmount;
      } else if (finalStatus === 'paid') {
        updatedCustomer.subscriptionPaid = subscriptionValue;
        updatedPartialAmounts[yearMonth] = subscriptionValue;
      } else {
        delete updatedPartialAmounts[yearMonth];
      }
      updatedCustomer.monthlyPartialAmounts = updatedPartialAmounts;
      
      // التحقق من الحالة السابقة للشهر
      const previousMonthStatus = confirmStatusChange.customer.monthlyPayments?.[yearMonth];
      
      // إذا اختار خصم، نسجل الخصم تلقائياً
      if (finalStatus === 'discounted') {
        const discountAmount = subscriptionValue - paidAmount;
        updatedCustomer.hasDiscount = true;
        updatedCustomer.discountAmount = discountAmount;
      } else if (previousMonthStatus === 'discounted' && finalStatus !== 'discounted') {
        // إذا كانت الحالة السابقة خصم والحالة الجديدة مختلفة، نحذف الخصم
        updatedCustomer.hasDiscount = false;
        updatedCustomer.discountAmount = 0;
      }
      
      await setDoc(doc(db, 'customers', confirmStatusChange.customer.id), updatedCustomer);
      
      // تحديث الحالة المحلية
      if (selectedCustomer?.id === confirmStatusChange.customer.id) {
        setSelectedCustomer(updatedCustomer);
      }
      setCustomers(customers.map(c => c.id === confirmStatusChange.customer.id ? updatedCustomer : c));
      
      const statusMap: Record<string, string> = { paid: 'مدفوع', unpaid: 'غير مسدد', partial: 'جزئي', discounted: 'مدفوع بخصم' };
      setToastMessage(`تم تغيير حالة ${confirmStatusChange.customer.name} إلى ${statusMap[finalStatus]}`);
      setConfirmStatusChange(null);
      setPartialPaymentAmount('');
      setPaymentTypeChoice('partial');
    } catch (error) {
      setToastMessage('خطأ في تغيير الحالة');
      console.error(error);
    }
  };

  const openCustomerDetails = (customer: Customer) => {
    setSelectedCustomer(customer);
    setShowCustomerModal(true);
  };

  const openEditCustomer = (customer: Customer) => {
    setPendingEditCustomer(customer);
    setEditPasswordModal(true);
    setEditPassword('');
  };

  const openTransferCustomer = (customer: Customer) => {
    setTransferCustomer(customer);
    setTransferCityId('');
    setTransferPassword('');
    setTransferModal(true);
  };

  const confirmTransferCustomer = async (pwOverride?: string) => {
    if (!transferCustomer || !transferCityId || !(pwOverride ?? transferPassword).trim()) {
      setToastMessage('يرجى اختيار المدينة وإدخال كلمة المرور');
      return;
    }

    if (transferCityId === transferCustomer.cityId) {
      setToastMessage('العميل موجود بالفعل في هذه المدينة');
      return;
    }

    setTransferLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        setToastMessage('خطأ في المصادقة');
        return;
      }

      // التحقق من كلمة المرور
      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? transferPassword);
      await reauthenticateWithCredential(user, credential);

      // نقل العميل للمدينة الجديدة
      await setDoc(doc(db, 'customers', transferCustomer.id), {
        ...transferCustomer,
        cityId: transferCityId,
      });

      const newCity = cities.find(c => c.id === transferCityId);
      setToastMessage(`تم نقل ${transferCustomer.name} إلى ${newCity?.name}`);
      setTransferModal(false);
      setTransferCustomer(null);
      setTransferCityId('');
      setTransferPassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في نقل العميل');
        console.error(error);
      }
    } finally {
      setTransferLoading(false);
    }
  };

  const confirmEditPassword = async (pwOverride?: string) => {
    if (!pendingEditCustomer || !(pwOverride ?? editPassword).trim()) {
      setToastMessage('أدخل كلمة المرور');
      return;
    }

    setEditLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        setToastMessage('خطأ في المصادقة');
        return;
      }

      const credential = EmailAuthProvider.credential(user.email, pwOverride ?? editPassword);
      await reauthenticateWithCredential(user, credential);

      // فتح نافذة التعديل
      setEditingCustomer({ ...pendingEditCustomer, additionalRouters: pendingEditCustomer.additionalRouters ? [...pendingEditCustomer.additionalRouters] : [] });
      setShowEditModal(true);
      setEditPasswordModal(false);
      setPendingEditCustomer(null);
      setEditPassword('');
    } catch (error: any) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setToastMessage('كلمة المرور غير صحيحة');
      } else {
        setToastMessage('خطأ في التحقق');
        console.error(error);
      }
    } finally {
      setEditLoading(false);
    }
  };

  const handleEditCustomer = (field: keyof Customer, value: string | number) => {
    if (!editingCustomer) return;
    setEditingCustomer({ ...editingCustomer, [field]: value });
  };

  const handleEditAdditionalRouterCount = (count: number) => {
    if (!editingCustomer) return;
    const newRouters: AdditionalRouter[] = [];
    for (let i = 0; i < count; i++) {
      newRouters.push(editingCustomer.additionalRouters?.[i] || { userName: '', ipNumber: '' });
    }
    setEditingCustomer({ ...editingCustomer, additionalRouters: newRouters });
  };

  const updateEditAdditionalRouter = (index: number, field: 'userName' | 'ipNumber', value: string) => {
    if (!editingCustomer || !editingCustomer.additionalRouters) return;
    const updated = [...editingCustomer.additionalRouters];
    updated[index] = { ...updated[index], [field]: value };
    setEditingCustomer({ ...editingCustomer, additionalRouters: updated });
  };

  const saveEditedCustomer = async () => {
    if (!editingCustomer) return;
    
    // التحقق من عدم تكرار userName في نفس المدينة
    if (editingCustomer.userName) {
      const existingUserName = customers.find(
        c => c.cityId === editingCustomer.cityId && c.userName === editingCustomer.userName && c.id !== editingCustomer.id
      );
      if (existingUserName) {
        setToastMessage(`User Name "${editingCustomer.userName}" موجود مسبقاً في هذه المدينة للعميل: ${existingUserName.name}`);
        return;
      }
    }

    // التحقق من عدم تكرار ipNumber في نفس المدينة
    if (editingCustomer.ipNumber) {
      const existingIpNumber = customers.find(
        c => c.cityId === editingCustomer.cityId && c.ipNumber === editingCustomer.ipNumber && c.id !== editingCustomer.id
      );
      if (existingIpNumber) {
        setToastMessage(`IP Number "${editingCustomer.ipNumber}" موجود مسبقاً في هذه المدينة للعميل: ${existingIpNumber.name}`);
        return;
      }
    }

    try {
      const { id, ...customerData } = editingCustomer;
      // Remove undefined values for Firestore
      const cleanData: Record<string, unknown> = {};
      Object.entries(customerData).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          cleanData[key] = val;
        }
      });
      await setDoc(doc(db, 'customers', id), cleanData);
      
      setToastMessage(`تم تحديث بيانات ${editingCustomer.name}`);
      setShowEditModal(false);
      setEditingCustomer(null);
    } catch (error) {
      setToastMessage('خطأ في تحديث البيانات');
      console.error(error);
    }
  };

  // ربط عميل ببرج أو فك ربطه (towerId فارغ = فك الربط) — يعيد حفظ مستند العميل كاملاً
  const setCustomerTower = async (customer: Customer, towerId: string) => {
    try {
      const { id, ...rest } = customer;
      const cleanData: Record<string, unknown> = {};
      Object.entries(rest).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') cleanData[key] = val;
      });
      if (towerId) cleanData.towerId = towerId;
      else delete cleanData.towerId;
      await setDoc(doc(db, 'customers', id), cleanData);
      setToastMessage(towerId ? `تم ربط ${customer.name} بالبرج` : `تم فك ربط ${customer.name}`);
    } catch (error) {
      setToastMessage('خطأ في تحديث العميل');
      console.error(error);
    }
  };

  // فاتورة التأسيس - تظهر رسوم التأسيس والمدفوع والمتبقي
  const generateSetupInvoicePDF = async (customer: Customer, month?: number, year?: number) => {
    const html2pdf = (await import('html2pdf.js')).default;
    const city = cities.find((c) => c.id === customer.cityId);
    const setupRemaining = (customer.setupFeeTotal ?? 0) - (customer.setupFeePaid ?? 0);
    
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    let isPreviousMonth = false;
    let monthName = '';
    let invoiceDate = todayISO();
    
    if (month && year) {
      isPreviousMonth = (year !== currentYear || month !== currentMonth);
      monthName = MONTHS_AR[month - 1] + ' ' + year;
      invoiceDate = `${year}-${String(month).padStart(2, '0')}-01`;
    }

    const invoiceHTML = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', Arial, sans-serif; }
          body { color: #1a1a1a; line-height: 1.6; direction: rtl; font-size: 14px; padding: 20px; }
          .header { border-bottom: 3px solid #ea580c; padding-bottom: 15px; margin-bottom: 20px; }
          .header table { width: 100%; }
          .company { font-size: 28px; font-weight: 700; color: #ea580c; }
          .invoice-type { font-size: 16px; color: #f59e0b; font-weight: 600; }
          .invoice-info { font-size: 12px; text-align: left; }
          .section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
          .section-title { font-size: 14px; font-weight: 700; color: white; background: #ea580c; padding: 10px 15px; }
          .data-table { width: 100%; border-collapse: collapse; }
          .data-table td { padding: 12px 15px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
          .data-table tr:last-child td { border-bottom: none; }
          .data-table .label { color: #64748b; width: 40%; }
          .data-table .value { font-weight: 600; color: #1e293b; }
          .financial-table { width: 100%; border-collapse: collapse; }
          .financial-table th { background: #ea580c; color: white; padding: 12px 15px; text-align: right; font-size: 13px; }
          .financial-table td { padding: 12px 15px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
          .financial-table .highlight { background: #fef3c7; font-weight: 700; }
          .footer { text-align: center; padding-top: 20px; margin-top: 30px; border-top: 2px solid #e2e8f0; font-size: 11px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="header">
          <table>
            <tr>
              <td style="vertical-align: middle;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${window.location.origin}/logo.png" style="height: 40px;" crossorigin="anonymous" />
                  <div>
                    <div class="company">SERVOX</div>
                    <div class="invoice-type">${isPreviousMonth ? `فاتورة تأسيس سابقة لشهر: ${monthName}` : 'فاتورة تأسيس'}</div>
                  </div>
                </div>
              </td>
              <td class="invoice-info" style="vertical-align: top;">
                <div><strong>رقم الفاتورة:</strong> SET-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}</div>
                <div><strong>التاريخ:</strong> ${formatDate(invoiceDate)}</div>
              </td>
            </tr>
          </table>
        </div>
        
        <div class="section">
          <div class="section-title">معلومات العميل</div>
          <table class="data-table">
            <tr><td class="label">اسم العميل:</td><td class="value">${customer.name}</td></tr>
            <tr><td class="label">رقم الجوال:</td><td class="value">${customer.phone || '-'}</td></tr>
            <tr><td class="label">المدينة:</td><td class="value">${city?.name || '-'}</td></tr>
          </table>
        </div>
        
        <div class="section">
          <div class="section-title">تفاصيل التأسيس</div>
          <table class="financial-table">
            <thead>
              <tr><th>البيان</th><th>المبلغ (﷼)</th></tr>
            </thead>
            <tbody>
              <tr><td>إجمالي رسوم التأسيس</td><td>${customer.setupFeeTotal ?? 0}</td></tr>
              <tr><td>المبلغ المدفوع</td><td>${customer.setupFeePaid ?? 0}</td></tr>
              <tr class="highlight"><td><strong>المتبقي</strong></td><td><strong>${setupRemaining}</strong></td></tr>
            </tbody>
          </table>
        </div>
        
        ${customer.notes ? `
        <div class="section">
          <div class="section-title">ملاحظات</div>
          <div style="padding: 15px; font-size: 13px; color: #374151;">${customer.notes}</div>
        </div>
        ` : ''}
        
        <div class="footer">
          <p>شكراً لتعاملكم معنا | © 2025 SERVOX</p>
        </div>
      </body>
      </html>
    `;

    const options = {
      margin: 10,
      filename: `فاتورة_تأسيس_${customer.name}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait' as const, unit: 'mm' as const, format: 'a4' as const }
    };
    // إزالة الثيم الداكن مؤقتاً أثناء إنشاء PDF
    const savedThemeSetup = document.documentElement.getAttribute('data-theme');
    if (savedThemeSetup === 'dark') document.documentElement.removeAttribute('data-theme');
    html2pdf().set(options).from(invoiceHTML).save();
    if (savedThemeSetup === 'dark') setTimeout(() => document.documentElement.setAttribute('data-theme', 'dark'), 500);
    setToastMessage(`تم إصدار فاتورة التأسيس لـ ${customer.name}`);
  };

  // فاتورة الاشتراك - تظهر قيمة الاشتراك وحالة الدفع
  const generateSubscriptionInvoicePDF = async (customer: Customer, month?: number, year?: number) => {
    const html2pdf = (await import('html2pdf.js')).default;
    const city = cities.find((c) => c.id === customer.cityId);
    
    // إذا تم تحديد شهر وسنة، استخدم حالة الدفع من monthlyPayments
    let paymentStatus: 'paid' | 'partial' | 'pending' | 'discounted' = 'pending';
    let invoiceDate = todayISO();
    let monthName = '';
    let isPreviousMonth = false;
    
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    if (month && year) {
      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      paymentStatus = (customer.monthlyPayments?.[yearMonth] || 'pending') as typeof paymentStatus;
      invoiceDate = `${year}-${String(month).padStart(2, '0')}-01`;
      monthName = MONTHS_AR[month - 1] + ' ' + year;
      // تحقق إذا كان الشهر/السنة مختلفة عن الحالية
      isPreviousMonth = (year !== currentYear || month !== currentMonth);
    } else {
      paymentStatus = customer.paymentStatus === 'paid' ? 'paid' : customer.paymentStatus === 'partial' ? 'partial' : customer.paymentStatus === 'discounted' ? 'discounted' : 'pending';
    }
    
    const isPaid = paymentStatus === 'paid';
    const isPartial = paymentStatus === 'partial';

    const invoiceHTML = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', Arial, sans-serif; }
          body { color: #1a1a1a; line-height: 1.6; direction: rtl; font-size: 14px; padding: 20px; }
          .header { border-bottom: 3px solid #ea580c; padding-bottom: 15px; margin-bottom: 20px; }
          .header table { width: 100%; }
          .company { font-size: 28px; font-weight: 700; color: #ea580c; }
          .invoice-type { font-size: 16px; color: #06b6d4; font-weight: 600; }
          .invoice-info { font-size: 12px; text-align: left; }
          .section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
          .section-title { font-size: 14px; font-weight: 700; color: white; background: #ea580c; padding: 10px 15px; }
          .data-table { width: 100%; border-collapse: collapse; }
          .data-table td { padding: 12px 15px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
          .data-table tr:last-child td { border-bottom: none; }
          .data-table .label { color: #64748b; width: 40%; }
          .data-table .value { font-weight: 600; color: #1e293b; }
          .subscription-box { background: #e0f2fe; border: 2px solid #0ea5e9; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }
          .subscription-label { font-size: 14px; color: #64748b; margin-bottom: 10px; }
          .subscription-value { font-size: 32px; font-weight: 700; color: #ea580c; }
          .status-box { border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }
          .status-paid { background: #dcfce7; border: 2px solid #22c55e; }
          .status-unpaid { background: #fee2e2; border: 2px solid #ef4444; }
          .status-partial { background: #fef3c7; border: 2px solid #f59e0b; }
          .status-label { font-size: 14px; color: #64748b; margin-bottom: 10px; }
          .status-value { font-size: 24px; font-weight: 700; }
          .status-paid .status-value { color: #16a34a; }
          .status-unpaid .status-value { color: #dc2626; }
          .status-partial .status-value { color: #d97706; }
          .footer { text-align: center; padding-top: 20px; margin-top: 30px; border-top: 2px solid #e2e8f0; font-size: 11px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="header">
          <table>
            <tr>
              <td style="vertical-align: middle;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${window.location.origin}/logo.png" style="height: 40px;" crossorigin="anonymous" />
                  <div>
                    <div class="company">SERVOX</div>
                    <div class="invoice-type">${isPreviousMonth ? `فاتورة سابقة لشهر: ${monthName}` : 'فاتورة اشتراك شهري'}</div>
                  </div>
                </div>
              </td>
              <td class="invoice-info" style="vertical-align: top;">
                <div><strong>رقم الفاتورة:</strong> SUB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}</div>
                <div><strong>التاريخ:</strong> ${formatDate(invoiceDate)}</div>
              </td>
            </tr>
          </table>
        </div>
        
        <div class="section">
          <div class="section-title">بيانات العميل</div>
          <table class="data-table">
            <tr><td class="label">اسم العميل</td><td class="value">${customer.name}</td></tr>
            <tr><td class="label">رقم الجوال</td><td class="value">${customer.phone || '-'}</td></tr>
            <tr><td class="label">المدينة</td><td class="value">${city?.name || '-'}</td></tr>
            <tr><td class="label">الموقع</td><td class="value">${customer.site || '-'}</td></tr>
            <tr><td class="label">تاريخ بدء الاشتراك</td><td class="value">${customer.startDate ? formatDate(customer.startDate) : '-'}</td></tr>
          </table>
        </div>
        
        <div class="subscription-box">
          <div class="subscription-label">قيمة الاشتراك الشهري</div>
          <div class="subscription-value">${customer.subscriptionValue ?? 0} ﷼</div>
        </div>
        
        <div class="status-box ${isPaid ? 'status-paid' : isPartial ? 'status-partial' : 'status-unpaid'}">
          <div class="status-label">حالة السداد</div>
          <div class="status-value">${isPaid ? '✓ مدفوع' : isPartial ? `◐ جزئي (${customer.subscriptionPaid || 0} ﷼) - المتبقي: ${(customer.subscriptionValue || 0) - (customer.subscriptionPaid || 0)} ﷼` : '✗ غير مسدد'}</div>
        </div>
        
        ${customer.notes ? `
        <div class="section">
          <div class="section-title">ملاحظات</div>
          <div style="padding: 15px; font-size: 13px; color: #374151;">${customer.notes}</div>
        </div>
        ` : ''}
        
        <div class="footer">
          <p>شكراً لتعاملكم معنا | © 2025 SERVOX</p>
        </div>
      </body>
      </html>
    `;

    const options = {
      margin: 10,
      filename: `فاتورة_اشتراك_${customer.name}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait' as const, unit: 'mm' as const, format: 'a4' as const }
    };
    // إزالة الثيم الداكن مؤقتاً أثناء إنشاء PDF
    const savedThemeSub = document.documentElement.getAttribute('data-theme');
    if (savedThemeSub === 'dark') document.documentElement.removeAttribute('data-theme');
    html2pdf().set(options).from(invoiceHTML).save();
    if (savedThemeSub === 'dark') setTimeout(() => document.documentElement.setAttribute('data-theme', 'dark'), 500);
    setToastMessage(`تم إصدار فاتورة الاشتراك لـ ${customer.name}`);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setToastMessage('أدخل البريد الإلكتروني وكلمة المرور');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, username, password);
      setUsername('');
      setPassword('');
      setToastMessage('تم التحقق بنجاح');
    } catch (error: any) {
      const errorMessage = 
        error.code === 'auth/user-not-found' ? 'المستخدم غير موجود' :
        error.code === 'auth/wrong-password' ? 'كلمة المرور غير صحيحة' :
        error.code === 'auth/invalid-email' ? 'البريد الإلكتروني غير صحيح' :
        error.code === 'auth/user-disabled' ? 'المستخدم معطّل' :
        'فشل الدخول - حاول مرة أخرى';
      setToastMessage(errorMessage);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setToastMessage('تم تسجيل الخروج بنجاح');
    } catch (error) {
      setToastMessage('خطأ في تسجيل الخروج');
    }
  };

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
    } finally {
      setBioBusy(false);
    }
  };

  // زر «تأكيد بالبصمة» — يُعرض داخل كل نافذة تطلب كلمة مرور الحساب
  const bioConfirmBtn = (run: (pw: string) => void) => (
    bioAvailable && bioEnabled ? (
      <button
        type="button"
        className="btn bio-confirm-btn"
        disabled={bioBusy}
        title="تأكيد ببصمة الوجه بدل كتابة كلمة المرور"
        onClick={async () => { const pw = await getBioPassword(); if (pw) run(pw); }}
      >
        {bioBusy ? '...' : '👆 بالبصمة'}
      </button>
    ) : null
  );

  // إرسال رسالة نصية في الشات العام
  const sendChatMessage = async () => {
    const user = auth.currentUser;
    if (!user || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      await setDoc(doc(db, 'chat', id), {
        senderEmail: user.email || '',
        senderName: user.displayName || '',
        text,
        createdAt: Date.now(),
      });
    } catch (e) {
      setToastMessage('تعذّر إرسال الرسالة');
      console.error(e);
    }
  };

  // إرسال صورة أو فيديو أو أي ملف في الشات (يُرفع إلى Firebase Storage)
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
    setChatUploading(true);
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const path = `chat/${id}_${file.name.replace(/[^\w.\-]/g, '_')}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      await setDoc(doc(db, 'chat', id), {
        senderEmail: user.email || '',
        senderName: user.displayName || '',
        mediaUrl: url,
        mediaPath: path,
        mediaType: kind,
        fileName: file.name,
        fileSize: file.size,
        createdAt: Date.now(),
      });
    } catch (e) {
      setToastMessage('تعذّر رفع الملف — تأكد من تفعيل Firebase Storage');
      console.error(e);
    } finally {
      setChatUploading(false);
    }
  };

  // حذف رسالة أرسلها المستخدم نفسه (مع ملف الوسائط إن وُجد)
  const deleteChatMessage = async (m: ChatMessage) => {
    try {
      if (m.mediaUrl || m.mediaPath) {
        try {
          await deleteObject(storageRef(storage, m.mediaPath || m.mediaUrl!));
        } catch (err) {
          console.warn('تعذّر حذف ملف الوسائط (قد يكون محذوفاً مسبقاً)', err);
        }
      }
      await deleteDoc(doc(db, 'chat', m.id));
      setChatDeleteConfirm(null);
      setToastMessage('تم حذف الرسالة');
    } catch (e) {
      setToastMessage('تعذّر حذف الرسالة');
      console.error(e);
    }
  };

  // تثبيت/إلغاء تثبيت رسالة — المثبّتة محميّة من الحذف التلقائي
  const toggleChatPin = async (m: ChatMessage) => {
    try {
      const { id, ...rest } = m;
      const data: Record<string, unknown> = {};
      Object.entries(rest).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') data[k] = v;
      });
      if (m.pinned) delete data.pinned;
      else data.pinned = true;
      await setDoc(doc(db, 'chat', id), data);
      setToastMessage(m.pinned ? 'أُلغي التثبيت — ستُحذف تلقائياً بعد ٣ أشهر' : '📌 تم التثبيت — لن تُحذف تلقائياً');
    } catch (e) {
      setToastMessage('تعذّر تغيير التثبيت');
      console.error(e);
    }
  };

  // حذف رسائل الشات الأقدم من ٣ أشهر (عدا المثبّتة) مع ملفات الوسائط
  const cleanupOldChat = async (messages: ChatMessage[]) => {
    const cutoff = Date.now() - CHAT_RETENTION_MS;
    const expired = messages.filter(m => !m.pinned && m.createdAt < cutoff);
    if (expired.length === 0) return;
    let removed = 0;
    for (const m of expired) {
      try {
        // احذف ملف الوسائط أولاً حتى لا تتراكم المساحة
        if (m.mediaUrl || m.mediaPath) {
          try {
            await deleteObject(storageRef(storage, m.mediaPath || m.mediaUrl!));
          } catch (err) {
            console.warn('تعذّر حذف ملف الوسائط (قد يكون محذوفاً مسبقاً)', err);
          }
        }
        await deleteDoc(doc(db, 'chat', m.id));
        removed++;
      } catch (e) {
        console.error('تعذّر حذف رسالة قديمة', e);
      }
    }
    if (removed > 0) setToastMessage(`🧹 حُذفت ${removed} رسالة أقدم من ٣ أشهر`);
  };

  // فتح صفحة البروفايل (تهيئة الحقول من الحساب الحالي)
  const openProfile = () => {
    setProfileName(auth.currentUser?.displayName || '');
    setProfileNewEmail('');
    setProfileEmailPassword('');
    setProfileCurrentPassword('');
    setProfileNewPassword('');
    setProfileConfirmPassword('');
    setRevealedCurrentPassword(null);
    setShowProfileEmailPw(false);
    setShowProfileCurPw(false);
    setShowProfileNewPw(false);
    setShowProfileConfPw(false);
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

  // حفظ اسم الحساب (displayName)
  const saveProfileName = async () => {
    const user = auth.currentUser;
    if (!user) { setToastMessage('خطأ في المصادقة'); return; }
    if (!profileName.trim()) { setToastMessage('أدخل الاسم'); return; }
    setProfileNameBusy(true);
    try {
      await updateProfile(user, { displayName: profileName.trim() });
      setToastMessage('تم تحديث الاسم');
    } catch (e) {
      setToastMessage('تعذّر تحديث الاسم');
      console.error(e);
    } finally {
      setProfileNameBusy(false);
    }
  };

  // تغيير البريد الإلكتروني (يرسل رابط تأكيد للبريد الجديد ثم يُحدَّث بعد الضغط عليه)
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
      setProfileNewEmail('');
      setProfileEmailPassword('');
    } catch (e: any) {
      if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') setToastMessage('كلمة المرور غير صحيحة');
      else if (e?.code === 'auth/invalid-email') setToastMessage('البريد الجديد غير صحيح');
      else if (e?.code === 'auth/email-already-in-use') setToastMessage('البريد مستخدم بالفعل');
      else setToastMessage('تعذّر تغيير البريد');
      console.error(e);
    } finally {
      setProfileEmailBusy(false);
    }
  };

  // تغيير كلمة المرور (يُلغي البصمة المحفوظة لأنها تعتمد على كلمة المرور القديمة)
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
      // كلمة المرور المخزّنة للبصمة أصبحت قديمة
      if (getBioStore()) { clearBioStore(); setBioEnabled(false); }
      setProfileCurrentPassword('');
      setProfileNewPassword('');
      setProfileConfirmPassword('');
      setToastMessage('تم تغيير كلمة المرور' + (bioEnabled ? ' — أعد تفعيل البصمة' : ''));
    } catch (e: any) {
      if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') setToastMessage('كلمة المرور الحالية غير صحيحة');
      else if (e?.code === 'auth/weak-password') setToastMessage('كلمة المرور الجديدة ضعيفة');
      else setToastMessage('تعذّر تغيير كلمة المرور');
      console.error(e);
    } finally {
      setProfilePasswordBusy(false);
    }
  };

  // Show loading while checking auth state
  if (authLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-brand">
            <img src="/logo.png" alt="SERVOX" style={{ height: '60px' }} />
          </div>
          <p style={{ textAlign: 'center', color: 'var(--text-light)' }}>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-brand">
            <img src="/logo.png" alt="SERVOX" style={{ height: '80px' }} />
          </div>
          <form onSubmit={handleLogin}>
            <input type="email" placeholder="البريد الإلكتروني" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <input type="password" placeholder="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="submit" className="login-btn">
              <span className="login-btn-text">دخول</span>
              <span className="login-btn-icon">→</span>
            </button>
          </form>
          {bioAvailable && bioEnabled && (
            <button type="button" className="bio-login-btn" onClick={handleBioLogin} disabled={bioBusy}>
              <span className="bio-login-icon">👤</span>
              <span>{bioBusy ? 'جارٍ التحقق...' : 'دخول بالبصمة / Face ID'}</span>
            </button>
          )}
        </div>
        {toastMessage && <div className="toast">{toastMessage}</div>}
      </div>
    );
  }

  return (
    <div className="container">
      <header className="app-header">
        <div className="brand">
          <img src="/logo.png" alt="SERVOX" style={{ height: '70px' }} />
        </div>
        <button 
          className={`theme-toggle ${darkMode ? 'dark' : ''}`}
          onClick={() => setDarkMode(!darkMode)}
          title={darkMode ? 'وضع النهار' : 'وضع الليل'}
        >
          <div className="theme-toggle-thumb">
            {darkMode ? '🌙' : '☀️'}
          </div>
        </button>
        <button className="chat-toggle-btn" onClick={() => { setShowChat(true); markChatRead(); }} title="الشات العام بين حسابات الإدارة">
          💬
          {chatUnreadCount > 0 && <span className="chat-toggle-count">{chatUnreadCount}</span>}
        </button>
        <div className="search-box">
          <input 
            type="text"
            placeholder={
              activeTab === 'expenses' || activeTab === 'towers'
                ? 'البحث غير متاح في هذا التبويب'
                : activeTab === 'discounts'
                ? 'ابحث في العملاء بالخصم...'
                : activeTab === 'suspended'
                ? 'ابحث في العملاء الموقوفين...'
                : activeTab === 'pool'
                ? 'استخدم البحث داخل التبويب...'
                : 'ابحث عن عميل بالاسم أو الرقم...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
            disabled={activeTab === 'expenses' || activeTab === 'towers'}
          />
          {searchQuery && searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map(customer => {
                const city = cities.find(c => c.id === customer.cityId);
                return (
                  <div key={customer.id} className="search-result-item" onClick={() => navigateToCustomer(customer)}>
                    <div className="result-name">{customer.name}</div>
                    <div className="result-details">
                      {customer.userName && <span className="result-username">{customer.userName}</span>}
                      {customer.phone && <span>{customer.phone}</span>}
                      {city && <span className="result-city">{city.name}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {searchQuery && searchResults.length === 0 && activeTab !== 'expenses' && (
            <div className="search-results">
              <div className="search-result-item" style={{ color: 'var(--text-light)', cursor: 'default' }}>
                لا توجد نتائج في هذا التبويب
              </div>
            </div>
          )}
        </div>
        <button className="profile-avatar-btn" onClick={openProfile} title="حسابي — الاسم والبريد وكلمة المرور">
          {(auth.currentUser?.displayName || auth.currentUser?.email || '؟').trim().charAt(0).toUpperCase()}
        </button>
        <button onClick={handleLogout} className="btn secondary">تسجيل خروج</button>
      </header>

      <div className="tabs">
        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>لوحة التحكم</button>
        <button className={`tab-btn ${activeTab === 'customers-db' ? 'active' : ''}`} onClick={() => setActiveTab('customers-db')}>قاعدة العملاء</button>
        <button className={`tab-btn ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')}>الفواتير</button>
        <button className={`tab-btn ${activeTab === 'yearly' ? 'active' : ''}`} onClick={() => setActiveTab('yearly')}>متابعة الاشتراكات</button>
        <button className={`tab-btn ${activeTab === 'revenues' ? 'active' : ''}`} onClick={() => setActiveTab('revenues')}>الإيرادات</button>
        <button className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`} onClick={() => setActiveTab('expenses')}>المصروفات</button>
        <button className={`tab-btn ${activeTab === 'discounts' ? 'active' : ''}`} onClick={() => setActiveTab('discounts')}>الخصومات</button>
        <button className={`tab-btn ${activeTab === 'suspended' ? 'active' : ''}`} onClick={() => setActiveTab('suspended')}>إيقاف مؤقت</button>
        <button className={`tab-btn ${activeTab === 'pool' ? 'active' : ''}`} onClick={() => setActiveTab('pool')}>user number &amp; ip number</button>
        <button className={`tab-btn ${activeTab === 'towers' ? 'active' : ''}`} onClick={() => setActiveTab('towers')}>الأبراج</button>
        <button className={`tab-btn ${activeTab === 'whatsapp' ? 'active' : ''}`} onClick={() => setActiveTab('whatsapp')}>واتساب</button>
      </div>

      {loading ? (
        <div className="loading">جاري التحميل...</div>
      ) : (
      <main className="main-content">
        {activeTab === 'dashboard' && (
          <>
            <div className="section">
              <div className="section-header">
                <h2>المدن</h2>
                <button type="button" className="btn-add" onClick={() => {
                  const name = prompt('أدخل اسم المدينة:');
                  if (name && name.trim()) {
                    const id = crypto.randomUUID();
                    setDoc(doc(db, 'cities', id), { id, name: name.trim() });
                    setToastMessage('تمت إضافة المدينة');
                  }
                }}>+</button>
              </div>
              <div className="city-list">
                {cities.map((city) => (
                  <div key={city.id} className={`city-card ${selectedCityId === city.id ? 'active' : ''}`} onClick={() => setSelectedCityId(city.id)}>
                    <span>{city.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteCity(city.id); }} className="btn danger">حذف</button>
                  </div>
                ))}
              </div>
            </div>

            {selectedCity && (
              <div className="section">
                <div className="section-header">
                  <h2>عملاء {selectedCity.name}</h2>
                  <button type="button" className="btn-add" onClick={() => setShowAddCustomerForm(!showAddCustomerForm)}>
                    {showAddCustomerForm ? '×' : '+'}
                  </button>
                </div>
                {showAddCustomerForm && (
                <form onSubmit={handleAddCustomer} className="form-group customer-form-collapsible">
                  <input type="text" placeholder="اسم العميل" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
                  <input type="text" placeholder="رقم العميل (الجوال)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                  <div className="date-field">
                    <label>تاريخ بدء الاشتراك</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <input type="number" placeholder="قيمة الاشتراك" value={subscriptionValue} onChange={(e) => setSubscriptionValue(e.target.value)} />
                  <input type="number" placeholder="رسوم التأسيس" value={setupFeeTotal} onChange={(e) => setSetupFeeTotal(e.target.value)} />
                  <input type="number" placeholder="المدفوع" value={setupFeePaid} onChange={(e) => setSetupFeePaid(e.target.value)} />
                  <div className="calculated-field">
                    <span>المتبقي: </span>
                    <strong>{(parseFloat(setupFeeTotal) || 0) - (parseFloat(setupFeePaid) || 0)} ﷼</strong>
                  </div>
                  <input type="text" placeholder="IP Number (الراوتر الأساسي)" value={ipNumber} onChange={(e) => setIpNumber(e.target.value)} />
                  <input type="text" placeholder="User Name (الراوتر الأساسي)" value={userName} onChange={(e) => setUserName(e.target.value)} />
                  <select className="customer-tower-select" value={customerTowerId} onChange={(e) => setCustomerTowerId(e.target.value)}>
                    <option value="">📡 البرج التابع له (اختياري)</option>
                    {[...towers].sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'ar')).map(t => (
                      <option key={t.id} value={t.id}>{t.deviceName}{t.towerNumber ? ` (${t.towerNumber})` : ''}</option>
                    ))}
                  </select>

                  <div className="router-section">
                    <label>عدد الراوترات الإضافية:</label>
                    <input 
                      type="number" 
                      min="0" 
                      max="10"
                      value={additionalRouterCount} 
                      onChange={(e) => handleAdditionalRouterCountChange(parseInt(e.target.value) || 0)} 
                    />
                  </div>
                  
                  {additionalRouters.map((router, index) => (
                    <div key={index} className="additional-router-fields">
                      <div className="router-label">راوتر إضافي {index + 1}</div>
                      <input 
                        type="text" 
                        placeholder={`User Name - راوتر ${index + 1}`}
                        value={router.userName} 
                        onChange={(e) => updateAdditionalRouter(index, 'userName', e.target.value)} 
                      />
                      <input 
                        type="text" 
                        placeholder={`IP Number - راوتر ${index + 1}`}
                        value={router.ipNumber} 
                        onChange={(e) => updateAdditionalRouter(index, 'ipNumber', e.target.value)} 
                      />
                    </div>
                  ))}
                  
                  <input type="text" placeholder="LAP" value={lap} onChange={(e) => setLap(e.target.value)} />
                  <input type="text" placeholder="الموقع" value={site} onChange={(e) => setSite(e.target.value)} />
                  <textarea placeholder="ملاحظات إضافية" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <button type="submit" className="btn primary">إضافة عميل</button>
                </form>
                )}

                <div className="customer-list">
                  {filteredCustomers.map((customer) => {
                    const remaining = (customer.setupFeeTotal ?? 0) - (customer.setupFeePaid ?? 0);
                    return (
                    <div key={customer.id} id={`customer-${customer.id}`} className={`customer-card ${customer.isSuspended ? 'suspended' : ''} ${customer.isExempt ? 'exempt' : ''}`}>
                      <div className="customer-header">
                        <strong>
                          {customer.isSuspended && <span className="suspended-badge">⛔</span>}
                          {customer.isExempt && <span className="exempt-badge">🆓</span>}
                          {customer.hasDiscount && <span className="discount-badge">🏷️</span>}
                          {customer.name}
                        </strong>
                        <div className="payment-buttons">
                          <button 
                            onClick={() => handleTogglePaymentStatus(customer, 'paid')} 
                            className={`payment-btn ${customer.paymentStatus === 'paid' ? 'active paid-active' : customer.paymentStatus === 'partial' ? 'active partial-active' : customer.paymentStatus === 'discounted' ? 'active discounted-active' : ''}`}
                          >
                            {customer.paymentStatus === 'partial' ? 'جزئي' : customer.paymentStatus === 'discounted' ? 'بخصم' : 'مدفوع'}
                          </button>
                          <button 
                            onClick={() => handleTogglePaymentStatus(customer, 'unpaid')} 
                            className={`payment-btn ${customer.paymentStatus === 'unpaid' || !customer.paymentStatus ? 'active unpaid-active' : ''}`}
                          >
                            غير مسدد
                          </button>
                        </div>
                        <div className="customer-actions-top">
                          <button 
                            onClick={() => toggleExemptStatus(customer)} 
                            className={`btn btn-sm ${customer.isExempt ? 'success' : 'secondary'}`}
                            title={customer.isExempt ? 'إلغاء الإعفاء' : 'إعفاء من الإيرادات'}
                          >
                            {customer.isExempt ? '🆓' : 'إعفاء'}
                          </button>
                          <button onClick={() => openCustomerDetails(customer)} className="btn info btn-sm">معلومات</button>
                          <button onClick={() => openEditCustomer(customer)} className="btn edit btn-sm">تعديل</button>
                          <button onClick={() => openTransferCustomer(customer)} className="btn primary btn-sm">نقل</button>
                        </div>
                      </div>
                      <div className="small">{customer.userName || '-'} • {customer.phone || '-'} • {customer.ipNumber || '-'}</div>
                      {customer.towerId && (() => {
                        const t = towers.find(tw => tw.id === customer.towerId);
                        return t ? <div className="small customer-tower-line">📡 {t.deviceName}{t.towerNumber ? ` (${t.towerNumber})` : ''}</div> : null;
                      })()}
                      <div className="small">المتبقي: {remaining} ﷼</div>
                      <div className="actions">
                        <button onClick={() => generateSetupInvoicePDF(customer)} className="btn warning">تأسيس</button>
                        <button onClick={() => generateSubscriptionInvoicePDF(customer)} className="btn secondary">اشتراك</button>
                        <button onClick={() => handleDeleteCustomer(customer.id)} className="btn danger">حذف</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'invoices' && (
          <div className="section">
            <h2>الفواتير</h2>
            <div className="invoice-filters">
              <select value={invoiceCityId || ''} onChange={(e) => setInvoiceCityId(e.target.value || null)} className="input">
                <option value="">اختر مدينة</option>
                {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
              </select>
              
              <input
                type="text"
                className="input invoice-search"
                placeholder="ابحث بالاسم أو الجوال أو اسم المستخدم..."
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
              />
              
              <div className="invoice-date-selector">
                <label>شهر الفاتورة:</label>
                <div className="date-inputs">
                  <select value={invoiceMonth} onChange={(e) => setInvoiceMonth(Number(e.target.value))} className="input">
                    {MONTHS_AR.map((month, idx) => (
                      <option key={idx} value={idx + 1}>{month}</option>
                    ))}
                  </select>
                  <div className="year-selector">
                    <button className="btn-year" onClick={() => setInvoiceYear(y => y - 1)}>◀</button>
                    <span className="year-display">{invoiceYear}</span>
                    <button className="btn-year" onClick={() => setInvoiceYear(y => y + 1)}>▶</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="invoice-list">
              {invoiceFilteredCustomers.map((customer) => {
                const remaining = (customer.setupFeeTotal ?? 0) - (customer.setupFeePaid ?? 0);
                const yearMonth = `${invoiceYear}-${String(invoiceMonth).padStart(2, '0')}`;
                const monthStatus = customer.monthlyPayments?.[yearMonth] || 'pending';
                const statusLabel = monthStatus === 'paid' ? '✓ مدفوع' : monthStatus === 'partial' ? '◐ جزئي' : monthStatus === 'discounted' ? '🏷️ بخصم' : '✗ غير مسدد';
                const statusClass = monthStatus === 'paid' ? 'status-paid' : monthStatus === 'partial' ? 'status-partial' : monthStatus === 'discounted' ? 'status-discounted' : 'status-unpaid';
                const daysSinceStart = getDaysSinceStart(customer.startDate);
                return (
                <div key={customer.id} className="invoice-card">
                  <div><strong>{customer.name}</strong> <span className="days-badge">{daysSinceStart} يوم</span></div>
                  <div className="small">المتبقي: {remaining} ﷼</div>
                  <div className={`invoice-month-status ${statusClass}`}>
                    {MONTHS_AR[invoiceMonth - 1]}: {statusLabel}
                  </div>
                  <div className="actions">
                    <button onClick={() => generateSetupInvoicePDF(customer, invoiceMonth, invoiceYear)} className="btn warning">فاتورة التأسيس</button>
                    <button onClick={() => generateSubscriptionInvoicePDF(customer, invoiceMonth, invoiceYear)} className="btn primary">فاتورة الاشتراك</button>
                  </div>
                </div>
                );
              })}
            </div>

            {/* جدول الفواتير المستحقة */}
            <div className="due-invoices-section">
              <h3>📋 الفواتير المستحقة (30 يوم فأكثر)</h3>
              {dueInvoices.length === 0 ? (
                <p className="no-data">لا توجد فواتير مستحقة حالياً</p>
              ) : (
                <table className="due-invoices-table">
                  <thead>
                    <tr>
                      <th>اسم العميل</th>
                      <th>المدينة</th>
                      <th>عدد الأيام</th>
                      <th>المستحق</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dueInvoices.map(customer => {
                      const city = cities.find(c => c.id === customer.cityId);
                      const daysSinceStart = getDaysSinceMonthStart(customer.startDate);
                      return (
                        <tr key={customer.id}>
                          <td>{customer.name}</td>
                          <td>{city?.name || '-'}</td>
                          <td className="days-cell">{daysSinceStart} يوم</td>
                          <td className="amount-cell">{customer.subscriptionValue || 0} ﷼</td>
                          <td>
                            <button 
                              onClick={() => generateSubscriptionInvoicePDF(customer, invoiceMonth, invoiceYear)} 
                              className="btn primary btn-sm"
                            >
                              استخراج الفاتورة
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'yearly' && (
          <div className="section yearly-section">
            <div className="yearly-header">
              <h2>متابعة الاشتراكات السنوية</h2>
              <div className="yearly-controls">
                <select 
                  value={yearlyCityId || ''} 
                  onChange={(e) => setYearlyCityId(e.target.value || null)} 
                  className="input"
                >
                  <option value="">جميع المدن</option>
                  {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
                </select>
                <div className="year-selector">
                  <button className="btn-year" onClick={() => setSelectedYear(y => y - 1)}>◀</button>
                  <span className="year-display">{selectedYear}</span>
                  <button className="btn-year" onClick={() => setSelectedYear(y => y + 1)}>▶</button>
                </div>
              </div>
            </div>

            <div className="yearly-table-container">
              <table className="yearly-table">
                <thead>
                  <tr>
                    <th className="sticky-col customer-col">العميل</th>
                    <th className="sticky-col city-col">المدينة</th>
                    <th className="sticky-col subscription-col">الاشتراك</th>
                    {MONTHS_AR.map((month, idx) => (
                      <th key={idx} className="month-col">{month}</th>
                    ))}
                    <th className="total-col">المجموع</th>
                  </tr>
                </thead>
                <tbody>
                  {customers
                    .filter(c => !yearlyCityId || c.cityId === yearlyCityId)
                    .filter(c => {
                      if (!searchQuery.trim()) return true;
                      const q = searchQuery.trim().toLowerCase();
                      return c.name.toLowerCase().includes(q) ||
                        (c.userName && c.userName.toLowerCase().includes(q)) ||
                        (c.phone && c.phone.includes(q));
                    })
                    .map((customer) => {
                      const city = cities.find(c => c.id === customer.cityId);
                      let paidCount = 0;
                      
                      return (
                        <tr key={customer.id}>
                          <td className="sticky-col customer-col">{customer.name}</td>
                          <td className="sticky-col city-col">{city?.name || '-'}</td>
                          <td className="sticky-col subscription-col">{customer.subscriptionValue ?? 0} ﷼</td>
                          {MONTHS_AR.map((_, monthIdx) => {
                            const yearMonth = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}`;
                            const status = customer.monthlyPayments?.[yearMonth] || 'pending';
                            if (status === 'paid') paidCount++;
                            if (status === 'partial') paidCount += 0.5;
                            if (status === 'discounted') paidCount++;
                            
                            const statusLabels: Record<string, string> = {
                              paid: 'مدفوع',
                              partial: 'جزئي',
                              discounted: 'بخصم',
                              pending: 'انتظار'
                            };
                            
                            return (
                              <td key={monthIdx} className="month-cell">
                                <div className="month-cell-content">
                                  <button
                                    className={`status-btn ${status}`}
                                    onClick={() => {
                                      // إذا كان الشهر جزئي وضغط عليه مرة ثانية، نفتح النافذة لتعديل المبلغ
                                      if (status === 'partial') {
                                        setConfirmStatusChange({ 
                                          customer, 
                                          newStatus: 'partial',
                                          yearMonth
                                        });
                                        const lastAmount = customer.monthlyPartialAmounts?.[yearMonth];
                                        setPartialPaymentAmount(lastAmount ? String(lastAmount) : String(customer.subscriptionPaid || ''));
                                        return;
                                      }
                                      const nextStatus = status === 'pending' ? 'partial' : 'pending';
                                      // إذا كانت الحالة الجديدة جزئي، نفتح نافذة إدخال المبلغ
                                      if (nextStatus === 'partial') {
                                        setConfirmStatusChange({ 
                                          customer, 
                                          newStatus: 'partial',
                                          yearMonth
                                        });
                                        // تعبئة آخر مبلغ مدخل لهذا الشهر إن وجد
                                        const lastAmount = customer.monthlyPartialAmounts?.[yearMonth];
                                        setPartialPaymentAmount(lastAmount ? String(lastAmount) : '');
                                      } else {
                                        // تحديث مباشر للحالات الأخرى مع مزامنة paymentStatus
                                        const today = new Date();
                                        const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
                                        const isCurrentMonth = yearMonth === currentYearMonth;
                                        
                                        const updatedPayments = {
                                          ...(customer.monthlyPayments || {}),
                                          [yearMonth]: nextStatus
                                        };
                                        
                                        const updatedCustomer: Customer = {
                                          ...customer,
                                          monthlyPayments: updatedPayments as Record<string, 'paid' | 'partial' | 'pending'>,
                                        };
                                        
                                        // مزامنة paymentStatus إذا كان الشهر الحالي
                                        if (isCurrentMonth) {
                                          updatedCustomer.paymentStatus = nextStatus === 'pending' ? 'unpaid' : nextStatus;
                                        }
                                        
                                        setDoc(doc(db, 'customers', customer.id), updatedCustomer);
                                        setCustomers(customers.map(c => c.id === customer.id ? updatedCustomer : c));
                                      }
                                    }}
                                  >
                                    {statusLabels[status]}
                                    {status === 'partial' && customer.monthlyPartialAmounts?.[yearMonth] && (
                                      <span style={{ display: 'block', fontSize: '9px', marginTop: '1px', opacity: 0.9 }}>
                                        {customer.monthlyPartialAmounts[yearMonth]} ﷼
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    className="invoice-mini-btn"
                                    onClick={() => generateSubscriptionInvoicePDF(customer, monthIdx + 1, selectedYear)}
                                    title="استخراج فاتورة"
                                  >
                                    📄
                                  </button>
                                </div>
                              </td>
                            );
                          })}
                          <td className="total-cell">
                            <span className="paid-count">{paidCount}</span>
                            <span className="total-separator">/</span>
                            <span className="total-months">12</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className="yearly-summary">
              <div className="summary-card">
                <div className="summary-label">إجمالي العملاء</div>
                <div className="summary-value">{customers.filter(c => !yearlyCityId || c.cityId === yearlyCityId).length}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">إجمالي الاشتراكات الشهرية</div>
                <div className="summary-value">
                  {customers
                    .filter(c => !yearlyCityId || c.cityId === yearlyCityId)
                    .reduce((sum, c) => sum + (c.subscriptionValue ?? 0), 0)} ﷼
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      )}

      {/* Customer Details Modal */}
      {showCustomerModal && selectedCustomer && (
        <div className="modal-overlay modal-overlay-top" onClick={() => setShowCustomerModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>معلومات العميل</h3>
              <button onClick={() => setShowCustomerModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <span className="detail-label">اسم العميل:</span>
                <span className="detail-value">{selectedCustomer.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">رقم العميل:</span>
                <span className="detail-value">{selectedCustomer.phone || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">تاريخ بدء الاشتراك:</span>
                <span className="detail-value">{selectedCustomer.startDate ? formatDate(selectedCustomer.startDate) : '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">قيمة الاشتراك:</span>
                <span className="detail-value">{selectedCustomer.subscriptionValue ?? 0} ﷼</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">رسوم التأسيس:</span>
                <span className="detail-value">{selectedCustomer.setupFeeTotal ?? 0} ﷼</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">المدفوع:</span>
                <span className="detail-value">{selectedCustomer.setupFeePaid ?? 0} ﷼</span>
              </div>
              <div className="detail-row highlight">
                <span className="detail-label">المتبقي:</span>
                <span className="detail-value">{(selectedCustomer.setupFeeTotal ?? 0) - (selectedCustomer.setupFeePaid ?? 0)} ﷼</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">IP Number (الراوتر الأساسي):</span>
                <span className="detail-value">{selectedCustomer.ipNumber || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">User Name (الراوتر الأساسي):</span>
                <span className="detail-value">{selectedCustomer.userName || '-'}</span>
              </div>
              {selectedCustomer.additionalRouters && selectedCustomer.additionalRouters.length > 0 && (
                <div className="additional-routers-section">
                  <div className="section-title-small">الراوترات الإضافية ({selectedCustomer.additionalRouters.length})</div>
                  {selectedCustomer.additionalRouters.map((router, index) => (
                    <div key={index} className="router-details">
                      <div className="router-number">راوتر {index + 1}</div>
                      <div className="detail-row">
                        <span className="detail-label">User Name:</span>
                        <span className="detail-value">{router.userName || '-'}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">IP Number:</span>
                        <span className="detail-value">{router.ipNumber || '-'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">LAP:</span>
                <span className="detail-value">{selectedCustomer.lap || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">الموقع:</span>
                <span className="detail-value">{selectedCustomer.site || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">حالة الدفع:</span>
                <span className={`detail-value status-badge ${selectedCustomer.paymentStatus === 'paid' ? 'paid' : 'unpaid'}`}>
                  {selectedCustomer.paymentStatus === 'paid' ? 'مدفوع' : 'غير مسدد'}
                </span>
              </div>
              {selectedCustomer.notes && (
                <div className="detail-row notes">
                  <span className="detail-label">ملاحظات:</span>
                  <span className="detail-value">{selectedCustomer.notes}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCustomerModal(false)} className="btn secondary">إغلاق</button>
              <button onClick={() => { generateSetupInvoicePDF(selectedCustomer); }} className="btn warning">فاتورة التأسيس</button>
              <button onClick={() => { generateSubscriptionInvoicePDF(selectedCustomer); }} className="btn primary">فاتورة الاشتراك</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => { setDeleteConfirm(null); setDeletePassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تأكيد الحذف</h3>
              <button onClick={() => { setDeleteConfirm(null); setDeletePassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '20px' }}>
                هل أنت متأكد من حذف {deleteConfirm.type === 'city' ? 'المدينة' : 'العميل'}{' '}
                <strong className="text-danger">{deleteConfirm.name}</strong>؟
                {deleteConfirm.type === 'city' && (
                  <><br /><small style={{ color: '#ef4444' }}>سيتم حذف جميع العملاء في هذه المدينة</small></>
                )}
              </p>
              <div className="edit-field">
                <label>أدخل كلمة المرور للتأكيد</label>
                <input 
                  type="password" 
                  placeholder="كلمة المرور" 
                  value={deletePassword} 
                  onChange={(e) => setDeletePassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmDelete()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setDeleteConfirm(null); setDeletePassword(''); }} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmDelete)}<button onClick={() => confirmDelete()} className="btn danger" disabled={deleteLoading}>
                {deleteLoading ? 'جاري التحقق...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finance Delete Confirmation Modal (للمصروفات والإيرادات) */}
      {financeDeleteConfirm && (
        <div className="modal-overlay" onClick={() => { setFinanceDeleteConfirm(null); setFinanceDeletePassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تأكيد الحذف</h3>
              <button onClick={() => { setFinanceDeleteConfirm(null); setFinanceDeletePassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '20px' }}>
                هل أنت متأكد من حذف {financeDeleteConfirm.type === 'expense' ? 'المصروف' : 'الإيراد'}{' '}
                <strong className="text-danger">{financeDeleteConfirm.item.name}</strong>؟
                <br />
                <small>المبلغ: {financeDeleteConfirm.item.amount} ﷼</small>
              </p>
              <div className="edit-field">
                <label>أدخل كلمة المرور للتأكيد</label>
                <input 
                  type="password" 
                  placeholder="كلمة المرور" 
                  value={financeDeletePassword} 
                  onChange={(e) => setFinanceDeletePassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmFinanceDelete()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setFinanceDeleteConfirm(null); setFinanceDeletePassword(''); }} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmFinanceDelete)}<button onClick={() => confirmFinanceDelete()} className="btn danger" disabled={financeDeleteLoading}>
                {financeDeleteLoading ? 'جاري التحقق...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discount Delete Confirmation Modal (لإزالة الخصومات) */}
      {discountDeleteConfirm && (
        <div className="modal-overlay" onClick={() => { setDiscountDeleteConfirm(null); setDiscountDeletePassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تأكيد إزالة الخصم</h3>
              <button onClick={() => { setDiscountDeleteConfirm(null); setDiscountDeletePassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '20px' }}>
                هل أنت متأكد من إزالة الخصم من العميل{' '}
                <strong className="text-danger">{discountDeleteConfirm.name}</strong>؟
                <br />
                <small>قيمة الخصم: {discountDeleteConfirm.discountAmount || 0} ﷼</small>
                <br />
                <small>ستعود قيمة الاشتراك إلى: {(discountDeleteConfirm.subscriptionValue || 0) + (discountDeleteConfirm.discountAmount || 0)} ﷼</small>
              </p>
              <div className="edit-field">
                <label>أدخل كلمة المرور للتأكيد</label>
                <input 
                  type="password" 
                  placeholder="كلمة المرور" 
                  value={discountDeletePassword} 
                  onChange={(e) => setDiscountDeletePassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmDiscountDelete()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setDiscountDeleteConfirm(null); setDiscountDeletePassword(''); }} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmDiscountDelete)}<button onClick={() => confirmDiscountDelete()} className="btn danger" disabled={discountDeleteLoading}>
                {discountDeleteLoading ? 'جاري التحقق...' : 'تأكيد إزالة الخصم'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Expense Modal (تعديل المصروفات) */}
      {showEditExpenseModal && editingExpense && (
        <div className="modal-overlay" onClick={() => { setShowEditExpenseModal(false); setEditingExpense(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تعديل المصروف</h3>
              <button onClick={() => { setShowEditExpenseModal(false); setEditingExpense(null); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="edit-field">
                <label>اسم المصروف</label>
                <input 
                  type="text" 
                  value={editingExpense.name} 
                  onChange={(e) => setEditingExpense({ ...editingExpense, name: e.target.value })}
                />
              </div>
              <div className="edit-field">
                <label>الوصف</label>
                <input 
                  type="text" 
                  value={editingExpense.description || ''} 
                  onChange={(e) => setEditingExpense({ ...editingExpense, description: e.target.value })}
                />
              </div>
              <div className="edit-field">
                <label>المبلغ</label>
                <input 
                  type="number" 
                  value={editingExpense.amount} 
                  onChange={(e) => setEditingExpense({ ...editingExpense, amount: Number(e.target.value) })}
                />
              </div>
              <div className="edit-field">
                <label>التاريخ</label>
                <input 
                  type="date" 
                  value={editingExpense.date} 
                  onChange={(e) => setEditingExpense({ ...editingExpense, date: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setShowEditExpenseModal(false); setEditingExpense(null); }} className="btn secondary">إلغاء</button>
              <button onClick={saveEditedExpense} className="btn primary">حفظ التعديلات</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Income Modal (تعديل الإيرادات) */}
      {showEditIncomeModal && editingIncome && (
        <div className="modal-overlay" onClick={() => { setShowEditIncomeModal(false); setEditingIncome(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تعديل الإيراد</h3>
              <button onClick={() => { setShowEditIncomeModal(false); setEditingIncome(null); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="edit-field">
                <label>اسم الإيراد</label>
                <input 
                  type="text" 
                  value={editingIncome.name} 
                  onChange={(e) => setEditingIncome({ ...editingIncome, name: e.target.value })}
                />
              </div>
              <div className="edit-field">
                <label>الوصف</label>
                <input 
                  type="text" 
                  value={editingIncome.description || ''} 
                  onChange={(e) => setEditingIncome({ ...editingIncome, description: e.target.value })}
                />
              </div>
              <div className="edit-field">
                <label>المبلغ</label>
                <input 
                  type="number" 
                  value={editingIncome.amount} 
                  onChange={(e) => setEditingIncome({ ...editingIncome, amount: Number(e.target.value) })}
                />
              </div>
              <div className="edit-field">
                <label>التاريخ</label>
                <input 
                  type="date" 
                  value={editingIncome.date} 
                  onChange={(e) => setEditingIncome({ ...editingIncome, date: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setShowEditIncomeModal(false); setEditingIncome(null); }} className="btn secondary">إلغاء</button>
              <button onClick={saveEditedIncome} className="btn primary">حفظ التعديلات</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Finance Password Modal (تأكيد تعديل المصروفات/الإيرادات) */}
      {(pendingEditExpense || pendingEditIncome) && (
        <div className="modal-overlay" onClick={() => { setPendingEditExpense(null); setPendingEditIncome(null); setEditFinancePassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تأكيد التعديل</h3>
              <button onClick={() => { setPendingEditExpense(null); setPendingEditIncome(null); setEditFinancePassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '20px' }}>
                لتعديل {pendingEditExpense ? 'المصروف' : 'الإيراد'}{' '}
                <strong>{pendingEditExpense?.name || pendingEditIncome?.name}</strong>، أدخل كلمة المرور
              </p>
              <div className="edit-field">
                <label>كلمة المرور</label>
                <input 
                  type="password" 
                  placeholder="كلمة المرور" 
                  value={editFinancePassword} 
                  onChange={(e) => setEditFinancePassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmEditFinance()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setPendingEditExpense(null); setPendingEditIncome(null); setEditFinancePassword(''); }} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmEditFinance)}<button onClick={() => confirmEditFinance()} className="btn primary" disabled={editFinanceLoading}>
                {editFinanceLoading ? 'جاري التحقق...' : 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Password Confirmation Modal */}
      {editPasswordModal && pendingEditCustomer && (
        <div className="modal-overlay" onClick={() => { setEditPasswordModal(false); setPendingEditCustomer(null); setEditPassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تأكيد التعديل</h3>
              <button onClick={() => { setEditPasswordModal(false); setPendingEditCustomer(null); setEditPassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '20px' }}>
                لتعديل بيانات العميل <strong>{pendingEditCustomer.name}</strong>، أدخل كلمة المرور
              </p>
              <div className="edit-field">
                <label>كلمة المرور</label>
                <input 
                  type="password" 
                  placeholder="كلمة المرور" 
                  value={editPassword} 
                  onChange={(e) => setEditPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmEditPassword()}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setEditPasswordModal(false); setPendingEditCustomer(null); setEditPassword(''); }} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmEditPassword)}<button onClick={() => confirmEditPassword()} className="btn primary" disabled={editLoading}>
                {editLoading ? 'جاري التحقق...' : 'متابعة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tower Edit Password Modal — كلمة مرور تعديل البرج */}
      {towerEditPasswordModal && pendingEditTower && (
        <div className="modal-overlay" onClick={() => { setTowerEditPasswordModal(false); setPendingEditTower(null); setTowerEditPassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تأكيد تعديل البرج</h3>
              <button onClick={() => { setTowerEditPasswordModal(false); setPendingEditTower(null); setTowerEditPassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '20px' }}>
                لتعديل البرج <strong>{pendingEditTower.deviceName}</strong>، أدخل كلمة المرور
              </p>
              <div className="edit-field">
                <label>كلمة المرور</label>
                <input
                  type="password"
                  placeholder="كلمة المرور"
                  value={towerEditPassword}
                  onChange={(e) => setTowerEditPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmTowerEditPassword()}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setTowerEditPasswordModal(false); setPendingEditTower(null); setTowerEditPassword(''); }} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmTowerEditPassword)}<button onClick={() => confirmTowerEditPassword()} className="btn primary" disabled={towerEditLoading}>
                {towerEditLoading ? 'جاري التحقق...' : 'متابعة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Status Change Modal */}
      {confirmStatusChange && (
        <div className="modal-overlay" onClick={() => setConfirmStatusChange(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: confirmStatusChange.newStatus === 'unpaid' ? '440px' : '480px' }}>
            <div className="modal-header">
              <h3>{confirmStatusChange.newStatus === 'unpaid' ? 'تأكيد تغيير الحالة' : '💳 تسجيل دفعة'}</h3>
              <button onClick={() => setConfirmStatusChange(null)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              {confirmStatusChange.newStatus === 'unpaid' ? (
                <p className="confirm-text">
                  هل تريد تغيير حالة <strong>{confirmStatusChange.customer.name}</strong> إلى{' '}
                  <strong className="text-warning">غير مسدد</strong>؟
                </p>
              ) : (
                <>
                  <p className="confirm-text" style={{ marginBottom: '16px', fontSize: '15px' }}>
                    تسجيل دفعة لـ <strong style={{ color: 'var(--primary-light)' }}>{confirmStatusChange.customer.name}</strong>
                  </p>
                  {!confirmStatusChange.yearMonth && (
                    <div className="payment-date-picker">
                      <div className="year-nav">
                        <button className="year-nav-btn" onClick={() => setPaymentYear(paymentYear + 1)}>›</button>
                        <span className="year-nav-label">{paymentYear}</span>
                        <button className="year-nav-btn" onClick={() => setPaymentYear(paymentYear - 1)}>‹</button>
                      </div>
                      <div className="month-grid">
                        {MONTHS_AR.map((m, i) => (
                          <button
                            key={i}
                            type="button"
                            className={`month-card${paymentMonth === i + 1 ? ' active' : ''}${i + 1 === new Date().getMonth() + 1 && paymentYear === new Date().getFullYear() ? ' current' : ''}`}
                            onClick={() => setPaymentMonth(i + 1)}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="payment-amount-section">
                    <div className="payment-amount-label">
                      <span>المبلغ المدفوع</span>
                      <span className="subscription-value">{confirmStatusChange.customer.subscriptionValue || 0} ﷼</span>
                    </div>
                    <input 
                      type="number" 
                      className="payment-amount-input"
                      value={partialPaymentAmount}
                      onChange={(e) => setPartialPaymentAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  {(() => {
                    const paid = parseFloat(partialPaymentAmount) || 0;
                    const total = confirmStatusChange.customer.subscriptionValue || 0;
                    const remaining = total - paid;
                    if (paid > 0 && paid < total) {
                      return (
                        <>
                          <div className="payment-type-choice">
                            <span className="choice-label">نوع الدفع:</span>
                            <button 
                              type="button"
                              className={`choice-btn ${paymentTypeChoice === 'partial' ? 'active partial' : ''}`}
                              onClick={() => setPaymentTypeChoice('partial')}
                            >
                              جزئي
                            </button>
                            <button 
                              type="button"
                              className={`choice-btn ${paymentTypeChoice === 'discounted' ? 'active discounted' : ''}`}
                              onClick={() => setPaymentTypeChoice('discounted')}
                            >
                              خصم
                            </button>
                          </div>
                          <div className={`payment-status-indicator ${paymentTypeChoice === 'discounted' ? 'discounted' : 'partial'}`}>
                            <span className="status-icon">{paymentTypeChoice === 'discounted' ? '🏷️' : '⚠️'}</span>
                            <span>
                              {paymentTypeChoice === 'discounted' 
                                ? `خصم: ${remaining} ﷼ — سيتم تسجيله في الخصومات` 
                                : `المتبقي: ${remaining} ﷼`}
                            </span>
                          </div>
                        </>
                      );
                    } else if (paid >= total && total > 0) {
                      return (
                        <div className="payment-status-indicator full">
                          <span className="status-icon">✅</span>
                          <span>مدفوع بالكامل</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfirmStatusChange(null)} className="btn secondary">إلغاء</button>
              <button onClick={confirmPaymentStatusChange} className="btn primary">تأكيد</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {showEditModal && editingCustomer && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تعديل بيانات العميل</h3>
              <button onClick={() => setShowEditModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <div className="edit-form">
                <div className="edit-field">
                  <label>اسم العميل</label>
                  <input type="text" value={editingCustomer.name} onChange={(e) => handleEditCustomer('name', e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>رقم العميل (الجوال)</label>
                  <input type="text" value={editingCustomer.phone || ''} onChange={(e) => handleEditCustomer('phone', e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>تاريخ بدء الاشتراك</label>
                  <input type="date" value={editingCustomer.startDate || ''} onChange={(e) => handleEditCustomer('startDate', e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>قيمة الاشتراك</label>
                  <input type="number" value={editingCustomer.subscriptionValue || ''} onChange={(e) => handleEditCustomer('subscriptionValue', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="edit-field">
                  <label>رسوم التأسيس</label>
                  <input type="number" value={editingCustomer.setupFeeTotal || ''} onChange={(e) => handleEditCustomer('setupFeeTotal', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="edit-field">
                  <label>المدفوع</label>
                  <input type="number" value={editingCustomer.setupFeePaid || ''} onChange={(e) => handleEditCustomer('setupFeePaid', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="edit-field calculated">
                  <label>المتبقي</label>
                  <span className="calculated-value">{(editingCustomer.setupFeeTotal ?? 0) - (editingCustomer.setupFeePaid ?? 0)} ﷼</span>
                </div>
                <div className="edit-field">
                  <label>IP Number</label>
                  <input type="text" value={editingCustomer.ipNumber || ''} onChange={(e) => handleEditCustomer('ipNumber', e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>User Name</label>
                  <input type="text" value={editingCustomer.userName || ''} onChange={(e) => handleEditCustomer('userName', e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>البرج التابع له</label>
                  <select value={editingCustomer.towerId || ''} onChange={(e) => handleEditCustomer('towerId', e.target.value)}>
                    <option value="">— بدون برج —</option>
                    {[...towers].sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'ar')).map(t => (
                      <option key={t.id} value={t.id}>{t.deviceName}{t.towerNumber ? ` (${t.towerNumber})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="router-section">
                  <div className="edit-field">
                    <label>عدد الراوترات الإضافية</label>
                    <input 
                      type="number" 
                      min="0" 
                      value={editingCustomer.additionalRouters?.length || 0} 
                      onChange={(e) => handleEditAdditionalRouterCount(parseInt(e.target.value) || 0)} 
                    />
                  </div>
                  {editingCustomer.additionalRouters && editingCustomer.additionalRouters.length > 0 && (
                    <div className="additional-router-fields">
                      {editingCustomer.additionalRouters.map((router, index) => (
                        <div key={index} className="router-item">
                          <div className="router-label">راوتر إضافي {index + 1}</div>
                          <div className="edit-field">
                            <label>User Name</label>
                            <input 
                              type="text" 
                              value={router.userName} 
                              onChange={(e) => updateEditAdditionalRouter(index, 'userName', e.target.value)} 
                            />
                          </div>
                          <div className="edit-field">
                            <label>IP Number</label>
                            <input 
                              type="text" 
                              value={router.ipNumber} 
                              onChange={(e) => updateEditAdditionalRouter(index, 'ipNumber', e.target.value)} 
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="edit-field">
                  <label>LAP</label>
                  <input type="text" value={editingCustomer.lap || ''} onChange={(e) => handleEditCustomer('lap', e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>الموقع</label>
                  <input type="text" value={editingCustomer.site || ''} onChange={(e) => handleEditCustomer('site', e.target.value)} />
                </div>
                <div className="edit-field full-width">
                  <label>ملاحظات إضافية</label>
                  <textarea value={editingCustomer.notes || ''} onChange={(e) => handleEditCustomer('notes', e.target.value)} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowEditModal(false)} className="btn secondary">إلغاء</button>
              <button onClick={saveEditedCustomer} className="btn primary">حفظ التعديلات</button>
            </div>
          </div>
        </div>
      )}

        {activeTab === 'revenues' && (
          <div className="section revenues-section">
            <div className="revenues-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                <h2>الإيرادات الشهرية</h2>
                {/* قائمة المعفيين */}
                {(() => {
                  const exemptCustomers = customers.filter(c => c.isExempt && !c.isSuspended && (revenuesCityId ? c.cityId === revenuesCityId : true));
                  return exemptCustomers.length > 0 ? (
                    <div style={{ position: 'relative' }}>
                      <button 
                        onClick={() => setShowExemptList(!showExemptList)} 
                        className="btn" 
                        style={{ 
                          background: 'var(--primary)', 
                          color: 'white', 
                          padding: '6px 12px', 
                          borderRadius: '20px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontSize: '13px'
                        }}
                      >
                        🆓 المعفيين ({exemptCustomers.length})
                        <span style={{ transform: showExemptList ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}>▼</span>
                      </button>
                      {showExemptList && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: '5px',
                          background: 'var(--card)',
                          borderRadius: '10px',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                          padding: '10px 0',
                          minWidth: '250px',
                          maxHeight: '300px',
                          overflowY: 'auto',
                          zIndex: 100
                        }}>
                          <div style={{ padding: '8px 15px', borderBottom: '1px solid var(--border)', fontWeight: 'bold', color: 'var(--primary-light)' }}>
                            العملاء المعفيين من الإيرادات
                          </div>
                          {exemptCustomers.map(customer => {
                            const city = cities.find(c => c.id === customer.cityId);
                            return (
                              <div key={customer.id} style={{ 
                                padding: '8px 15px', 
                                borderBottom: '1px solid #f5f5f5',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}>
                                <span>{customer.name}</span>
                                <span style={{ fontSize: '11px', color: 'var(--text-light)' }}>{city?.name || ''}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
              <div className="revenues-controls">
                <select value={revenuesCityId || ''} onChange={(e) => setRevenuesCityId(e.target.value || null)}>
                  <option value="">جميع المدن</option>
                  {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
                </select>
                <div className="year-selector">
                  <button className="btn-month" onClick={() => setRevenuesYear(y => y - 1)}>◀</button>
                  <span className="year-display">{revenuesYear}</span>
                  <button className="btn-month" onClick={() => setRevenuesYear(y => y + 1)}>▶</button>
                </div>
                <div className="month-year-selector">
                  <button className="btn-month" onClick={() => setRevenuesMonth(m => m === 1 ? 12 : m - 1)}>◀</button>
                  <span className="month-display">{MONTHS_AR[revenuesMonth - 1]}</span>
                  <button className="btn-month" onClick={() => setRevenuesMonth(m => m === 12 ? 1 : m + 1)}>▶</button>
                </div>
              </div>
            </div>

            <div className="revenues-summary">
              <div className="revenue-card paid">
                <div className="revenue-label">الإيرادات المستحصلة</div>
                <div className="revenue-amount">{revenuesData.paidAmount.toFixed(0)} ﷼</div>
                <div className="revenue-count">{revenuesData.paid.length} عميل</div>
              </div>
              <div className="revenue-card partial">
                <div className="revenue-label">الإيرادات الجزئية</div>
                <div className="revenue-amount">{revenuesData.partialAmount.toFixed(0)} ﷼</div>
                <div className="revenue-count">{revenuesData.partial.length} عميل</div>
              </div>
              <div className="revenue-card pending">
                <div className="revenue-label">الإيرادات المتأخرة</div>
                <div className="revenue-amount">{revenuesData.pendingAmount.toFixed(0)} ﷼</div>
                <div className="revenue-count">{revenuesData.pending.length} عميل</div>
              </div>
            </div>

            <div className="revenues-list collapsible">
              <div 
                className="revenues-section-title clickable" 
                onClick={() => setShowPaidRevenues(!showPaidRevenues)}
                style={{cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px'}}
              >
                <span style={{transition: 'transform 0.3s', transform: showPaidRevenues ? 'rotate(90deg)' : 'rotate(0deg)'}}>▶</span>
                المستحصلة ({revenuesData.paid.length})
              </div>
              {showPaidRevenues && (
                <table className="revenues-table">
                  <thead>
                    <tr>
                      <th>اسم العميل</th>
                      <th>المدينة</th>
                      <th>رقم الهاتف</th>
                      <th>المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenuesData.paid.map(customer => {
                      const city = cities.find(c => c.id === customer.cityId);
                      return (
                        <tr key={customer.id}>
                          <td>{customer.name}</td>
                          <td>{city?.name || '-'}</td>
                          <td>{customer.phone || '-'}</td>
                          <td>{customer.subscriptionValue} ﷼</td>
                        </tr>
                      );
                    })}
                    {revenuesData.paid.length === 0 && (
                      <tr><td colSpan={4} style={{textAlign: 'center', color: 'var(--text-light)'}}>لا توجد إيرادات مستحصلة</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="revenues-list collapsible">
              <div 
                className="revenues-section-title clickable" 
                onClick={() => setShowPartialRevenues(!showPartialRevenues)}
                style={{cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px'}}
              >
                <span style={{transition: 'transform 0.3s', transform: showPartialRevenues ? 'rotate(90deg)' : 'rotate(0deg)'}}>▶</span>
                الإيرادات الجزئية ({revenuesData.partial.length})
              </div>
              {showPartialRevenues && (
                <table className="revenues-table">
                  <thead>
                    <tr>
                      <th>اسم العميل</th>
                      <th>المدينة</th>
                      <th>رقم الهاتف</th>
                      <th>قيمة الاشتراك</th>
                      <th>المستحصل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenuesData.partial.map(customer => {
                      const city = cities.find(c => c.id === customer.cityId);
                      return (
                        <tr key={customer.id}>
                          <td>{customer.name}</td>
                          <td>{city?.name || '-'}</td>
                          <td>{customer.phone || '-'}</td>
                          <td>{customer.subscriptionValue} ﷼</td>
                          <td>{(customer.subscriptionPaid || 0).toFixed(0)} ﷼</td>
                        </tr>
                      );
                    })}
                    {revenuesData.partial.length === 0 && (
                      <tr><td colSpan={5} style={{textAlign: 'center', color: 'var(--text-light)'}}>لا توجد إيرادات جزئية</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="revenues-list collapsible">
              <div 
                className="revenues-section-title clickable" 
                onClick={() => setShowPendingRevenues(!showPendingRevenues)}
                style={{cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px'}}
              >
                <span style={{transition: 'transform 0.3s', transform: showPendingRevenues ? 'rotate(90deg)' : 'rotate(0deg)'}}>▶</span>
                الإيرادات المتأخرة ({revenuesData.pending.length})
              </div>
              {showPendingRevenues && (
                <table className="revenues-table">
                  <thead>
                    <tr>
                      <th>اسم العميل</th>
                      <th>المدينة</th>
                      <th>رقم الهاتف</th>
                      <th>المبلغ المتأخر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenuesData.pending.map(customer => {
                      const city = cities.find(c => c.id === customer.cityId);
                      return (
                        <tr key={customer.id}>
                          <td>{customer.name}</td>
                          <td>{city?.name || '-'}</td>
                          <td>{customer.phone || '-'}</td>
                          <td>{customer.subscriptionValue} ﷼</td>
                        </tr>
                      );
                    })}
                    {revenuesData.pending.length === 0 && (
                      <tr><td colSpan={4} style={{textAlign: 'center', color: 'var(--text-light)'}}>لا توجد إيرادات متأخرة</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'discounts' && (
          <div className="section discounts-section">
            <h2>تطبيق الخصومات</h2>
            
            {/* اختيار الشهر والسنة */}
            <div className="discount-filters">
              <div className="month-year-selector">
                <button className="btn-month" onClick={() => setDiscountMonth(m => m === 1 ? 12 : m - 1)}>◀</button>
                <span className="month-display">{MONTHS_AR[discountMonth - 1]}</span>
                <button className="btn-month" onClick={() => setDiscountMonth(m => m === 12 ? 1 : m + 1)}>▶</button>
              </div>
              <div className="year-selector">
                <button className="btn-month" onClick={() => setDiscountYear(y => y - 1)}>◀</button>
                <span className="year-display">{discountYear}</span>
                <button className="btn-month" onClick={() => setDiscountYear(y => y + 1)}>▶</button>
              </div>
            </div>
            
            <div className="discount-form">
              <div className="discount-row">
                <div className="discount-field">
                  <label>ابحث عن العميل</label>
                  <input 
                    type="text"
                    value={discountSearch}
                    onChange={(e) => setDiscountSearch(e.target.value)}
                    placeholder="ابحث بالاسم..."
                    className="input"
                  />
                </div>
              </div>

              <div className="discount-row">
                <div className="discount-field">
                  <label>اختر العميل</label>
                  <select 
                    value={discountCustomerId} 
                    onChange={(e) => setDiscountCustomerId(e.target.value)}
                    className="input"
                  >
                    <option value="">-- اختر عميل --</option>
                    {customers
                      .filter(c => !discountSearch || c.name.toLowerCase().includes(discountSearch.toLowerCase()))
                      .map(customer => {
                        const city = cities.find(c => c.id === customer.cityId);
                        return (
                          <option key={customer.id} value={customer.id}>
                            {customer.hasDiscount ? '🏷️ ' : ''}{customer.name} - {city?.name || ''} ({customer.subscriptionValue || 0} ﷼)
                          </option>
                        );
                      })}
                  </select>
                </div>
              </div>

              <div className="discount-row">
                <div className="discount-field">
                  <label>نوع الخصم</label>
                  <div className="discount-type-buttons">
                    <button 
                      className={`discount-type-btn ${discountType === 'amount' ? 'active' : ''}`}
                      onClick={() => setDiscountType('amount')}
                    >
                      قيمة ثابتة (﷼)
                    </button>
                    <button 
                      className={`discount-type-btn ${discountType === 'percentage' ? 'active' : ''}`}
                      onClick={() => setDiscountType('percentage')}
                    >
                      نسبة مئوية (%)
                    </button>
                  </div>
                </div>
              </div>

              <div className="discount-row">
                <div className="discount-field">
                  <label>{discountType === 'percentage' ? 'نسبة الخصم (%)' : 'قيمة الخصم (﷼)'}</label>
                  <input 
                    type="number" 
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === 'percentage' ? 'مثال: 10' : 'مثال: 50'}
                    className="input"
                  />
                </div>
              </div>

              {discountCustomerId && discountValue && (
                <div className="discount-preview">
                  {(() => {
                    const customer = customers.find(c => c.id === discountCustomerId);
                    if (!customer) return null;
                    const currentValue = customer.subscriptionValue || 0;
                    const discount = discountType === 'percentage' 
                      ? (currentValue * parseFloat(discountValue || '0')) / 100
                      : parseFloat(discountValue || '0');
                    const newValue = currentValue - discount;
                    return (
                      <div className="preview-card">
                        <div className="preview-row">
                          <span>قيمة الاشتراك الحالية:</span>
                          <span className="current-value">{currentValue} ﷼</span>
                        </div>
                        <div className="preview-row">
                          <span>قيمة الخصم:</span>
                          <span className="discount-value">- {discount.toFixed(0)} ﷼</span>
                        </div>
                        <div className="preview-row total">
                          <span>قيمة الاشتراك الجديدة:</span>
                          <span className="new-value">{newValue.toFixed(0)} ﷼</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <button onClick={applyDiscount} className="btn primary apply-discount-btn">
                تطبيق الخصم
              </button>
            </div>

            {/* قائمة العملاء المخصوم لهم */}
            <div className="discounted-customers">
              <h3>🏷️ العملاء المخصوم لهم</h3>
              {customers.filter(c => c.hasDiscount).length === 0 ? (
                <p className="no-discounts">لا يوجد عملاء مخصوم لهم حالياً</p>
              ) : (
                <table className="discounted-table">
                  <thead>
                    <tr>
                      <th>اسم العميل</th>
                      <th>المدينة</th>
                      <th>قيمة الخصم</th>
                      <th>قيمة الاشتراك الحالية</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.filter(c => c.hasDiscount).map(customer => {
                      const city = cities.find(c => c.id === customer.cityId);
                      return (
                        <tr key={customer.id}>
                          <td>🏷️ {customer.name}</td>
                          <td>{city?.name || '-'}</td>
                          <td className="discount-cell">{customer.discountAmount || 0} ﷼</td>
                          <td>{customer.subscriptionValue || 0} ﷼</td>
                          <td>
                            <button 
                              onClick={() => handleRemoveDiscount(customer)} 
                              className="btn danger btn-sm"
                            >
                              إزالة الخصم
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="section expenses-section">
            <h2>💰 الحسابات المالية</h2>
            
            {/* اختيار الشهر والسنة */}
            <div className="finance-filters">
              <div className="month-year-selector">
                <button className="btn-month" onClick={() => setFinanceMonth(m => m === 1 ? 12 : m - 1)}>◀</button>
                <span className="month-display">{MONTHS_AR[financeMonth - 1]}</span>
                <button className="btn-month" onClick={() => setFinanceMonth(m => m === 12 ? 1 : m + 1)}>▶</button>
              </div>
              <div className="year-selector">
                <button className="btn-month" onClick={() => setFinanceYear(y => y - 1)}>◀</button>
                <span className="year-display">{financeYear}</span>
                <button className="btn-month" onClick={() => setFinanceYear(y => y + 1)}>▶</button>
              </div>
            </div>

            {/* ملخص الشهر */}
            {(() => {
              const monthExpenses = expenses.filter(e => e.month === financeMonth && e.year === financeYear);
              const monthIncomes = incomes.filter(i => i.month === financeMonth && i.year === financeYear);
              const totalExpenses = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
              const totalIncomes = monthIncomes.reduce((sum, i) => sum + i.amount, 0);
              const netRevenue = totalIncomes - totalExpenses;
              
              return (
                <div className="net-revenue-section">
                  <h3>📊 ملخص {MONTHS_AR[financeMonth - 1]} {financeYear}</h3>
                  <div className="net-summary-cards">
                    <div className="net-card income">
                      <div className="net-label">إجمالي الإيرادات</div>
                      <div className="net-amount">{totalIncomes.toFixed(0)} ﷼</div>
                    </div>
                    <div className="net-card expenses">
                      <div className="net-label">إجمالي المصروفات</div>
                      <div className="net-amount">{totalExpenses.toFixed(0)} ﷼</div>
                    </div>
                    <div className={`net-card net ${netRevenue >= 0 ? 'positive' : 'negative'}`}>
                      <div className="net-label">صافي الربح</div>
                      <div className="net-amount">{netRevenue.toFixed(0)} ﷼</div>
                    </div>
                  </div>
                </div>
              );
            })()}
            
            {/* نموذج إضافة مصروف وإيراد */}
            <div className="finance-forms">
              <div className="expense-form">
                <h3>➖ إضافة مصروف</h3>
                <div className="expense-form-grid">
                  <div className="expense-field">
                    <label>اسم المصروف *</label>
                    <input 
                      type="text" 
                      value={expenseName}
                      onChange={(e) => setExpenseName(e.target.value)}
                      placeholder="مثال: فاتورة كهرباء"
                      className="input"
                    />
                  </div>
                  <div className="expense-field">
                    <label>الوصف</label>
                    <input 
                      type="text" 
                      value={expenseDescription}
                      onChange={(e) => setExpenseDescription(e.target.value)}
                      placeholder="تفاصيل إضافية..."
                      className="input"
                    />
                  </div>
                  <div className="expense-field">
                    <label>القيمة (﷼) *</label>
                    <input 
                      type="number" 
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      placeholder="0"
                      className="input"
                    />
                  </div>
                  <div className="expense-field">
                    <label>التاريخ</label>
                    <input 
                      type="date" 
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      className="input"
                    />
                  </div>
                </div>
                <button onClick={addExpense} className="btn danger">إضافة مصروف</button>
              </div>

              <div className="expense-form income-form">
                <h3>➕ إضافة إيراد</h3>
                <div className="expense-form-grid">
                  <div className="expense-field">
                    <label>اسم الإيراد *</label>
                    <input 
                      type="text" 
                      value={incomeName}
                      onChange={(e) => setIncomeName(e.target.value)}
                      placeholder="مثال: بيع معدات"
                      className="input"
                    />
                  </div>
                  <div className="expense-field">
                    <label>الوصف</label>
                    <input 
                      type="text" 
                      value={incomeDescription}
                      onChange={(e) => setIncomeDescription(e.target.value)}
                      placeholder="تفاصيل إضافية..."
                      className="input"
                    />
                  </div>
                  <div className="expense-field">
                    <label>القيمة (﷼) *</label>
                    <input 
                      type="number" 
                      value={incomeAmount}
                      onChange={(e) => setIncomeAmount(e.target.value)}
                      placeholder="0"
                      className="input"
                    />
                  </div>
                  <div className="expense-field">
                    <label>التاريخ</label>
                    <input 
                      type="date" 
                      value={incomeDate}
                      onChange={(e) => setIncomeDate(e.target.value)}
                      className="input"
                    />
                  </div>
                </div>
                <button onClick={addIncome} className="btn primary">إضافة إيراد</button>
              </div>
            </div>

            {/* جداول المصروفات والإيرادات */}
            <div className="finance-tables">
              <div className="expenses-list">
                <h3>📋 مصروفات {MONTHS_AR[financeMonth - 1]}</h3>
                {(() => {
                  const monthExpenses = expenses.filter(e => e.month === financeMonth && e.year === financeYear);
                  return monthExpenses.length === 0 ? (
                    <p className="no-expenses">لا توجد مصروفات في هذا الشهر</p>
                  ) : (
                    <table className="expenses-table">
                      <thead>
                        <tr>
                          <th>اسم المصروف</th>
                          <th>الوصف</th>
                          <th>القيمة</th>
                          <th>التاريخ</th>
                          <th>إجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthExpenses
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map(expense => (
                            <tr key={expense.id}>
                              <td>{expense.name}</td>
                              <td>{expense.description || '-'}</td>
                              <td className="expense-amount">{expense.amount} ﷼</td>
                              <td>{formatDate(expense.date)}</td>
                              <td>
                                <button 
                                  onClick={() => { setPendingEditExpense(expense); setEditFinancePassword(''); }} 
                                  className="btn edit btn-sm"
                                  style={{ marginLeft: '5px' }}
                                >
                                  تعديل
                                </button>
                                <button 
                                  onClick={() => handleDeleteExpense(expense)} 
                                  className="btn danger btn-sm"
                                >
                                  حذف
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              <div className="expenses-list incomes-list">
                <h3>📋 إيرادات {MONTHS_AR[financeMonth - 1]}</h3>
                {(() => {
                  const monthIncomes = incomes.filter(i => i.month === financeMonth && i.year === financeYear);
                  return monthIncomes.length === 0 ? (
                    <p className="no-expenses">لا توجد إيرادات في هذا الشهر</p>
                  ) : (
                    <table className="expenses-table incomes-table">
                      <thead>
                        <tr>
                          <th>اسم الإيراد</th>
                          <th>الوصف</th>
                          <th>القيمة</th>
                          <th>التاريخ</th>
                          <th>إجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthIncomes
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map(income => (
                            <tr key={income.id}>
                              <td>{income.name}</td>
                              <td>{income.description || '-'}</td>
                              <td className="income-amount">{income.amount} ﷼</td>
                              <td>{formatDate(income.date)}</td>
                              <td>
                                <button 
                                  onClick={() => { setPendingEditIncome(income); setEditFinancePassword(''); }} 
                                  className="btn edit btn-sm"
                                  style={{ marginLeft: '5px' }}
                                >
                                  تعديل
                                </button>
                                <button 
                                  onClick={() => handleDeleteIncome(income)} 
                                  className="btn danger btn-sm"
                                >
                                  حذف
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'customers-db' && (
          <div className="section customers-db-section">
            <h2>📋 قاعدة العملاء</h2>
            <p className="section-info">جميع بيانات العملاء في مكان واحد</p>
            
            {/* فلاتر */}
            <div className="customers-db-filters">
              <select 
                value={customersDbCityId || ''} 
                onChange={(e) => setCustomersDbCityId(e.target.value || null)} 
                className="input"
              >
                <option value="">جميع المدن</option>
                {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
              </select>
              
              <input
                type="text"
                className="input customers-db-search"
                placeholder="ابحث بالاسم أو الجوال أو اسم المستخدم أو IP..."
                value={customersDbSearch}
                onChange={(e) => setCustomersDbSearch(e.target.value)}
              />
              
              <span className="customers-count">
                إجمالي العملاء: {(() => {
                  let filtered = customersDbCityId 
                    ? customers.filter(c => c.cityId === customersDbCityId)
                    : customers;
                  if (customersDbSearch.trim()) {
                    const query = customersDbSearch.trim().toLowerCase();
                    filtered = filtered.filter(c => 
                      c.name.toLowerCase().includes(query) ||
                      (c.phone && c.phone.includes(query)) ||
                      (c.userName && c.userName.toLowerCase().includes(query)) ||
                      (c.ipNumber && c.ipNumber.includes(query))
                    );
                  }
                  return filtered.length;
                })()}
              </span>

              <button onClick={printCustomersDbPdf} className="btn primary">
                🖨️ طباعة PDF
              </button>
            </div>

            {/* جدول العملاء */}
            <div className="customers-db-table-container">
              <table className="customers-db-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الاسم</th>
                    <th>المدينة</th>
                    <th>الجوال</th>
                    <th>Username</th>
                    <th>IP Number</th>
                    <th>الاشتراك</th>
                    <th>تاريخ البدء</th>
                    <th>LAP</th>
                    <th>الموقع</th>
                    <th>الحالة</th>
                    <th>ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let filtered = customersDbCityId 
                      ? customers.filter(c => c.cityId === customersDbCityId)
                      : customers;
                    if (customersDbSearch.trim()) {
                      const query = customersDbSearch.trim().toLowerCase();
                      filtered = filtered.filter(c => 
                        c.name.toLowerCase().includes(query) ||
                        (c.phone && c.phone.includes(query)) ||
                        (c.userName && c.userName.toLowerCase().includes(query)) ||
                        (c.ipNumber && c.ipNumber.includes(query))
                      );
                    }
                    return filtered.map((customer, index) => {
                      const city = cities.find(c => c.id === customer.cityId);
                      return (
                        <tr key={customer.id} className={`${customer.isSuspended ? 'row-suspended' : ''} ${customer.isExempt ? 'row-exempt' : ''}`}>
                          <td>{index + 1}</td>
                          <td>
                            {customer.isSuspended && <span title="موقوف">⏸️</span>}
                            {customer.isExempt && <span title="معفي">🆓</span>}
                            {customer.hasDiscount && <span title="خصم">🏷️</span>}
                            {customer.name}
                          </td>
                          <td>{city?.name || '-'}</td>
                          <td>{customer.phone || '-'}</td>
                          <td>{customer.userName || '-'}</td>
                          <td>{customer.ipNumber || '-'}</td>
                          <td>{customer.subscriptionValue || 0} ﷼</td>
                          <td>{customer.startDate ? formatDate(customer.startDate) : '-'}</td>
                          <td>{customer.lap || '-'}</td>
                          <td>{customer.site || '-'}</td>
                          <td>
                            <span className={`status-badge ${customer.paymentStatus === 'paid' ? 'paid' : customer.paymentStatus === 'partial' ? 'partial' : 'unpaid'}`}>
                              {customer.paymentStatus === 'paid' ? 'مدفوع' : customer.paymentStatus === 'partial' ? 'جزئي' : 'غير مسدد'}
                            </span>
                          </td>
                          <td className="notes-cell">{customer.notes || '-'}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'pool' && (() => {
          const scoped = poolCityIds.length ? customers.filter(c => poolCityIds.includes(c.cityId)) : customers;
          // تطبيع رقم الـ IP: لو فيه نقاط مثل 192.168.1.26 نأخذ آخر مقطع فقط
          const normalizeIp = (ip: string) => {
            const s = (ip || '').trim();
            if (!s) return '';
            if (s.includes('.')) {
              const parts = s.split('.').map(p => p.trim()).filter(Boolean);
              return parts[parts.length - 1] || '';
            }
            return s;
          };
          const userMap = new Map<string, Customer[]>();
          const ipMap = new Map<string, Customer[]>();
          const addTo = (map: Map<string, Customer[]>, key: string, c: Customer) => {
            const k = (key || '').trim();
            if (!k) return;
            const arr = map.get(k) || [];
            if (!arr.find(x => x.id === c.id)) arr.push(c);
            map.set(k, arr);
          };
          scoped.forEach(c => {
            if (c.userName) addTo(userMap, c.userName.trim(), c);
            const mainIp = normalizeIp(c.ipNumber || '');
            if (mainIp) addTo(ipMap, mainIp, c);
            (c.additionalRouters || []).forEach(r => {
              if (r.userName) addTo(userMap, r.userName.trim(), c);
              const rIp = normalizeIp(r.ipNumber || '');
              if (rIp) addTo(ipMap, rIp, c);
            });
          });
          const q = poolSearch.trim().toLowerCase();
          const users = Array.from({ length: POOL_SIZE }, (_, i) => `ppp${i + 1}`);
          const ips = Array.from({ length: POOL_SIZE }, (_, i) => String(i + 1));
          const matchUser = (u: string) => !q || u.toLowerCase().includes(q);
          const matchIp = (ip: string) => !q || ip.includes(q);
          // التكرار يُحسب فقط إذا كان في نفس المدينة. عبر مدن مختلفة = مستخدم وليس مكرر.
          // إذا كان كل العملاء المستخدمين موقوفين → الحالة "موقوف" بدل "مستخدم/مكرر"
          const classify = (list: Customer[]): 'free' | 'used' | 'dup' | 'suspended' => {
            if (!list || list.length === 0) return 'free';
            const allSuspended = list.every(c => !!c.isSuspended);
            if (allSuspended) return 'suspended';
            if (list.length === 1) return 'used';
            const byCity = new Map<string, number>();
            list.forEach(c => byCity.set(c.cityId || '', (byCity.get(c.cityId || '') || 0) + 1));
            const anyDup = Array.from(byCity.values()).some(n => n >= 2);
            return anyDup ? 'dup' : 'used';
          };
          const stateOf = (list: Customer[] | undefined) => classify(list || []);
          const hasSuspended = (list: Customer[] | undefined) => !!list && list.some(c => !!c.isSuspended);
          const userStates = users.map(u => stateOf(userMap.get(u)));
          const ipStates = ips.map(ip => stateOf(ipMap.get(ip)));
          const freeU = userStates.filter(s => s === 'free').length;
          const usedU = userStates.filter(s => s === 'used').length;
          const dupU = userStates.filter(s => s === 'dup').length;
          const suspU = users.filter(u => { const l = userMap.get(u); return stateOf(l) === 'suspended' || hasSuspended(l); }).length;
          const freeI = ipStates.filter(s => s === 'free').length;
          const usedI = ipStates.filter(s => s === 'used').length;
          const dupI = ipStates.filter(s => s === 'dup').length;
          const suspI = ips.filter(ip => { const l = ipMap.get(ip); return stateOf(l) === 'suspended' || hasSuspended(l); }).length;
          const toggleFilter = (f: 'free' | 'used' | 'dup' | 'suspended') => setPoolFilter(prev => prev === f ? 'all' : f);
          const passFilter = (s: 'free' | 'used' | 'dup' | 'suspended', list?: Customer[]) => {
            if (poolFilter === 'all') return true;
            if (poolFilter === 'suspended') return s === 'suspended' || hasSuspended(list);
            return poolFilter === s;
          };
          return (
            <div className="section pool-section">
              <h2>🗂️ user number &amp; ip number</h2>
              <p className="section-info">عرض حالة كل يوزر ورقم IP من 1 إلى {POOL_SIZE}. اضغط على أي خانة مستخدمة أو مكررة لعرض العملاء. يمكنك اختيار أكثر من مدينة.</p>

              <div className="pool-filters">
                <div className="pool-cities">
                  <div className="pool-cities-header">
                    <span className="pool-cities-label">المدن:</span>
                    <button
                      type="button"
                      className="pool-city-chip all"
                      onClick={() => setPoolCityIds([])}
                      data-active={poolCityIds.length === 0}
                    >
                      جميع المدن
                    </button>
                    {poolCityIds.length > 0 && (
                      <button type="button" className="pool-city-clear" onClick={() => setPoolCityIds([])}>
                        مسح ({poolCityIds.length})
                      </button>
                    )}
                  </div>
                  <div className="pool-city-chips">
                    {cities.map(city => {
                      const active = poolCityIds.includes(city.id);
                      return (
                        <button
                          key={city.id}
                          type="button"
                          className="pool-city-chip"
                          data-active={active}
                          onClick={() => setPoolCityIds(prev => prev.includes(city.id) ? prev.filter(x => x !== city.id) : [...prev, city.id])}
                        >
                          {active ? '✓ ' : ''}{city.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <input
                  type="text"
                  className="input pool-search"
                  placeholder="ابحث برقم IP أو اسم اليوزر..."
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                />
              </div>

              <div className="pool-legend">
                <span className="pool-legend-item"><span className="pool-dot free"></span> غير مستخدم</span>
                <span className="pool-legend-item"><span className="pool-dot used"></span> مستخدم</span>
                <span className="pool-legend-item"><span className="pool-dot dup"></span> مكرر</span>
                <span className="pool-legend-item"><span className="pool-dot suspended"></span> موقوف</span>
                {poolFilter !== 'all' && (
                  <button type="button" className="pool-filter-clear" onClick={() => setPoolFilter('all')}>
                    إلغاء الفلتر ✕
                  </button>
                )}
              </div>

              <div className="pool-columns">
                <div className="pool-column">
                  <div className="pool-column-header">
                    <h3>اليوزرات (ppp1 - ppp{POOL_SIZE})</h3>
                    <div className="pool-stats">
                      <button type="button" className={`pool-stat free ${poolFilter === 'free' ? 'active' : ''}`} onClick={() => toggleFilter('free')}>غير مستخدم: {freeU}</button>
                      <button type="button" className={`pool-stat used ${poolFilter === 'used' ? 'active' : ''}`} onClick={() => toggleFilter('used')}>مستخدم: {usedU}</button>
                      <button type="button" className={`pool-stat dup ${poolFilter === 'dup' ? 'active' : ''}`} onClick={() => toggleFilter('dup')}>مكرر: {dupU}</button>
                      <button type="button" className={`pool-stat suspended ${poolFilter === 'suspended' ? 'active' : ''}`} onClick={() => toggleFilter('suspended')}>موقوف: {suspU}</button>
                    </div>
                  </div>
                  <div className="pool-grid">
                    {users.filter(matchUser).map(u => {
                      const list = userMap.get(u) || [];
                      const s = stateOf(list);
                      if (!passFilter(s, list)) return null;
                      const hasSusp = hasSuspended(list);
                      return (
                        <button
                          key={u}
                          type="button"
                          className={`pool-cell ${s}${hasSusp && s !== 'suspended' ? ' has-suspended' : ''}`}
                          onClick={() => { if (list.length) setPoolModal({ kind: 'user', value: u, customers: list }); }}
                          title={list.length ? `${list.length} عميل${hasSusp ? ' — يوجد موقوف' : ''}` : 'غير مستخدم'}
                        >
                          <span className="pool-cell-label">{u}</span>
                          {list.length > 1 && <span className="pool-cell-badge">{list.length}</span>}
                          {hasSusp && s !== 'suspended' && <span className="pool-cell-susp" title="يوجد عميل موقوف">⏸️</span>}
                        </button>
                      );
                    })}
                    {users.filter(matchUser).filter(u => passFilter(stateOf(userMap.get(u)), userMap.get(u))).length === 0 && (
                      <div className="pool-empty">لا توجد نتائج</div>
                    )}
                  </div>
                </div>

                <div className="pool-column">
                  <div className="pool-column-header">
                    <h3>أرقام IP (1 - {POOL_SIZE})</h3>
                    <div className="pool-stats">
                      <button type="button" className={`pool-stat free ${poolFilter === 'free' ? 'active' : ''}`} onClick={() => toggleFilter('free')}>غير مستخدم: {freeI}</button>
                      <button type="button" className={`pool-stat used ${poolFilter === 'used' ? 'active' : ''}`} onClick={() => toggleFilter('used')}>مستخدم: {usedI}</button>
                      <button type="button" className={`pool-stat dup ${poolFilter === 'dup' ? 'active' : ''}`} onClick={() => toggleFilter('dup')}>مكرر: {dupI}</button>
                      <button type="button" className={`pool-stat suspended ${poolFilter === 'suspended' ? 'active' : ''}`} onClick={() => toggleFilter('suspended')}>موقوف: {suspI}</button>
                    </div>
                  </div>
                  <div className="pool-grid">
                    {ips.filter(matchIp).map(ip => {
                      const list = ipMap.get(ip) || [];
                      const s = stateOf(list);
                      if (!passFilter(s, list)) return null;
                      const hasSusp = hasSuspended(list);
                      return (
                        <button
                          key={ip}
                          type="button"
                          className={`pool-cell ${s}${hasSusp && s !== 'suspended' ? ' has-suspended' : ''}`}
                          onClick={() => { if (list.length) setPoolModal({ kind: 'ip', value: ip, customers: list }); }}
                          title={list.length ? `${list.length} عميل${hasSusp ? ' — يوجد موقوف' : ''}` : 'غير مستخدم'}
                        >
                          <span className="pool-cell-label">{ip}</span>
                          {list.length > 1 && <span className="pool-cell-badge">{list.length}</span>}
                          {hasSusp && s !== 'suspended' && <span className="pool-cell-susp" title="يوجد عميل موقوف">⏸️</span>}
                        </button>
                      );
                    })}
                    {ips.filter(matchIp).filter(ip => passFilter(stateOf(ipMap.get(ip)), ipMap.get(ip))).length === 0 && (
                      <div className="pool-empty">لا توجد نتائج</div>
                    )}
                  </div>
                </div>
              </div>

              {poolModal && (
                <div className="modal-overlay" onClick={() => setPoolModal(null)}>
                  <div className="modal pool-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h3>
                        {poolModal.kind === 'user' ? `العملاء المستخدمين لليوزر: ${poolModal.value}` : `العملاء المستخدمين للـ IP: ${poolModal.value}`}
                      </h3>
                      <button className="modal-close" onClick={() => setPoolModal(null)}>×</button>
                    </div>
                    <div className="modal-body">
                      {poolModal.customers.length > 1 && (
                        <div className="pool-modal-warn">⚠️ هذا {poolModal.kind === 'user' ? 'اليوزر' : 'الـ IP'} مكرر على {poolModal.customers.length} عملاء</div>
                      )}
                      <table className="pool-modal-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>الاسم</th>
                            <th>المدينة</th>
                            <th>الجوال</th>
                            <th>Username</th>
                            <th>IP</th>
                            <th>ملاحظات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poolModal.customers.map((c, i) => {
                            const city = cities.find(x => x.id === c.cityId);
                            return (
                              <tr key={c.id} className={c.isSuspended ? 'row-suspended' : ''}>
                                <td>{i + 1}</td>
                                <td>
                                  {c.isSuspended && <span className="pool-suspended-badge" title="موقوف">⏸️ موقوف</span>}
                                  {c.name}
                                </td>
                                <td>{city?.name || '-'}</td>
                                <td>{c.phone || '-'}</td>
                                <td>{c.userName || '-'}</td>
                                <td>{c.ipNumber || '-'}</td>
                                <td className="pool-notes-cell">{c.notes ? c.notes : <span className="muted">—</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {activeTab === 'suspended' && (
          <div className="section suspended-section">
            <h2>⏸️ إيقاف مؤقت للعملاء</h2>
            <p className="suspended-info">العملاء الموقوفين لا يتم حساب فواتيرهم في الإيرادات</p>
            
            <div className="suspended-grid">
              {/* إيقاف عميل جديد */}
              <div className="suspended-card">
                <h3>إيقاف عميل</h3>
                <input
                  type="text"
                  className="input"
                  placeholder="ابحث بالاسم أو رقم الجوال..."
                  value={suspendSearch}
                  onChange={(e) => setSuspendSearch(e.target.value)}
                />
                {suspendSearch.trim() && (() => {
                  const searchResults = customers.filter(c => 
                    !c.isSuspended && 
                    (c.name.toLowerCase().includes(suspendSearch.toLowerCase()) || 
                     (c.phone && c.phone.includes(suspendSearch)) ||
                     (c.userName && c.userName.toLowerCase().includes(suspendSearch.toLowerCase())))
                  );
                  return searchResults.length > 0 ? (
                    <div className="suspend-search-results">
                      {searchResults.slice(0, 10).map(customer => {
                        const city = cities.find(c => c.id === customer.cityId);
                        return (
                          <div 
                            key={customer.id} 
                            className="suspend-search-item"
                            onClick={() => {
                              toggleSuspend(customer);
                              setSuspendSearch('');
                            }}
                          >
                            <span className="suspend-customer-name">{customer.name}</span>
                            <span className="suspend-customer-info">{city?.name} {customer.userName ? `- ${customer.userName}` : ''} {customer.phone ? `- ${customer.phone}` : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="suspend-search-results">
                      <div className="suspend-no-results">لا توجد نتائج</div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* قائمة العملاء الموقوفين */}
            <div className="suspended-list">
              <h3>📋 العملاء الموقوفين ({customers.filter(c => c.isSuspended).length})</h3>
              {customers.filter(c => c.isSuspended).length === 0 ? (
                <p className="no-suspended">لا يوجد عملاء موقوفين حالياً</p>
              ) : (
                <table className="suspended-table">
                  <thead>
                    <tr>
                      <th>اسم العميل</th>
                      <th>المدينة</th>
                      <th>قيمة الاشتراك</th>
                      <th>تاريخ الإيقاف</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.filter(c => c.isSuspended).map(customer => {
                      const city = cities.find(c => c.id === customer.cityId);
                      return (
                        <tr key={customer.id}>
                          <td>⏸️ {customer.name}</td>
                          <td>{city?.name || '-'}</td>
                          <td>{customer.subscriptionValue || 0} ﷼</td>
                          <td>{customer.suspendedDate ? formatDate(customer.suspendedDate) : '-'}</td>
                          <td>
                            <button 
                              onClick={() => toggleSuspend(customer)} 
                              className="btn success btn-sm"
                            >
                              إعادة التفعيل
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'towers' && (() => {
          let list = towerFilterCityId ? towers.filter(t => t.cityId === towerFilterCityId) : towers;
          if (towerStatusFilter !== 'all') list = list.filter(t => t.status === towerStatusFilter);
          if (towerSearch.trim()) {
            const q = towerSearch.trim().toLowerCase();
            list = list.filter(t =>
              t.deviceName.toLowerCase().includes(q) ||
              (t.ipNumber && t.ipNumber.toLowerCase().includes(q)) ||
              (t.towerNumber && t.towerNumber.toLowerCase().includes(q)) ||
              // البحث بأسماء العملاء المرتبطين بالبرج أو الـ IP أو اسم المستخدم
              customers.some(c => c.towerId === t.id && (
                c.name.toLowerCase().includes(q) ||
                (c.ipNumber && c.ipNumber.toLowerCase().includes(q)) ||
                (c.userName && c.userName.toLowerCase().includes(q))
              ))
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
                  placeholder="ابحث بالبرج أو باسم العميل أو IP العميل..."
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
                  const linkedCount = customers.filter(c => c.towerId === tower.id).length;
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
                        <button className="tower-users-btn" onClick={() => setTowerCustomersModal(tower)}>
                          👥 المستخدمون <span className="tower-users-count">{linkedCount}</span>
                        </button>
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

            {/* قائمة انتظار تعيين البرج — المستخدمون غير المعيّنين لأي برج */}
            {towers.length > 0 && (() => {
              const unassigned = customers
                .filter(c => !c.towerId && (!towerFilterCityId || c.cityId === towerFilterCityId))
                .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
              return (
                <div className="tower-queue">
                  <div className="tower-queue-header">
                    <span className="tower-queue-title">🕒 مستخدمون بانتظار تعيين برج</span>
                    <span className="tower-queue-count">{unassigned.length}</span>
                  </div>
                  {unassigned.length === 0 ? (
                    <p className="tower-queue-empty">{towerFilterCityId ? 'لا يوجد مستخدمون بانتظار التعيين في هذه المدينة ✅' : 'كل المستخدمين معيّنون لأبراج ✅'}</p>
                  ) : (
                    <div className="tower-queue-list">
                      {unassigned.map(c => {
                        const cityName = cities.find(ct => ct.id === c.cityId)?.name;
                        const cityTowers = towers
                          .filter(t => t.cityId === c.cityId)
                          .sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'ar'));
                        return (
                          <div key={c.id} className="tower-queue-row">
                            <div className="tower-queue-info tower-user-info-clickable" onClick={() => openCustomerDetails(c)} title="عرض معلومات العميل الكاملة">
                              <strong>{c.name} <span className="tower-user-info-hint">ℹ️</span></strong>
                              <span className="small">{c.userName || '-'} • {c.ipNumber || '-'}{cityName ? ` • ${cityName}` : ''}</span>
                            </div>
                            {cityTowers.length === 0 ? (
                              <span className="tower-queue-notower">لا أبراج في مدينته</span>
                            ) : (
                              <select
                                className="tower-queue-select"
                                value=""
                                onChange={(e) => { if (e.target.value) setCustomerTower(c, e.target.value); }}
                              >
                                <option value="">— عيّن لبرج —</option>
                                {cityTowers.map(t => (
                                  <option key={t.id} value={t.id}>{t.deviceName}{t.towerNumber ? ` (${t.towerNumber})` : ''}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          );
        })()}

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
          const statusMatch = (c: Customer) => {
            if (waStatusFilter === 'all') return true;
            return statusOf(c) === waStatusFilter;
          };
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
            setWaQueue(ids);
            setWaQueuePos(1);
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
                <input
                  type="text"
                  className="cards-search-input"
                  placeholder="ابحث بالاسم أو رقم الجوال أو IP Number..."
                  value={waSearch}
                  onChange={(e) => setWaSearch(e.target.value)}
                />
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

            {/* فلتر الشهر — يحدّد حالة السداد لشهر معيّن بدل الحالة العامة */}
            <div className="wa-toolbar wa-month-toolbar">
              <label className="wa-month-label">الشهر:</label>
              <select className="cards-select" value={waMonth} onChange={(e) => { setWaMonth(Number(e.target.value)); setWaSelected([]); }}>
                <option value={0}>الحالة العامة (بدون شهر)</option>
                {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select className="cards-select" value={waYear} onChange={(e) => { setWaYear(Number(e.target.value)); setWaSelected([]); }} disabled={waMonth === 0}>
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {waMonth > 0 && (
                <span className="wa-month-hint">الفلترة حسب سداد {MONTHS_AR[waMonth - 1]} {waYear}</span>
              )}
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

      {/* Tower Customers Modal — مستخدمو البرج */}
      {towerCustomersModal && (() => {
        const tower = towers.find(t => t.id === towerCustomersModal.id) || towerCustomersModal;
        const linked = customers
          .filter(c => c.towerId === tower.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        return (
          <div className="modal-overlay" onClick={() => setTowerCustomersModal(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>مستخدمو البرج: {tower.deviceName}</h3>
                <button onClick={() => setTowerCustomersModal(null)} className="modal-close">×</button>
              </div>
              <div className="modal-body">
                <p className="small" style={{ opacity: 0.7, marginBottom: 12 }}>لإضافة مستخدم لهذا البرج، عيّنه من «قائمة انتظار تعيين البرج» في أسفل صفحة الأبراج.</p>
                <div className="section-title-small">المستخدمون المرتبطون ({linked.length})</div>
                {linked.length === 0 ? (
                  <p className="small" style={{ opacity: 0.6 }}>لا يوجد مستخدمون مرتبطون بهذا البرج بعد</p>
                ) : (
                  <div className="tower-users-list">
                    {linked.map(c => {
                      const cityName = cities.find(ct => ct.id === c.cityId)?.name;
                      return (
                        <div key={c.id} className="tower-user-row">
                          <div className="tower-user-info tower-user-info-clickable" onClick={() => openCustomerDetails(c)} title="عرض معلومات العميل الكاملة">
                            <strong>{c.name} <span className="tower-user-info-hint">ℹ️</span></strong>
                            <span className="small">{c.userName || '-'} • {c.ipNumber || '-'}{cityName ? ` • ${cityName}` : ''}</span>
                          </div>
                          <button className="btn danger btn-sm" onClick={() => { setPendingUnlinkCustomer(c); setUnlinkPassword(''); }}>إزالة</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button onClick={() => setTowerCustomersModal(null)} className="btn secondary">إغلاق</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unlink Customer Password Modal — كلمة مرور إزالة المستخدم من البرج */}
      {pendingUnlinkCustomer && (
        <div className="modal-overlay" onClick={() => { setPendingUnlinkCustomer(null); setUnlinkPassword(''); }}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>تأكيد إزالة المستخدم</h3>
              <button onClick={() => { setPendingUnlinkCustomer(null); setUnlinkPassword(''); }} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text" style={{ marginBottom: '20px' }}>
                لإزالة <strong>{pendingUnlinkCustomer.name}</strong> من البرج، أدخل كلمة المرور
              </p>
              <div className="edit-field">
                <label>كلمة المرور</label>
                <input
                  type="password"
                  placeholder="كلمة المرور"
                  value={unlinkPassword}
                  onChange={(e) => setUnlinkPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmUnlinkCustomer()}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => { setPendingUnlinkCustomer(null); setUnlinkPassword(''); }} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmUnlinkCustomer)}<button onClick={() => confirmUnlinkCustomer()} className="btn danger" disabled={unlinkLoading}>
                {unlinkLoading ? 'جاري التحقق...' : 'إزالة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Customer Modal */}
      {transferModal && transferCustomer && (
        <div className="modal-overlay" onClick={() => setTransferModal(false)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>نقل العميل إلى مدينة أخرى</h3>
              <button onClick={() => setTransferModal(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                نقل العميل <strong>{transferCustomer.name}</strong> إلى مدينة جديدة
              </p>
              <div className="edit-field">
                <label>اختر المدينة الجديدة</label>
                <select 
                  value={transferCityId} 
                  onChange={(e) => setTransferCityId(e.target.value)}
                  className="input"
                >
                  <option value="">-- اختر المدينة --</option>
                  {cities
                    .filter(city => city.id !== transferCustomer.cityId)
                    .map(city => (
                      <option key={city.id} value={city.id}>{city.name}</option>
                    ))}
                </select>
              </div>
              <div className="edit-field">
                <label>كلمة المرور للتأكيد</label>
                <input 
                  type="password" 
                  value={transferPassword}
                  onChange={(e) => setTransferPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="input"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setTransferModal(false)} className="btn secondary" disabled={transferLoading}>
                إلغاء
              </button>
              {bioConfirmBtn(confirmTransferCustomer)}<button onClick={() => confirmTransferCustomer()} className="btn primary" disabled={transferLoading}>
                {transferLoading ? 'جاري النقل...' : 'تأكيد النقل'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card Delete Confirm Modal */}
      {cardDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setCardDeleteConfirm(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>حذف بطاقة</h3>
              <button onClick={() => setCardDeleteConfirm(null)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                هل تريد حذف البطاقة <strong>{cardDeleteConfirm.cardNumber}</strong> ({cardDeleteConfirm.package} - {cardDeleteConfirm.value} ﷼)؟
              </p>
              <div className="edit-field">
                <label>أدخل كلمة المرور للتأكيد</label>
                <input
                  type="password"
                  value={cardDeletePassword}
                  onChange={(e) => setCardDeletePassword(e.target.value)}
                  placeholder="كلمة المرور"
                  onKeyDown={(e) => e.key === 'Enter' && confirmDeleteCard()}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setCardDeleteConfirm(null)} className="btn secondary">إلغاء</button>
              {bioConfirmBtn(confirmDeleteCard)}<button onClick={() => confirmDeleteCard()} className="btn danger" disabled={cardDeleteLoading}>
                {cardDeleteLoading ? 'جاري الحذف...' : 'حذف'}
              </button>
            </div>
          </div>
        </div>
      )}

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
              {bioConfirmBtn(confirmDeleteTower)}<button onClick={() => confirmDeleteTower()} className="btn danger" disabled={towerDeleteLoading}>
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
                          <button className="chat-download-btn" onClick={() => downloadFile(m.mediaUrl!, m.fileName || 'image.jpg')} title="تحميل الصورة">⬇️ تحميل</button>
                        </div>
                      )}
                      {m.mediaUrl && m.mediaType === 'video' && (
                        <div className="chat-media-wrap">
                          <video className="chat-msg-media" src={m.mediaUrl} controls />
                          <button className="chat-download-btn" onClick={() => downloadFile(m.mediaUrl!, m.fileName || 'video.mp4')} title="تحميل الفيديو">⬇️ تحميل</button>
                        </div>
                      )}
                      {m.mediaUrl && m.mediaType === 'file' && (
                        <button className="chat-file-card" onClick={() => downloadFile(m.mediaUrl!, m.fileName || 'file')} title="اضغط للتحميل">
                          <span className="chat-file-icon">{fileIcon(m.fileName)}</span>
                          <span className="chat-file-info">
                            <span className="chat-file-name">{m.fileName || 'ملف'}</span>
                            <span className="chat-file-size">{formatFileSize(m.fileSize)} • اضغط للتحميل</span>
                          </span>
                          <span className="chat-file-dl">⬇️</span>
                        </button>
                      )}
                      <div className="chat-msg-footer">
                        <span className="chat-msg-time">{new Date(m.createdAt).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
                        <span className="chat-msg-actions">
                          <button
                            className={`chat-pin-btn ${m.pinned ? 'active' : ''}`}
                            onClick={() => toggleChatPin(m)}
                            title={m.pinned ? 'إلغاء التثبيت (ستُحذف بعد ٣ أشهر)' : 'تثبيت الرسالة (تمنع حذفها التلقائي)'}
                          >
                            📌
                          </button>
                          {mine && (
                            <button
                              className="chat-del-btn"
                              onClick={() => setChatDeleteConfirm(m)}
                              title="حذف رسالتي"
                            >
                              🗑️
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input-bar">
              <label className="chat-attach" title="إرسال صورة أو فيديو أو ملف">
                📎
                <input type="file" hidden disabled={chatUploading} onChange={(e) => { sendChatMedia(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <input
                type="text"
                className="chat-text-input"
                placeholder={chatUploading ? 'جارٍ رفع الملف...' : 'اكتب رسالة...'}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChatMessage(); }}
                disabled={chatUploading}
              />
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
                  <button type="button" className="password-eye" onClick={() => setShowProfileEmailPw(v => !v)} title={showProfileEmailPw ? 'إخفاء' : 'إظهار'} tabIndex={-1}>{showProfileEmailPw ? '🙈' : '👁️'}</button>
                </div>
                {bioConfirmBtn(saveProfileEmail)}<button className="btn primary profile-full-btn" onClick={() => saveProfileEmail()} disabled={profileEmailBusy}>
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
                  <button type="button" className="password-eye" onClick={() => setShowProfileCurPw(v => !v)} title={showProfileCurPw ? 'إخفاء' : 'إظهار'} tabIndex={-1}>{showProfileCurPw ? '🙈' : '👁️'}</button>
                </div>
                <div className="password-input-wrap">
                  <input type={showProfileNewPw ? 'text' : 'password'} value={profileNewPassword} onChange={(e) => setProfileNewPassword(e.target.value)} placeholder="كلمة المرور الجديدة" />
                  <button type="button" className="password-eye" onClick={() => setShowProfileNewPw(v => !v)} title={showProfileNewPw ? 'إخفاء' : 'إظهار'} tabIndex={-1}>{showProfileNewPw ? '🙈' : '👁️'}</button>
                </div>
                <div className="password-input-wrap">
                  <input type={showProfileConfPw ? 'text' : 'password'} value={profileConfirmPassword} onChange={(e) => setProfileConfirmPassword(e.target.value)} placeholder="تأكيد كلمة المرور الجديدة" />
                  <button type="button" className="password-eye" onClick={() => setShowProfileConfPw(v => !v)} title={showProfileConfPw ? 'إخفاء' : 'إظهار'} tabIndex={-1}>{showProfileConfPw ? '🙈' : '👁️'}</button>
                </div>
                {bioConfirmBtn(saveProfilePassword)}<button className="btn primary profile-full-btn" onClick={() => saveProfilePassword()} disabled={profilePasswordBusy}>
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
                <input
                  type="password"
                  placeholder="كلمة المرور"
                  value={bioSetupPassword}
                  onChange={(e) => setBioSetupPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmEnableBiometric()}
                  autoFocus
                />
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

      {toastMessage && <div className="toast">{toastMessage}</div>}
    </div>
  );
}

export default App;

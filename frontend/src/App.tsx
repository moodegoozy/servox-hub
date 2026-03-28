import { FormEvent, useEffect, useMemo, useState } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { collection, doc, getDocs, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';

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

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const [toastMessage, setToastMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'invoices' | 'yearly' | 'revenues' | 'discounts' | 'suspended' | 'expenses' | 'customers-db'>('dashboard');
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

  const confirmDiscountDelete = async () => {
    if (!discountDeleteConfirm || !discountDeletePassword.trim()) {
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
      const credential = EmailAuthProvider.credential(user.email, discountDeletePassword);
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
  const confirmEditFinance = async () => {
    if ((!pendingEditExpense && !pendingEditIncome) || !editFinancePassword.trim()) {
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

      const credential = EmailAuthProvider.credential(user.email, editFinancePassword);
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

  const confirmDeleteCard = async () => {
    if (!cardDeleteConfirm || !cardDeletePassword.trim()) { setToastMessage('أدخل كلمة المرور'); return; }
    setCardDeleteLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) { setToastMessage('خطأ في المصادقة'); return; }
      const credential = EmailAuthProvider.credential(user.email, cardDeletePassword);
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
  const confirmFinanceDelete = async () => {
    if (!financeDeleteConfirm || !financeDeletePassword.trim()) {
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
      const credential = EmailAuthProvider.credential(user.email, financeDeletePassword);
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

  // Load data from Firestore on mount
  useEffect(() => {
    if (!isAuthenticated) return;

    setLoading(true);

    // Listen to cities collection
    const unsubscribeCities = onSnapshot(collection(db, 'cities'), (snapshot) => {
      const citiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as City));
      setCities(citiesData);
    });

    // Listen to customers collection
    const unsubscribeCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      const customersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer));
      setCustomers(customersData);
      setLoading(false);
    });

    // Listen to expenses collection
    const unsubscribeExpenses = onSnapshot(collection(db, 'expenses'), (snapshot) => {
      const expensesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
      setExpenses(expensesData);
    });

    // Listen to incomes collection
    const unsubscribeIncomes = onSnapshot(collection(db, 'incomes'), (snapshot) => {
      const incomesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Income));
      setIncomes(incomesData);
    });

    // Listen to cards collection
    const unsubscribeCards = onSnapshot(collection(db, 'cards'), (snapshot) => {
      const cardsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Card));
      setCards(cardsData);
    });

    return () => {
      unsubscribeCities();
      unsubscribeCustomers();
      unsubscribeExpenses();
      unsubscribeIncomes();
      unsubscribeCards();
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

  const confirmDelete = async () => {
    if (!deleteConfirm || !deletePassword.trim()) {
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
      const credential = EmailAuthProvider.credential(user.email, deletePassword);
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

  const confirmTransferCustomer = async () => {
    if (!transferCustomer || !transferCityId || !transferPassword.trim()) {
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
      const credential = EmailAuthProvider.credential(user.email, transferPassword);
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

  const confirmEditPassword = async () => {
    if (!pendingEditCustomer || !editPassword.trim()) {
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

      const credential = EmailAuthProvider.credential(user.email, editPassword);
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
        <div className="search-box">
          <input 
            type="text"
            placeholder={
              activeTab === 'expenses'
                ? 'البحث غير متاح في هذا التبويب'
                : activeTab === 'discounts'
                ? 'ابحث في العملاء بالخصم...'
                : activeTab === 'suspended'
                ? 'ابحث في العملاء الموقوفين...'
                : 'ابحث عن عميل بالاسم أو الرقم...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
            disabled={activeTab === 'expenses'}
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
        <div className="modal-overlay" onClick={() => setShowCustomerModal(false)}>
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
              <button onClick={confirmDelete} className="btn danger" disabled={deleteLoading}>
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
              <button onClick={confirmFinanceDelete} className="btn danger" disabled={financeDeleteLoading}>
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
              <button onClick={confirmDiscountDelete} className="btn danger" disabled={discountDeleteLoading}>
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
              <button onClick={confirmEditFinance} className="btn primary" disabled={editFinanceLoading}>
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
              <button onClick={confirmEditPassword} className="btn primary" disabled={editLoading}>
                {editLoading ? 'جاري التحقق...' : 'متابعة'}
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
              <button onClick={confirmTransferCustomer} className="btn primary" disabled={transferLoading}>
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
              <button onClick={confirmDeleteCard} className="btn danger" disabled={cardDeleteLoading}>
                {cardDeleteLoading ? 'جاري الحذف...' : 'حذف'}
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

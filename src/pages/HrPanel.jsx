import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiConfig";

const STATUS_LABELS = {
  ACTIVE: "В штате",
  FIRED: "Уволен",
};

const statusPills = {
  ACTIVE: { background: "#dcfce7", color: "#166534", border: "#86efac" },
  FIRED: { background: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
};

const TEMPLATES = [
  {
    id: "ktu",
    name: "Табель учета рабочего времени (КТУ)",
    description: "Макрос Excel для автоматизации расчета и выгрузки табеля.",
    file: "/templates/tabel_ktu.xlsm",
  },
  {
    id: "money",
    name: "Табель (не утвержденный/черновик)",
    description: "Черновик для учета времени и начислений.",
    file: "/templates/табель_черновик.xlsm",
  },
];

const HR_ACTIONS = [
  { id: "hire", title: "Прием на работу", desc: "Оформить, внести, загрузить документы", icon: "👥" },
  { id: "vacation", title: "Отпуск / БС", desc: "Создать заявление, проверить остатки", icon: "📝" },
  { id: "transfer", title: "Перевод / рост", desc: "Переводы, повышение, перемещения", icon: "🔄" },
  { id: "fire", title: "Увольнение", desc: "Оформить приказ, заявление, закрыть доступы", icon: "❌" },
];

const EMPLOYMENT_TEMPLATES = [
  {
    id: "agreement",
    title: "Трудовой договор (универсальный)",
    desc: "Плейсхолдеры: работодатель, работник, должность, оклад, график, адрес, испытательный срок, реквизиты.",
    file: "/templates/employment/trudovoi_dogovor.docx",
    preview:
      "Трудовой договор между [Работодатель] и [Работник]. Должность: [Должность], оклад: [Оклад], место работы: [Адрес], график: [График], испытательный срок: [ИспытательныйСрок]. Обязанности/права/ответственность. Реквизиты сторон. Подписи, дата «__» ______ 20__ г.",
  },
  {
    id: "pd-processing",
    title: "Согласие на обработку ПД",
    desc: "152-ФЗ + гл.14 ТК РФ: цели, срок, способы обработки, право отзыва.",
    file: "/templates/employment/soglasie_pd.docx",
    preview:
      "Согласие на обработку персональных данных. ФИО: [ФИО], паспорт [Паспорт], работодатель: [Работодатель]. Цели: [Цель], состав ПД: [Состав], срок хранения: [Срок]. Способы: хранение, передача, уничтожение. Отзыв: письменное заявление. Подпись, дата.",
  },
  {
    id: "pd-distribution",
    title: "Согласие на распространение ПД",
    desc: "Отдельное согласие на публикацию/передачу, с возможностью отзыва.",
    file: "/templates/employment/soglasie_rasprostranenie_pd.docx",
    preview:
      "Согласие на распространение ПД. Разрешаю передавать/публиковать ПД: [Перечень], каналы: [Каналы], срок: [Срок], условия отзыва: письменное заявление. Подпись, дата.",
  },
  {
    id: "application",
    title: "Заявление о приеме на работу",
    desc: "По практике: прошу принять, должность, дата выхода, оклад/согласен.",
    file: "/templates/employment/zayavlenie_priem.docx",
    preview:
      "Прошу принять меня, [ФИО], на должность [Должность] с «__» ______ 20__ г. Оклад/ставка: [Оклад]. С условиями работы ознакомлен. Подпись, дата.",
  },
  {
    id: "lna-sheet",
    title: "Лист ознакомления с ЛНА",
    desc: "Таблица: документ, дата, подпись сотрудника.",
    file: "/templates/employment/list_oznakomlenia_lna.docx",
    preview: "Таблица: Наименование ЛНА | Дата ознакомления | Подпись сотрудника. Перечень: ПВТР, оплата труда, ПД, ОТ, ДИ и др.",
  },
  {
    id: "pd-third",
    title: "Согласие на передачу ПД третьим лицам",
    desc: "Для аутсорсинга, подрядчиков, облачных сервисов.",
    file: "/templates/employment/soglasie_peredacha_pd.docx",
    preview:
      "Согласие на передачу ПД третьим лицам. Получатели: [Получатели], цель: [Цель], срок: [Срок], перечень ПД: [Перечень], способы: [Способы]. Отзыв: письменное заявление. Подпись, дата.",
  },
  {
    id: "material",
    title: "Соглашение о мат. ответственности",
    desc: "Опционально для МОЛ/кладовщиков/кассиров.",
    file: "/templates/employment/soglashenie_mat_otvet.docx",
    preview:
      "Соглашение о материальной ответственности. МОЛ: [ФИО], должность: [Должность]. Перечень вверенного имущества, обязанности по сохранности, инвентаризация, порядок отчетности и возмещения. Подписи сторон, дата.",
  },
];

const EMPLOYMENT_SOURCES = [
  { name: "ТК РФ ст. 65 — документы при приеме", url: "https://base.garant.ru/12125268/d4d1c020f5ac1ff694cd399cf1a90fc2/" },
  { name: "ТК РФ ст. 57 — обязательные условия договора", url: "https://base.garant.ru/12125268/089b4a5b96814c6974a9dc40194feaf2/" },
  { name: "Пошаговый прием (Контур)", url: "https://kontur.ru/articles/2549" },
  { name: "Чек-лист прием на работу (Консультант)", url: "https://www.consultant.ru/law/podborki/chek_list_priem_na_rabotu/" },
  { name: "Согласие на распространение ПД (подборка)", url: "https://www.consultant.ru/law/podborki/obrazec_soglasiya_na_rasprostranenie_personalnyh_dannyh/" },
  { name: "Форум кадровиков", url: "https://www.kadrovik-praktik.ru/communication/forum/forum3/" },
];

const EMPLOYMENT_STEPS = [
  { id: "docs", title: "Сбор документов от сотрудника" },
  { id: "checks", title: "Проверки/условия (воинский учет, образование, справки)" },
  { id: "contract", title: "Подготовка и подписание трудового договора" },
  { id: "order", title: "Приказ, оформление, ознакомление с ЛНА" },
  { id: "consents", title: "Согласия по персональным данным (при необходимости)" },
  { id: "access", title: "Доступы и адаптация (чек-лист первого дня)" },
];

const HIRE_STEPS = [
  {
    title: "Сбор документов от кандидата",
    items: [
      "Паспорт, СНИЛС, ИНН, воинский учет (при наличии), медкнижка для склада с продуктами.",
      "Заявление о приеме, согласия на ПДн/биометрию (если требуется), уведомление о дистанционке при удаленной работе.",
      "Диплом/удостоверения, допуски, водительские категории — по должности.",
    ],
  },
  {
    title: "Оформление по ТК РФ",
    items: [
      "Трудовой договор с режимом работы, оплатой, компенсациями (ст. 57 ТК РФ).",
      "Приказ о приеме (Т-1/Т-1а), личная карточка Т-2, ознакомление с ПВТР, ДИ, охраной труда.",
      "Внесение в СЗВ-ТД/электронную трудовую книжку, выдача экземпляра договора и приказа.",
    ],
  },
  {
    title: "Охрана труда и доступ",
    items: [
      "Вводный инструктаж, первичный на рабочем месте, повторный — по графику; журналы подписей.",
      "Назначить ответственного за СИЗ, выдать каску/жилет/перчатки, оформить карточку учета СИЗ.",
      "Пропуск, доступ в WMS/1С, настроить роли, добавить в чат смены.",
    ],
  },
  {
    title: "Финальные действия",
    items: [
      "Добавить в график смен/табель, проверить начисление отпуска с даты приема.",
      "Передать данные в бухгалтерию/зарплатный проект, настроить удержания (авансы, ДМС, столовая).",
      "Поставить контрольные даты: испытательный срок, медосмотр, повторный инструктаж.",
    ],
  },
];

const HIRE_DOCS = [
  { name: "Заявление о приеме на работу", file: null },
  { name: "Трудовой договор (склад)", file: null },
  { name: "Приказ о приеме (Т-1/Т-1а)", file: null },
  { name: "Личная карточка Т-2", file: null },
  { name: "Согласие на обработку персональных данных", file: null },
  { name: "Журналы: вводный, на рабочем месте, целевой инструктаж", file: null },
  { name: "Карточка учета выдачи СИЗ", file: null },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU");
}

function diffDaysInclusive(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  return Math.max(0, Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

function normalizeDateInput(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const ru = String(value).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) {
    const [, dd, mm, yyyy] = ru;
    return `${yyyy}-${mm}-${dd}`;
  }
  return value;
}

function openPrintWindow(docText) {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const styles = `
    <style>
      @page { size: A4; margin: 20mm 20mm 20mm 25mm; }
      body { font-family: "Times New Roman", serif; font-size: 18px; margin: 0; color: #111; }
      .sheet { width: 100%; min-height: 60vh; display: flex; justify-content: center; }
      .paper { width: 70%; margin-top: 25mm; line-height: 1.6; }
      .doc-header { text-align: right; line-height: 1.7; margin-bottom: 24px; }
      .doc-title { text-align: center; font-weight: 700; margin: 18px 0; font-size: 20px; }
      .doc-body { margin: 0 0 18px 0; }
      .doc-meta { margin-top: 6px; color: #444; }
      .doc-date { margin: 16px 0 6px 0; }
      .doc-note { font-size: 12px; color: #666; font-style: italic; }
      .doc-sign { margin-top: 12px; }
    </style>
  `;
  win.document.write(
    `<html><head><title>Заявление</title>${styles}</head><body><div class="sheet"><div class="paper">${docText}</div></div><script>window.print();</script></body></html>`
  );
  win.document.close();
}

export default function HrPanel() {
  const [section, setSection] = useState("employees");
  const [employeeTab, setEmployeeTab] = useState("register");
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    birthDate: "",
    position: "",
    department: "",
    telegramChatId: "",
    hiredAt: "",
  });
  const [editSaving, setEditSaving] = useState(false);

  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search, setSearch] = useState("");

  const [form, setForm] = useState(() => ({
    fullName: "",
    birthDate: "",
    position: "",
    department: "",
    telegramChatId: "",
    hiredAt: todayStr(),
  }));

  const [leaveTab, setLeaveTab] = useState("PAID");
  const [leaveForm, setLeaveForm] = useState(() => ({
    employeeId: "",
    type: "PAID",
    startDate: todayStr(),
    endDate: todayStr(),
    reason: "",
  }));
  const [terminationForm, setTerminationForm] = useState(() => ({
    employeeId: "",
    date: todayStr(),
    reason: "",
  }));
  const [leaveBalance, setLeaveBalance] = useState({
    accruedDays: 0,
    usedDays: 0,
    availableDays: 0,
  });
  const [safetyTab, setSafetyTab] = useState("periodicity");
  const [selectedAction, setSelectedAction] = useState("hire");
  const [employmentSection, setEmploymentSection] = useState("master");
  const [employmentFilter, setEmploymentFilter] = useState("office");
  const [employmentProgress, setEmploymentProgress] = useState(() => {
    try {
      const saved = localStorage.getItem("employment_progress");
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [leaveDays, setLeaveDays] = useState(1);
  const [leavePreview, setLeavePreview] = useState(null);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  const [safetyInstructions, setSafetyInstructions] = useState([]);
  const [safetyAssignments, setSafetyAssignments] = useState([]);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyError, setSafetyError] = useState("");
  const [safetyResources, setSafetyResources] = useState({ instructions: [], journals: [] });

  const token = localStorage.getItem("token");
  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token]
  );

  const loadEmployees = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiFetch(`/hr/employees`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось загрузить сотрудников");
      setEmployees(data);
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSafetyData = async () => {
    try {
      setSafetyLoading(true);
      setSafetyError("");
      const [instrRes, assignRes, resRes] = await Promise.all([
        apiFetch(`/safety/instructions`, { headers: authHeaders }),
        apiFetch(`/safety/assignments`, { headers: authHeaders }),
        apiFetch(`/safety/resources`, { headers: authHeaders }),
      ]);
      const instrData = await instrRes.json();
      const assignData = await assignRes.json();
      const resData = await resRes.json();
      if (!instrRes.ok) throw new Error(instrData.message || "Не удалось загрузить инструкции");
      if (!assignRes.ok) throw new Error(assignData.message || "Не удалось загрузить статусы инструктажей");
      if (!resRes.ok) throw new Error(resData.message || "Не удалось загрузить материалы");
      setSafetyInstructions(instrData);
      setSafetyAssignments(assignData);
      setSafetyResources(resData);
    } catch (e) {
      console.error(e);
      setSafetyError(e.message);
    } finally {
      setSafetyLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    setLeaveForm({
      employeeId: "",
      type: leaveTab,
      startDate: todayStr(),
      endDate: todayStr(),
      reason: "",
    });
    setLeaveBalance({ accruedDays: 0, usedDays: 0, availableDays: 0 });
    setLeavePreview(null);
    setLeaveError("");
    setLeaveDays(1);
    setTerminationForm({ employeeId: "", date: todayStr(), reason: "" });
  }, [leaveTab]);

  useEffect(() => {
    setLeaveDays(diffDaysInclusive(leaveForm.startDate, leaveForm.endDate));
  }, [leaveForm.startDate, leaveForm.endDate]);

  useEffect(() => {
    if (section === "safety") loadSafetyData();
  }, [section]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((emp) => {
      const byStatus = filterStatus === "ALL" || emp.status === filterStatus;
      const byText =
        !term ||
        emp.fullName?.toLowerCase().includes(term) ||
        emp.department?.toLowerCase().includes(term) ||
        emp.position?.toLowerCase().includes(term);
      return byStatus && byText;
    });
  }, [employees, filterStatus, search]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const fullName = form.fullName.trim();
      const birthDate = normalizeDateInput(form.birthDate);
      const position = form.position.trim();
      const department = form.department.trim();
      const telegramChatId = form.telegramChatId.trim();
      const hiredAt = normalizeDateInput(form.hiredAt);

      if (!fullName || !birthDate || !position || !department || !telegramChatId || !hiredAt) {
        throw new Error("Заполните все поля, включая ID Telegram.");
      }

      const body = {
        fullName,
        birthDate,
        position,
        department,
        telegramChatId,
        status: "ACTIVE",
        hiredAt,
      };
      const res = await apiFetch(`/hr/employees`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось создать карточку сотрудника");
      setEmployees((prev) => [data, ...prev]);
      setForm({
        fullName: "",
        birthDate: "",
        position: "",
        department: "",
        telegramChatId: "",
        hiredAt: todayStr(),
      });
      loadSafetyData();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditStart = (emp) => {
    setEditEmployeeId(emp.id);
    setEditForm({
      fullName: emp.fullName || "",
      birthDate: emp.birthDate ? emp.birthDate.slice(0, 10) : "",
      position: emp.position || "",
      department: emp.department || "",
      telegramChatId: emp.telegramChatId || "",
      hiredAt: emp.hiredAt ? emp.hiredAt.slice(0, 10) : "",
    });
    setError("");
  };

  const handleEditCancel = () => {
    setEditEmployeeId(null);
    setEditForm({
      fullName: "",
      birthDate: "",
      position: "",
      department: "",
      telegramChatId: "",
      hiredAt: "",
    });
  };

  const handleEditSave = async (id) => {
    setEditSaving(true);
    setError("");
    try {
      const fullName = editForm.fullName.trim();
      const birthDate = normalizeDateInput(editForm.birthDate);
      const position = editForm.position.trim();
      const department = editForm.department.trim();
      const telegramChatId = editForm.telegramChatId.trim();
      const hiredAt = normalizeDateInput(editForm.hiredAt);

      if (!fullName || !birthDate || !position || !department || !telegramChatId || !hiredAt) {
        throw new Error("Заполните все поля, включая ID Telegram.");
      }

      const res = await apiFetch(`/hr/employees/${id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          fullName,
          birthDate,
          position,
          department,
          telegramChatId,
          hiredAt,
        }),
      });
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }
      if (!res.ok) throw new Error(data?.message || "Не удалось обновить данные сотрудника");
      const updatedEmployee = data || {
        id,
        fullName,
        birthDate,
        position,
        department,
        telegramChatId,
        hiredAt,
      };
      setEmployees((prev) => prev.map((emp) => (emp.id === id ? { ...emp, ...updatedEmployee } : emp)));
      handleEditCancel();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleSelectEmployee = async (value) => {
    const empId = value || "";
    setLeaveForm((prev) => ({ ...prev, employeeId: empId }));
    setLeavePreview(null);
    setLeaveError("");
    if (empId && leaveTab === "PAID") {
      await handleLoadBalance(empId);
    } else {
      setLeaveBalance({ accruedDays: 0, usedDays: 0, availableDays: 0 });
    }
  };

  const handleLoadBalance = async (employeeId) => {
    if (!employeeId) {
      setLeaveBalance({ accruedDays: 0, usedDays: 0, availableDays: 0 });
      return;
    }
    try {
      const res = await apiFetch(`/hr/employees/${employeeId}/leave-balance`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось получить баланс отпуска");
      setLeaveBalance(data);
    } catch (e) {
      console.error(e);
      setLeaveError(e.message);
    }
  };

  const handleLeaveField = (key, value) => {
    setLeaveForm((prev) => {
      const next = { ...prev, [key]: value };
      setLeaveDays(diffDaysInclusive(next.startDate, next.endDate));
      return next;
    });
  };
  const handleGenerateLeave = async (e) => {
    e.preventDefault();
    setLeaveSaving(true);
    setLeaveError("");
    setLeavePreview(null);
    try {
      if (leaveTab === "TERMINATION") {
        if (!terminationForm.employeeId) throw new Error("Выберите сотрудника");

        const res = await apiFetch(`/hr/leave-applications`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            employeeId: terminationForm.employeeId,
            type: "TERMINATION",
            startDate: normalizeDateInput(terminationForm.date),
            endDate: normalizeDateInput(terminationForm.date),
            reason: terminationForm.reason,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Не удалось сформировать увольнение");

        setLeavePreview({ docText: data.docText, id: data.id });
        setEmployees((prev) =>
          prev.map((emp) => (emp.id === Number(terminationForm.employeeId) ? { ...emp, status: "FIRED" } : emp))
        );
      } else {
        if (!leaveForm.employeeId) throw new Error("Выберите сотрудника");

        const res = await apiFetch(`/hr/leave-applications`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ...leaveForm,
            startDate: normalizeDateInput(leaveForm.startDate),
            endDate: normalizeDateInput(leaveForm.endDate),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Не удалось сформировать заявление");

        setLeavePreview({ docText: data.docText, id: data.id });
        setLeaveBalance({
          accruedDays: data.accruedDays,
          usedDays: data.usedDays,
          availableDays: data.availableDays,
        });
      }
    } catch (e) {
      console.error(e);
      setLeaveError(e.message);
    } finally {
      setLeaveSaving(false);
    }
  };

  const handleCompleteInstruction = async (assignmentId) => {
    try {
      setSafetyError("");
      const res = await apiFetch(`/safety/assignments/${assignmentId}/complete`, {
        method: "PUT",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось обновить статус");
      setSafetyAssignments((prev) =>
        prev.map((a) => (a.id === assignmentId ? { ...a, completedAt: data.completedAt, status: "DONE" } : a))
      );
    } catch (e) {
      console.error(e);
      setSafetyError(e.message);
    }
  };

  const handleRemindInstruction = async (assignment) => {
    try {
      setSafetyError("");
      const res = await apiFetch(`/safety/assignments/${assignment.id}/remind`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Не удалось отправить напоминание");
      setSafetyAssignments((prev) =>
        prev.map((a) => (a.id === assignment.id ? { ...a, lastReminderAt: new Date().toISOString() } : a))
      );
    } catch (e) {
      console.error(e);
      setSafetyError(e.message);
    }
  };

  const toggleEmploymentStep = (id) => {
    setEmploymentProgress((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("employment_progress", JSON.stringify(next));
      return next;
    });
  };

  const employmentProgressCount = EMPLOYMENT_STEPS.reduce(
    (acc, step) => acc + (employmentProgress[step.id] ? 1 : 0),
    0
  );

  const sectionCards = [
    { key: "employees", title: "Сотрудники", icon: "👥", desc: "Карточки и статусы" },
    { key: "leave", title: "Заявления", icon: "📝", desc: "Отпуска, БС, увольнения" },
    { key: "employment", title: "Трудоустройство", icon: "📋", desc: "Мастер приема и шаблоны" },
    { key: "safety", title: "Охрана труда", icon: "🛡️", desc: "Инструктажи и контроль" },
    { key: "templates", title: "Табели/шаблоны", icon: "📄", desc: "Файлы для скачивания" },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Отдел кадров</h1>
        <p className="page-subtitle">Регистрация сотрудников, заявления на отпуск/БС, табели и быстрые действия.</p>
      </div>

      <div className="warehouse-grid" style={{ marginBottom: 16 }}>
        {sectionCards.map((card) => (
          <button
            key={card.key}
            className={"warehouse-card" + (section === card.key ? " warehouse-card--active" : "")}
            onClick={() => setSection(card.key)}
            type="button"
          >
            <span className="warehouse-card__icon">
              <span className="warehouse-card__icon-symbol">{card.icon}</span>
            </span>
            <div className="warehouse-card__body">
              <span className="warehouse-card__title">{card.title}</span>
              <span className="warehouse-card__subtitle">{card.desc}</span>
            </div>
          </button>
        ))}
      </div>

      {section === "employees" && (
        <>
          <div className="tabs tabs--sm" style={{ marginBottom: 12 }}>
            <button
              className="tabs__btn"
              onClick={() => setEmployeeTab("register")}
              style={{
                background: employeeTab === "register" ? "#ffffff" : "transparent",
                color: employeeTab === "register" ? "#111827" : "#6b7280",
                boxShadow: employeeTab === "register" ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
              }}
              type="button"
            >
              Регистрация сотрудника
            </button>
            <button
              className="tabs__btn"
              onClick={() => setEmployeeTab("list")}
              style={{
                background: employeeTab === "list" ? "#ffffff" : "transparent",
                color: employeeTab === "list" ? "#111827" : "#6b7280",
                boxShadow: employeeTab === "list" ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
              }}
              type="button"
            >
              Список сотрудников
            </button>
          </div>

          {employeeTab === "register" && (
            <div className="card card--1c" style={{ marginTop: 8 }}>
              <div className="card1c__header">Регистрация сотрудника</div>
              <div className="card1c__body">
                {error && (
                  <div className="alert alert--danger" style={{ marginBottom: 10 }}>
                    {error}
                  </div>
                )}

                <form className="request-form-1c" onSubmit={handleCreate}>
                  <div className="form__group">
                    <label className="form__label">ФИО</label>
                    <input
                      className="form__input"
                      required
                      value={form.fullName}
                      onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                      placeholder="Иванов Иван Иванович"
                    />
                  </div>

                  <div className="form__group">
                    <label className="form__label">Дата рождения</label>
                    <input
                      type="date"
                      className="form__input"
                      required
                      value={form.birthDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, birthDate: e.target.value }))}
                    />
                  </div>

                  <div className="form__group">
                    <label className="form__label">Должность</label>
                    <input
                      className="form__input"
                      required
                      value={form.position}
                      onChange={(e) => setForm((prev) => ({ ...prev, position: e.target.value }))}
                      placeholder="Специалист по кадрам"
                    />
                  </div>

                  <div className="form__group">
                    <label className="form__label">Подразделение</label>
                    <input
                      className="form__input"
                      required
                      value={form.department}
                      onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))}
                      placeholder="Кадры / Склад / Офис"
                    />
                  </div>

                  <div className="form__group">
                    <label className="form__label">ID Telegram</label>
                    <input
                      className="form__input"
                      required
                      value={form.telegramChatId || ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, telegramChatId: e.target.value }))}
                      placeholder="Укажите chat_id сотрудника"
                    />
                  </div>

                  <div className="form__group">
                    <label className="form__label">Дата приема</label>
                    <input
                      type="date"
                      className="form__input"
                      required
                      value={form.hiredAt}
                      onChange={(e) => setForm((prev) => ({ ...prev, hiredAt: e.target.value }))}
                    />
                  </div>

                  <div className="request-form-1c__actions">
                    <button type="submit" className="btn btn--primary" disabled={saving}>
                      {saving ? "Создаем..." : "Добавить сотрудника"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {employeeTab === "list" && (
            <>
              <div className="card" style={{ marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Фильтры и поиск</h3>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={loadEmployees}
                    style={{ marginLeft: "auto" }}
                  >
                    Обновить
                  </button>
                </div>

                <div style={{ display: "flex", gap: 10,  }}>
                  <div style={{ flex: "1 1 220px" }}>
                    <input
                      placeholder="Поиск по ФИО, отделу, должности"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>

                  <div style={{ width: 200 }}>
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                      <option value="ALL">Все статусы</option>
                      <option value="ACTIVE">В штате</option>
                      <option value="FIRED">Уволен</option>
                    </select>
                  </div>
                </div>

              </div>

              <div className="card card--1c" style={{ marginTop: 12 }}>
                <div className="card1c__header">Список сотрудников</div>
                <div className="card1c__body">
                  {loading ? (
                    <p>Загружаем список...</p>
                  ) : filteredEmployees.length === 0 ? (
                    <p className="text-muted">Сотрудников нет или не найдено по фильтру.</p>
                  ) : (
                    <div className="table-wrapper">
                      <table className="table">
                        <thead>
                          <tr>
                            <th style={{ width: 70 }}>ID</th>
                            <th>ФИО</th>
                            <th>Должность</th>
                            <th>Подразделение</th>
                            <th style={{ width: 140 }}>ID Telegram</th>
                            <th>Статус</th>
                            <th>Принят</th>
                            <th>ДР</th>
                            <th style={{ width: 180 }}>Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEmployees.map((emp) => (
                            <tr key={emp.id}>
                              <td>{emp.id}</td>
                              <td>
                                {editEmployeeId === emp.id ? (
                                  <input
                                    className="form__input form__input--sm"
                                    value={editForm.fullName}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, fullName: e.target.value }))}
                                  />
                                ) : (
                                  emp.fullName
                                )}
                              </td>
                              <td>
                                {editEmployeeId === emp.id ? (
                                  <input
                                    className="form__input form__input--sm"
                                    value={editForm.position}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, position: e.target.value }))}
                                  />
                                ) : (
                                  emp.position || "-"
                                )}
                              </td>
                              <td>
                                {editEmployeeId === emp.id ? (
                                  <input
                                    className="form__input form__input--sm"
                                    value={editForm.department}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, department: e.target.value }))}
                                  />
                                ) : (
                                  emp.department || "-"
                                )}
                              </td>
                              <td>
                                {editEmployeeId === emp.id ? (
                                  <input
                                    className="form__input form__input--sm"
                                    value={editForm.telegramChatId}
                                    onChange={(e) =>
                                      setEditForm((prev) => ({ ...prev, telegramChatId: e.target.value }))
                                    }
                                  />
                                ) : (
                                  emp.telegramChatId || "-"
                                )}
                              </td>
                              <td>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    fontSize: 12,
                                    background: statusPills[emp.status]?.background || "#e5e7eb",
                                    color: statusPills[emp.status]?.color || "#374151",
                                    border: `1px solid ${statusPills[emp.status]?.border || "#d1d5db"}`,
                                  }}
                                >
                                  {STATUS_LABELS[emp.status] || emp.status}
                                </span>
                              </td>
                              <td>
                                {editEmployeeId === emp.id ? (
                                  <input
                                    type="date"
                                    className="form__input form__input--sm"
                                    value={editForm.hiredAt}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, hiredAt: e.target.value }))}
                                  />
                                ) : (
                                  formatDate(emp.hiredAt)
                                )}
                              </td>
                              <td>
                                {editEmployeeId === emp.id ? (
                                  <input
                                    type="date"
                                    className="form__input form__input--sm"
                                    value={editForm.birthDate}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, birthDate: e.target.value }))}
                                  />
                                ) : (
                                  formatDate(emp.birthDate)
                                )}
                              </td>
                              <td>
                                {editEmployeeId === emp.id ? (
                                  <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                      type="button"
                                      className="btn btn--primary btn--sm"
                                      onClick={() => handleEditSave(emp.id)}
                                      disabled={editSaving}
                                    >
                                      Сохранить
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--secondary btn--sm"
                                      onClick={handleEditCancel}
                                      disabled={editSaving}
                                    >
                                      Отмена
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn--secondary btn--sm"
                                    onClick={() => handleEditStart(emp)}
                                  >
                                    Редактировать
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )} 
      {section === "safety" && (
        <div className="card card--1c" style={{ marginTop: 8 }}>
          <div className="card1c__header">Охрана труда: инструктажи</div>
          <div className="card1c__body">
            {safetyError && (
              <div className="alert alert--danger" style={{ marginBottom: 10 }}>
                {safetyError}
              </div>
            )}

            <div className="tabs tabs--sm" style={{ marginBottom: 12 }}>
              <button
                className={"tabs__btn" + (safetyTab === "periodicity" ? " tabs__btn--active" : "")}
                onClick={() => setSafetyTab("periodicity")}
                type="button"
              >
                Периодичность
              </button>
              <button
                className={"tabs__btn" + (safetyTab === "templates" ? " tabs__btn--active" : "")}
                onClick={() => setSafetyTab("templates")}
                type="button"
              >
                Шаблоны
              </button>
              <button
                className={"tabs__btn" + (safetyTab === "statuses" ? " tabs__btn--active" : "")}
                onClick={() => setSafetyTab("statuses")}
                type="button"
              >
                Списки прохождений
              </button>
            </div>

            {safetyTab === "periodicity" && (
              <div className="card" style={{ margin: 0 }}>
                <div className="card__header" style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Инструкции (склад, кладовщики, грузчики)
                </div>
                <div className="card__body">
                  {safetyLoading ? (
                    <p>Загружаем...</p>
                  ) : safetyInstructions.length === 0 ? (
                    <p className="text-muted">Инструкции не найдены.</p>
                  ) : (
                    <ul style={{ listStyle: "disc", paddingLeft: 18, margin: 0, color: "#374151" }}>
                      {safetyInstructions.map((i) => (
                        <li key={i.id} style={{ marginBottom: 6 }}>
                          <strong>{i.title}</strong> — ({i.periodicityDays} дн.)
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {safetyTab === "templates" && (
              <div className="card" style={{ margin: 0 }}>
                <div className="card__header" style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Шаблоны и журналы
                </div>
                <div className="card__body">
                  {safetyLoading ? (
                    <p>Загружаем...</p>
                  ) : (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        <strong>Инструкции (файлы)</strong>
                        {safetyResources.instructions?.length === 0 ? null : (
                          <ul style={{ listStyle: "none", paddingLeft: 0, margin: "6px 0 10px" }}>
                            {safetyResources.instructions.map((r) => (
                              <li
                                key={r.title}
                                style={{
                                  marginBottom: 4,
                                  padding: "6px 0",
                                  borderBottom: "1px solid #e5e7eb",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontWeight: 600, flex: 1 }}>{r.title}</span>
                                  {r.file ? (
                                    <a className="btn btn--secondary btn--sm" href={r.file} download>
                                      Скачать
                                    </a>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <strong>Журналы</strong>
                        {safetyResources.journals?.length === 0 ? null : (
                          <ul style={{ listStyle: "none", paddingLeft: 0, margin: "6px 0 0" }}>
                            {safetyResources.journals.map((r) => (
                              <li
                                key={r.title}
                                style={{
                                  marginBottom: 4,
                                  padding: "6px 0",
                                  borderBottom: "1px solid #e5e7eb",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontWeight: 600, flex: 1 }}>{r.title}</span>
                                  {r.file ? (
                                    <a className="btn btn--secondary btn--sm" href={r.file} download>
                                      Скачать
                                    </a>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                    </>
                  )}
                </div>
              </div>
            )}

            {safetyTab === "statuses" && (
              <div className="card" style={{ margin: 0 }}>
                <div className="card__header" style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Статус по сотрудникам
                </div>
                <div className="card__body">
                  {safetyLoading ? (
                    <p>Загружаем...</p>
                  ) : safetyAssignments.length === 0 ? (
                    <p className="text-muted">Нет назначений</p>
                  ) : (
                    <div className="table-wrapper">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Сотр.</th>
                            <th>Инструктаж</th>
                            <th>Статус</th>
                            <th>След. дата</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {safetyAssignments.map((a) => {
                            const overdue = a.status === "PENDING";
                            const canRemind = overdue && a.employee?.telegramChatId;
                            return (
                              <tr key={a.id}>
                                <td>{a.employee?.fullName || a.employeeId}</td>
                                <td>{a.instruction?.title}</td>
                                <td>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "2px 8px",
                                      borderRadius: 999,
                                      fontSize: 12,
                                      background: overdue ? "#fee2e2" : "#dcfce7",
                                      color: overdue ? "#991b1b" : "#166534",
                                      border: `1px solid ${overdue ? "#fca5a5" : "#86efac"}`,
                                    }}
                                  >
                                    {overdue ? "Требуется" : "Пройден"}
                                  </span>
                                </td>
                                <td>{formatDate(a.nextDue)}</td>
                                <td style={{ width: 190 }}>
                                  {overdue && (
                                    <div style={{ display: "flex", gap: 6 }}>
                                      {canRemind ? (
                                        <button
                                          type="button"
                                          className="btn btn--ghost btn--sm"
                                          onClick={() => handleRemindInstruction(a)}
                                        >
                                          Напомнить
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: 12, color: "#9ca3af" }}>Нет ID Telegram</span>
                                      )}
                                      <button
                                        type="button"
                                        className="btn btn--secondary btn--sm"
                                        onClick={() => handleCompleteInstruction(a.id)}
                                      >
                                        Закрыть
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {section === "employment" && (
        <div className="card card--1c" style={{ marginTop: 8 }}>
          <div className="card1c__header">Трудоустройство</div>
          <div className="card1c__body">
            <div className="tabs tabs--sm" style={{ marginBottom: 12 }}>
              <button
                className={"tabs__btn" + (employmentSection === "master" ? " tabs__btn--active" : "")}
                onClick={() => setEmploymentSection("master")}
                type="button"
              >
                Мастер
              </button>
              <button
                className={"tabs__btn" + (employmentSection === "checklists" ? " tabs__btn--active" : "")}
                onClick={() => setEmploymentSection("checklists")}
                type="button"
              >
                Чек-листы
              </button>
              <button
                className={"tabs__btn" + (employmentSection === "templates" ? " tabs__btn--active" : "")}
                onClick={() => setEmploymentSection("templates")}
                type="button"
              >
                Шаблоны
              </button>
              <button
                className={"tabs__btn" + (employmentSection === "sources" ? " tabs__btn--active" : "")}
                onClick={() => setEmploymentSection("sources")}
                type="button"
              >
                Источники
              </button>
            </div>

            {employmentSection === "master" && (
              <div className="card" style={{ margin: 0 }}>
                <div className="card__header" style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Пошаговая инструкция (мастер)
                </div>
                <div className="card__body" style={{ paddingTop: 10 }}>
                  <div style={{ marginBottom: 10, fontWeight: 600 }}>
                    Прогресс: {employmentProgressCount}/{EMPLOYMENT_STEPS.length}
                  </div>
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 60 }}></th>
                          <th>Этап</th>
                        </tr>
                      </thead>
                      <tbody>
                        {EMPLOYMENT_STEPS.map((step) => (
                          <tr key={step.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!employmentProgress[step.id]}
                                onChange={() => toggleEmploymentStep(step.id)}
                              />
                            </td>
                            <td>{step.title}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {employmentSection === "checklists" && (
              <div className="card" style={{ margin: 0 }}>
                <div className="card__header" style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Документы и требования при приеме
                </div>
                <div className="card__body" style={{ paddingTop: 10 }}>
                  <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <label style={{ fontWeight: 600 }}>Профиль:</label>
                    <div className="tabs tabs--sm" style={{ marginBottom: 0 }}>
                      <button
                        className={"tabs__btn" + (employmentFilter === "office" ? " tabs__btn--active" : "")}
                        onClick={() => setEmploymentFilter("office")}
                        type="button"
                      >
                        Офис
                      </button>
                      <button
                        className={"tabs__btn" + (employmentFilter === "warehouse" ? " tabs__btn--active" : "")}
                        onClick={() => setEmploymentFilter("warehouse")}
                        type="button"
                      >
                        Склад (грузчик/кладовщик)
                      </button>
                      <button
                        className={"tabs__btn" + (employmentFilter === "foreigner" ? " tabs__btn--active" : "")}
                        onClick={() => setEmploymentFilter("foreigner")}
                        type="button"
                      >
                        Иностранец
                      </button>
                    </div>
                  </div>

                  <div className="card" style={{ margin: 0, marginBottom: 12 }}>
                    <div className="card__header" style={{ fontWeight: 600, padding: "10px 12px" }}>
                      Документы от сотрудника (ст. 65 ТК РФ)
                    </div>
                    <div className="card__body" style={{ paddingTop: 8 }}>
                      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                        <li>Документ, удостоверяющий личность.</li>
                        <li>Сведения о трудовой деятельности (трудовая книжка/ЭТК) — если не первое место.</li>
                        <li>Регистрация в системе персонифицированного учета (СНИЛС/электронный документ).</li>
                        <li>Документ воинского учета (для военнообязанных).</li>
                        <li>Документ об образовании/квалификации — если требуется по должности.</li>
                        <li>Доп. справки (судимость/адм. наказание) — только если по должности обязательно.</li>
                        {employmentFilter === "warehouse" && (
                          <>
                            <li>Медкнижка/медосмотр — при контакте с пищевой продукцией или повышенных рисках.</li>
                            <li>Согласие на сменный/ночной график — если применимо.</li>
                          </>
                        )}
                        {employmentFilter === "foreigner" && (
                          <>
                            <li>Патент/разрешение на работу или ВНЖ/РВП, миграционный учет.</li>
                            <li>Полис ДМС (если требуется), перевод документов при необходимости.</li>
                          </>
                        )}
                      </ul>
                      <div className="alert alert--info" style={{ marginTop: 10 }}>
                        Нельзя требовать лишние документы, не предусмотренные законом.
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ margin: 0 }}>
                    <div className="card__header" style={{ fontWeight: 600, padding: "10px 12px" }}>
                      Документы работодателя (чек-лист)
                    </div>
                    <div className="card__body" style={{ paddingTop: 8 }}>
                      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                        <li>Трудовой договор (обязательные условия по ст. 57 ТК РФ).</li>
                        <li>Приказ о приеме (или кадровое событие).</li>
                        <li>Ознакомление с ЛНА: ПВТР, оплата труда, политика ПД, ОТ и др.</li>
                        <li>Согласия по ПД: обработка, распространение (отдельно), передача третьим лицам — при наличии.</li>
                        <li>Заявление о приеме — если используете в процессе.</li>
                        <li>Согласие на ЭДО — опционально, если ведете ЭДО.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {employmentSection === "templates" && (
              <div className="card" style={{ margin: 0 }}>
                <div className="card__header" style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Шаблоны (скачать/распечатать)
                </div>
                <div className="card__body" style={{ paddingTop: 8 }}>
                  <div className="table-wrapper">
                    <table className="table table--bordered" style={{ tableLayout: "fixed", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ width: "35%" }}>Название</th>
                          <th style={{ width: "45%" }}>Описание</th>
                          <th style={{ width: "20%" }}>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {EMPLOYMENT_TEMPLATES.map((tpl, idx) => (
                          <tr key={tpl.id}>
                            <td style={{ verticalAlign: "middle", paddingTop: 12, paddingBottom: 12 }}>{tpl.title}</td>
                            <td style={{ fontSize: 13, color: "#6b7280", verticalAlign: "middle", paddingTop: 12, paddingBottom: 12 }}>
                              {tpl.desc}
                            </td>
                            <td style={{ textAlign: "center", verticalAlign: "middle", padding: 12 }}>
                              <a
                                href={tpl.file}
                                download
                                className="btn btn--primary btn--sm"
                                style={{ minWidth: 100, textAlign: "center" }}
                              >
                                Скачать
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {employmentSection === "sources" && (
              <div className="card" style={{ margin: 0 }}>
                <div className="card__header" style={{ padding: "10px 12px", fontWeight: 600 }}>
                  Источники и ссылки
                </div>
                <div className="card__body" style={{ paddingTop: 8 }}>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {EMPLOYMENT_SOURCES.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {section === "leave" && (
        <div className="card card--1c" style={{ marginTop: 8 }}>
          <div className="card1c__header">Заявления</div>
          <div className="card1c__body">
            <div className="tabs tabs--sm" style={{ marginBottom: 12 }}>
              <button
                className={"tabs__btn" + (leaveTab === "PAID" ? " tabs__btn--active" : "")}
                onClick={() => setLeaveTab("PAID")}
                type="button"
              >
                Оплачиваемый
              </button>
              <button
                className={"tabs__btn" + (leaveTab === "UNPAID" ? " tabs__btn--active" : "")}
                onClick={() => setLeaveTab("UNPAID")}
                type="button"
              >
                Без содержания
              </button>
              <button
                className={"tabs__btn" + (leaveTab === "TERMINATION" ? " tabs__btn--active" : "")}
                onClick={() => setLeaveTab("TERMINATION")}
                type="button"
              >
                Увольнение
              </button>
            </div>

            {leaveError && (
              <div className="alert alert--danger" style={{ marginBottom: 10 }}>
                {leaveError}
              </div>
            )}

            {leaveTab === "TERMINATION" ? (
              <form className="request-form-1c" onSubmit={handleGenerateLeave}>
                <div className="form__group">
                  <label className="form__label">Сотрудник</label>
                  <select
                    value={terminationForm.employeeId}
                    onChange={(e) => setTerminationForm((prev) => ({ ...prev, employeeId: e.target.value }))}
                    required
                  >
                    <option value="">Выберите</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form__group">
                  <label className="form__label">Дата увольнения</label>
                  <input
                    type="date"
                    className="form__input"
                    value={terminationForm.date}
                    onChange={(e) => setTerminationForm((prev) => ({ ...prev, date: e.target.value }))}
                  />
                </div>

                <div className="form__group">
                  <label className="form__label">Основание / комментарий</label>
                  <input
                    className="form__input"
                    value={terminationForm.reason}
                    onChange={(e) => setTerminationForm((prev) => ({ ...prev, reason: e.target.value }))}
                    placeholder="По соглашению сторон, ст. 80 ТК РФ и т.п."
                  />
                </div>

                <div className="request-form-1c__actions">
                  <button type="submit" className="btn btn--primary" disabled={leaveSaving}>
                    {leaveSaving ? "Формируем..." : "Сформировать увольнение"}
                  </button>
                </div>
              </form>
            ) : (
              <form className="request-form-1c" onSubmit={handleGenerateLeave}>
                <div className="form__group">
                  <label className="form__label">Сотрудник</label>
                  <select
                    value={leaveForm.employeeId}
                    onChange={(e) => handleSelectEmployee(e.target.value)}
                    required
                  >
                    <option value="">Выберите</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form__group">
                  <label className="form__label">Даты</label>
                  <div style={{ display: "flex", gap: 8, width: "100%" }}>
                    <input
                      type="date"
                      value={leaveForm.startDate}
                      onChange={(e) => handleLeaveField("startDate", e.target.value)}
                    />
                    <input
                      type="date"
                      value={leaveForm.endDate}
                      onChange={(e) => handleLeaveField("endDate", e.target.value)}
                    />
                  </div>
                </div>

                <div className="form__group">
                  <label className="form__label">Комментарий</label>
                  <input
                    className="form__input"
                    value={leaveForm.reason}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, reason: e.target.value }))}
                    placeholder="По семейным обстоятельствам / график отпуска"
                  />
                </div>

                {leaveTab === "PAID" && (
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      marginTop: 8,
                    }}
                  >
                    <span className="badge badge--pending">Начислено: {leaveBalance.accruedDays} дн.</span>
                    <span className="badge badge--approved">Доступно: {leaveBalance.availableDays} дн.</span>
                    <span className="badge badge--pending">По заявлению: {leaveDays} дн.</span>
                  </div>
                )}

                <div className="request-form-1c__actions">
                  <button type="submit" className="btn btn--primary" disabled={leaveSaving}>
                    {leaveSaving ? "Формируем..." : "Сформировать заявление"}
                  </button>
                </div>
              </form>
            )}

            {leavePreview && (
              <div className="card" style={{ marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <strong>Сформированный текст</strong>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => openPrintWindow(leavePreview.docText)}
                    style={{ marginLeft: "auto" }}
                  >
                    Печать
                  </button>
                </div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontFamily: "Segoe UI, sans-serif",
                    margin: 0,
                    fontSize: 13,
                  }}
                >
{leavePreview.docText}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
      {section === "templates" && (
        <div className="card card--1c" style={{ marginTop: 12 }}>
          <div className="card1c__header">Табели и шаблоны</div>
          <div className="card1c__body">
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Название файла</th>
                    <th>Описание</th>
                    <th style={{ width: 140 }}>Скачать</th>
                  </tr>
                </thead>
                <tbody>
                  {TEMPLATES.map((tpl) => (
                    <tr key={tpl.id}>
                      <td>{tpl.name}</td>
                      <td style={{ fontSize: 13, color: "#6b7280" }}>{tpl.description}</td>
                      <td>
                        <a
                          href={tpl.file}
                          download
                          className="btn btn--primary btn--sm"
                          style={{ width: "100%", textAlign: "center" }}
                        >
                          Скачать
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {section === "actions" && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Быстрые действия (маршрут)</h3>
          <div className="warehouse-subcards" style={{ marginBottom: 12 }}>
            {HR_ACTIONS.map((act) => (
              <button
                key={act.id}
                className="warehouse-subcards__card"
                type="button"
                onClick={() => setSelectedAction(act.id)}
                style={
                  selectedAction === act.id
                    ? { borderColor: "#2563eb", boxShadow: "0 0 0 2px rgba(37,99,235,0.15)" }
                    : undefined
                }
              >
                <span className="warehouse-subcards__icon">{act.icon}</span>
                <div className="warehouse-subcards__text">
                  <span className="warehouse-subcards__title">{act.title}</span>
                  <span className="warehouse-subcards__desc">{act.desc}</span>
                </div>
              </button>
            ))}
          </div>

          {selectedAction === "hire" && (
            <div className="card card--1c" style={{ marginTop: 12 }}>
              <div className="card1c__header">Маршрут найма: склад / кладовщики / грузчики</div>
              <div className="card1c__body">
                <div style={{ display: "grid", gap: 12 }}>
                  {HIRE_STEPS.map((block, idx) => (
                    <div key={block.title} className="card" style={{ margin: 0 }}>
                      <div className="card__header" style={{ fontWeight: 600, padding: "10px 12px" }}>
                        {idx + 1}. {block.title}
                      </div>
                      <div className="card__body" style={{ paddingTop: 6 }}>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {block.items.map((item) => (
                            <li key={item} style={{ marginBottom: 6, lineHeight: 1.5 }}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card" style={{ marginTop: 12 }}>
                  <div className="card__header" style={{ fontWeight: 600, padding: "10px 12px" }}>
                    Документы и журналы
                  </div>
                  <div className="card__body" style={{ paddingTop: 10 }}>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {HIRE_DOCS.map((doc) => (
                        <li key={doc.name} style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8,  }}>
                            <span>{doc.name}</span>
                            {doc.file ? (
                              <a className="btn btn--secondary btn--sm" href={doc.file} download>
                                Скачать
                              </a>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}




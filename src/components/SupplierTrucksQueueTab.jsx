// C:\Users\dvinskikh.sergey\Desktop\business-portal\src\components\SupplierTrucksQueueTab.jsx



import { useEffect, useState } from "react";
import { apiFetch } from "../apiConfig";



const STATUS_LABELS = {

  IN_QUEUE: "В очереди",

  UNLOADING: "На разгрузке",

  DONE: "Выехал",

};



const PO_STATUS_LABELS = {

  DRAFT: "Черновик",

  SENT: "Отправлен",

  RECEIVED: "Получен",

  CLOSED: "Закрыт",

};



const SUBTABS = {

  REGISTER: "REGISTER",

  QUEUE: "QUEUE",

};



export default function SupplierTrucksQueueTab() {

  const token = localStorage.getItem("token");

  const authHeaders = {

    Authorization: `Bearer ${token}`,

    "Content-Type": "application/json",

  };



  const [activeSubtab, setActiveSubtab] = useState(SUBTABS.REGISTER);



  // очередь машин

  const [items, setItems] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [onlyActive, setOnlyActive] = useState(true);

  const [dateFrom, setDateFrom] = useState("");

  const [dateTo, setDateTo] = useState("");

  const [selectedTruckId, setSelectedTruckId] = useState(null);



  // форма регистрации машины

  const [form, setForm] = useState({

    supplier: "",

    orderNumber: "",

    deliveryDate: "",

    vehicleBrand: "",

    truckNumber: "",

    driverName: "",

    driverPhone: "",

    cargo: "",

    note: "",

    directImport: false,

  });



  // поставщики и заказы поставщика

  const [suppliers, setSuppliers] = useState([]);

  const [suppliersLoading, setSuppliersLoading] = useState(false);

  const [selectedSupplierId, setSelectedSupplierId] = useState(""); // id выбранного поставщика

  const [supplierOrders, setSupplierOrders] = useState([]);

  const [ordersLoading, setOrdersLoading] = useState(false);



  // ---------- загрузка очереди ----------

  const loadQueue = async (opts = {}) => {

    try {

      setLoading(true);

      setError("");



      const onlyActiveLocal =
        opts.onlyActive !== undefined ? opts.onlyActive : onlyActive;

      const dateFromLocal = opts.dateFrom !== undefined ? opts.dateFrom : dateFrom;

      const dateToLocal = opts.dateTo !== undefined ? opts.dateTo : dateTo;



      const params = new URLSearchParams();



      if (onlyActiveLocal) {

        params.append("onlyActive", "1");

      }

      if (dateFromLocal) {

        params.append("dateFrom", dateFromLocal);

      }

      if (dateToLocal) {

        params.append("dateTo", dateToLocal);

      }



      const queryString = params.toString();

      const path =

        queryString.length > 0

          ? `/supplier-trucks?${queryString}`

          : "/supplier-trucks";



      const res = await apiFetch(path, {

        headers: { Authorization: authHeaders.Authorization },

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка загрузки очереди машин");

      }



      setItems(Array.isArray(data) ? data : []);

    } catch (e) {

      console.error(e);

      setError(e.message);

    } finally {

      setLoading(false);

    }

  };



  // очередь обновляем при изменении фильтров

  useEffect(() => {

    loadQueue({ onlyActive, dateFrom, dateTo });

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [onlyActive, dateFrom, dateTo]);



  // ---------- загрузка поставщиков ----------

  const loadSuppliers = async () => {

    try {

      setSuppliersLoading(true);

      setError("");



      const res = await apiFetch("/suppliers", {

        headers: { Authorization: authHeaders.Authorization },

      });

      const data = await res.json();



      if (!res.ok) {

        throw new Error(data.message || "Ошибка загрузки поставщиков");

      }



      setSuppliers(Array.isArray(data) ? data : []);

    } catch (e) {

      console.error(e);

      setError(e.message);

    } finally {

      setSuppliersLoading(false);

    }

  };



  useEffect(() => {

    loadSuppliers();

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, []);



  // ---------- загрузка заказов для выбранного поставщика ----------

  const loadOrdersForSupplier = async (supplierId) => {

    if (!supplierId) {

      setSupplierOrders([]);

      return;

    }



    try {

      setOrdersLoading(true);

      setError("");



      const res = await apiFetch("/purchase-orders", {

        headers: { Authorization: authHeaders.Authorization },

      });

      const data = await res.json();



      if (!res.ok) {

        throw new Error(

          data.message || "Ошибка загрузки заказов поставщику"

        );

      }



      const list = Array.isArray(data) ? data : [];



      // оставляем только заказы выбранного поставщика,

      // которые ещё не приняты на склад (не RECEIVED и не CLOSED)

      const filtered = list.filter(

        (po) =>

          po.supplierId === supplierId &&

          po.status !== "RECEIVED" &&

          po.status !== "CLOSED"

      );



      setSupplierOrders(filtered);

    } catch (e) {

      console.error(e);

      setError(e.message);

    } finally {

      setOrdersLoading(false);

    }

  };



  // ---------- выбор поставщика из select ----------

  const handleSupplierSelectChange = (e) => {

    const value = e.target.value; // id или ""

    setSelectedSupplierId(value);



    const supplierName =

      suppliers.find((s) => String(s.id) === value)?.name || "";



    setForm((prev) => ({

      ...prev,

      supplier: supplierName,

      orderNumber: "", // сбрасываем номер заказа при смене поставщика

    }));



    if (value) {

      loadOrdersForSupplier(Number(value));

    } else {

      setSupplierOrders([]);

    }

  };



  // ---------- регистрация машины ----------

  const handleCreate = async (e) => {

    e.preventDefault();

    setError("");



    try {

      if (

        !form.supplier.trim() &&

        !form.truckNumber.trim() &&

        !form.driverName.trim()

      ) {

        return setError(

          "Укажите хотя бы поставщика, номер машины или водителя."

        );

      }



      const body = {

        supplier: form.supplier.trim() || null,

        orderNumber: form.orderNumber.trim() || null,

        deliveryDate: form.deliveryDate || null,

        vehicleBrand: form.vehicleBrand.trim() || null,

        truckNumber: form.truckNumber.trim() || null,

        driverName: form.driverName.trim() || null,

        driverPhone: form.driverPhone.trim() || null,

        cargo: form.cargo.trim() || null,

        note: form.note || null,

        directImport: form.directImport,

      };



      const res = await apiFetch("/supplier-trucks", {

        method: "POST",

        headers: authHeaders,

        body: JSON.stringify(body),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка регистрации машины");

      }



      // очистка формы

      setForm({

        supplier: "",

        orderNumber: "",

        deliveryDate: "",

        vehicleBrand: "",

        truckNumber: "",

        driverName: "",

        driverPhone: "",

        cargo: "",

        note: "",

        directImport: false,

      });

      setSelectedSupplierId("");

      setSupplierOrders([]);



      // переключаемся на вкладку "Очередь" и обновляем список

      setActiveSubtab(SUBTABS.QUEUE);

      await loadQueue();

    } catch (e) {

      console.error(e);

      setError(e.message);

    }

  };



  // ---------- смена статуса машины ----------

  const changeStatus = async (id, status) => {

    try {

      setError("");



      let gate = undefined;

      if (status === "UNLOADING") {

        gate = prompt("На какие ворота ставим машину?");

        if (!gate) return;

      }



      const res = await apiFetch(`/supplier-trucks/${id}/status`, {

        method: "PUT",

        headers: authHeaders,

        body: JSON.stringify({ status, gate }),

      });



      const data = await res.json();

      if (!res.ok) {

        throw new Error(data.message || "Ошибка смены статуса");

      }



      await loadQueue();

    } catch (e) {

      console.error(e);

      setError(e.message);

    }

  };



  // ====== РЕНДЕР ======

  const selectedTruck = items.find((t) => t.id === selectedTruckId);



  return (

    <div>

      {/* Вкладки над жёлтой шапкой, как в других разделах */}

      <div className="tabs tabs--sm" style={{ marginBottom: 8 }}>

        <button

          type="button"

          className={

            "tabs__btn " +

            (activeSubtab === SUBTABS.REGISTER ? "tabs__btn--active" : "")

          }

          onClick={() => setActiveSubtab(SUBTABS.REGISTER)}

        >

          Регистрация авто

        </button>

        <button

          type="button"

          className={

            "tabs__btn " +

            (activeSubtab === SUBTABS.QUEUE ? "tabs__btn--active" : "")

          }

          onClick={() => setActiveSubtab(SUBTABS.QUEUE)}

        >

          Очередь

        </button>

      </div>



      <div className="card card--1c card--wide">

        <div className="card1c__header">

          <span>Машины поставщиков</span>

        </div>



        <div className="card1c__body">

          {error && (

            <div className="alert alert--danger" style={{ marginBottom: 8 }}>

              {error}

            </div>

          )}



          {/* ---------- вкладка РЕГИСТРАЦИЯ ---------- */}

          {activeSubtab === SUBTABS.REGISTER && (

            <form

              onSubmit={handleCreate}

              className="form request-form-1c"

              style={{ marginBottom: 16 }}

            >

              <div className="form__group">

                <label className="form__label">Поставщик</label>

                <div

                  style={{

                    display: "flex",

                    gap: 8,

                    alignItems: "center",

                    flexWrap: "wrap",

                  }}

                >

                  <select

                    className="form__select"

                    value={selectedSupplierId}

                    onChange={handleSupplierSelectChange}

                    disabled={suppliersLoading}

                  >

                    <option value="">Выберите из списка</option>

                    {suppliers.map((s) => (

                      <option key={s.id} value={s.id}>

                        {s.name}

                      </option>

                    ))}

                  </select>

                  <span

                    style={{

                      fontSize: 12,

                      color: "#6b7280",

                      whiteSpace: "nowrap",

                    }}

                  >

                    Список берётся из раздела «Поставщики».

                  </span>

                </div>

              </div>



              <div className="form__group">

                <label className="form__label">№ заказа</label>

                <div

                  style={{

                    display: "flex",

                    gap: 8,

                    alignItems: "center",

                    flexWrap: "wrap",

                  }}

                >

                  <input

                    className="form__input"

                    list="purchase-orders-datalist"

                    value={form.orderNumber}

                    onChange={(e) =>

                      setForm((prev) => ({

                        ...prev,

                        orderNumber: e.target.value,

                      }))

                    }

                    placeholder="Выберите из списка"

                    disabled={ordersLoading || !selectedSupplierId}

                  />

                  <datalist id="purchase-orders-datalist">

                    {supplierOrders.map((po) => {

                      const dateStr = po.date

                        ? new Date(po.date).toLocaleDateString("ru-RU")

                        : "";

                      const statusLabel =

                        PO_STATUS_LABELS[po.status] || po.status;

                      return (

                        <option

                          key={po.id}

                          value={po.number}

                        >{`${po.number} от ${dateStr} — ${statusLabel}`}</option>

                      );

                    })}

                  </datalist>

                  <span

                    style={{

                      fontSize: 12,

                      color: "#6b7280",

                      maxWidth: 420,

                    }}

                  >

                    Показаны заказы этого поставщика в статусах «Черновик» и

                    «Отправлен» (ещё не приняты на склад).

                  </span>

                </div>

              </div>



              <div className="form__group">

                <label className="form__label">Дата доставки</label>

                <input

                  type="date"

                  className="form__input"

                  value={form.deliveryDate}

                  onChange={(e) =>

                    setForm({ ...form, deliveryDate: e.target.value })

                  }

                />

              </div>



              <div className="form__group">

                <label className="form__label">Марка авто</label>

                <input

                  className="form__input"

                  value={form.vehicleBrand}

                  onChange={(e) =>

                    setForm({ ...form, vehicleBrand: e.target.value })

                  }

                  placeholder="MAN, КамАЗ..."

                />

              </div>



              <div className="form__group">

                <label className="form__label">Номер авто</label>

                <input

                  className="form__input"

                  value={form.truckNumber}

                  onChange={(e) =>

                    setForm({ ...form, truckNumber: e.target.value })

                  }

                  placeholder="гос. номер"

                />

              </div>



              <div className="form__group">

                <label className="form__label">Водитель</label>

                <input

                  className="form__input"

                  value={form.driverName}

                  onChange={(e) =>

                    setForm({ ...form, driverName: e.target.value })

                  }

                />

              </div>



              <div className="form__group">

                <label className="form__label">Телефон водителя</label>

                <input

                  className="form__input"

                  value={form.driverPhone}

                  onChange={(e) =>

                    setForm({ ...form, driverPhone: e.target.value })

                  }

                />

              </div>



              <div className="form__group">

                <label className="form__label">Товар / груз</label>

                <input

                  className="form__input"

                  value={form.cargo}

                  onChange={(e) => setForm({ ...form, cargo: e.target.value })}

                  placeholder="Кратко: напитки, бумага..."

                />

              </div>



              <div className="form__group">

                <label className="form__label">Примечание</label>

                <input

                  className="form__input"

                  value={form.note}

                  onChange={(e) => setForm({ ...form, note: e.target.value })}

                  placeholder="Например: реф, транзит и т.п."

                />

              </div>



              <div className="request-form-1c__actions">

                <button type="submit" className="btn btn--primary">

                  Зарегистрировать в очереди

                </button>

              </div>

            </form>

          )}



          {/* ---------- вкладка ОЧЕРЕДЬ ---------- */}

          {activeSubtab === SUBTABS.QUEUE && (

            <>

              {/* фильтры над таблицей */}

              <div

                style={{

                  display: "flex",

                  flexWrap: "wrap",

                  justifyContent: "flex-end",

                  gap: 16,

                  alignItems: "center",

                  marginBottom: 12,

                }}

              >

                <label

                  style={{

                    fontSize: 13,

                    display: "flex",

                    alignItems: "center",

                    gap: 6,

                  }}

                >

                  <input

                    type="checkbox"

                    checked={onlyActive}

                    onChange={(e) => setOnlyActive(e.target.checked)}

                  />

                  Показывать только в очереди / на разгрузке

                </label>



                <div

                  style={{

                    display: "flex",

                    alignItems: "center",

                    gap: 6,

                    fontSize: 13,

                    flexWrap: "wrap",

                  }}

                >

                  <span>Прибытие с</span>

                  <input

                    type="date"

                    value={dateFrom}

                    onChange={(e) => setDateFrom(e.target.value)}

                    style={{ fontSize: 13 }}

                  />

                  <span>по</span>

                  <input

                    type="date"

                    value={dateTo}

                    onChange={(e) => setDateTo(e.target.value)}

                    style={{ fontSize: 13 }}

                  />

                  {(dateFrom || dateTo) && (

                    <button

                      type="button"

                      onClick={() => {

                        setDateFrom("");

                        setDateTo("");

                      }}

                      style={{

                        border: "none",

                        background: "transparent",

                        textDecoration: "underline",

                        cursor: "pointer",

                        padding: 0,

                      }}

                    >

                      Сбросить

                    </button>

                  )}

                </div>

              </div>



              {loading ? (

                <p>Загрузка очереди...</p>

              ) : items.length === 0 ? (

                <p className="text-muted">Машин в очереди пока нет.</p>

              ) : (

                <div

                  className="table-wrapper"

                  style={{ width: "100%", overflowX: "auto" }}

                >

                <div

                  className="queue-actions"

                >

                  <div className="queue-actions__label">

                    {selectedTruck

                      ? `Выбрана машина #${selectedTruck.id}`

                      : "Выберите строку для действий"}

                  </div>

                  <div className="queue-actions__buttons">

                    <button

                      type="button"

                      className="btn btn--primary btn--sm"

                      disabled={!selectedTruck || selectedTruck.status !== "IN_QUEUE"}

                      onClick={() =>

                        selectedTruck &&

                        changeStatus(selectedTruck.id, "UNLOADING")

                      }

                    >

                      На разгрузку

                    </button>

                    <button

                      type="button"

                      className="btn btn--success btn--sm"

                      disabled={!selectedTruck || selectedTruck.status !== "UNLOADING"}

                      onClick={() =>

                        selectedTruck && changeStatus(selectedTruck.id, "DONE")

                      }

                    >

                      Выезд

                    </button>

                  </div>

                </div>

                <table className="table table--queue">

                    <thead>

                      <tr>


                        <th style={{ width: 100 }}>Статус</th>

                        <th style={{ width: 140 }}>Прибытие</th>

                        <th style={{ width: 140 }}>Заезд на разгрузку</th>

                        <th style={{ width: 140 }}>Выезд</th>

                        <th>Поставщик</th>

                        <th style={{ width: 110 }}>№ заказа</th>

                        <th style={{ width: 110 }}>Дата дост.</th>

                        <th style={{ width: 70 }}>Ворота</th>

                        <th>Марка</th>

                        <th style={{ width: 110 }}>Номер авто</th>

                        <th>Водитель</th>

                        <th style={{ width: 120 }}>Телефон</th>

                        <th>Товар</th>

                        <th>Примечание</th>

                      </tr>

                    </thead>

                    <tbody>

                      {items.map((t) => (

                        <tr

                          key={t.id}

                          className={

                            selectedTruckId === t.id

                              ? "queue-row queue-row--active"

                              : "queue-row"

                          }

                          onClick={() => setSelectedTruckId(t.id)}

                        >


                          <td

                            style={{ whiteSpace: "nowrap", fontSize: 13 }}

                            title={

                              t.status === "DONE"

                                ? "Разгружен / выехал"

                                : STATUS_LABELS[t.status] || t.status

                            }

                          >

                            {STATUS_LABELS[t.status] || t.status}

                          </td>

                          <td

                            title={

                              t.arrivalAt

                                ? new Date(t.arrivalAt).toLocaleString("ru-RU")

                                : "-"

                            }

                          >

                            {t.arrivalAt

                              ? new Date(t.arrivalAt).toLocaleString("ru-RU")

                              : "-"}

                          </td>

                          <td

                            title={

                              t.unloadStartAt

                                ? new Date(t.unloadStartAt).toLocaleString(

                                    "ru-RU"

                                  )

                                : "-"

                            }

                          >

                            {t.unloadStartAt

                              ? new Date(

                                  t.unloadStartAt

                                ).toLocaleString("ru-RU")

                              : "-"}

                          </td>

                          <td

                            title={

                              t.unloadEndAt

                                ? new Date(t.unloadEndAt).toLocaleString(

                                    "ru-RU"

                                  )

                                : "-"

                            }

                          >

                            {t.unloadEndAt

                              ? new Date(t.unloadEndAt).toLocaleString(

                                  "ru-RU"

                                )

                              : "-"}

                          </td>

                          <td title={t.supplier || "-"}>{t.supplier || "-"}</td>

                          <td title={t.orderNumber || "-"}>{t.orderNumber || "-"}</td>

                          <td

                            title={

                              t.deliveryDate

                                ? new Date(t.deliveryDate).toLocaleDateString(

                                    "ru-RU"

                                  )

                                : "-"

                            }

                          >

                            {t.deliveryDate

                              ? new Date(

                                  t.deliveryDate

                                ).toLocaleDateString("ru-RU")

                              : "-"}

                          </td>

                          <td title={t.gate || "-"}>{t.gate || "-"}</td>

                          <td title={t.vehicleBrand || "-"}>{t.vehicleBrand || "-"}</td>

                          <td title={t.truckNumber || "-"}>{t.truckNumber || "-"}</td>

                          <td title={t.driverName || "-"}>{t.driverName || "-"}</td>

                          <td title={t.driverPhone || "-"}>{t.driverPhone || "-"}</td>

                          <td title={t.cargo || "-"}>{t.cargo || "-"}</td>

                          <td title={t.note || "-"}>{t.note || "-"}</td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

              )}

            </>

          )}

        </div>

      </div>

    </div>

  );

}

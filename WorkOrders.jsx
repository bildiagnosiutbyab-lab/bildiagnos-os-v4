import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import {
  controlOrderTimer,
  loadRelationalOrders,
  saveRelationalOrder,
  subscribeToRelationalOrders,
} from './ordersRepository.js';
import CommercialOrderFlow from './CommercialOrderFlow.jsx';
import CatalogOrderImport from './CatalogOrderImport.jsx';

const ORDERS_STORAGE_KEY = 'bildiagnos-orders';
const CENTRAL_STATE_KEY = 'central_state';

function parseStoredValue(value) {
  let parsed = value;

  for (let attempt = 0; attempt < 3 && typeof parsed === 'string'; attempt += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  return parsed;
}

function extractOrders(value) {
  const parsed = parseStoredValue(value);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, ORDERS_STORAGE_KEY)) {
    return extractOrders(parsed[ORDERS_STORAGE_KEY]);
  }

  for (const containerKey of ['state', 'data', 'storage', 'localStorage']) {
    if (Object.prototype.hasOwnProperty.call(parsed, containerKey)) {
      const orders = extractOrders(parsed[containerKey]);

      if (orders) {
        return orders;
      }
    }
  }

  return null;
}

function loadOrders() {
  const directOrders = extractOrders(
    window.localStorage.getItem(ORDERS_STORAGE_KEY)
  );
  const centralOrders = extractOrders(
    window.localStorage.getItem(CENTRAL_STATE_KEY)
  );

  if (centralOrders?.length) {
    return centralOrders;
  }

  return directOrders || centralOrders || [];
}

function saveOrders(orders) {
  window.localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));

  const currentCentralState = parseStoredValue(
    window.localStorage.getItem(CENTRAL_STATE_KEY)
  );
  const centralState =
    currentCentralState &&
    typeof currentCentralState === 'object' &&
    !Array.isArray(currentCentralState)
      ? currentCentralState
      : {};

  window.localStorage.setItem(
    CENTRAL_STATE_KEY,
    JSON.stringify({
      ...centralState,
      [ORDERS_STORAGE_KEY]: orders,
    })
  );
}

const STATUS_OPTIONS = [
  'Abierta',
  'En diagnóstico',
  'Esperando piezas',
  'En reparación',
  'Terminada',
  'Pagada',
  'Cancelada',
  'Garantía',
];

const emptyForm = {
  customer: '',
  plate: '',
  vehicle: '',
  mileage: '',
  requestedWork: '',
  diagnosis: '',
  dtc: '',
  status: 'Abierta',
};

function formatTime(totalSeconds = 0) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export default function WorkOrders() {
  const [showForm, setShowForm] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [, setClockTick] = useState(0);
  const [showPartForm, setShowPartForm] = useState(false);

  const [orders, setOrders] = useState(loadOrders);
  const [syncMessage, setSyncMessage] = useState('');
  const [timerBusy, setTimerBusy] = useState(false);

  const selectedOrder = orders.find((order) => order.id === selectedOrderId);

  useEffect(() => {
    saveOrders(orders);
  }, [orders]);


  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const cloudOrders = await loadRelationalOrders();
        if (active) setOrders(cloudOrders);
      } catch (error) {
        console.error('No se pudieron cargar las órdenes relacionales:', error);
        if (active) setSyncMessage('Sin conexión: usando copia local');
      }
    }
    refresh();
    const unsubscribe = subscribeToRelationalOrders(refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    const hasRunningTimer = orders.some((order) => order.timerStartedAt);

    if (!hasRunningTimer) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setClockTick((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [orders]);

  function getTotalSeconds(order) {
    const accumulated = Number(order.accumulatedSeconds || 0);

    if (!order.timerStartedAt) {
      return accumulated;
    }

    const currentSession = Math.floor(
      (Date.now() - Number(order.timerStartedAt)) / 1000
    );

    return accumulated + Math.max(0, currentSession);
  }

  async function updateOrder(orderId, changes) {
    const current = orders.find((order) => order.id === orderId);
    if (!current) return;
    const next = { ...current, ...changes, updatedAt: new Date().toLocaleString('sv-SE') };
    setOrders((items) => items.map((order) => order.id === orderId ? next : order));
    setSyncMessage('Guardando…');
    try {
      const saved = await saveRelationalOrder(next, current.version ?? null);
      setOrders((items) => items.map((order) => order.id === orderId ? saved : order));
      setSyncMessage('Guardado en Supabase');
    } catch (error) {
      console.error('No se pudo guardar la orden:', error);
      setSyncMessage(error.message?.includes('ORDER_VERSION_CONFLICT')
        ? 'Conflicto detectado: recargando la versión más reciente'
        : 'Error de sincronización');
      const latest = await loadRelationalOrders().catch(() => null);
      if (latest) setOrders(latest);
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function startNewOrder() {
    setEditingOrderId(null);
    setSelectedOrderId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function startEditOrder(order) {
    setEditingOrderId(order.id);

    setForm({
      customer: order.customer || '',
      plate: order.plate || '',
      vehicle: order.vehicle || '',
      mileage: order.mileage || '',
      requestedWork: order.requestedWork || '',
      diagnosis: order.diagnosis || '',
      dtc: order.dtc || '',
      status: order.status || 'Abierta',
    });

    setSelectedOrderId(null);
    setShowForm(true);
  }

  async function saveOrder() {
    if (!form.customer.trim() || !form.plate.trim()) {
      alert('Escribe como mínimo el cliente y la matrícula.');
      return;
    }

    if (editingOrderId) {
      await updateOrder(editingOrderId, {
        ...form,
        plate: form.plate.toUpperCase(),
      });
    } else {
      const newOrder = {
        id: Date.now(),
        ...form,
        plate: form.plate.toUpperCase(),
        accumulatedSeconds: 0,
        timerStartedAt: null,
        createdAt: new Date().toLocaleString('sv-SE'),
      };

      setSyncMessage('Guardando…');
      try {
        const saved = await saveRelationalOrder(newOrder, null);
        setOrders((currentOrders) => [saved, ...currentOrders]);
        setSyncMessage('Guardado en Supabase');
      } catch (error) {
        console.error('No se pudo crear la orden:', error);
        setSyncMessage('No se pudo guardar la orden');
        return;
      }
    }

    setForm(emptyForm);
    setEditingOrderId(null);
    setShowForm(false);
  }

  function cancelForm() {
    setForm(emptyForm);
    setEditingOrderId(null);
    setShowForm(false);
  }

  async function runTimerAction(order, action) {
    if (timerBusy) return;
    setTimerBusy(true);
    setSyncMessage('Guardando cronómetro…');
    try {
      const saved = await controlOrderTimer(order, action);
      setOrders((items) => items.map((item) => item.id === order.id ? saved : item));
      setSyncMessage('Cronómetro guardado en Supabase');
    } catch (error) {
      console.error('No se pudo guardar el cronómetro:', error);
      setSyncMessage('No se pudo guardar el cronómetro. Comprueba la conexión.');
      const latest = await loadRelationalOrders().catch(() => null);
      if (latest) setOrders(latest);
    } finally {
      setTimerBusy(false);
    }
  }

  function startTimer(order) {
    if (!order.timerStartedAt) runTimerAction(order, 'start');
  }

  function pauseTimer(order) {
    if (order.timerStartedAt) runTimerAction(order, 'pause');
  }

  function resetTimer(order) {
    if (window.confirm('¿Seguro que quieres poner el cronómetro en cero?')) {
      runTimerAction(order, 'reset');
    }
  }

  function changeStatus(orderId, status) {
    updateOrder(orderId, { status });
  }

  async function deleteOrder(orderId) {
    const confirmed = window.confirm(
      'La orden no se eliminará: se marcará como Cancelada. ¿Continuar?'
    );

    if (!confirmed) {
      return;
    }

    await updateOrder(orderId, { status: 'Cancelada' });
    setSelectedOrderId(null);
  }

  if (selectedOrder) {
    const totalSeconds = getTotalSeconds(selectedOrder);
    const timerRunning = Boolean(selectedOrder.timerStartedAt);

    return (
      <>
        <PageHeader
          title={`Orden #${selectedOrder.orderNumber ?? "—"} · ${selectedOrder.plate}`}
          subtitle={selectedOrder.customer}
        />

        <section className="card order-detail">
          <div className="order-card-header">
            <button className="plate">{selectedOrder.plate}</button>

            <span className="status warning">{selectedOrder.status}</span>
          </div>

          <h2>{selectedOrder.customer}</h2>

          <label className="status-control">
            Estado de la orden
            <select
              value={selectedOrder.status}
              onChange={(event) =>
                changeStatus(selectedOrder.id, event.target.value)
              }
            >
              {STATUS_OPTIONS.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <section className="timer-panel">
            <span>Tiempo de trabajo</span>

            <strong className="timer-display">
              {formatTime(totalSeconds)}
            </strong>

            <div className="timer-actions">
              {!timerRunning ? (
                <button
                  className="timer-start-button"
                  disabled={timerBusy}
                  onClick={() => startTimer(selectedOrder)}
                >
                  Iniciar
                </button>
              ) : (
                <button
                  className="timer-pause-button"
                  disabled={timerBusy}
                  onClick={() => pauseTimer(selectedOrder)}
                >
                  Pausar
                </button>
              )}

              <button
                className="secondary-button"
                disabled={timerBusy}
                onClick={() => resetTimer(selectedOrder)}
              >
                Reiniciar
              </button>
            </div>

            {timerRunning && (
              <small className="timer-running">Cronómetro activo</small>
            )}
          </section>
          <button
            className="primary-button"
            onClick={() => setShowPartForm(true)}
          >
           Agregar pieza a esta orden
          </button>
          {showPartForm && (
            <section className="card order-form">
              <label>
                Pieza
                <input
                  type="text"
                  placeholder="Nombre o número de artículo"
                />
              </label>

              <label>
                 Cantidad
                 <input 
                   type="number"
                   min="1"
                   defaultvalue="1"
                />
              </label>

              <label>
                 Proveedor
                 <input 
                   type="text"
                  placeholder="AD Bildelar, Bilxtra, Partslink24"
                 />
               </label>

               <label>
                 Coste
                 <input
                   type="number"
                   min="0"
                   step="0.01"
                   placeholder="Coste real"
                 />
               </label>

              </section>
              )}

          <p>
            <strong>Vehículo:</strong>{' '}
            {selectedOrder.vehicle || 'Sin especificar'}
          </p>

          <p>
            <strong>Kilometraje:</strong>{' '}
            {selectedOrder.mileage
              ? `${selectedOrder.mileage} km`
              : 'Sin especificar'}
          </p>

          <p>
            <strong>Trabajo solicitado:</strong>{' '}
            {selectedOrder.requestedWork || 'Sin descripción'}
          </p>

          <p>
            <strong>Diagnóstico:</strong>{' '}
            {selectedOrder.diagnosis || 'Sin diagnóstico'}
          </p>

          <p>
            <strong>DTC:</strong>{' '}
            {selectedOrder.dtc || 'Sin códigos registrados'}
          </p>

          <p>
            <strong>Creada:</strong> {selectedOrder.createdAt}
          </p>

          {selectedOrder.updatedAt && (
            <p>
              <strong>Actualizada:</strong> {selectedOrder.updatedAt}
            </p>
          )}

          <CatalogOrderImport order={selectedOrder} onSaved={async () => {
            const latest = await loadRelationalOrders();
            setOrders(latest);
          }} />
          <CommercialOrderFlow
            order={selectedOrder}
            onSaved={async () => {
              const latest = await loadRelationalOrders();
              setOrders(latest);
            }}
          />

          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => setSelectedOrderId(null)}
            >
              Volver
            </button>

            <button
              className="primary-button"
              onClick={() => startEditOrder(selectedOrder)}
            >
              Editar orden
            </button>

            <button
              className="danger-button"
              onClick={() => deleteOrder(selectedOrder.id)}
            >
              Eliminar orden
            </button>
          </div>
        </section>
      </>
    );
  }

  if (showForm) {
    return (
      <>
        <PageHeader
          title={
            editingOrderId
              ? 'Editar orden de trabajo'
              : 'Nueva orden de trabajo'
          }
          subtitle="Cliente, vehículo, diagnóstico y reparación"
        />

        <section className="card order-form">
          <label>
            Cliente
            <input
              name="customer"
              type="text"
              placeholder="Nombre del cliente"
              value={form.customer}
              onChange={handleChange}
            />
          </label>

          <label>
            Matrícula
            <input
              name="plate"
              type="text"
              placeholder="ABC 123"
              value={form.plate}
              onChange={handleChange}
            />
          </label>

          <label>
            Vehículo
            <input
              name="vehicle"
              type="text"
              placeholder="Marca, modelo y año"
              value={form.vehicle}
              onChange={handleChange}
            />
          </label>

          <label>
            Kilometraje
            <input
              name="mileage"
              type="number"
              placeholder="Kilómetros"
              value={form.mileage}
              onChange={handleChange}
            />
          </label>

          <label>
            Estado
            <select name="status" value={form.status} onChange={handleChange}>
              {STATUS_OPTIONS.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label>
            Trabajo solicitado
            <textarea
              name="requestedWork"
              placeholder="Describe el problema o trabajo solicitado"
              value={form.requestedWork}
              onChange={handleChange}
            />
          </label>

          <label>
            Diagnóstico
            <textarea
              name="diagnosis"
              placeholder="Pruebas realizadas y diagnóstico"
              value={form.diagnosis}
              onChange={handleChange}
            />
          </label>

          <label>
            DTC
            <input
              name="dtc"
              type="text"
              placeholder="Ejemplo: P0299"
              value={form.dtc}
              onChange={handleChange}
            />
          </label>

          <div className="form-actions">
            <button className="secondary-button" onClick={cancelForm}>
              Cancelar
            </button>

            <button className="primary-button" onClick={saveOrder}>
              {editingOrderId ? 'Guardar cambios' : 'Guardar orden'}
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Órdenes de trabajo"
        subtitle="Diagnóstico, reparación, tiempo y piezas"
        action="Crear orden"
        onAction={startNewOrder}
      />

      {syncMessage && <p className="auth-message">{syncMessage}</p>}

      {orders.length === 0 ? (
        <section className="card empty-state">
          <h2>No hay órdenes guardadas</h2>
          <p>Pulsa Crear orden para registrar el primer trabajo.</p>
        </section>
      ) : (
        <section className="orders-list">
          {orders.map((order) => (
            <article className="card order-card" key={order.id}>
              <div className="order-card-header">
                <button
                  className="plate"
                  onClick={() => setSelectedOrderId(order.id)}
                >
                  {order.plate}
                </button>

                <span className="status warning">
                  {order.status || 'Abierta'}
                </span>
              </div>

              <h2>{order.customer}</h2>\n\n              <p><strong>Orden:</strong> #{order.orderNumber ?? "—"}</p>

              <p>
                <strong>Vehículo:</strong> {order.vehicle || 'Sin especificar'}
              </p>

              <p>
                <strong>Kilometraje:</strong>{' '}
                {order.mileage ? `${order.mileage} km` : 'Sin especificar'}
              </p>

              <p>
                <strong>Trabajo:</strong>{' '}
                {order.requestedWork || 'Sin descripción'}
              </p>

              <p>
                <strong>Tiempo:</strong> {formatTime(getTotalSeconds(order))}
              </p>

              <button
                className="primary-button open-order-button"
                onClick={() => setSelectedOrderId(order.id)}
              >
                Abrir orden
              </button>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

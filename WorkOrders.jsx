import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';

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

  const [orders, setOrders] = useState(() => {
    const savedOrders = localStorage.getItem('bildiagnos-orders');

    try {
      return savedOrders ? JSON.parse(savedOrders) : [];
    } catch {
      return [];
    }
  });

  const selectedOrder = orders.find((order) => order.id === selectedOrderId);

  useEffect(() => {
    localStorage.setItem('bildiagnos-orders', JSON.stringify(orders));
  }, [orders]);

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

  function updateOrder(orderId, changes) {
    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              ...changes,
              updatedAt: new Date().toLocaleString('sv-SE'),
            }
          : order
      )
    );
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

  function saveOrder() {
    if (!form.customer.trim() || !form.plate.trim()) {
      alert('Escribe como mínimo el cliente y la matrícula.');
      return;
    }

    if (editingOrderId) {
      updateOrder(editingOrderId, {
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

      setOrders((currentOrders) => [newOrder, ...currentOrders]);
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

  function startTimer(order) {
    if (order.timerStartedAt) {
      return;
    }

    updateOrder(order.id, {
      timerStartedAt: Date.now(),
      status: order.status === 'Abierta' ? 'En reparación' : order.status,
    });
  }

  function pauseTimer(order) {
    if (!order.timerStartedAt) {
      return;
    }

    const sessionSeconds = Math.floor(
      (Date.now() - Number(order.timerStartedAt)) / 1000
    );

    updateOrder(order.id, {
      accumulatedSeconds:
        Number(order.accumulatedSeconds || 0) + Math.max(0, sessionSeconds),
      timerStartedAt: null,
    });
  }

  function resetTimer(order) {
    const confirmed = window.confirm(
      '¿Seguro que quieres poner el cronómetro en cero?'
    );

    if (!confirmed) {
      return;
    }

    updateOrder(order.id, {
      accumulatedSeconds: 0,
      timerStartedAt: null,
    });
  }

  function changeStatus(orderId, status) {
    updateOrder(orderId, { status });
  }

  function deleteOrder(orderId) {
    const confirmed = window.confirm(
      '¿Seguro que quieres eliminar esta orden?'
    );

    if (!confirmed) {
      return;
    }

    setOrders((currentOrders) =>
      currentOrders.filter((order) => order.id !== orderId)
    );

    setSelectedOrderId(null);
  }

  if (selectedOrder) {
    const totalSeconds = getTotalSeconds(selectedOrder);
    const timerRunning = Boolean(selectedOrder.timerStartedAt);

    return (
      <>
        <PageHeader
          title={`Orden ${selectedOrder.plate}`}
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
                  onClick={() => startTimer(selectedOrder)}
                >
                  Iniciar
                </button>
              ) : (
                <button
                  className="timer-pause-button"
                  onClick={() => pauseTimer(selectedOrder)}
                >
                  Pausar
                </button>
              )}

              <button
                className="secondary-button"
                onClick={() => resetTimer(selectedOrder)}
              >
                Reiniciar
              </button>
            </div>

            {timerRunning && (
              <small className="timer-running">Cronómetro activo</small>
            )}
          </section>

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

              <h2>{order.customer}</h2>

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

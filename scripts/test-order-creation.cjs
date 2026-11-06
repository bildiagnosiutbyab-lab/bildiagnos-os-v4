const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('WorkOrders.jsx', 'utf8');
const saveCode = source.slice(source.indexOf('  async function saveOrder()'), source.indexOf('  function cancelForm()'));

function makeForm(save) {
  let uuid = 0;
  const state = { busy: false, orders: [], message: '', alerts: [] };
  const scope = {
    form: { customer: 'Test customer', plate: 'ABC123', requestedWork: 'Service', status: 'Abierta' },
    editingOrderId: null, reserveAppointment: false, emptyForm: {},
    creationDraft: { current: null }, orderSaveInFlight: { current: false },
    crypto: { randomUUID: () => 'draft-' + ++uuid }, console: { error() {} },
    alert: value => state.alerts.push(value),
    setSavingOrder: value => { state.busy = value; },
    setSyncMessage: value => { state.message = value; },
    setOrders: update => { state.orders = update(state.orders); },
    setForm() {}, setEditingOrderId() {}, setShowForm() {},
    saveRelationalOrder: save,
  };
  vm.createContext(scope);
  vm.runInContext(saveCode + '\nthis.save = saveOrder;', scope);
  return { scope, state, save: () => scope.save() };
}

async function testForm() {
  let resolve;
  let calls = 0;
  const pending = new Promise(r => { resolve = r; });
  const form = makeForm(async order => { calls++; await pending; return { ...order, relationalId: 'row-1', orderNumber: 700001 }; });
  const first = form.save();
  const second = form.save();
  const third = form.save();
  assert.equal(calls, 1, 'three rapid events must issue only one create RPC');
  assert.equal(form.state.busy, true);
  // Simulate the realtime subscription delivering the same saved order first.
  form.state.orders = [{ id: 'draft-1', relationalId: 'row-1', orderNumber: 700001 }];
  resolve();
  await Promise.all([first, second, third]);
  assert.equal(form.state.orders.length, 1, 'RPC and realtime responses must not duplicate the UI card');
  assert.equal(form.state.busy, false);
  assert.ok(form.scope.creationDraft.current, 'completion retains identity against a queued late event');
  await form.save();
  assert.equal(form.state.orders.length, 1, 'a queued click after completion still resolves to the original order');

  const requests = [];
  let lost = true;
  const retry = makeForm(async order => {
    requests.push({ ...order });
    if (lost) { lost = false; throw new Error('response lost after commit'); }
    return { ...order, relationalId: 'original-row', orderNumber: 700001 };
  });
  await retry.save();
  assert.equal(retry.state.busy, false, 'failure releases the button');
  assert.ok(retry.scope.creationDraft.current, 'failed response retains the draft identity');
  await retry.save();
  assert.equal(requests[0].id, requests[1].id, 'retry uses the same idempotency key');
  assert.equal(requests[0].createdAt, requests[1].createdAt, 'retry retains the original draft date');
  await retry.save();
  assert.equal(requests[1].id, requests[2].id, 'a late event after success must retain the same identity');
  // Opening New explicitly resets this ref; the vehicle itself is not deduplicated.
  retry.scope.creationDraft.current = null;
  await retry.save();
  assert.notEqual(requests[2].id, requests[3].id, 'a deliberate new order for the same car gets a new identity');

  const edit = makeForm(async () => { throw new Error('edit must not create'); });
  edit.scope.editingOrderId = 'existing-order';
  edit.scope.updateOrder = async () => { throw new Error('version conflict'); };
  await edit.save();
  assert.equal(edit.scope.creationDraft.current, null, 'a failed edit must never create');
  assert.equal(edit.state.busy, false);
  edit.scope.editingOrderId = null;
  edit.scope.form.customer = '';
  await edit.save();
  assert.equal(edit.state.alerts.length, 1);
  assert.equal(edit.state.busy, false, 'invalid input releases the guard');
}

async function testRepository() {
  const code = fs.readFileSync('ordersRepository.js', 'utf8').replace(/^import .*;\n/m, '').replace(/export /g, '');
  const calls = [];
  const scope = { supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: args.p_order, error: null }; } } };
  vm.createContext(scope);
  vm.runInContext(code + '\nthis.save = saveRelationalOrder;', scope);
  await scope.save({ id: 'draft-1', customer: 'Test', plate: 'ABC123' }, null);
  assert.equal(calls[0].name, 'create_work_order_once');
  await assert.rejects(scope.save({ id: 'draft-1', relationalId: 'existing', orderNumber: 700001 }, null), /ORDER_CREATE_ID_MISMATCH/);
  await assert.rejects(scope.save({ customer: 'Test', plate: 'ABC123' }, null), /ORDER_CREATE_ID_MISMATCH/);
  assert.equal(calls.length, 1, 'invalid create requests are blocked before the RPC');
  const lookup = {
    select() { return this; }, eq() { return this; },
    async single() { return { data: { id: 'existing', legacy_order_id: 'original-key', order_number: 700002, version: 7 }, error: null }; },
  };
  scope.supabase.from = () => lookup;
  await scope.save({ id: 'display-id', relationalId: 'existing', orderNumber: 700002 }, 7);
  assert.equal(calls[1].name, 'save_work_order_legacy', 'edits retain the versioned RPC');
  assert.equal(calls[1].args.p_expected_version, 7);
  assert.equal(calls[1].args.p_order.id, 'original-key', 'edits resolve by their original database key');
  await assert.rejects(scope.save({ id: 'display-id', relationalId: 'existing', orderNumber: 700002 }, 6), /ORDER_VERSION_CONFLICT/);
  assert.equal(calls.length, 2, 'a stale edit never reaches a write RPC');
}

(async () => {
  await testForm();
  await testRepository();
  console.log('PASS: rapid submissions, retry identity, realtime deduplication, separate new orders, failed edits and create RPC routing; no production writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('CommercialOrderFlow.jsx', 'utf8');
const start = source.indexOf('<form className="commercial-inline-form" onSubmit={(event) => { event.preventDefault(); if (Math.abs(Number(paymentForm.amount)');
assert.ok(start >= 0, 'payment submit handler exists');
const handler = source.slice(start).split('onSubmit={')[1].split('}>')[0];

async function submit(amount, total, invoice = null) {
  let calls = 0;
  let message = '';
  const scope = {
    paymentForm: { amount }, displayedTotal: total, invoice,
    setMessage: value => { message = value; },
    confirmCommercialPayment: async () => { calls++; return null; },
    context: {}, run: action => action(),
  };
  const callback = vm.runInNewContext('(' + handler + ')', scope);
  callback({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, message };
}

(async () => {
  assert.equal((await submit('2401.00', 2401.25)).calls, 1, 'rounded Swish reaches payment registration');
  assert.equal((await submit('2401.25', 2401.25)).calls, 0, 'unrounded amount is blocked');
  assert.equal((await submit('2400.00', 2401.25)).calls, 0, 'underpayment is blocked');
  assert.equal((await submit('2402.00', 2401.25)).calls, 0, 'overpayment is blocked');
  assert.equal((await submit('2402.00', 2401.75)).calls, 1, 'upward rounding is accepted');
  assert.equal((await submit('300.00', 300)).calls, 1, 'whole amounts remain accepted');
  assert.equal((await submit('2401.00', 2401.25, { total: 2500 })).calls, 0, 'mismatched historical invoice remains blocked');
  assert.equal((await submit('2401.00', 2401.25, { total: 2401.25 })).calls, 1, 'matching invoice keeps its accounting total');
  const receiptCode = source.slice(source.indexOf('  const receiptSubtotal ='), source.indexOf('  const receiptPayable ='));
  const receipt = vm.runInNewContext(receiptCode + '\n({ receiptSubtotal, receiptVat, receiptAccountingTotal });', {
    receiptInvoice: null, receiptLines: [{ quantity: 0.7, unit_price: 1000 }, { quantity: 4, unit_price: 283 }, { quantity: 1, unit_price: 89 }],
    lastReceipt: { payment: { amount: 2401 } },
  });
  assert.equal(receipt.receiptSubtotal, 1921);
  assert.equal(receipt.receiptVat, 480.25);
  assert.equal(receipt.receiptAccountingTotal, 2401.25);
  assert.equal(2401 - receipt.receiptAccountingTotal, -0.25);
  assert.ok(source.includes('{lastReceipt && Math.abs(receiptPayable - receiptAccountingTotal)'), 'cash receipt renders rounding without requiring an invoice');
  console.log('Payment rounding: 13 behavior checks passed (no database writes).');
})().catch(error => { console.error(error); process.exitCode = 1; });

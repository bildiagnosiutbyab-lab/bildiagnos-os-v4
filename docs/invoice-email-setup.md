# Invoice email from Bildiagnos OS

The application previews the exact PDF attachment before sending. Each send checks
the official Fortnox identity, amount, recipient and PDF hash again. A unique
delivery record and an atomic job claim block duplicates, including uncertain
SMTP outcomes. Sending never books an invoice or registers a payment.

The Work Gmail connector is separate from the deployed application. Gmail's host,
port and workshop address are preconfigured. To activate sending, the account owner
only needs to add `SMTP_PASSWORD` with a Google app password directly in Supabase
Edge Function Secrets. Never enter the account's normal password.

The following optional settings override the built-in Gmail defaults:

| Secret | Gmail value |
| --- | --- |
| SMTP_HOSTNAME | smtp.gmail.com |
| SMTP_PORT | 465 |
| SMTP_USERNAME | The workshop Gmail address |
| SMTP_FROM | The same workshop Gmail address |

Required secret: `SMTP_PASSWORD` = the Google app password, entered privately.

Never put the app password in chat, source code, browser storage or a public build.
Google may require two-step verification before allowing app passwords. The
account owner must create and enter that credential themselves. The configured
sender must match the workshop email verified against Fortnox.

Until configuration exists, the application allows PDF review but disables sending
and explains that the workshop email needs connecting. `status.email.configured`
is a boolean only; credentials are never returned to the browser.

To activate, configure the secrets, refresh the order, review the PDF and confirm
the destination and amount. Test SMTP delivery only with an explicitly authorized
test recipient. Do not resend an existing invoice as a test.

Invoice 300081 was already sent through the Work Gmail connector. Its confirmed
delivery receipt is recorded in `invoice_email_deliveries`; the send button is
blocked for that order. Fortnox's own Sent flag is not changed by an external email.

Validation: `npm run build`, `node scripts/test-invoice-document.cjs`, and
`node scripts/test-invoice-email.cjs`. The email test uses a mock mail transport
and sends no real messages.

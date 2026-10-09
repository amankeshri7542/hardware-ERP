#!/usr/bin/env node
// Keep the manual entrypoint contained; never load environment files or query invoices.
require('../src/utils/pdf').generateInvoicePDF().catch((error) => {
  console.error(error.errorCode);
  process.exitCode = 1;
});

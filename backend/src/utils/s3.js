const { disabledDocumentError } = require('./documentContainment');

// Document storage is contained for every configured driver, including legacy local:// paths.
async function uploadInvoicePDF() { throw disabledDocumentError('PDF'); }
async function getPresignedUrl() { throw disabledDocumentError('ATTACHMENT'); }

module.exports = { uploadInvoicePDF, getPresignedUrl };

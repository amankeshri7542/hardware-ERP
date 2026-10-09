function disabledDocumentError(feature) {
  const error = new Error(feature === 'PDF'
    ? 'PDF generation and downloads are disabled pending renderer isolation verification.'
    : 'Supplier attachments are disabled pending document safety verification.');
  error.statusCode = 503;
  error.errorCode = feature === 'PDF' ? 'PDF_DISABLED' : 'ATTACHMENTS_DISABLED';
  return error;
}

module.exports = { disabledDocumentError };

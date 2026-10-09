const { disabledDocumentError } = require('../utils/documentContainment');

async function addPdfJob() { throw disabledDocumentError('PDF'); }
module.exports = { addPdfJob };

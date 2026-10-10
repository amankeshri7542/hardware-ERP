const { fail } = require('../../utils/financial');
function enabled() { return process.env.NODE_ENV === 'test' && process.env.DOCUMENT_RUNTIME_MODE === 'synthetic-local'; }
function requireEnabled() { if (!enabled()) fail('DOCUMENTS_DISABLED', 503); }
function seller() {
  if (process.env.NODE_ENV !== 'test' || process.env.DOCUMENT_SELLER_CONFIRMED !== 'true') fail('DOCUMENT_SELLER_SNAPSHOT_REQUIRED');
  const name = process.env.STORE_NAME, address = process.env.STORE_ADDRESS;
  if (!name?.trim() || !address?.trim() || name.length > 240 || address.length > 800) fail('DOCUMENT_SELLER_SNAPSHOT_REQUIRED');
  const tax_id = process.env.STORE_GSTIN || 'Unknown / not supplied';
  if (tax_id.length > 100 || [name,address,tax_id].some(value=>Array.from(value).some(char=>{const code=char.codePointAt(0);return (code<32&&!['\t','\n','\r'].includes(char))||code===127||(code>=8234&&code<=8238)||(code>=8294&&code<=8297);}))) fail('DOCUMENT_SELLER_SNAPSHOT_REQUIRED');
  return { name, address, tax_id };
}
module.exports = { enabled, requireEnabled, seller };

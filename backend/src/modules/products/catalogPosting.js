const { pool } = require('../../config/db');
const { decimal, format, fail, positiveId, date } = require('../../utils/financial');
const { withIdempotency } = require('../../utils/idempotency');

const textFields = {name:255,category:100,brand:100,sku:50,barcode:50,unit:20,base_unit:20,hsn_code:8};
const priceFields = ['mrp','wholesale_price','purchase_price'];
const version = value => decimal(value,0,'version',{max:9223372036854775806n}).toString();
function object(input, allowed) {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key))) fail('UNSUPPORTED_CATALOG_FIELD');
}
function conversions(input, baseUnit) {
  if (!Array.isArray(input) || input.length>50) fail('INVALID_CONVERSIONS');
  const names=new Set();
  return input.map(row=>{
    object(row,['id','unit_name','conversion_value','is_sales_unit','is_purchase_unit']);
    if (typeof row.unit_name!=='string' || !row.unit_name.trim() || row.unit_name.trim().length>20) fail('INVALID_CONVERSION_UNIT');
    const name=row.unit_name.trim();
    if (names.has(name) || name===baseUnit) fail('DUPLICATE_CONVERSION_UNIT');
    names.add(name);
    if (typeof row.is_sales_unit!=='boolean' || typeof row.is_purchase_unit!=='boolean') fail('CONVERSION_FLAGS_REQUIRED');
    return {unit_name:name,conversion_value:format(decimal(row.conversion_value,4,'conversion',{min:1n}),4),
      is_sales_unit:row.is_sales_unit,is_purchase_unit:row.is_purchase_unit};
  }).sort((a,b)=>a.unit_name.localeCompare(b.unit_name));
}
function normalize(input, create=false) {
  if (!create && Object.hasOwn(input||{},'current_stock')) fail('STOCK_COMMAND_REQUIRED');
  object(input,[...Object.keys(textFields),...priceFields,'gst_rate','min_stock','is_active','conversions','expected_catalog_version',...(create?['current_stock']:[])]);
  const result={};
  for (const [field,max] of Object.entries(textFields)) {
    if (input[field]===undefined) continue;
    if (input[field]===null && !['name','category','unit','base_unit'].includes(field)) {result[field]=null;continue;}
    if (typeof input[field]!=='string' || input[field].trim().length>max) fail('INVALID_PRODUCT_TEXT');
    result[field]=input[field].trim();
    if (['name','category','unit','base_unit'].includes(field) && !result[field]) fail('INVALID_PRODUCT_TEXT');
    if (['sku','barcode'].includes(field) && !result[field]) result[field]=null;
  }
  for (const field of priceFields) if (input[field]!==undefined) result[field]=format(decimal(input[field],2));
  for (const field of ['min_stock','current_stock']) if (input[field]!==undefined) result[field]=format(decimal(input[field],3),3);
  if (input.gst_rate!==undefined) {
    result.gst_rate=format(decimal(input.gst_rate,2));
    if (!['0.00','5.00','12.00','18.00','28.00'].includes(result.gst_rate)) fail('INVALID_GST_RATE');
  }
  if (input.is_active!==undefined) {
    if(typeof input.is_active!=='boolean') fail('INVALID_PRODUCT_ACTIVE');
    result.is_active=input.is_active;
  }
  if (input.expected_catalog_version!==undefined) result.expected_catalog_version=version(input.expected_catalog_version);
  if (create) {
    if (!result.name || !result.category || !result.unit) fail('PRODUCT_FIELDS_REQUIRED');
    result.base_unit ||= result.unit;
    if(result.unit!==result.base_unit) fail('BASE_UNIT_CONFLICT');
    for(const field of priceFields) result[field] ??= '0.00';
    result.current_stock ??= '0.000';result.gst_rate ??= '0.00';result.min_stock ??= '0.000';result.is_active ??=true;
  }
  if (input.conversions!==undefined) result.conversions=conversions(input.conversions,result.base_unit||result.unit);
  return result;
}
async function replaceConversions(client,productId,rows,baseUnit) {
  const normalized=conversions(rows,baseUnit);
  const existing=(await client.query('SELECT * FROM product_unit_conversions WHERE product_id=$1 ORDER BY id FOR UPDATE',[productId])).rows;
  const byName=new Map(existing.map(row=>[row.unit_name,row]));
  let changed=false;
  for(const row of normalized) {
    const old=byName.get(row.unit_name);byName.delete(row.unit_name);
    if(old && old.conversion_value===row.conversion_value && old.is_sales_unit===row.is_sales_unit && old.is_purchase_unit===row.is_purchase_unit) continue;
    changed=true;
    if(old) await client.query('UPDATE product_unit_conversions SET conversion_value=$1,is_sales_unit=$2,is_purchase_unit=$3 WHERE id=$4',
      [row.conversion_value,row.is_sales_unit,row.is_purchase_unit,old.id]);
    else await client.query('INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit,is_purchase_unit) VALUES($1,$2,$3,$4,$5)',
      [productId,row.unit_name,row.conversion_value,row.is_sales_unit,row.is_purchase_unit]);
  }
  if(byName.size) {changed=true;await client.query('DELETE FROM product_unit_conversions WHERE product_id=$1 AND id=ANY($2::integer[])',[productId,[...byName.values()].map(row=>row.id)]);}
  return changed;
}
async function recordPrice(client,product,userId) {
  const {rows:[clock]}=await client.query('SELECT clock_timestamp()::text AS changed_at');
  await client.query('UPDATE product_price_history SET effective_to=$2 WHERE product_id=$1 AND effective_to IS NULL',[product.id,clock.changed_at]);
  await client.query(`INSERT INTO product_price_history(product_id,purchase_price,wholesale_price,mrp,source,changed_by,effective_from)
    VALUES($1,$2,$3,$4,'manual',$5,$6)`,[product.id,product.purchase_price,product.wholesale_price,product.mrp,userId,clock.changed_at]);
}
function uniqueError(error) {
  if(error.code==='23505' && error.constraint?.includes('sku')) fail('DUPLICATE_SKU',409);
  if(error.code==='23505' && error.constraint?.includes('barcode')) fail('DUPLICATE_BARCODE',409);
  throw error;
}
async function createProduct(input,userId,key) {
  const intent=normalize(input,true);
  try {
    return await withIdempotency({actorId:userId,operation:'product.create',key,intent},async client=>{
      const {conversions:units=[],expected_catalog_version:_ignored,...data}=intent;
      const columns=Object.keys(data);
      const {rows:[product]}=await client.query(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(data));
      await replaceConversions(client,product.id,units,product.base_unit);
      await recordPrice(client,product,userId);
      await client.query(`INSERT INTO stock_ledger(product_id,date,movement_type,reference_id,reference_type,qty_in,qty_out,stock_after,notes,created_by)
        VALUES($1,(CURRENT_TIMESTAMP AT TIME ZONE (SELECT timezone FROM shop_finance_config WHERE id=true))::date,'in',$1,'opening',$2,0,$2,'Opening stock',$3)`,[product.id,product.current_stock,userId]);
      return {status:201,body:{success:true,data:product}};
    });
  } catch(error) {uniqueError(error);}
}
async function updateProduct(id,input,userId) {
  id=positiveId(id);const data=normalize(input);
  if(!Object.keys(data).some(key=>key!=='expected_catalog_version')) fail('NO_FIELDS');
  if((data.conversions!==undefined || priceFields.some(field=>data[field]!==undefined)) && data.expected_catalog_version===undefined) fail('CATALOG_VERSION_REQUIRED');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows:[old]}=await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[id]);
    if(!old) fail('PRODUCT_NOT_FOUND',404);
    if(data.expected_catalog_version!==undefined && data.expected_catalog_version!==old.catalog_version) fail('CATALOG_CHANGED',409);
    const nextBase=data.base_unit??data.unit??old.base_unit??old.unit;
    if((data.unit!==undefined || data.base_unit!==undefined) && ((data.unit??nextBase)!==nextBase)) fail('BASE_UNIT_CONFLICT');
    if(nextBase!==(old.base_unit||old.unit)) {
      const history=await client.query(`SELECT 1 FROM stock_ledger WHERE product_id=$1 UNION ALL
        SELECT 1 FROM invoice_items WHERE product_id=$1 UNION ALL SELECT 1 FROM purchase_items WHERE product_id=$1 LIMIT 1`,[id]);
      if(decimal(old.current_stock,3)>0n || history.rowCount) fail('BASE_UNIT_CHANGE_UNSUPPORTED');
      data.unit=nextBase;data.base_unit=nextBase;
    }
    const {conversions:units,expected_catalog_version:_expected,...fields}=data;
    let saved=old;
    const names=Object.keys(fields);
    if(names.length) saved=(await client.query(`UPDATE products SET ${names.map((name,i)=>`${name}=$${i+1}`).join(',')},updated_at=NOW() WHERE id=$${names.length+1} RETURNING *`,[...Object.values(fields),id])).rows[0];
    if(units!==undefined && await replaceConversions(client,id,units,nextBase)) {
      saved=(await client.query('UPDATE products SET catalog_version=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,(BigInt(old.catalog_version)+1n).toString()])).rows[0];
    }
    if(priceFields.some(field=>saved[field]!==old[field])) await recordPrice(client,saved,userId);
    await client.query('COMMIT');return saved;
  } catch(error) {await client.query('ROLLBACK');uniqueError(error);} finally {client.release();}
}
async function adjustStock(id,input,userId,key) {
  object(input,['counted_stock','expected_stock','expected_stock_version','reason','date']);
  if(typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>500) fail('STOCK_REASON_REQUIRED');
  const intent={product_id:positiveId(id),counted_stock:format(decimal(input.counted_stock,3),3),
    expected_stock:format(decimal(input.expected_stock,3),3),expected_stock_version:version(input.expected_stock_version),
    reason:input.reason.trim(),date:date(input.date)};
  return withIdempotency({actorId:userId,operation:'stock.adjust',key,intent},async client=>{
    const {rows:[product]}=await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[intent.product_id]);
    if(!product?.is_active) fail('PRODUCT_UNAVAILABLE');
    if(product.current_stock!==intent.expected_stock || product.stock_version!==intent.expected_stock_version) fail('STOCK_CHANGED',409);
    const {rows:[history]}=await client.query(`SELECT COALESCE(SUM(qty_in-qty_out),0)=$2::numeric AS balanced,
      COALESCE(BOOL_AND(qty_in>=0 AND qty_out>=0),true) AS valid FROM stock_ledger WHERE product_id=$1`,[product.id,product.current_stock]);
    if(!history.valid || !history.balanced) fail('STOCK_RECONCILIATION_REQUIRED');
    const delta=decimal(intent.counted_stock,3)-decimal(product.current_stock,3);
    const {rows:[saved]}=await client.query('UPDATE products SET current_stock=$1,stock_version=stock_version+1,updated_at=NOW() WHERE id=$2 RETURNING current_stock,stock_version',[intent.counted_stock,product.id]);
    const {rows:[movement]}=await client.query(`INSERT INTO stock_ledger(product_id,date,movement_type,reference_id,reference_type,qty_in,qty_out,stock_after,notes,created_by)
      VALUES($1,$2,'adjustment',$1,'stock_count',$3,$4,$5,$6,$7) RETURNING id`,
    [product.id,intent.date,format(delta>0n?delta:0n,3),format(delta<0n?-delta:0n,3),saved.current_stock,intent.reason,userId]);
    return {status:201,body:{success:true,data:{adjustment_id:movement.id,product_id:product.id,...saved}}};
  });
}
module.exports={createProduct,updateProduct,adjustStock};

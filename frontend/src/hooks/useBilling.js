import { useState, useCallback, useMemo, useRef } from 'react';
import { calculateLineItem, calculateInvoiceTotals, getPaymentStatus, decimal, moneyDifference, moneySum, scaled } from '../utils/billing.calculations.js';
import { createInvoice, quoteInvoice } from '../api/invoices.api.js';
import { financialError } from '../utils/financialIntent.js';
import { useFinancialMutation } from './useFinancialMutation.js';
const emptyPayment = () => ({amount_paid:'0.00',modes:[],due_date:null});
export const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };

export function useBilling(initialBillType = 'retail') {
  const mutation = useFinancialMutation('invoice',createInvoice);
  const saved = mutation.intent?.snapshot;
  const [customer,setCustomerState] = useState(saved?.customer || null);
  const [billType,setBillTypeState] = useState(saved?.billType || initialBillType);
  const [items,setItems] = useState(saved?.items || []);
  const [payment,setPayment] = useState(saved?.payment || emptyPayment());
  const [errors,setErrors] = useState({});
  const [review,setReview] = useState(null);
  const [quoting,setQuoting] = useState(false);
  const revision = useRef(0);
  const quoteLock = useRef(false);
  const invalidate = () => { revision.current++; setReview(null); setErrors({}); };
  const change = fn => { if (mutation.locked) return; invalidate(); fn(); };
  const setCustomer = cust => change(() => { setCustomerState(cust); if(cust) setBillTypeState(cust.type === 'wholesale' ? 'wholesale' : 'retail'); });
  const setBillType = value => change(() => setBillTypeState(value));
  const preview = item => { try { return calculateLineItem(item); } catch(error) { return {...item,preview_error:error.message,gross_amount:'0.00',line_discount:'0.00',taxable_amount:'0.00',gst_amount:'0.00',line_total:'0.00'}; } };
  const addItem = product => {
    const index=items.length;
    change(() => setItems(prev => [...prev,preview({product_id:product.id,product_name_snapshot:product.name,hsn_snapshot:product.hsn_code || '',qty:'1.000',
      unit:product.base_unit || product.unit,base_unit:product.base_unit || product.unit,rate:decimal(billType==='wholesale' ? product.wholesale_price || product.mrp || '0' : product.mrp || '0'),
      discount_kind:'pct',discount_pct:'0.00',discount_amount:'0.00',gst_pct:decimal(product.gst_rate || '0'),_conversionValue:'1'})]));
    return index;
  };
  const updateItemFields = (index,fields) => change(() => setItems(prev => prev.map((item,i) => i !== index ? item : preview({...item,preview_error:null,...fields}))));
  const updateItem = (index,field,value) => updateItemFields(index,{[field]:value ?? ''});
  const removeItem = index => change(() => setItems(prev => prev.filter((_,i) => i !== index)));
  const totals = useMemo(() => calculateInvoiceTotals(items),[items]);
  let balanceDue='0.00',paymentStatus='unpaid';
  try { balanceDue=moneyDifference(totals.grand_total,payment.amount_paid || '0'); paymentStatus=getPaymentStatus(totals.grand_total,payment.amount_paid || '0'); } catch { /* Incomplete input is validated before quote. */ }
  const setPaymentAmount = amount => change(() => setPayment(prev => ({...prev,amount_paid:amount ?? ''})));
  const addPaymentMode = (mode,amount,reference_no='') => change(() => setPayment(prev => ({...prev,modes:[...prev.modes,{mode,amount,reference_no}]})));
  const removePaymentMode = index => change(() => setPayment(prev => ({...prev,modes:prev.modes.filter((_,i) => i !== index)})));
  const setFullPayment = (amount,mode='cash') => change(() => setPayment(prev=>({...prev,amount_paid:amount,modes:scaled(amount)>0n ? [{mode,amount,reference_no:''}] : []})));
  const setDueDate = date => change(() => setPayment(prev => ({...prev,due_date:date})));
  const submitInvoice = async (overrides = {}) => {
    if(mutation.locked || quoteLock.current) return null;
    setErrors({});
    const effCustomer = Object.hasOwn(overrides,'customer') ? overrides.customer : customer;
    const effType = overrides.billType || billType;
    const effPayment = overrides.payment || payment;
    if(!items.length) {setErrors({items:'Add at least one item'});return null;}
    if(items.some(item=>item.preview_error)) {setErrors({items:'Correct the quantity, rate or discount shown in the items'});return null;}
    if(effType !== 'quickbill' && !effCustomer?.id) {setErrors({customer:'Select a registered customer'});return null;}
    quoteLock.current=true;setQuoting(true);
    const version=revision.current;
    try {
      const canonicalPayment={amount_paid:decimal(effPayment.amount_paid || '0'),modes:effPayment.modes.map(mode=>({...mode,amount:decimal(mode.amount)})),due_date:effPayment.due_date || null};
      if(moneySum(canonicalPayment.modes.map(mode=>mode.amount)) !== canonicalPayment.amount_paid) throw new Error('Payment methods must add up exactly to the amount paid. Add each tender below.');
      const payload={customer_id:effCustomer?.id || null,customer_name_walkin:effType==='quickbill' && !effCustomer?.id ? effCustomer?.name || null : null,bill_type:effType,date:localDate(),
        items:items.map(item=>({product_id:item.product_id,qty:decimal(item.qty,3),unit:item.unit,rate:decimal(item.rate),
          ...(item.discount_kind==='amount' ? {discount_amount:decimal(item.discount_amount || '0')} : {discount_pct:decimal(item.discount_pct || '0')})})),payment:canonicalPayment};
      const {data}=await quoteInvoice({...payload,payment:{amount_paid:'0.00',modes:[],due_date:null}});
      if(revision.current !== version) {setErrors({submit:'The draft changed while totals were checked. Review it again.'});return null;}
      const quote=data.data;
      // Quick Bill explicitly reviews the full quoted cash/UPI amount before confirmation.
      if(overrides.payFullMode) payload.payment={amount_paid:quote.totals.grand_total,modes:scaled(quote.totals.grand_total)>0n ? [{mode:overrides.payFullMode,amount:quote.totals.grand_total,reference_no:''}] : [],due_date:null};
      const due=moneyDifference(quote.totals.grand_total,payload.payment.amount_paid);
      if(scaled(payload.payment.amount_paid)>scaled(quote.totals.grand_total)) throw new Error('Payment exceeds the quoted total. Correct the tender before confirming.');
      if(!payload.customer_id && due !== '0.00') throw new Error('Walk-in customers must pay the quoted total in full. Select a registered customer to allow dues.');
      if(due !== '0.00' && (!payload.payment.due_date || payload.payment.due_date < payload.date)) throw new Error('Choose a due date on or after the invoice date.');
      const changed=quote.totals.grand_total !== totals.grand_total || quote.items.some((item,index)=>item.base_qty !== items[index].base_qty || item.gst_pct !== items[index].gst_pct);
      setReview({quote,payload:{...payload,quote_hash:quote.quote_hash},changed,version,snapshot:{customer:effCustomer,billType:effType,items,payment:payload.payment}});
    } catch(error) {setErrors({submit:error.response?.data?.code ? financialError(error.response.data.code) : error.message || 'Could not check invoice totals'});}
    finally {quoteLock.current=false;setQuoting(false);}
    return null;
  };
  const confirmInvoice = async () => {
    if(!review || review.version !== revision.current) {setReview(null);return null;}
    const result=await mutation.run(review.payload,review.snapshot);
    setReview(null);return result;
  };
  const editRejected = async () => {if(await mutation.clear()) {setReview(null);setErrors({submit:'The previous request was not recorded. Review the corrected draft before confirming again.'});}};
  const resetBilling = useCallback(async () => {
    if(!await mutation.clear()) return false;
    revision.current++;setReview(null);setCustomerState(null);setBillTypeState(initialBillType);setItems([]);setPayment(emptyPayment());setErrors({});return true;
  },[mutation,initialBillType]);
  return {customer,setCustomer,billType,setBillType,items,addItem,updateItem,updateItemFields,removeItem,payment,setPaymentAmount,addPaymentMode,removePaymentMode,setDueDate,setFullPayment,
    isSubmitting:quoting || mutation.busy,errors,setErrors,totals,balanceDue,paymentStatus,submitInvoice,resetBilling,review,cancelReview:()=>setReview(null),confirmInvoice,
    draftChanged:()=>change(()=>{}),intent:mutation.intent,locked:mutation.locked,retryInvoice:()=>mutation.run(),editRejected,invoiceResult:mutation.intent?.status==='completed' ? mutation.intent.result : null};
}

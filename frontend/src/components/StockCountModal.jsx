import React, {useEffect,useState} from 'react';
import {Modal,InputNumber,Input,Button,Space,Typography,Alert} from 'antd';
import {adjustStock} from '../api/products.api';
import {useFinancialMutation} from '../hooks/useFinancialMutation.js';
import {localDate} from '../hooks/useBilling.js';
import {decimal} from '../utils/billing.calculations.js';
import FinancialRecovery from './FinancialRecovery.jsx';

export default function StockCountModal({product,open,onClose,onSuccess}) {
  const mutation=useFinancialMutation('stock-adjustment',adjustStock);
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [baseline,setBaseline]=useState(null);
  const [quantity,setQuantity]=useState('0');
  const [reason,setReason]=useState('');
  const [date,setDate]=useState(localDate());
  const [error,setError]=useState(null);
  useEffect(()=>{
    if(open && !mutation.intent) {setBaseline(product);setQuantity(product.current_stock);setError(null);}
  },[open,product]);
  const close=()=>{setRecoveryOpen(false);onClose();};
  const submit=async()=>{
    try {
      if(!baseline || !reason.trim()) throw new Error('Enter the count reason.');
      setError(null);
      await mutation.run({product_id:baseline.id,counted_stock:decimal(quantity,3),expected_stock:baseline.current_stock,
        expected_stock_version:baseline.stock_version,reason,date},{product_name:baseline.name,base_unit:baseline.base_unit||baseline.unit});
    } catch(error) {setError(error.message);}
  };
  return <>
    {mutation.intent && !open && !recoveryOpen && <Button onClick={()=>setRecoveryOpen(true)}>Recover stock count</Button>}
    <Modal title="Count stock" open={open||recoveryOpen} onCancel={close} footer={null}>
      {mutation.intent ? <FinancialRecovery mutation={mutation} label="Stock count" currentTarget={product.id} targetHref={`/products/${mutation.intent.payload?.product_id}`}
        onComplete={result=>{onSuccess?.(result);close();}}
        onEdit={saved=>{setReason(saved.payload.reason);setQuantity(saved.payload.counted_stock);setDate(saved.payload.date);setBaseline(null);setError('Reload the product and perform a fresh count before submitting again.');}}>
        {mutation.intent.result && <Typography.Text>Stock after count: {mutation.intent.result.current_stock}</Typography.Text>}
      </FinancialRecovery> : <Space direction="vertical" style={{width:'100%'}}>
        <Typography.Text>{product.name}: expected stock {baseline?.current_stock??'Reload required'} {product.base_unit||product.unit}</Typography.Text>
        <Typography.Text type="secondary">Use an immediate count of this stock location. A sale or receipt during the count requires a fresh count.</Typography.Text>
        <label>Counted stock<InputNumber aria-label="Counted stock" stringMode min="0" precision={3} value={quantity} onChange={setQuantity} /></label>
        <label>Count reason<Input aria-label="Count reason" value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} /></label>
        <label>Count date<Input aria-label="Count date" type="date" value={date} onChange={event=>setDate(event.target.value)} /></label>
        {error && <Alert type="error" showIcon message={error} />}
        <Button type="primary" onClick={submit} disabled={!baseline}>Confirm stock count</Button>
        {!baseline && <Button onClick={()=>{onSuccess?.();close();}}>Reload product for a new count</Button>}
      </Space>}
    </Modal>
  </>;
}

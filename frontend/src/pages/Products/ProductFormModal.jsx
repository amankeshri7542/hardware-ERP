import React, { useEffect, useState } from 'react';
import {
  Modal, Form, Input, InputNumber, Select, Switch, AutoComplete,
  message, Spin, Button, Space, Typography, Alert,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { createProduct, updateProduct, getProduct } from '../../api/products.api';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import { decimal } from '../../utils/billing.calculations.js';
import { financialError } from '../../utils/financialIntent.js';
import FinancialRecovery from '../../components/FinancialRecovery.jsx';

const { Text } = Typography;

const UNIT_SUGGESTIONS = [
  'piece', 'kg', 'gram', 'litre', 'ml', 'metre', 'cm', 'box', 'carton',
  'dozen', 'bundle', 'bag', 'packet', 'set', 'roll', 'sheet', 'pair',
  'tin', 'bottle', 'can', 'sack',
];

const GST_OPTIONS = [
  { label: '0%', value: 0 },
  { label: '5%', value: 5 },
  { label: '12%', value: 12 },
  { label: '18%', value: 18 },
  { label: '28%', value: 28 },
];

const CATEGORY_OPTIONS = [
  'Hardware', 'Plumbing', 'Electrical', 'Paint', 'Tools',
  'Cement', 'Steel', 'Sanitary', 'Pipes', 'Adhesive',
  'Waterproofing', 'Wood', 'Glass', 'Iron & Steel',
];

export default function ProductFormModal({ open, onClose, onSuccess, productId }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [baseline,setBaseline]=useState(null);
  const [error,setError]=useState(null);
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [createRecovery,setCreateRecovery]=useState(false);
  const mutation=useFinancialMutation('product-create',createProduct);
  const isEdit = !!productId && !createRecovery;
  const close=()=>{setRecoveryOpen(false);setCreateRecovery(false);onClose();};
  const load=async()=>{
    setFetching(true);setError(null);
    try {
      const product=await getProduct(productId);
      const data=product.data.data;
      if(!Array.isArray(data.conversions)) throw new Error('Missing catalog snapshot');
      setBaseline(data);form.setFieldsValue(data);
    } catch {setBaseline(null);setError('Could not load the complete product. Retry before saving.');}
    finally {setFetching(false);}
  };
  useEffect(()=>{
    if(!open || mutation.intent) return;
    if(productId) load();
    else {form.resetFields();form.setFieldsValue({unit:'piece',gst_rate:18,min_stock:0,current_stock:0,is_active:true,conversions:[]});}
  },[open,productId,form]);
  const handleSubmit=async()=>{
    if(mutation.locked) return;
    setError(null);
    try {
      const values=await form.validateFields();setLoading(true);
      const {conversions=[],current_stock,...fields}=values;
      const units=conversions.map(row=>({unit_name:row.unit_name,conversion_value:decimal(row.conversion_value,4),
        is_sales_unit:row.is_sales_unit,is_purchase_unit:row.is_purchase_unit}));
      if(isEdit) {
        if(!baseline) throw new Error('Reload the product before saving.');
        const data={expected_catalog_version:baseline.catalog_version};
        const originalUnits=baseline.conversions.map(row=>({unit_name:row.unit_name,conversion_value:decimal(row.conversion_value,4),is_sales_unit:row.is_sales_unit,is_purchase_unit:row.is_purchase_unit}));
        if(JSON.stringify(units)!==JSON.stringify(originalUnits)) data.conversions=units;
        for(const [key,value] of Object.entries(fields)) {
          if(value===undefined) continue;
          const numeric=['mrp','wholesale_price','purchase_price','gst_rate','min_stock'].includes(key);
          if(numeric ? decimal(value,key==='min_stock'?3:2)!==decimal(baseline[key]||0,key==='min_stock'?3:2) : value!==(baseline[key]??'')) data[key]=value;
        }
        if(Object.keys(data).length===1) {message.info('No changes to save');return;}
        const result=await updateProduct(productId,data);
        message.success('Product updated');onSuccess(result.data.data);close();
      } else await mutation.run({...fields,current_stock:decimal(current_stock||0,3),conversions:units},{formValues:values});
    } catch(error) {
      if(!error.errorFields) setError(error.response?.data?.code?financialError(error.response.data.code):error.message||'Failed to save product');
    } finally {setLoading(false);}
  };

  return (<>
    {mutation.intent && !open && !recoveryOpen && <Button onClick={()=>setRecoveryOpen(true)}>Recover product creation</Button>}
    <Modal
      title={mutation.intent ? 'Recover product creation' : isEdit ? 'Edit Product' : 'New Product'}
      open={open||recoveryOpen}
      onCancel={close}
      footer={mutation.intent?null:undefined}
      onOk={handleSubmit}
      confirmLoading={loading||mutation.busy}
      okText={isEdit ? 'Save product' : 'Create product'}
      okButtonProps={{'aria-label':isEdit ? 'Save product' : 'Create product',disabled:fetching||(isEdit&&!baseline)}}
      width={640}
      destroyOnHidden={false}
    >
      {mutation.intent ? <FinancialRecovery mutation={mutation} label="Product creation"
        onComplete={receipt=>{onSuccess(receipt);close();}} onEdit={saved=>{setCreateRecovery(true);form.setFieldsValue(saved.snapshot?.formValues||saved.payload);}}>
        {mutation.intent.result && <Text>Product {mutation.intent.result.name}: opening stock {mutation.intent.result.current_stock}</Text>}
      </FinancialRecovery> : <Spin spinning={fetching}>
        {error && <Alert type="error" showIcon message={error} action={isEdit?<Button onClick={load}>Reload product and review</Button>:null} />}

        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item name="name" label="Product Name"
            rules={[{ required: true, message: 'Required' }]}>
            <Input placeholder="e.g. Ambuja Cement 50kg" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="category" label="Category"
              rules={[{ required: true, message: 'Required' }]}>
              <AutoComplete
                options={CATEGORY_OPTIONS.map((c) => ({ value: c }))}
                placeholder="Select or type"
                filterOption={(input, option) =>
                  option.value.toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>


          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="brand" label="Brand">
              <Input placeholder="e.g. Ambuja" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="unit" label="Unit"
              rules={[{ required: true, message: 'Required' }]}>
              <AutoComplete
                options={UNIT_SUGGESTIONS.map(u => ({ value: u }))}
                placeholder="Type or select unit"
                filterOption={(input, option) =>
                  option.value.toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>

            <Form.Item name="hsn_code" label="HSN Code">
              <Input placeholder="e.g. 2523" />
            </Form.Item>

            <Form.Item name="gst_rate" label="GST Rate %"
              rules={[{ required: true, message: 'Required' }]}>
              <Select options={GST_OPTIONS} />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="mrp" label="MRP ₹"
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }}
                placeholder="0.00" />
            </Form.Item>

            <Form.Item name="wholesale_price" label="Wholesale Price ₹"
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }}
                placeholder="0.00" />
            </Form.Item>

            <Form.Item name="purchase_price" label="Cost Price ₹"
              rules={[{ required: true, message: 'Required' }]}
              extra="Used for profit calculation">
              <InputNumber min={0} precision={2} style={{ width: '100%' }}
                placeholder="0.00" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="sku" label="SKU Code">
              <Input placeholder="e.g. CEM-AMB-50" />
            </Form.Item>

            <Form.Item name="barcode" label="Barcode">
              <Input placeholder="Scan or type" />
            </Form.Item>

            <Form.Item name="min_stock" label="Min Stock Level"
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="current_stock" label={isEdit?"Stock (use Count stock to change)":"Opening stock"}
              extra={isEdit ? 'Use Count stock on the product detail page for a reasoned stock change.' : 'Initial stock quantity'}
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber stringMode disabled={isEdit} min={0} precision={3} style={{ width: '100%' }}
                placeholder="0" />
            </Form.Item>
          </div>

          <div style={{ marginBottom: 24, padding: 16, background: '#fafafa', borderRadius: 8 }}>
            <Text strong>Unit Conversions (Optional)</Text>
            <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
              Define alternate units (e.g., 1 Box = 10 Pieces). Base unit is defined above.
            </p>
            <Form.List name="conversions">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'unit_name']}
                        rules={[{ required: true, message: 'Unit name' }]}
                      >
                        <AutoComplete
                          options={UNIT_SUGGESTIONS.map(u => ({ value: u }))}
                          placeholder="Alt Unit (e.g. Box)"
                          style={{ width: 140 }}
                          filterOption={(input, option) =>
                            option.value.toLowerCase().includes(input.toLowerCase())
                          }
                        />
                      </Form.Item>
                      <Text>=</Text>
                      <Form.Item
                        {...restField}
                        name={[name, 'conversion_value']}
                        rules={[{ required: true, message: 'Value' }]}
                      >
                        <InputNumber min={0.0001} precision={4} placeholder="Qty" style={{ width: 100 }} />
                      </Form.Item>
                      <Text>Base Units</Text>
                    <Form.Item {...restField} name={[name,'is_sales_unit']} label="Sales unit" valuePropName="checked"><Switch /></Form.Item>
                    <Form.Item {...restField} name={[name,'is_purchase_unit']} label="Purchase unit" valuePropName="checked"><Switch /></Form.Item>
                      <Button aria-label="Remove conversion" onClick={()=>remove(name)} icon={<DeleteOutlined />} />
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add({conversion_value:1,is_sales_unit:true,is_purchase_unit:true})} block icon={<PlusOutlined />}>
                    Add Unit Conversion
                  </Button>
                </>
              )}
            </Form.List>
          </div>

          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Spin>}
    </Modal></>
  );
}

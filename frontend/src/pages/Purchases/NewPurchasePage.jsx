import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, Select, DatePicker, Input, Button, Table, InputNumber, Typography, Space, message, Modal, Form, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { createPurchase, quotePurchase } from '../../api/purchases.api';
import { getSuppliers, createSupplier } from '../../api/suppliers.api';
import { getProduct, getUnitConversions } from '../../api/products.api';
import ProductSearch from '../../components/ProductSearch/ProductSearch';
import ProductFormModal from '../Products/ProductFormModal';
import { formatINR } from '../../utils/formatCurrency';
import { decimal, scaled } from '../../utils/billing.calculations.js';
import { useFinancialMutation } from '../../hooks/useFinancialMutation.js';
import useAuthStore from '../../store/authStore.js';

const { Title, Text } = Typography;
export default function NewPurchasePage() {
  const navigate = useNavigate(), location = useLocation();
  const userId = useAuthStore(state => state.user?.id);
  const mutation = useFinancialMutation('purchase', createPurchase);
  const { intent } = mutation;
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState(location.state?.supplierId || null);
  const [date, setDate] = useState(dayjs());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [quote, setQuote] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [supplierForm] = Form.useForm();
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const current = useRef();
  const rawPayload = { supplier_id: supplierId, date: date?.format('YYYY-MM-DD'), notes,
    items: items.map(({ product_id, qty, unit, cost_price }) => ({ product_id, qty, unit, cost_price })) };
  current.current = { fingerprint: JSON.stringify(rawPayload), locked: mutation.locked, userId };
  const reviewedQuote = quote?.fingerprint === current.current.fingerprint ? quote : null;
  const fetchSuppliers = () => getSuppliers().then(({ data }) => setSuppliers(data.data?.suppliers || []))
    .catch(() => setError('Unable to load suppliers. Refresh before continuing.'));
  useEffect(() => { fetchSuppliers(); }, []);
  useEffect(() => {
    setItems([]); setQuote(null); setError(null); setNotes(''); setDate(dayjs()); setSupplierId(location.state?.supplierId || null);
  }, [userId]);

  const handleProductSelect = async product => {
    if (current.current.locked) return;
    const actor = userId;
    setAdding(true); setError(null); setQuote(null);
    try {
      const [productResponse, conversionResponse] = await Promise.all([getProduct(product.id), getUnitConversions(product.id)]);
      const value = productResponse.data.data;
      if (!value?.is_active) throw new Error('Select an active product.');
      const base = value.base_unit || value.unit;
      const units = [base, ...(conversionResponse.data.data?.conversions || []).filter(row => row.is_purchase_unit).map(row => row.unit_name)];
      if (!current.current.locked && current.current.userId === actor) setItems(previous => [...previous, {
        key: globalThis.crypto.randomUUID(), product_id: value.id, product_name: value.name, base_unit: base,
        units: [...new Set(units)], qty: '1.000', unit: base, cost_price: null,
      }]);
    } catch (failure) { setError(failure.response?.data?.error || failure.message || 'Unable to load purchase units.'); }
    finally { setAdding(false); }
  };
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefilled.current && location.state?.product) {
      prefilled.current = true;
      handleProductSelect(location.state.product);
    }
  }, [location.state]);
  const edit = callback => { setQuote(null); setError(null); callback(); };
  const updateItem = (key, field, value) => edit(() => setItems(previous => previous.map(item => item.key === key
    ? { ...item, [field]: value, ...(field === 'unit' ? { cost_price: null } : {}) } : item)));
  const handleSaveSupplier = async () => {
    try {
      const values = await supplierForm.validateFields();
      setSavingSupplier(true);
      const { data } = await createSupplier(values);
      await fetchSuppliers();
      edit(() => setSupplierId(data.data.id));
      setSupplierModalOpen(false); supplierForm.resetFields();
    } catch (failure) { if (!failure.errorFields) message.error(failure.response?.data?.error || 'Failed to create supplier'); }
    finally { setSavingSupplier(false); }
  };
  const handleSubmit = async () => {
    if (intent?.status === 'completed') {
      if (await mutation.clear()) navigate(`/purchases/${intent.result.purchase.id}`);
      return;
    }
    if (intent?.status === 'rejected') {
      if (await mutation.clear()) {
        setSupplierId(intent.payload.supplier_id); setDate(dayjs(intent.payload.date)); setNotes(intent.payload.notes || '');
        setItems(intent.snapshot?.items || []); setQuote(null); setError(null);
      }
      return;
    }
    if (intent) { await mutation.run(); return; }
    setError(null);
    try {
      if (!supplierId || !date || !items.length) throw new Error('Select a supplier, date and at least one product.');
      const payload = { ...rawPayload, items: items.map(item => {
        const qty = decimal(item.qty, 3);
        if (scaled(qty, 3) <= 0n) throw new Error('Enter a positive quantity for each line.');
        if (item.cost_price === null || item.cost_price === '') throw new Error('Enter the agreed price for every selected purchase unit.');
        return { product_id: item.product_id, qty, unit: item.unit, cost_price: decimal(item.cost_price) };
      }) };
      if (reviewedQuote) {
        await mutation.run({ ...reviewedQuote.payload, quote_hash: reviewedQuote.quote_hash }, { items, supplier_name: reviewedQuote.supplier_name, quote: reviewedQuote });
        return;
      }
      const before = current.current;
      setReviewing(true);
      const response = await quotePurchase(payload);
      if (before.fingerprint === current.current.fingerprint && before.userId === current.current.userId && !current.current.locked) {
        setQuote({ ...response.data.data, payload, fingerprint: before.fingerprint });
      }
    } catch (failure) { setError(failure.response?.data?.error || failure.message || 'Unable to review purchase.'); }
    finally { setReviewing(false); }
  };
  const shownItems = intent?.snapshot?.items || items;
  const shownQuote = intent?.snapshot?.quote || reviewedQuote;
  const disabled = mutation.locked || mutation.busy || reviewing || adding;
  const label = intent?.status === 'completed' ? 'View Saved Purchase' : intent?.status === 'rejected' ? 'Edit Rejected Purchase'
    : intent ? 'Retry Original Purchase' : reviewedQuote ? 'Confirm Stock Receipt' : 'Review Purchase';
  const columns = [
    { title: 'Product', dataIndex: 'product_name', render: value => <strong>{value}</strong> },
    { title: 'Quantity', dataIndex: 'qty', width: 120, render: (value, item) => <InputNumber aria-label={`Purchase quantity ${item.product_name}`} stringMode min="0.001" precision={3}
      value={value} disabled={disabled} onChange={next => updateItem(item.key, 'qty', next)} /> },
    { title: 'Purchase unit', dataIndex: 'unit', width: 140, render: (value, item) => <Select aria-label={`Purchase unit ${item.product_name}`} value={value} disabled={disabled}
      options={item.units.map(unit => ({ label: unit, value: unit }))} onChange={next => updateItem(item.key, 'unit', next)} style={{ width: '100%' }} /> },
    { title: 'Agreed price / unit', dataIndex: 'cost_price', width: 160, render: (value, item) => <InputNumber aria-label={`Agreed purchase price ${item.product_name}`} stringMode min="0" precision={2}
      value={value} disabled={disabled} placeholder="Enter agreed price" onChange={next => updateItem(item.key, 'cost_price', next)} /> },
    { title: 'Reviewed amount', align: 'right', render: (_, item, index) => shownQuote ? formatINR(shownQuote.items[index]?.line_total) : 'Review to calculate' },
    { title: '', width: 50, render: (_, item) => <Button aria-label={`Remove purchase line ${item.product_name}`} type="text" danger icon={<DeleteOutlined />} disabled={disabled}
      onClick={() => edit(() => setItems(previous => previous.filter(row => row.key !== item.key)))} /> },
  ];
  const supplierOptions = suppliers.filter(supplier => supplier.is_active !== false).map(supplier => ({ label: supplier.name, value: supplier.id }));
  if (intent?.payload && !supplierOptions.some(option => option.value === intent.payload.supplier_id)) {
    supplierOptions.push({ value: intent.payload.supplier_id, label: intent.snapshot?.supplier_name || `Supplier ${intent.payload.supplier_id}` });
  }
  return <div style={{ padding: 24, maxWidth: 1000 }}>
    <Title level={3}>New Stock-In</Title>
    {intent && <Alert showIcon style={{ marginBottom: 16 }} type={intent.status === 'completed' ? 'success' : intent.status === 'rejected' ? 'error' : 'warning'}
      message={intent.status === 'completed' ? 'Purchase received' : intent.status === 'rejected' ? 'Purchase was not recorded' : 'Purchase outcome needs confirmation'}
      description={intent.status === 'completed' ? `${intent.result.purchase.po_number}: ${formatINR(intent.result.purchase.total_amount)} received. View the saved purchase before starting another receipt.`
        : `${intent.error || 'The original purchase request is saved.'} ${intent.status === 'rejected' ? 'Edit and review before starting a new request.' : 'Retry the unchanged saved request before receiving stock again.'}`} />}
    {intent?.payload && <p>Saved purchase: supplier {intent.payload.supplier_id}, actor {intent.actorId}, dated {intent.payload.date}.</p>}
    {error && <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div><Text>Supplier *</Text><Space.Compact style={{ width: '100%' }}>
          <Select aria-label="Purchase supplier" showSearch placeholder="Select supplier" style={{ width: '100%' }} disabled={disabled}
            value={intent?.payload?.supplier_id ?? supplierId} onChange={value => edit(() => setSupplierId(value))} options={supplierOptions}
            filterOption={(input, option) => option.label.toLowerCase().includes(input.toLowerCase())} />
          <Button aria-label="Add supplier" icon={<PlusOutlined />} disabled={disabled} onClick={() => { supplierForm.resetFields(); setSupplierModalOpen(true); }} />
        </Space.Compact></div>
        <div><Text>Date *</Text><DatePicker aria-label="Purchase date" value={intent?.payload ? dayjs(intent.payload.date) : date} disabled={disabled}
          onChange={value => edit(() => setDate(value))} style={{ width: '100%' }} /></div>
      </div>
      <Input.TextArea aria-label="Purchase notes" rows={2} value={intent?.payload?.notes ?? notes} disabled={disabled} placeholder="Optional purchase notes"
        onChange={event => edit(() => setNotes(event.target.value))} style={{ marginTop: 12 }} />
      <p><Text type="warning">Supplier attachments remain unavailable. Save the purchase without a file.</Text></p>
    </Card>
    {!mutation.locked && <Card title="Add Products" style={{ marginBottom: 16 }} extra={<Button icon={<PlusOutlined />} disabled={disabled} onClick={() => setShowProductModal(true)}>Create New Product</Button>}>
      {adding ? <Text>Loading purchase units…</Text> : <ProductSearch onSelect={handleProductSelect} billType="retail" placeholder="Search products to add..." />}
      <Text type="secondary">Enter the agreed price for the selected purchase unit. Changing units clears that price.</Text>
    </Card>}
    {shownItems.length > 0 && <Card><Table dataSource={shownItems} columns={columns} rowKey="key" pagination={false} size="small" scroll={{ x: 850 }} /></Card>}
    {shownQuote && <Card title="Reviewed receipt" style={{ marginTop: 16 }}>
      {shownQuote.items.map((item, index) => <p key={index}>{item.product_name_snapshot}: {item.qty} {item.unit} = {item.base_qty} {item.base_unit_snapshot}; {formatINR(item.line_total)}. Current cost becomes {formatINR(item.base_cost_price)} / {item.base_unit_snapshot}.</p>)}
      <strong>Total: {formatINR(shownQuote.total_amount)}</strong>
    </Card>}
    <Space style={{ marginTop: 24 }}>
      <Button onClick={() => navigate('/purchases')}>Cancel</Button>
      <Button type="primary" aria-label={label} loading={reviewing || mutation.busy} onClick={handleSubmit}
        disabled={adding || reviewing || mutation.busy || intent?.status === 'storage_error' || (!intent && (!items.length || !supplierId))}>{label}</Button>
    </Space>
    <Modal title="New Supplier" open={supplierModalOpen} onCancel={() => setSupplierModalOpen(false)} onOk={handleSaveSupplier} confirmLoading={savingSupplier} width={480} destroyOnHidden>
      <Form form={supplierForm} layout="vertical">
        <Form.Item name="name" label="Supplier Name" rules={[{ required: true, message: 'Required' }]}><Input /></Form.Item>
        <Form.Item name="phone" label="Phone"><Input maxLength={10} /></Form.Item>
        <Form.Item name="email" label="Email"><Input /></Form.Item>
        <Form.Item name="gstin" label="GSTIN"><Input maxLength={15} /></Form.Item>
        <Form.Item name="address" label="Address"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="payment_terms" label="Payment Terms"><Input /></Form.Item>
      </Form>
    </Modal>
    <ProductFormModal open={showProductModal} onClose={() => setShowProductModal(false)} onSuccess={product => {
      setShowProductModal(false); if (product) handleProductSelect(product);
    }} />
  </div>;
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Button, Input, InputNumber, Radio, Select, Table, Tag, Modal, DatePicker,
  Alert, message, Space, Row, Col, Card, Divider, Typography, Spin,
  Descriptions, Checkbox,
} from 'antd';
import {
  DeleteOutlined, PrinterOutlined, PlusOutlined,
  ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined,
  WalletOutlined, CreditCardOutlined, BankOutlined, QrcodeOutlined,
  EditOutlined,
} from '@ant-design/icons';
import ProductSearch from '../../components/ProductSearch/ProductSearch';
import CustomerSearch from '../../components/CustomerSearch/CustomerSearch';
import { useBilling } from '../../hooks/useBilling';
import { formatINR, formatDate } from '../../utils/formatCurrency';
import { getUnitConversions } from '../../api/products.api';
import ProductFormModal from '../Products/ProductFormModal';
import CustomerFormModal from '../Customers/CustomerFormModal';
import './BillingPage.css';
import InvoiceReview from '../../components/InvoiceReview/InvoiceReview';
import { moneySum, quantityIncrement } from '../../utils/billing.calculations.js';

const { Title, Text } = Typography;

const PAYMENT_MODES = [
  { key: 'cash', label: 'Cash', icon: <WalletOutlined /> },
  { key: 'upi', label: 'UPI', icon: <QrcodeOutlined /> },
  { key: 'cheque', label: 'Cheque', icon: <CreditCardOutlined /> },
  { key: 'bank', label: 'Bank', icon: <BankOutlined /> },
];

export default function BillingPage() {
  const billing = useBilling('retail');
  const {
    customer, setCustomer,
    billType, setBillType,
    items, addItem, updateItem, updateItemFields, removeItem,
    payment, setPaymentAmount, addPaymentMode, removePaymentMode, setDueDate,
    isSubmitting, errors, setErrors,
    totals, balanceDue, paymentStatus,
    submitInvoice, resetBilling,
    locked, invoiceResult, setFullPayment,
  } = billing;

  // Quick-bill walk-in name
  const [walkinName, setWalkinName] = useState('');

  // Quick-add modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);


  // Post-submission modal
  const [submittedInvoice, setSubmittedInvoice] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Payment mode input state
  const [payModeSelected, setPayModeSelected] = useState('cash');
  const [payModeAmount, setPayModeAmount] = useState(0);
  const [payModeRef, setPayModeRef] = useState('');

  // Unit conversion cache: { [productId]: [{ unit_name, conversion_value }, ...] }
  const unitConversionsCache = useRef({});
  const [unitConversions, setUnitConversions] = useState({});
  // Track default prices per item index for "edited" indicator
  const [defaultRates, setDefaultRates] = useState({});

  const fetchUnitConversions = useCallback(async (productId) => {
    if (unitConversionsCache.current[productId]) {
      return unitConversionsCache.current[productId];
    }
    try {
      const { data } = await getUnitConversions(productId);
      const conversions = Array.isArray(data?.data?.conversions) ? data.data.conversions
        : Array.isArray(data?.data) ? data.data
        : [];
      unitConversionsCache.current[productId] = conversions;
      setUnitConversions(prev => ({ ...prev, [productId]: conversions }));
      return conversions;
    } catch {
      // No conversions available — not an error
      unitConversionsCache.current[productId] = [];
      setUnitConversions(prev => ({ ...prev, [productId]: [] }));
      return [];
    }
  }, []);

  // Refs for focus management
  const productSearchRef = useRef(null);
  const qtyInputRefs = useRef({});
  const rateInputRefs = useRef({});
  const discInputRefs = useRef({});
  const gstInputRefs = useRef({});

  // ───── Keyboard shortcuts ─────
  useEffect(() => {
    const handleGlobalKeyDown = async (e) => {
      if(locked || isSubmitting || billing.review || submittedInvoice) {
        if(['F2','F4','F9','Escape'].includes(e.key)) e.preventDefault();
        return;
      }
      // F2 → toggle Quick Bill
      if (e.key === 'F2') {
        e.preventDefault();
        setBillType(prev => prev === 'quickbill' ? 'retail' : 'quickbill');
        message.info(billType === 'quickbill' ? 'Switched to Retail' : 'Quick Bill mode');
      }
      // F9 → submit invoice
      if (e.key === 'F9') {
        e.preventDefault();
        handleSubmit();
      }
      // F4 → pay full amount
      if (e.key === 'F4') {
        e.preventDefault();
        handlePayFull();
      }
      // Esc → clear bill (only if items exist, no confirmation)
      if (e.key === 'Escape') {
        if (items.length > 0) {
          e.preventDefault();
          if (!await resetBilling()) return;
          setWalkinName('');
          setPayModeAmount(0);
          setPayModeRef('');
          setDefaultRates({});
          message.info('Bill cleared');
        }
      }
      // Ctrl+P → print last invoice
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        if (submittedInvoice) {
          e.preventDefault();
          message.info('PDF printing is temporarily unavailable while safety checks are completed.');
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [billType, items, customer, payment, submittedInvoice, locked, isSubmitting, billing.review]);

  // ───── Product selected → add item, focus qty ─────
  const handleProductSelect = useCallback((product) => {
    if (!product || !product.id) {
      message.warning('Invalid product selected');
      return;
    }
    try {
      // Check if product already in items
      const existingIdx = items.findIndex(i => i.product_id === product.id);
      if (existingIdx >= 0) {
        updateItem(existingIdx, 'qty', quantityIncrement(items[existingIdx].qty || '0'));
        message.info(`${product.name} qty increased to ${quantityIncrement(items[existingIdx].qty || '0')}`);
        return;
      }
      const newIndex = addItem(product);
      // Track default rate for "edited" indicator
      const defaultRate = billType === 'wholesale'
        ? (parseFloat(product.wholesale_price) || parseFloat(product.mrp) || 0)
        : (parseFloat(product.mrp) || 0);
      setDefaultRates(prev => ({ ...prev, [newIndex]: defaultRate }));
      // Fetch unit conversions for the product
      fetchUnitConversions(product.id);
      // Focus qty field of the new item after render
      setTimeout(() => {
        const qtyEl = qtyInputRefs.current[newIndex];
        if (qtyEl) {
          try { qtyEl.focus(); } catch (_) { /* ignore focus errors */ }
        }
      }, 100);
    } catch (err) {
      console.error('Error adding product to bill:', err);
      message.error('Failed to add product. Please try again.');
    }
  }, [addItem, items, updateItem, billType, fetchUnitConversions]);

  // ───── Keyboard flow: Qty → Rate → Disc% → Product Search ─────
  const focusAndSelect = (el) => {
    if (!el) return;
    el.focus();
    // Antd InputNumber: select the inner input text
    setTimeout(() => {
      const input = el?.input || el?.nativeElement?.querySelector?.('input');
      if (input && input.select) input.select();
    }, 10);
  };

  const handleQtyKeyDown = (e, idx) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      focusAndSelect(rateInputRefs.current[idx]);
    }
  };

  const handleRateKeyDown = (e, idx) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      focusAndSelect(discInputRefs.current[idx]);
    }
  };

  const handleDiscKeyDown = (e, idx) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      focusAndSelect(gstInputRefs.current[idx]);
    }
  };

  const handleGstKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const searchInput = document.querySelector('.billing-product-search input');
      if (searchInput) searchInput.focus();
    }
  };

  // ───── Submit ─────
  const handleSubmit = async () => {
    const overrides = billType === 'quickbill'
      ? { billType: 'quickbill', customer: customer?.id ? customer : walkinName.trim() ? {name:walkinName.trim()} : null }
      : {};
    await submitInvoice(overrides);
  };
  useEffect(() => {
    if(invoiceResult) { setSubmittedInvoice(invoiceResult); setShowSuccessModal(true); }
  },[invoiceResult]);

  // ───── Close success modal and reset ─────
  const handleModalClose = async () => {
    if(!await resetBilling()) return;
    setShowSuccessModal(false);
    setSubmittedInvoice(null);
    setWalkinName('');
    setPayModeSelected('cash');
    setPayModeAmount(0);
    setPayModeRef('');
    setDefaultRates({});
  };

  // ───── Handle "Pay Full" convenience ─────
  const handlePayFull = () => {
    setFullPayment(totals.grand_total,payModeSelected);
  };

  // ───── Add payment mode entry ─────
  const handleAddPaymentMode = () => {
    if (payModeAmount <= 0) {
      message.warning('Enter a payment amount');
      return;
    }
    addPaymentMode(payModeSelected, payModeAmount, payModeRef);
    const totalModeAmount = moneySum([...payment.modes.map(m=>m.amount),payModeAmount]);
    setPaymentAmount(totalModeAmount);
    setPayModeAmount(0);
    setPayModeRef('');
  };

  // ───── Unit conversion change handler ─────
  const handleUnitChange = useCallback((idx, value, item) => {
    const conv = (unitConversionsCache.current[item.product_id] || []).find(c => c.unit_name === value && c.is_sales_unit);
    updateItemFields(idx,{unit:value,selected_unit:value,rate:'',discount_amount:'0.00',discount_pct:'0.00',_conversionValue:value===item.base_unit ? '1' : conv?.conversion_value || '1',alt_unit:value===item.base_unit ? null : value});
    message.info(`Enter the selling rate per ${value}.`);
  }, [updateItemFields]);

  // ───── Stock error display ─────
  const stockErrors = errors.stock;

  // ───── Table columns ─────
  const columns = [
    {
      title: '#',
      width: 36,
      align: 'center',
      className: 'col-sno',
      render: (_, __, idx) => <Text type="secondary">{idx + 1}</Text>,
    },
    {
      title: 'Product',
      dataIndex: 'product_name_snapshot',
      width: 200,
      className: 'col-product',
      render: (name, record) => (
        <div className="product-cell">
          <span className="product-name">{name}</span>{record.preview_error && <Text type="danger">{record.preview_error}</Text>}
          {record.hsn_snapshot && (
            <span className="product-hsn">HSN: {record.hsn_snapshot}</span>
          )}
        </div>
      ),
    },
    {
      title: 'Qty',
      dataIndex: 'qty',
      width: 90,
      render: (val, record, idx) => (
        <div>
          <InputNumber
            stringMode
            disabled={locked}
            ref={(el) => { qtyInputRefs.current[idx] = el; }}
            className="billing-qty-input"
            precision={3}
            min={0.001}
            value={val}
            onChange={(v) => updateItem(idx, 'qty', v ?? '')}
            onKeyDown={(e) => handleQtyKeyDown(e, idx)}
            onFocus={(e) => e.target.select()}
            size="small"
            style={{ width: '100%' }}
          />
          {record.alt_unit && record.base_qty && (
            <div style={{ fontSize: 10, color: '#888', marginTop: 2, textAlign: 'center' }}>
              = {record.base_qty} {record.base_unit}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Unit',
      dataIndex: 'unit',
      width: 88,
      render: (unitVal, record, idx) => {
        const rawConversions = unitConversions[record.product_id];
        const conversions = Array.isArray(rawConversions) ? rawConversions : [];
        const bUnit = record.base_unit || unitVal;

        const options = conversions.length > 0
          ? [
              { label: bUnit, value: bUnit },
              ...conversions.filter(c=>c.is_sales_unit && c.unit_name!==bUnit).map(c => ({ label: c.unit_name, value: c.unit_name })),
            ]
          : [{label:bUnit,value:bUnit}];

        return (
          <Select
            size="small"
            value={record.selected_unit || bUnit}
            options={options}
            showSearch
            onChange={(val) => handleUnitChange(idx, val, record)}
            style={{ width: '100%' }}
            popupMatchSelectWidth={false}
          />
        );
      },
    },
    {
      title: 'Rate / selected unit',
      dataIndex: 'rate',
      width: 100,
      render: (val, _, idx) => {
        const isEdited = defaultRates[idx] !== undefined && val !== defaultRates[idx];
        return (
          <div style={{ position: 'relative' }}>
            <InputNumber
            stringMode
            precision={2}
            disabled={locked}
              ref={(el) => { rateInputRefs.current[idx] = el; }}
              className="billing-rate-input"
              min={0}
              step={0.5}
              value={val}
              onChange={(v) => updateItem(idx, 'rate', v ?? '')}
              onKeyDown={(e) => handleRateKeyDown(e, idx)}
              onFocus={(e) => e.target.select()}
              size="small"
              style={{ width: '100%' }}
              formatter={(v) => `${v}`}
            />
            {isEdited && (
              <span className="rate-edited-dot" title={`Default: ${formatINR(defaultRates[idx])}`} />
            )}
          </div>
        );
      },
    },
    {
      title: 'Discount / unit', width: 120,
      render: (_, record, idx) => <Space direction="vertical" size={2}>
        <Select size="small" value={record.discount_kind || 'pct'} disabled={locked} options={[{value:'pct',label:'Percent'},{value:'amount',label:'Fixed / unit'}]}
          onChange={kind=>updateItemFields(idx,{discount_kind:kind,discount_pct:'0.00',discount_amount:'0.00'})}/>
        <InputNumber className="billing-disc-input" stringMode precision={2} min="0" disabled={locked}
          value={record.discount_kind==='amount' ? record.discount_amount : record.discount_pct}
          onChange={value=>updateItem(idx,record.discount_kind==='amount' ? 'discount_amount' : 'discount_pct',value || '0')}/>
      </Space>,
    },
    {title:'GST (catalog)',dataIndex:'gst_pct',width:90,render:value=>`${value}%`},
    {
      title: 'Amount',
      dataIndex: 'line_total',
      width: 110,
      align: 'right',
      render: (val) => <Text strong>{formatINR(val)}</Text>,
    },
    {
      title: '',
      width: 36,
      align: 'center',
      render: (_, __, idx) => (
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => removeItem(idx)}
          style={{ padding: '0 4px' }}
        />
      ),
    },
  ];

  return (
    <div className="billing-page">
      <InvoiceReview billing={billing}/>
      {/* Keyboard shortcuts bar */}
      <div className="shortcuts-bar">
        <span className="shortcut-item"><span className="shortcut-key">F2</span> Quick Bill</span>
        <span className="shortcut-item"><span className="shortcut-key">F9</span> Finalize</span>
        <span className="shortcut-item"><span className="shortcut-key">F4</span> Pay Full</span>
        <span className="shortcut-item"><span className="shortcut-key">Esc</span> Clear</span>
        <span className="shortcut-item">Rates and fixed discounts are per selected selling unit</span>
        <span className="shortcut-item"><span className="shortcut-key">Ctrl+P</span> Print</span>
      </div>

      <Row gutter={16} className="billing-body">
        {/* ═══════ LEFT PANEL ═══════ */}
        <Col xs={24} lg={16} xl={17}>
          {/* Customer section */}
          <Card size="small" className="billing-card">
            <Row gutter={12} align="middle">
              <Col flex="auto">
                {billType === 'quickbill' && !customer?.id ? (
                  <Input
                    disabled={locked}
                    placeholder="Walk-in customer name (optional)"
                    value={walkinName}
                    onChange={(e) => {billing.draftChanged();setWalkinName(e.target.value);}}
                    size="large"
                    prefix={<Text type="secondary">Walk-in:</Text>}
                  />
                ) : (
                  <>
                    {customer ? (
                      <div className="selected-customer">
                        <Space size={4} wrap>
                          <Text strong>{customer.name}</Text>
                          {customer.phone && <Text type="secondary">{customer.phone}</Text>}
                          <Tag color={customer.type === 'wholesale' ? 'blue' : 'green'} style={{ marginRight: 0 }}>
                            {customer.type}
                          </Tag>
                          {customer.outstanding_balance > 0 && (
                            <Tag color="red">Due: {formatINR(customer.outstanding_balance)}</Tag>
                          )}
                          <Button
                            type="link"
                            size="small"
                            danger
                            onClick={() => setCustomer(null)}
                          >
                            Change
                          </Button>
                        </Space>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <CustomerSearch
                            onSelect={setCustomer}
                            autoFocus={true}
                          />
                        </div>
                        <Button
                          icon={<PlusOutlined />}
                          title="Quick Add Customer"
                          onClick={() => setShowCustomerModal(true)}
                        />
                      </div>
                    )}
                  </>
                )}
              </Col>
              <Col>
                <Radio.Group
                  value={billType}
                  disabled={locked}
                  onChange={(e) => setBillType(e.target.value)}
                  size="small"
                  buttonStyle="solid"
                >
                  <Radio.Button value="retail">Retail</Radio.Button>
                  <Radio.Button value="wholesale">Wholesale</Radio.Button>
                  <Radio.Button value="quickbill">
                    <ThunderboltOutlined /> Quick
                  </Radio.Button>
                </Radio.Group>
              </Col>
            </Row>
            {errors.customer && (
              <Alert message={errors.customer} type="error" showIcon style={{ marginTop: 8 }} />
            )}
          </Card>

          {/* Product search */}
          <Card size="small" className="billing-card billing-product-search">
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <ProductSearch
                  onSelect={handleProductSelect}
                  billType={billType === 'quickbill' ? 'retail' : billType}
                  autoFocus={billType === 'quickbill'}
                  placeholder="Search product by name, code, or barcode..."
                />
              </div>
              <Button
                icon={<PlusOutlined />}
                title="Quick Add Product"
                onClick={() => setShowProductModal(true)}
              />
            </div>
          </Card>

          {/* Items table */}
          <Card
            size="small"
            className="billing-card billing-items-card"
            title={
              <Space>
                <Text strong>Items</Text>
                <Tag>{items.length} items, {items.reduce((s, i) => s + (Number(i.qty) || 0), 0)} qty</Tag>
              </Space>
            }
          >
            {errors.items && (
              <Alert message={errors.items} type="error" showIcon style={{ marginBottom: 8 }} />
            )}

            {/* INSUFFICIENT_STOCK error display */}
            {stockErrors && (
              <Alert
                type="error"
                showIcon
                icon={<CloseCircleOutlined />}
                message="Insufficient Stock"
                description={
                  Array.isArray(stockErrors) ? (
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {stockErrors.map((f, i) => (
                        <li key={i}>
                          <strong>{f.product_name || f.product_id}</strong>: requested {f.requested}, available {f.available}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Text>{String(stockErrors)}</Text>
                  )
                }
                closable
                onClose={() => setErrors((prev) => { const { stock, ...rest } = prev; return rest; })}
                style={{ marginBottom: 8 }}
              />
            )}

            <Table
              dataSource={items}
              columns={columns}
              rowKey={(record, idx) => `${record.product_id || 'item'}-${idx}`}
              pagination={false}
              size="small"
              scroll={{ x: 820, y: 'calc(100vh - 420px)' }}
              locale={{ emptyText: 'No items added. Search a product above.' }}
              className="billing-table"
            />
          </Card>
        </Col>

        {/* ═══════ RIGHT PANEL ═══════ */}
        <Col xs={24} lg={8} xl={7}>
         <div className="billing-right-panel">
          {/* Grand total highlight box */}
          <div className="grand-total-box">
            <div className="totals-row">
              <Text type="secondary" style={{ fontSize: 12 }}>Subtotal</Text>
              <Text style={{ fontSize: 12 }}>{formatINR(totals.subtotal)}</Text>
            </div>
            {totals.discount_total > 0 && (
              <div className="totals-row">
                <Text type="secondary" style={{ fontSize: 12 }}>Discount</Text>
                <Text type="danger" style={{ fontSize: 12 }}>-{formatINR(totals.discount_total)}</Text>
              </div>
            )}
            <div className="totals-row">
              <Text type="secondary" style={{ fontSize: 12 }}>GST</Text>
              <Text style={{ fontSize: 12 }}>{formatINR(totals.gst_total)}</Text>
            </div>
            <Divider style={{ margin: '6px 0' }} />
            <div className="totals-row">
              <Text strong style={{ fontSize: 16 }}>Grand Total</Text>
              <Text strong style={{ fontSize: 22, color: '#1677ff' }}>
                {formatINR(totals.grand_total)}
              </Text>
            </div>
          </div>

          {/* Payment card */}
          <Card size="small" className="billing-card payment-card" title="Payment">
            {/* Quick pay full */}
            <Space style={{ marginBottom: 12, width: '100%' }} direction="vertical">
              <Row gutter={8} align="middle">
                <Col flex="auto">
                  <InputNumber
            stringMode
            precision={2}
            disabled={locked}
                    value={payment.amount_paid}
                    onChange={(v) => setPaymentAmount(v || 0)}
                    min={0}
                    max={totals.grand_total}
                    style={{ width: '100%' }}
                    size="large"
                    prefix={<Text type="secondary">Paid</Text>}
                    formatter={(v) => `${v}`}
                    onFocus={(e) => e.target.select()}
                  />
                </Col>
                <Col>
                  <Button type="primary" ghost onClick={handlePayFull}>
                    Full
                  </Button>
                </Col>
              </Row>

              {/* Balance display */}
              <div className="balance-display">
                <Text type="secondary">Balance Due:</Text>
                <Text
                  strong
                  style={{
                    fontSize: 18,
                    color: balanceDue > 0 ? '#ff4d4f' : '#52c41a',
                  }}
                >
                  {formatINR(Math.max(balanceDue, 0))}
                </Text>
              </div>

              <Tag
                color={
                  paymentStatus === 'paid' ? 'success' :
                  paymentStatus === 'partial' ? 'warning' : 'default'
                }
                icon={paymentStatus === 'paid' ? <CheckCircleOutlined /> : null}
              >
                {paymentStatus === 'paid' ? 'Paid in Full' :
                 paymentStatus === 'partial' ? 'Partial Payment' : 'Unpaid'}
              </Tag>
            </Space>

            <Divider style={{ margin: '8px 0' }} />

            {/* Payment modes */}
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
              Payment Method
            </Text>
            <Space wrap style={{ marginBottom: 8 }}>
              {PAYMENT_MODES.map((m) => (
                <Button
                  key={m.key}
                  type={payModeSelected === m.key ? 'primary' : 'default'}
                  icon={m.icon}
                  size="small"
                  onClick={() => setPayModeSelected(m.key)}
                >
                  {m.label}
                </Button>
              ))}
            </Space>

            <Row gutter={8} style={{ marginBottom: 8 }}>
              <Col span={10}>
                <InputNumber
            stringMode
            precision={2}
            disabled={locked}
                  placeholder="Amount"
                  value={payModeAmount}
                  onChange={(v) => setPayModeAmount(v || 0)}
                  min={0}
                  style={{ width: '100%' }}
                  size="small"
                  onFocus={(e) => e.target.select()}
                />
              </Col>
              <Col span={10}>
                <Input
                  placeholder="Ref #"
                  value={payModeRef}
                  onChange={(e) => setPayModeRef(e.target.value)}
                  size="small"
                  disabled={payModeSelected === 'cash'}
                />
              </Col>
              <Col span={4}>
                <Button
                  icon={<PlusOutlined />}
                  size="small"
                  onClick={handleAddPaymentMode}
                  style={{ width: '100%' }}
                />
              </Col>
            </Row>

            {/* Payment mode entries */}
            {payment.modes.length > 0 && (
              <div className="payment-modes-list">
                {payment.modes.map((m, i) => (
                  <div key={i} className="payment-mode-entry">
                    <Tag>{m.mode}</Tag>
                    <Text>{formatINR(m.amount)}</Text>
                    {m.reference_no && <Text type="secondary" style={{ fontSize: 11 }}>Ref: {m.reference_no}</Text>}
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        removePaymentMode(i);
                        const remaining = payment.modes.filter((_, idx) => idx !== i);
                        const totalRemaining = moneySum(remaining.map(pm=>pm.amount));
                        setPaymentAmount(totalRemaining);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Due date for partial/unpaid */}
            {balanceDue > 0 && customer?.id && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  Due Date (required)
                </Text>
                <DatePicker
                  onChange={(date) => setDueDate(date ? date.format('YYYY-MM-DD') : null)}
                  style={{ width: '100%' }}
                  size="small"
                  format="DD-MM-YYYY"
                />
                {errors.due_date && (
                  <Text type="danger" style={{ fontSize: 12 }}>{errors.due_date}</Text>
                )}
              </div>
            )}
          </Card>

          {/* Submit errors */}
          {errors.submit && (
            <Alert
              message={errors.submit}
              type="error"
              showIcon
              closable
              onClose={() => setErrors((prev) => { const { submit, ...rest } = prev; return rest; })}
              style={{ marginBottom: 12 }}
            />
          )}

          {/* Action buttons */}
          <div style={{ marginBottom: 8 }}>
            <Button
              type="primary"
              size="large"
              block
              className="billing-finalize-btn"
              loading={isSubmitting}
              onClick={handleSubmit}
              disabled={items.length === 0 || locked}
            >
              {isSubmitting ? 'Creating Invoice...' : 'Finalise Bill (F9)'}
            </Button>
          </div>

          <Row gutter={8} align="middle">
            <Col flex="auto">

            </Col>
            <Col>
              <Button
                size="small"
                type="text"
                danger
                disabled={locked}
                onClick={() => {
                  if (items.length > 0) {
                    Modal.confirm({
                      title: 'Clear bill?',
                      content: 'All items and payment info will be lost.',
                      okText: 'Clear',
                      okType: 'danger',
                      onOk: async () => {
                        if(!await resetBilling()) return;
                        setWalkinName('');
                        setPayModeAmount(0);
                        setPayModeRef('');
                        setDefaultRates({});
                                          },
                    });
                  } else {
                    resetBilling();
                  }
                }}
              >
                Clear Bill
              </Button>
            </Col>
          </Row>
         </div>
        </Col>
      </Row>

      {/* ═══════ SUCCESS MODAL ═══════ */}
      <Modal
        open={showSuccessModal}
        onCancel={handleModalClose}
        footer={null}
        width={520}
        centered
        closable
        maskClosable={false}
      >
        {submittedInvoice && (
          <div className="success-modal-content">
            <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
            <Title level={4} style={{ marginBottom: 16 }}>Invoice Created!</Title>

            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Invoice #">
                <Text strong>{submittedInvoice.invoice_no}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Type">
                <Tag color={submittedInvoice.bill_type === 'quickbill' ? 'orange' : submittedInvoice.bill_type === 'wholesale' ? 'blue' : 'green'}>
                  {submittedInvoice.bill_type}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Total">
                <Text strong style={{ color: '#1677ff' }}>
                  {formatINR(submittedInvoice.grand_total)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Paid">
                {formatINR(submittedInvoice.amount_paid || 0)}
              </Descriptions.Item>
              <Descriptions.Item label="Balance">
                <Text type={submittedInvoice.balance_due > 0 ? 'danger' : 'success'}>
                  {formatINR(submittedInvoice.balance_due || 0)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={
                  submittedInvoice.status === 'paid' ? 'success' :
                  submittedInvoice.status === 'partial' ? 'warning' : 'error'
                }>
                  {submittedInvoice.status}
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            <Divider />

            <Space>
              <Button disabled icon={<PrinterOutlined />}>PDF unavailable</Button>
              <Button type="primary" onClick={handleModalClose}>
                New Bill
              </Button>
            </Space>
          </div>
        )}
      </Modal>
      {/* Quick Add Modals */}
      <ProductFormModal
        open={showProductModal}
        onClose={() => setShowProductModal(false)}
        onSuccess={(product) => {
          setShowProductModal(false);
          // If the product creation returns the product, auto-select it.
          // Fallback handling may be needed if we need to manually trigger search
          if (product && product.id) {
            handleProductSelect(product);
          } else {
            message.success('Product created. You can search for it now.');
          }
        }}
      />
      <CustomerFormModal
        open={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSuccess={(cust) => {
          setShowCustomerModal(false);
          if (cust && cust.id) {
            setCustomer(cust);
          } else {
            message.success('Customer created. You can search for them now.');
          }
        }}
      />
    </div>
  );
}

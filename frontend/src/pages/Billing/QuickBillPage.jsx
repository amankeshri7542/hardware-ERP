import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Input, InputNumber, Button, Table, Tag, Modal, Radio, Alert, message,
  Row, Col, Card, Typography, Space, Spin, Divider,
} from 'antd';
import { DeleteOutlined, PrinterOutlined, DownloadOutlined } from '@ant-design/icons';
import { useBilling } from '../../hooks/useBilling';
import ProductSearch from '../../components/ProductSearch/ProductSearch';
import { formatINR } from '../../utils/formatCurrency';
import './BillingPage.css';
import InvoiceReview from '../../components/InvoiceReview/InvoiceReview';

const { Title, Text } = Typography;

export default function QuickBillPage() {
  const billing = useBilling('quickbill');
  const [walkinName, setWalkinName] = useState('');
  const [successData, setSuccessData] = useState(null);
  const productSearchRef = useRef(null);
  const qtyRefs = useRef({});

  // F9 shortcut to submit
  const handleSubmit = useCallback(async () => {
    await billing.submitInvoice({billType:'quickbill',customer:walkinName.trim() ? {name:walkinName.trim()} : null,
      payment:{amount_paid:'0.00',modes:[],due_date:null},payFullMode:billing.payment.modes[0]?.mode || 'cash'});
  }, [billing, walkinName]);

  useEffect(()=>{if(billing.invoiceResult) setSuccessData(billing.invoiceResult);},[billing.invoiceResult]);
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'F9') {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSubmit]);

  const handleProductSelect = useCallback((product) => {
    if (!product || !product.id) return;
    try {
      const idx = billing.addItem(product);
      setTimeout(() => {
        try { qtyRefs.current[idx]?.focus(); } catch (_) { /* ignore */ }
      }, 100);
    } catch (err) {
      console.error('Error adding product:', err);
      message.error('Failed to add product');
    }
  }, [billing]);

  const handlePaymentModeChange = useCallback((e) => {
    const mode = e.target.value;
    const amount = billing.totals.grand_total;
    // Replace existing mode
    if (billing.payment.modes.length > 0) {
      billing.removePaymentMode(0);
    }
    billing.addPaymentMode(mode, amount, '');
  }, [billing]);

  const handleNewBill = useCallback(async () => {
    if(!await billing.resetBilling()) return;
    setSuccessData(null);
    setWalkinName('');
  }, [billing]);

  const columns = [
    {
      title: '#',
      width: 40,
      align: 'center',
      render: (_, __, i) => i + 1,
    },
    {
      title: 'Product',
      dataIndex: 'product_name_snapshot',
      width: 200,
      render: (name) => (
        <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>
      ),
    },
    {
      title: 'Qty',
      dataIndex: 'qty',
      width: 90,
      render: (val, _, i) => (
        <InputNumber
          stringMode
          disabled={billing.locked}
          ref={(el) => { qtyRefs.current[i] = el; }}
          className="billing-qty-input"
          min={0.001}
          precision={3}
          value={val}
          size="small"
          style={{ width: '100%' }}
          onChange={(v) => billing.updateItem(i, 'qty', v)}
          onFocus={(e) => e.target.select()}
          onPressEnter={() => productSearchRef.current?.focus()}
        />
      ),
    },
    {
      title: 'Rate / unit',
      dataIndex: 'rate',
      width: 100,
      render: (val, _, i) => (
        <InputNumber
          stringMode
          disabled={billing.locked}
          className="billing-rate-input"
          precision={2}
          min={0}
          step={0.5}
          value={val}
          size="small"
          style={{ width: '100%' }}
          onChange={(v) => billing.updateItem(i, 'rate', v ?? '')}
          onFocus={(e) => e.target.select()}
        />
      ),
    },
    {
      title:'GST (catalog)',dataIndex:'gst_pct',width:90,render:value=>`${value}%`,
    },
    {
      title: 'Total',
      dataIndex: 'line_total',
      width: 110,
      align: 'right',
      render: (v) => formatINR(v),
    },
    {
      title: '',
      width: 40,
      render: (_, __, i) => (
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => billing.removeItem(i)}
        />
      ),
    },
  ];

  const currentMode = billing.payment.modes[0]?.mode || 'cash';

  return (
    <div style={{ padding: 24 }}>
      <InvoiceReview billing={billing}/>
      <Card>
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Title level={4} style={{ margin: 0 }}>
              Quick Bill <Tag color="orange">Walk-In · paid in full</Tag>
            </Title>
          </Col>
        </Row>

        {/* Error alerts */}
        {billing.errors.stock && (
          <Alert
            type="error"
            message="Stock unavailable"
            description={
              Array.isArray(billing.errors.stock)
                ? billing.errors.stock
                    .map((f) => `${f.product_name}: requested ${f.requested}, available ${f.available}`)
                    .join('; ')
                : billing.errors.stock
            }
            closable
            onClose={() => billing.setErrors({})}
            style={{ marginBottom: 16 }}
          />
        )}
        {billing.errors.submit && (
          <Alert
            type="error"
            message={billing.errors.submit}
            closable
            onClose={() => billing.setErrors({})}
            style={{ marginBottom: 16 }}
          />
        )}
        {billing.errors.items && (
          <Alert
            type="warning"
            message={billing.errors.items}
            closable
            onClose={() => billing.setErrors({})}
            style={{ marginBottom: 16 }}
          />
        )}

        <Row gutter={24}>
          {/* Left: Product entry + items */}
          <Col xs={24} lg={16}>
            <Input
              disabled={billing.locked}
              placeholder="Walk-in customer name (optional)"
              value={walkinName}
              onChange={(e) => {billing.draftChanged();setWalkinName(e.target.value);}}
              maxLength={100}
              style={{ marginBottom: 16 }}
              allowClear
            />

            <ProductSearch
              ref={productSearchRef}
              onSelect={handleProductSelect}
              billType="retail"
              autoFocus
              placeholder="Search products..."
            />

            <Table
              dataSource={billing.items}
              columns={columns}
              rowKey={(_, i) => i}
              pagination={false}
              size="small"
              style={{ marginTop: 16 }}
              locale={{ emptyText: 'Add products to begin' }}
              summary={() =>
                billing.items.length > 0 ? (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5} align="right">
                        <Text strong>
                          {billing.items.length} item(s) | Qty: {billing.items.reduce((s, i) => s + (Number(i.qty) || 0), 0)}
                        </Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Text strong>{formatINR(billing.totals.grand_total)}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={6} />
                    </Table.Summary.Row>
                  </Table.Summary>
                ) : null
              }
            />
          </Col>

          {/* Right: Payment panel */}
          <Col xs={24} lg={8}>
            <Card size="small" title="Payment">
              <div style={{ marginBottom: 16 }}>
                <Radio.Group disabled={billing.locked} value={currentMode} onChange={handlePaymentModeChange}>
                  <Radio.Button value="cash">Cash</Radio.Button>
                  <Radio.Button value="upi">UPI</Radio.Button>
                </Radio.Group>
              </div>

              <Divider style={{ margin: '12px 0' }} />

              <Row justify="space-between" style={{ marginBottom: 4 }}>
                <Text type="secondary">Subtotal</Text>
                <Text>{formatINR(billing.totals.subtotal)}</Text>
              </Row>
              {billing.totals.discount_total > 0 && (
                <Row justify="space-between" style={{ marginBottom: 4 }}>
                  <Text type="secondary">Discount</Text>
                  <Text>-{formatINR(billing.totals.discount_total)}</Text>
                </Row>
              )}
              <Row justify="space-between" style={{ marginBottom: 4 }}>
                <Text type="secondary">GST</Text>
                <Text>{formatINR(billing.totals.gst_total)}</Text>
              </Row>

              <Divider style={{ margin: '12px 0' }} />

              <div style={{ textAlign: 'right' }}>
                <Text type="secondary">Grand Total</Text>
                <Title level={3} style={{ margin: 0 }}>
                  {formatINR(billing.totals.grand_total)}
                </Title>
              </div>

              <Button
                type="primary"
                size="large"
                block
                style={{ marginTop: 24 }}
                disabled={billing.items.length === 0 || billing.isSubmitting}
                loading={billing.isSubmitting}
                onClick={handleSubmit}
              >
                Quick Bill (F9)
              </Button>
            </Card>
          </Col>
        </Row>
      </Card>

      {/* Success Modal */}
      <Modal open={!!successData} footer={null} closable={false} width={420} centered>
        {successData && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <Title level={3} style={{ marginBottom: 8 }}>{successData.invoice_no}</Title>
            <Tag color="green" style={{ fontSize: 14, padding: '2px 12px' }}>{successData.status?.toUpperCase()}</Tag>

            <Divider />

            <Text strong style={{ fontSize: 18 }}>
              Total: {formatINR(successData.grand_total)}
            </Text>

            <Divider />

            <Alert type="warning" showIcon message="PDF printing and downloads are temporarily unavailable while safety checks are completed." />

            <Divider />

            <Button type="primary" block size="large" onClick={handleNewBill}>
              New Quick Bill
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

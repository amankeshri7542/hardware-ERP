import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Card, Table, Tag, Button, Typography, Row, Col, Divider, Descriptions, Space,
  Spin, Alert, Tooltip, message,
} from 'antd';
import {
  ArrowLeftOutlined, DownloadOutlined, PrinterOutlined,
  RollbackOutlined, DollarOutlined,
} from '@ant-design/icons';
import { getInvoice, openInvoicePdf } from '../../api/invoices.api';
import { getInvoicePayments } from '../../api/payments.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';
import ReturnModal from '../../components/ReturnModal/ReturnModal';
import PaymentModal from '../../components/PaymentModal/PaymentModal';
import DocumentsPanel, { useDocumentCapabilities } from '../../components/Documents/DocumentsPanel.jsx';

const { Title, Text } = Typography;

const BILL_TYPE_COLORS = { retail: 'blue', wholesale: 'purple', quickbill: 'orange' };
const STATUS_COLORS = { paid: 'green', partial: 'gold', unpaid: 'red' };
const PAYMENT_MODE_LABELS = {
  cash: 'Cash', upi: 'UPI', bank: 'Bank', cheque: 'Cheque', mixed: 'Mixed',
};

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const documentCapabilities=useDocumentCapabilities();

  const [invoice, setInvoice] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invoiceRes, paymentsRes] = await Promise.all([
        getInvoice(id),
        getInvoicePayments(id).catch(() => ({ data: { data: [] } })),
      ]);
      setInvoice(invoiceRes.data.data);
      setPayments(paymentsRes.data.data?.payments || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleDownloadPdf = useCallback(async () => {
    try {
      await openInvoicePdf(id);
    } catch {
      message.error('Failed to download PDF');
    }
  }, [id]);

  const handleReturnSuccess = useCallback(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handlePaymentSuccess = useCallback(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message="Error Loading Invoice" description={error} showIcon />
        <Button style={{ marginTop: 16 }} onClick={() => navigate('/invoices')}>
          Back to Invoices
        </Button>
      </div>
    );
  }

  if (!invoice) return null;

  const billTypeLabel = invoice.bill_type === 'quickbill'
    ? 'Quick Bill'
    : invoice.bill_type?.charAt(0).toUpperCase() + invoice.bill_type?.slice(1);

  const balanceDue = invoice.balance_due;
  const isCredit=invoice.document_kind==='sales_return';
  const showPaymentAction = !isCredit && balanceDue > 0;
  const isReturnable = !isCredit && Number(invoice.grand_total)>=0 && invoice.items?.some(item=>Number(item.qty)>Number(item.qty_returned||0));

  // Line items columns
  const itemColumns = [
    { title: '#', width: 40, align: 'center', render: (_, __, i) => i + 1 },
    { title: 'Product', dataIndex: 'product_name_snapshot', ellipsis: true },
    { title: 'HSN', dataIndex: 'hsn_snapshot', width: 80 },
    { title: 'Qty', dataIndex: 'qty', width: 70, align: 'center' },
    { title: 'Unit', dataIndex: 'unit', width: 70 },
    { title: 'Base stock qty', render:(_,item)=>`${item.base_qty ?? 'Unverified'} ${item.base_unit_snapshot ?? ''}` },
    { title: 'Returned qty', dataIndex:'qty_returned', render:value=>value||'0.000' },
    {
      title: 'Rate', dataIndex: 'rate', width: 100, align: 'right',
      render: (v) => formatINR(v),
    },
    {
      title: 'Disc%', dataIndex: 'discount_pct', width: 65, align: 'center',
      render: (v) => v > 0 ? `${v}%` : '--',
    },
    {
      title: 'Taxable', dataIndex: 'taxable_amount', width: 110, align: 'right',
      render: (v) => formatINR(v),
    },
    { title: 'GST%', dataIndex: 'gst_pct', width: 60, align: 'center' },
    {
      title: 'GST Amt', dataIndex: 'gst_amount', width: 100, align: 'right',
      render: (v) => formatINR(v),
    },
    {
      title: 'Net Amount', dataIndex: 'line_total', width: 120, align: 'right',
      render: (v) => <Text strong>{formatINR(v)}</Text>,
    },
    {
      title: 'Cost', dataIndex: 'cost_price_snapshot', width: 100, align: 'right',
      render: (v) => formatINR(v),
    },
    {
      title: 'Profit', width: 100, align: 'right',
      render: (_, record) => {
        const profit = record.line_profit;
        return (
          <Text style={{ color: profit >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
            {profit == null ? 'Unavailable' : formatINR(profit)}
          </Text>
        );
      },
    },
  ];

  // Payment history columns
  const paymentColumns = [
    { title: 'Date', dataIndex: 'payment_date', width: 110, render: (v) => formatDate(v) },
    {
      title: 'Mode', dataIndex: 'mode', width: 120,
      render: (v) => PAYMENT_MODE_LABELS[v] || v,
    },
    {
      title: 'Amount', dataIndex: 'amount', width: 120, align: 'right',
      render: (v) => formatINR(v),
    },
    { title: 'Reference', dataIndex: 'reference_no', width: 140, render: (v) => v || '--' },
    { title: 'Notes', dataIndex: 'notes', ellipsis: true, render: (v) => v || '--' },
  ];

  const totalCost = invoice.total_cost;
  const totalProfit = invoice.profit_amount;
  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Col>
          <Space align="center" size="middle">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/invoices')}>
              Back
            </Button>
            <Title level={3} style={{ margin: 0 }}>{invoice.invoice_no}</Title>
            <Tag color={BILL_TYPE_COLORS[invoice.bill_type]}>{billTypeLabel}</Tag>
            <Tag color={STATUS_COLORS[invoice.status]}>
              {invoice.status?.toUpperCase()}
            </Tag>
          </Space>
        </Col>
        <Col>
          <Space>
            {!documentCapabilities?.enabled && <><Tooltip title="PDF downloads are temporarily unavailable while safety checks are completed">
              <Button icon={<DownloadOutlined />} disabled>PDF unavailable</Button>
            </Tooltip>
            <Tooltip title="Print">
              <Button icon={<PrinterOutlined />} disabled>Print unavailable</Button>
            </Tooltip></>}
            {isReturnable && (
              <Button
                icon={<RollbackOutlined />}
                danger
                onClick={() => setReturnModalOpen(true)}
              >
                Process Return
              </Button>
            )}
            {showPaymentAction && (
              <Button
                type="primary"
                icon={<DollarOutlined />}
                onClick={() => setPaymentModalOpen(true)}
              >
                Record Payment
              </Button>
            )}
          </Space>
        </Col>
      </Row>

      <DocumentsPanel key={`invoice-${id}`} sourceType="invoice" sourceId={id} credit={isCredit} />

      {/* Invoice info + Customer info */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card size="small" title="Invoice Details">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Invoice No">{invoice.invoice_no}</Descriptions.Item>
              <Descriptions.Item label="Date">{formatDate(invoice.date)}</Descriptions.Item>
              <Descriptions.Item label="Bill Type">{billTypeLabel}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={STATUS_COLORS[invoice.status]}>
                  {invoice.status?.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              {invoice.due_date && (
                <Descriptions.Item label="Due Date">{formatDate(invoice.due_date)}</Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="Customer">
            {invoice.customer_id ? (
              <Descriptions column={2} size="small">
                <Descriptions.Item label="Name">{invoice.customer_name || '--'}</Descriptions.Item>
                <Descriptions.Item label="Phone">{invoice.customer_phone || '--'}</Descriptions.Item>
                <Descriptions.Item label="GSTIN">{invoice.customer_gstin || '--'}</Descriptions.Item>
              </Descriptions>
            ) : (
              <div>
                <Text>
                  {invoice.customer_name_walkin
                    ? `Walk-in: ${invoice.customer_name_walkin}`
                    : 'Walk-in Customer'
                  }
                </Text>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {isCredit && <Alert type="info" showIcon style={{marginBottom:16}} message="Sales credit note — no cash refund"
        description={<a href={`/invoices/${invoice.original_invoice_id}`}>Original invoice {invoice.original_invoice_id}</a>} />}
      {!invoice.customer_id && <Alert type="info" message="Eligible fully paid walk-in returns create a separate liability. Record its refund in Settlements." style={{marginBottom:16}} />}
      <Link to={invoice.customer_id ? `/settlements/customer/${invoice.customer_id}` : '/settlements/anonymous'}>Open settlement availability and refunds</Link>
      {!!invoice.return_applications?.length && <Card size="small" title="Return credits" style={{marginBottom:16}}>
        <Table rowKey="id" pagination={false} dataSource={invoice.return_applications} columns={[
          {title:'Credit note',render:(_,row)=><a href={`/invoices/${row.credit_invoice_id}`}>{row.credit_note_no}</a>},
          {title:'Issued credit',dataIndex:'total_credit',render:formatINR},
          {title:'Applied to original invoice',dataIndex:'applied_amount',render:formatINR},
          {title:invoice.customer_id?'Original unapplied customer credit':'Original walk-in liability',dataIndex:'unapplied_amount',render:formatINR},
        ]} />
        <Text type="secondary">These amounts show original return recognition, not current availability. Review current funds, allocations, and refunds in Settlements.</Text>
      </Card>}
      {/* Line Items */}
      <Card size="small" title="Line Items" style={{ marginBottom: 16 }}>
        <Table
          dataSource={invoice.items || []}
          columns={itemColumns}
          rowKey={(record) => record.id || record.product_id}
          pagination={false}
          size="small"
          scroll={{ x: 1300 }}
        />
      </Card>

      {/* Totals + Profit */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card size="small" title="Totals">
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">Subtotal</Text>
              <Text>{formatINR(invoice.subtotal)}</Text>
            </Row>
            {invoice.discount_total > 0 && (
              <Row justify="space-between" style={{ marginBottom: 4 }}>
                <Text type="secondary">Discount</Text>
                <Text>-{formatINR(invoice.discount_total)}</Text>
              </Row>
            )}
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">Taxable Amount</Text>
              <Text>{formatINR(invoice.taxable_total)}</Text>
            </Row>
            <Divider style={{ margin: '8px 0' }} />
            {/* GST breakdown */}
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">CGST</Text>
              <Text>{formatINR((invoice.gst_total || 0) / 2)}</Text>
            </Row>
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">SGST</Text>
              <Text>{formatINR((invoice.gst_total || 0) / 2)}</Text>
            </Row>
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">Total GST</Text>
              <Text>{formatINR(invoice.gst_total)}</Text>
            </Row>
            <Divider style={{ margin: '8px 0' }} />
            <Row justify="space-between">
              <Text strong style={{ fontSize: 16 }}>Grand Total</Text>
              <Text strong style={{ fontSize: 16 }}>{formatINR(invoice.grand_total)}</Text>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="Payment Summary">
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">Grand Total</Text>
              <Text>{formatINR(invoice.grand_total)}</Text>
            </Row>
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">Amount Paid</Text>
              <Text style={{ color: '#52c41a' }}>{formatINR(invoice.amount_paid)}</Text>
            </Row>
            <Divider style={{ margin: '8px 0' }} />
            <Row justify="space-between">
              <Text strong style={{ fontSize: 16 }}>Balance Due</Text>
              <Text strong style={{ fontSize: 16, color: balanceDue > 0 ? '#ff4d4f' : '#52c41a' }}>
                {formatINR(balanceDue)}
              </Text>
            </Row>

            <Divider style={{ margin: '12px 0' }} />

            {/* Profit Section */}
            <Title level={5} style={{ marginBottom: 8 }}>Profit</Title>
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">Revenue (Taxable)</Text>
              <Text>{formatINR(invoice.taxable_total)}</Text>
            </Row>
            <Row justify="space-between" style={{ marginBottom: 4 }}>
              <Text type="secondary">Cost of Goods</Text>
              <Text>{totalCost == null ? 'Unavailable' : formatINR(totalCost)}</Text>
            </Row>
            <Divider style={{ margin: '8px 0' }} />
            <Row justify="space-between">
              <Text strong>Net Profit</Text>
              <Text strong style={{ color: totalProfit >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 16 }}>
                {totalProfit == null ? 'Unavailable' : formatINR(totalProfit)}
              </Text>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* Payment History */}
      <Card size="small" title="Payment History" style={{ marginBottom: 16 }}>
        {payments.length > 0 ? (
          <Table
            dataSource={payments}
            columns={paymentColumns}
            rowKey={(record) => record.id}
            pagination={false}
            size="small"
          />
        ) : (
          <Text type="secondary">No payments recorded yet.</Text>
        )}
      </Card>

      {/* Return Modal */}
      <ReturnModal
        invoiceId={id}
        invoice={invoice}
        open={returnModalOpen}
        onClose={() => setReturnModalOpen(false)}
        onSuccess={handleReturnSuccess}
      />

      {/* Payment Modal */}
      <PaymentModal
        customerId={invoice.customer_id}
        invoiceId={id}
        balanceDue={balanceDue}
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}

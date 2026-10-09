import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Card, Descriptions, Badge, Table, Tag, DatePicker, Select, Tabs,
  Spin, Typography, Row, Col, Button, Space, message, Modal, Form,
  InputNumber, Switch,
} from 'antd';
import { ArrowLeftOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  getProduct, getStockLedger, getProductPriceHistory,
  getProductSuppliers, linkProductSupplier, getUnitConversions,
} from '../../api/products.api';
import { getSuppliers } from '../../api/suppliers.api';
import { formatINR, formatDate } from '../../utils/formatCurrency';
import ProductFormModal from './ProductFormModal';
import StockCountModal from '../../components/StockCountModal.jsx';
import PriceHistoryChart from '../../components/PriceHistoryChart';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const MOVEMENT_COLORS = {
  in: 'green',
  out: 'orange',
  return_in: 'blue',
  return_out: 'red',
  adjustment: 'purple',
};

export default function ProductDetailPage() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerPagination, setLedgerPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [dateRange, setDateRange] = useState([null, null]);
  const [typeFilter, setTypeFilter] = useState(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [countOpen,setCountOpen]=useState(false);

  // Price History state
  const [priceHistory, setPriceHistory] = useState([]);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);

  // Product Suppliers state
  const [productSuppliers, setProductSuppliers] = useState([]);
  const [productSuppliersLoading, setProductSuppliersLoading] = useState(false);
  const [linkSupplierModal, setLinkSupplierModal] = useState(false);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [linkForm] = Form.useForm();
  const [linkSaving, setLinkSaving] = useState(false);
  const [unitConversions, setUnitConversions] = useState([]);

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getProduct(id);
      setProduct(data.data);
    } catch {
      message.error('Failed to load product');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const params = {
        page: ledgerPagination.page,
        limit: ledgerPagination.limit,
      };
      if (dateRange[0]) params.from = dateRange[0].format('YYYY-MM-DD');
      if (dateRange[1]) params.to = dateRange[1].format('YYYY-MM-DD');

      const { data } = await getStockLedger(id, params);
      let entries = data.data.entries;
      if (typeFilter) {
        entries = entries.filter((e) => e.movement_type === typeFilter);
      }
      setLedger(entries);
      setLedgerPagination((prev) => ({ ...prev, total: data.data.pagination.total }));
    } catch {
      message.error('Failed to load stock ledger');
    } finally {
      setLedgerLoading(false);
    }
  }, [id, ledgerPagination.page, ledgerPagination.limit, dateRange, typeFilter]);

  const fetchPriceHistory = useCallback(async () => {
    setPriceHistoryLoading(true);
    try {
      const { data } = await getProductPriceHistory(id);
      setPriceHistory(data.data.entries);
    } catch {
      message.error('Failed to load price history');
    } finally {
      setPriceHistoryLoading(false);
    }
  }, [id]);

  const fetchProductSuppliers = useCallback(async () => {
    setProductSuppliersLoading(true);
    try {
      const { data } = await getProductSuppliers(id);
      setProductSuppliers(Array.isArray(data.data.suppliers) ? data.data.suppliers : []);
    } catch {
      message.error('Failed to load product suppliers');
    } finally {
      setProductSuppliersLoading(false);
    }
  }, [id]);

  const fetchUnitConversions = useCallback(async () => {
    try {
      const { data } = await getUnitConversions(id);
      setUnitConversions(Array.isArray(data.data) ? data.data : []);
    } catch {
      // Not critical — silently ignore
    }
  }, [id]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);
  useEffect(() => { fetchLedger(); }, [fetchLedger]);
  useEffect(() => { fetchUnitConversions(); }, [fetchUnitConversions]);

  const handleTabChange = (key) => {
    if (key === 'price-history' && priceHistory.length === 0) {
      fetchPriceHistory();
    }
    if (key === 'suppliers' && productSuppliers.length === 0) {
      fetchProductSuppliers();
    }
  };

  const openLinkSupplierModal = async () => {
    linkForm.resetFields();
    try {
      const { data } = await getSuppliers();
      setAllSuppliers(Array.isArray(data.data.suppliers) ? data.data.suppliers : []);
    } catch {
      message.error('Failed to load suppliers list');
    }
    setLinkSupplierModal(true);
  };

  const handleLinkSupplier = async () => {
    try {
      const values = await linkForm.validateFields();
      setLinkSaving(true);
      await linkProductSupplier(id, values);
      message.success('Supplier linked');
      setLinkSupplierModal(false);
      fetchProductSuppliers();
    } catch (err) {
      if (!err.errorFields) message.error('Failed to link supplier');
    } finally {
      setLinkSaving(false);
    }
  };

  const ledgerColumns = [
    {
      title: 'Date', dataIndex: 'date', key: 'date', width: 110,
      render: (v) => formatDate(v),
    },
    {
      title: 'Type', dataIndex: 'movement_type', key: 'movement_type', width: 110,
      render: (type) => (
        <Tag color={MOVEMENT_COLORS[type] || 'default'}>
          {type.replace('_', ' ').toUpperCase()}
        </Tag>
      ),
    },
    { title: 'Qty In', dataIndex: 'qty_in', key: 'qty_in', width: 80, align: 'right' },
    { title: 'Qty Out', dataIndex: 'qty_out', key: 'qty_out', width: 80, align: 'right' },
    { title: 'Stock After', dataIndex: 'stock_after', key: 'stock_after', width: 100, align: 'right' },
    { title: 'Reference', key: 'ref', width: 120,
      render: (_, r) => r.reference_type ? `${r.reference_type} #${r.reference_id}` : '—'
    },
    { title: 'Notes', dataIndex: 'notes', key: 'notes', ellipsis: true },
    { title: 'By', dataIndex: 'created_by_name', key: 'created_by_name', width: 100 },
  ];

  const priceHistoryColumns = [
    { title: 'Effective From', dataIndex: 'effective_from', key: 'effective_from', width: 130, render: (v) => formatDate(v) },
    { title: 'Cost Price', dataIndex: 'purchase_price', key: 'purchase_price', width: 120, render: (v) => v != null ? formatINR(v) : '—', align: 'right' },
    { title: 'Wholesale', dataIndex: 'wholesale_price', key: 'wholesale_price', width: 120, render: (v) => v != null ? formatINR(v) : '—', align: 'right' },
    { title: 'MRP', dataIndex: 'mrp', key: 'mrp', width: 120, render: (v) => v != null ? formatINR(v) : '—', align: 'right' },
    { title: 'Source', dataIndex: 'source', key: 'source', width: 120 },
    { title: 'Changed By', dataIndex: 'changed_by_name', key: 'changed_by_name', width: 120 },
    { title: 'Date', dataIndex: 'created_at', key: 'created_at', width: 130, render: (v) => formatDate(v) },
  ];

  const suppliersColumns = [
    { title: 'Supplier', dataIndex: 'supplier_name', key: 'supplier_name', render: (t) => <strong>{t}</strong> },
    { title: 'Phone', dataIndex: 'supplier_phone', key: 'supplier_phone', width: 120 },
    { title: 'Last Price', dataIndex: 'last_price', key: 'last_price', width: 120, render: (v) => v != null ? formatINR(v) : '—', align: 'right' },
    { title: 'Last Purchase', dataIndex: 'last_purchase_date', key: 'last_purchase_date', width: 130, render: (v) => v ? formatDate(v) : '—' },
    {
      title: 'Primary', dataIndex: 'is_primary_supplier', key: 'is_primary_supplier', width: 90,
      render: (v) => v ? <Tag color="blue">Primary</Tag> : null,
    },
  ];

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;
  if (!product) return <div style={{ padding: 48 }}>Product not found</div>;

  const isLowStock = product.current_stock < product.min_stock;

  return (
    <div style={{ padding: 24 }}>
      <Link to="/products"><ArrowLeftOutlined /> Back to Products</Link>

      <Row gutter={24} style={{ marginTop: 16 }}>
        <Col span={18}>
          <Card
            title={<Title level={4} style={{ margin: 0 }}>{product.name}</Title>}
            extra={
              <Space>
              <Button icon={<EditOutlined />} onClick={() => setModalOpen(true)}>
                Edit
              </Button>
              <Button onClick={()=>setCountOpen(true)}>Count stock</Button>
              </Space>
            }
          >
            <Descriptions column={3} size="small">
              <Descriptions.Item label="SKU">{product.sku || '—'}</Descriptions.Item>
              <Descriptions.Item label="Barcode">{product.barcode || '—'}</Descriptions.Item>
              <Descriptions.Item label="Category">{product.category}</Descriptions.Item>
              <Descriptions.Item label="Brand">{product.brand || '—'}</Descriptions.Item>
              <Descriptions.Item label="Unit">{product.unit}</Descriptions.Item>
              <Descriptions.Item label="HSN">{product.hsn_code || '—'}</Descriptions.Item>
              <Descriptions.Item label="GST Rate">{product.gst_rate}%</Descriptions.Item>
              <Descriptions.Item label="MRP">{formatINR(product.mrp)}</Descriptions.Item>
              <Descriptions.Item label="Wholesale">{formatINR(product.wholesale_price)}</Descriptions.Item>
              <Descriptions.Item label="Cost Price">{formatINR(product.purchase_price)}</Descriptions.Item>
              <Descriptions.Item label="Min Stock">{product.min_stock}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={product.is_active ? 'green' : 'default'}>
                  {product.is_active ? 'Active' : 'Inactive'}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col span={6}>
          <Card style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>CURRENT STOCK</Text>
            <div style={{
              fontSize: 42,
              fontWeight: 800,
              color: isLowStock ? '#ff4d4f' : '#52c41a',
              lineHeight: 1.2,
              margin: '8px 0',
            }}>
              {product.current_stock}
            </div>
            <Text type="secondary">{product.unit}s</Text>
            {unitConversions.length > 0 && (() => {
              const stock = parseFloat(product.current_stock) || 0;
              return unitConversions.map((conv) => {
                const cv = parseFloat(conv.conversion_value) || 1;
                const wholeUnits = Math.floor(stock / cv);
                const remainder = parseFloat((stock - wholeUnits * cv).toFixed(3));
                const label = conv.unit_name;
                const baseUnit = product.unit;
                let display;
                if (wholeUnits > 0 && remainder > 0) {
                  display = `${wholeUnits} ${label} + ${remainder} ${baseUnit}`;
                } else if (wholeUnits > 0) {
                  display = `${wholeUnits} ${label}`;
                } else {
                  display = `${stock} ${baseUnit}`;
                }
                return (
                  <div key={conv.id} style={{ marginTop: 4 }}>
                    <Tag color="blue" style={{ fontSize: 12 }}>
                      {display}
                    </Tag>
                    <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>
                      1 {label} = {cv} {baseUnit}
                    </div>
                  </div>
                );
              });
            })()}
            {isLowStock && (
              <div style={{ marginTop: 8 }}>
                <Badge status="error" text={`Below min (${product.min_stock})`} />
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Tabbed section */}
      <Card style={{ marginTop: 24 }}>
        <Tabs defaultActiveKey="stock-ledger" onChange={handleTabChange} items={[
          {
            key: 'stock-ledger',
            label: 'Stock Ledger',
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <RangePicker onChange={(dates) => setDateRange(dates || [null, null])} />
                  <Select placeholder="Movement Type" allowClear onChange={setTypeFilter}
                    style={{ width: 150 }}
                    options={[
                      { label: 'Stock In', value: 'in' },
                      { label: 'Stock Out', value: 'out' },
                      { label: 'Return In', value: 'return_in' },
                      { label: 'Return Out', value: 'return_out' },
                      { label: 'Adjustment', value: 'adjustment' },
                    ]}
                  />
                </Space>
                <Table
                  dataSource={ledger}
                  columns={ledgerColumns}
                  rowKey="id"
                  loading={ledgerLoading}
                  size="small"
                  pagination={{
                    current: ledgerPagination.page,
                    pageSize: ledgerPagination.limit,
                    total: ledgerPagination.total,
                    onChange: (page, pageSize) =>
                      setLedgerPagination((prev) => ({ ...prev, page, limit: pageSize })),
                  }}
                />
              </>
            ),
          },
          {
            key: 'price-history',
            label: 'Price History',
            children: (
              <>
                {!priceHistoryLoading && priceHistory.length >= 2 && (
                  <PriceHistoryChart data={priceHistory} />
                )}
                <Table
                  dataSource={priceHistory}
                  columns={priceHistoryColumns}
                  rowKey="id"
                  loading={priceHistoryLoading}
                  size="small"
                  pagination={{ pageSize: 20 }}
                  locale={{ emptyText: 'No price history records' }}
                />
              </>
            ),
          },
          {
            key: 'suppliers',
            label: 'Suppliers',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openLinkSupplierModal}>
                    Link Supplier
                  </Button>
                </div>
                <Table
                  dataSource={productSuppliers}
                  columns={suppliersColumns}
                  rowKey="id"
                  loading={productSuppliersLoading}
                  size="small"
                  pagination={false}
                  locale={{ emptyText: 'No suppliers linked' }}
                />
              </>
            ),
          },
        ]} />
      </Card>

      {/* Link Supplier Modal */}
      <Modal
        title="Link Supplier to Product"
        open={linkSupplierModal}
        onCancel={() => setLinkSupplierModal(false)}
        onOk={handleLinkSupplier}
        confirmLoading={linkSaving}
        destroyOnHidden={false}
      >
        <Form form={linkForm} layout="vertical" requiredMark="optional">
          <Form.Item name="supplier_id" label="Supplier"
            rules={[{ required: true, message: 'Select a supplier' }]}>
            <Select
              placeholder="Select supplier"
              showSearch
              optionFilterProp="label"
              options={allSuppliers.map((s) => ({ label: s.name, value: s.id }))}
            />
          </Form.Item>
          <Form.Item name="last_price" label="Price">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="0.00" />
          </Form.Item>
          <Form.Item name="is_primary_supplier" label="Primary Supplier" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <ProductFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => { fetchProduct(); fetchLedger(); }}
        productId={id}
      />
      {product && <StockCountModal product={product} open={countOpen} onClose={()=>setCountOpen(false)} onSuccess={()=>{fetchProduct();fetchLedger();}} />}
    </div>
  );
}

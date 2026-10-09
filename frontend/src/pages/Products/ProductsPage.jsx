import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Input, Select, Switch, Button, Tag, Space, Popconfirm,
  message, Spin, Typography, Row, Col, Card,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  SearchOutlined, WarningOutlined,
} from '@ant-design/icons';
import { getProducts, deleteProduct } from '../../api/products.api';
import { formatINR } from '../../utils/formatCurrency';
import ProductFormModal from './ProductFormModal';
import useAuthStore from '../../store/authStore';
import { hasCapability } from '../../utils/access';

const { Title } = Typography;

export default function ProductsPage() {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const canEdit = hasCapability(user, 'catalog.write');
  const canReadCost = hasCapability(user, 'cost.read');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(undefined);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editProductId, setEditProductId] = useState(null);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        limit: pagination.limit,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (category) params.category = category;
      if (lowStockOnly) params.low_stock_only = 'true';
      if (!showInactive) params.is_active = 'true';

      const { data } = await getProducts(params);
      setProducts(Array.isArray(data.data.products) ? data.data.products : []);
      setPagination((prev) => ({ ...prev, total: data.data.pagination?.total || 0 }));
    } catch {
      message.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, debouncedSearch, category, lowStockOnly, showInactive]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const handleDelete = async (id) => {
    try {
      await deleteProduct(id);
      message.success('Product deactivated');
      fetchProducts();
    } catch (err) {
      if (err.response?.status === 422 || err.response?.data?.code === 'PRODUCT_HAS_HISTORY') {
        message.error(err.response?.data?.error || 'Cannot delete — product has billing history. Deactivate instead.');
      } else {
        message.error('Failed to deactivate product');
      }
    }
  };

  const columns = [
    {
      title: 'Name', dataIndex: 'name', key: 'name',
      render: (text, record) => canReadCost ? (
        <a onClick={() => navigate(`/products/${record.id}`)}
           style={{ fontWeight: 600 }}>
          {text}
        </a>
      ) : text,
    },
    { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 100 },
    { title: 'Category', dataIndex: 'category', key: 'category', width: 120 },
    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 80 },
    {
      title: 'MRP', dataIndex: 'mrp', key: 'mrp', width: 110,
      render: (v) => formatINR(v), align: 'right',
    },
    {
      title: 'Wholesale', dataIndex: 'wholesale_price', key: 'wholesale_price', width: 110,
      render: (v) => formatINR(v), align: 'right',
    },
    {
      title: 'Cost', dataIndex: 'purchase_price', key: 'purchase_price', width: 110,
      render: (v) => formatINR(v), align: 'right',
    },
    {
      title: 'Stock', dataIndex: 'current_stock', key: 'current_stock', width: 160,
      render: (stock, record) => {
        const isLow = stock < record.min_stock;
        const convs = record.unit_conversions;
        let convText = null;
        if (convs && convs.length > 0) {
          const cv = parseFloat(convs[0].conversion_value) || 1;
          const s = parseFloat(stock) || 0;
          const whole = Math.floor(s / cv);
          const rem = parseFloat((s - whole * cv).toFixed(3));
          const uName = convs[0].unit_name;
          if (whole > 0 && rem > 0) {
            convText = `${whole} ${uName} + ${rem} ${record.unit}`;
          } else if (whole > 0) {
            convText = `${whole} ${uName}`;
          }
        }
        return (
          <div>
            <span style={{ color: isLow ? '#ff4d4f' : '#52c41a', fontWeight: isLow ? 700 : 400 }}>
              {stock} {record.unit} {isLow && <WarningOutlined />}
            </span>
            {convText && (
              <div style={{ fontSize: 11, color: '#8c8c8c' }}>{convText}</div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Min', dataIndex: 'min_stock', key: 'min_stock', width: 70,
      align: 'right',
    },
    {
      title: 'Status', dataIndex: 'is_active', key: 'is_active', width: 90,
      render: (active) => (
        <Tag color={active ? 'green' : 'default'}>
          {active ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: '', key: 'actions', width: 90,
      render: (_, record) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} size="small"
            onClick={() => { setEditProductId(record.id); setModalOpen(true); }} />
          <Popconfirm title={`Deactivate ${record.name}? It will no longer appear in billing search.`}
            onConfirm={() => handleDelete(record.id)} okText="Yes" cancelText="No">
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 20 }}>
        <Col><Title level={3} style={{ margin: 0 }}>Products</Title></Col>
        <Col>
          {canEdit && <Button type="primary" icon={<PlusOutlined />}
            onClick={() => { setEditProductId(null); setModalOpen(true); }}>
            Add Product
          </Button>}
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Input prefix={<SearchOutlined />} placeholder="Search products..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              allowClear style={{ maxWidth: 320 }} />
          </Col>
          <Col>
            <Select placeholder="Category" value={category} onChange={setCategory}
              allowClear style={{ width: 160 }}
              options={[
                { label: 'Hardware', value: 'Hardware' },
                { label: 'Plumbing', value: 'Plumbing' },
                { label: 'Electrical', value: 'Electrical' },
                { label: 'Paint', value: 'Paint' },
                { label: 'Tools', value: 'Tools' },
              ]} />
          </Col>
          <Col>
            <Space>
              <span>Low Stock</span>
              <Switch checked={lowStockOnly} onChange={setLowStockOnly} size="small" />
            </Space>
          </Col>
          <Col>
            <Space>
              <span>Inactive</span>
              <Switch checked={showInactive} onChange={setShowInactive} size="small" />
            </Space>
          </Col>
        </Row>
      </Card>

      <Spin spinning={loading}>
        <Table
          dataSource={products}
          columns={columns.filter(column => (column.key !== 'purchase_price' || canReadCost) && (column.key !== 'actions' || canEdit))}
          rowKey="id"
          pagination={{
            current: pagination.page,
            pageSize: pagination.limit,
            total: pagination.total,
            showTotal: (total) => `${total} products`,
            onChange: (page, pageSize) =>
              setPagination((prev) => ({ ...prev, page, limit: pageSize })),
          }}
          size="middle"
          scroll={{ x: 1000 }}
        />
      </Spin>

      {canEdit && <ProductFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditProductId(null); }}
        onSuccess={fetchProducts}
        productId={editProductId}
      />}
    </div>
  );
}

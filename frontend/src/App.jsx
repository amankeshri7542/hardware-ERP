import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PrivateRoute from './components/PrivateRoute';
import AppLayout from './components/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import useAuthStore from './store/authStore';
import { homePath } from './utils/access';
import { Spin } from 'antd';

// Auth pages
import LoginPage from './pages/Login/LoginPage';

// Dashboard
import DashboardPage from './pages/Dashboard/DashboardPage';

// Product pages
import ProductsPage from './pages/Products/ProductsPage';
import ProductDetailPage from './pages/Products/ProductDetailPage';
import LowStockPage from './pages/Products/LowStockPage';

// Supplier pages
import SuppliersPage from './pages/Suppliers/SuppliersPage';
import SupplierDetailPage from './pages/Suppliers/SupplierDetailPage';

// Purchase pages
import PurchasesPage from './pages/Purchases/PurchasesPage';
import NewPurchasePage from './pages/Purchases/NewPurchasePage';
import PurchaseDetailPage from './pages/Purchases/PurchaseDetailPage';

// Billing pages
import BillingLayout from './pages/Billing/BillingLayout';
import BillingPage from './pages/Billing/BillingPage';
import QuickBillPage from './pages/Billing/QuickBillPage';

// Invoice pages
import InvoicesPage from './pages/Invoices/InvoicesPage';
import InvoiceDetailPage from './pages/Invoices/InvoiceDetailPage';

// Customer pages
import CustomersPage from './pages/Customers/CustomersPage';
import CustomerDetailPage from './pages/Customers/CustomerDetailPage';

// Payment pages
import PaymentsPage from './pages/Payments/PaymentsPage';

// Report pages
import ReportsIndexPage from './pages/Reports/ReportsIndexPage';
import SalesReportPage from './pages/Reports/SalesReportPage';
import GstReportPage from './pages/Reports/GstReportPage';
import StockReportPage from './pages/Reports/StockReportPage';
import StockMovementPage from './pages/Reports/StockMovementPage';
import CustomerDuesPage from './pages/Reports/CustomerDuesPage';
import ProfitReportPage from './pages/Reports/ProfitReportPage';
import CollectionsReportPage from './pages/Reports/CollectionsReportPage';

// Settings
import SettingsPage from './pages/Settings/SettingsPage';

export default function App() {
  const user = useAuthStore(state => state.user);
  const isInitializing = useAuthStore(state => state.isInitializing);
  const initialize = useAuthStore(state => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isInitializing) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected routes — all wrapped in AppLayout (sidebar nav) */}
        <Route element={<PrivateRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to={homePath(user)} replace />} />

            {/* Dashboard */}
            <Route path="/dashboard" element={<DashboardPage />} />

            {/* Billing */}
            <Route path="/billing" element={<BillingLayout />}>
              <Route index element={<BillingPage />} />
              <Route path="quick" element={<QuickBillPage />} />
            </Route>

            {/* Invoices */}
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage />} />

            {/* Customers */}
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />

            {/* Products */}
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/products/low-stock" element={<LowStockPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />

            {/* Suppliers */}
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/suppliers/:id" element={<SupplierDetailPage />} />

            {/* Purchases */}
            <Route path="/purchases" element={<PurchasesPage />} />
            <Route path="/purchases/new" element={<NewPurchasePage />} />
            <Route path="/purchases/:id" element={<PurchaseDetailPage />} />

            {/* Payments */}
            <Route path="/payments" element={<PaymentsPage />} />

            {/* Reports */}
            <Route path="/reports" element={<ReportsIndexPage />} />
            <Route path="/reports/sales" element={<SalesReportPage />} />
            <Route path="/reports/gst" element={<GstReportPage />} />
            <Route path="/reports/stock" element={<StockReportPage />} />
            <Route path="/reports/stock-movement" element={<StockMovementPage />} />
            <Route path="/reports/dues" element={<CustomerDuesPage />} />
            <Route path="/reports/profit" element={<ProfitReportPage />} />
            <Route path="/reports/collections" element={<CollectionsReportPage />} />

            {/* Settings */}
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

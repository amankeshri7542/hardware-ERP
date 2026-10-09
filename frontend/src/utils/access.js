export const hasCapability = (user, capability) => user?.capabilities?.includes(capability) === true;
export const homePath = (user) => hasCapability(user, 'dashboard.read') ? '/dashboard' : '/products';

export function canAccessPath(user, path) {
  if (path === '/') return true;
  if (path === '/products') return hasCapability(user, 'catalog.read');
  const capability = [
    ['/products', 'cost.read'], ['/billing', 'billing.create'],
    ['/invoices', 'invoices.read'], ['/customers', 'customers.read'],
    ['/suppliers', 'suppliers.read'], ['/purchases', 'purchases.read'],
    ['/payments', 'payments.read'], ['/reports', 'reports.read'],
    ['/settings', 'settings.read'], ['/dashboard', 'dashboard.read'],
  ].find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1];
  return Boolean(capability && hasCapability(user, capability));
}

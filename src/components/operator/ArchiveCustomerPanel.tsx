import OperatorCustomerSearch from './OperatorCustomerSearch';
import { useOperatorPreferences } from '../../contexts/OperatorPreferencesContext';

type Props = {
  onNavigateToOrder?: (orderId: string, kind: 'live' | 'archive') => void;
  onNavigateToCustomerOrders?: (phone: string) => void;
  focusCustomerPhone?: string | null;
  focusCustomerToken?: number;
  customerDeletePassword?: string;
};

export default function ArchiveCustomerPanel({
  onNavigateToOrder,
  onNavigateToCustomerOrders,
  focusCustomerPhone,
  focusCustomerToken,
  customerDeletePassword = '2007',
}: Props) {
  const { t } = useOperatorPreferences();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-[var(--op-text)] text-start">{t('بيانات العملاء', 'Customer Data')}</h2>
        <p className="mt-1 text-sm text-[var(--op-muted)] text-start">
          {t('بحث وعرض بيانات العملاء والطلبات المؤرشفة', 'Search and view customer records and archived orders')}
        </p>
      </div>
      {onNavigateToOrder && (
        <OperatorCustomerSearch
          onNavigateToOrder={onNavigateToOrder}
          onFocusOrdersByPhone={(phone) => onNavigateToCustomerOrders?.(phone)}
          customerDeletePassword={customerDeletePassword}
          focusPhone={focusCustomerPhone}
          focusToken={focusCustomerToken}
        />
      )}
    </div>
  );
}

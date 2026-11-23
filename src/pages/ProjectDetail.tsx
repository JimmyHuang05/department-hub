import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, DollarSign, Edit, TrendingUp, User } from 'lucide-react';
import type { CSSProperties, ElementType } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSettingsStore } from '../store/settingsStore';
import { formatCurrency, formatDate, formatPercent } from '../utils/format';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { getProductById } = useProjectStore();
  const { settings } = useSettingsStore();
  const product = id ? getProductById(id) : undefined;

  if (!product) {
    return (
      <div className="w-full space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-slate-500">产品不存在</p>
          <Link to="/projects" className="mt-4 inline-flex items-center gap-2 text-brand-600 hover:text-brand-700">
            <ArrowLeft size={16} />
            返回项目列表
          </Link>
        </div>
      </div>
    );
  }

  const statusCfg = settings.statusConfigs.find(status => status.name === product.status);
  const statusStyle = statusCfg
    ? ({ '--status-color': statusCfg.color } as CSSProperties)
    : undefined;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/projects"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft size={16} />
          返回项目列表
        </Link>
        <Link
          to={`/projects/${product.id}/edit`}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
        >
          <Edit size={16} />
          编辑
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-bold text-slate-900">{product.productName || '未命名项目'}</h2>
                <p className="mt-2 text-slate-500">{product.client || '未填写客户'}</p>
              </div>
              <span
                className="app-status-badge shrink-0 rounded-full border px-3 py-1 text-sm font-medium"
                style={statusStyle}
              >
                {product.status || '未填写状态'}
              </span>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-semibold text-slate-900">备注</h3>
              <p className="whitespace-pre-wrap text-slate-600">{product.remarks || '暂无备注'}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">基本信息</h3>
            <div className="space-y-4">
              <InfoRow icon={User} label="A角" value={product.trustManager || '未分配'} />
              <InfoRow icon={User} label="B角" value={product.trustManagerB || '未分配'} />
              <InfoRow icon={Calendar} label="成立时间" value={formatDate(product.establishDate)} />
              {product.deadline && <InfoRow icon={TrendingUp} label="期限" value={product.deadline} />}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">财务信息</h3>
            <div className="space-y-4">
              <InfoRow icon={DollarSign} label="USD" value={formatCurrency(product.usd, 'USD')} />
              <InfoRow icon={DollarSign} label="RMB" value={formatCurrency(product.rmb, 'CNY')} />
              <TextRow label="费率" value={formatPercent(product.feeRate)} />
              <TextRow label="年度收入" value={formatCurrency(product.annualIncome, 'CNY')} />
              <TextRow label="今年收入" value={formatCurrency(product.thisYearIncome, 'CNY')} />
              <TextRow label="绩效报酬" value={formatCurrency(product.performanceIncome, 'CNY')} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">其他信息</h3>
            <div className="space-y-3">
              {product.target && <TextRow label="标的" value={product.target} />}
              {product.brokerChannel && <TextRow label="券商渠道" value={product.brokerChannel} />}
              {product.strategy && <TextRow label="策略" value={product.strategy} />}
              {product.custodianBank && <TextRow label="托管行" value={product.custodianBank} />}
              {product.tradingBroker && <TextRow label="交易券商" value={product.tradingBroker} />}
              {!product.target && !product.brokerChannel && !product.strategy && !product.custodianBank && !product.tradingBroker && (
                <p className="text-sm text-slate-500">暂无其他信息</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="text-slate-400" size={20} />
      <div className="min-w-0">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="truncate font-medium text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="font-medium text-slate-900">{value}</p>
    </div>
  );
}

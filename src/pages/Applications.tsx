import { Link } from 'react-router-dom';
import { ContactRound, FileSpreadsheet, NotebookPen, type LucideIcon } from 'lucide-react';
import Header from '../components/Layout/Header';
import FeatureInfo from '../components/Guidance/FeatureInfo';

interface ApplicationItem {
  name: string;
  description: string;
  path: string;
  icon: LucideIcon;
  tone: 'blue' | 'violet' | 'green';
  newTab?: boolean;
}

const crmUrl = import.meta.env.VITE_CRM_URL?.trim();

const applications: ApplicationItem[] = [
  { name: '工作小结', description: '汇总并导出本周工作内容', path: '/worklog/summary', icon: NotebookPen, tone: 'green' },
  { name: 'GCO Excel', description: '在线创建和编辑表格', path: '/sheet-editor', icon: FileSpreadsheet, tone: 'blue', newTab: true },
  ...(/^https?:\/\//i.test(crmUrl || '') && crmUrl
    ? [{ name: 'GCO CRM', description: '客户关系与业务机会管理', path: crmUrl, icon: ContactRound, tone: 'violet' as const, newTab: true }]
    : []),
];

function ApplicationCard({ item }: { item: ApplicationItem }) {
  const Icon = item.icon;
  const content = (
    <>
      <span className={`applications-item-icon is-${item.tone}`}><Icon size={20} strokeWidth={1.8} /></span>
      <span className="applications-item-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
    </>
  );

  return item.newTab
    ? <a href={item.path} target="_blank" rel="noopener noreferrer" className="applications-item group">{content}</a>
    : <Link to={item.path} className="applications-item group">{content}</Link>;
}

export default function Applications() {
  return (
    <div className="applications-page flex min-h-full flex-col gap-5">
      <Header
        title="应用"
        subtitle="集中访问 GCO Link 的业务应用与协作能力。"
        info={<FeatureInfo label="应用功能说明">点击应用即可进入对应页面。</FeatureInfo>}
      />
      <main className="applications-surface min-h-0 flex-1">
        <section className="applications-group applications-group--flat">
          <div className="applications-grid">
            {applications.map(item => <ApplicationCard key={item.path} item={item} />)}
          </div>
        </section>
      </main>
    </div>
  );
}

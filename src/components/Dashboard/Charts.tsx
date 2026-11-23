import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { useSettingsStore } from '../../store/settingsStore';
import { useMemo } from 'react';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

interface ChartsProps {
  productsByStatus: Record<string, number>;
  products: any[];
}

export default function Charts({ productsByStatus, products }: ChartsProps) {
  const statusConfigs = useSettingsStore(s => s.settings.statusConfigs);
  const rootStyles = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const readThemeColor = (name: string, fallback: string) => rootStyles?.getPropertyValue(name).trim() || fallback;
  const primaryColor = readThemeColor('--app-primary', '#2754d7');
  const successColor = readThemeColor('--app-success', '#16a34a');
  const infoColor = readThemeColor('--app-info', '#2563eb');
  const mutedColor = readThemeColor('--app-faint', '#64748b');

  const gridColor = 'rgba(15, 23, 42, 0.06)';
  const tickColor = mutedColor;
  const legendColor = readThemeColor('--app-text', '#334155');

  // 从设置中读取状态标签和颜色
  const statusLabels = useMemo(() => {
    return statusConfigs.map(s => s.name);
  }, [statusConfigs]);

  const statusColors = useMemo(() => {
    return statusConfigs.map(s => s.color);
  }, [statusConfigs]);

  const barData = {
    labels: statusLabels,
    datasets: [
      {
        label: '产品数量',
        data: statusLabels.map(label => productsByStatus[label] || 0),
        backgroundColor: statusColors,
        borderRadius: 8,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1, color: tickColor }, grid: { color: gridColor } },
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
    },
  };

  // 从真实产品数据按月统计
  const monthlyData = useMemo(() => {
    const months = ['1月', '2月', '3月', '4月', '5月', '6月',
      '7月', '8月', '9月', '10月', '11月', '12月'];

    // 按月份统计新增产品（从当前年份看）
    const currentYear = new Date().getFullYear();
    const newProductsByMonth = new Array(12).fill(0);
    const establishedByMonth = new Array(12).fill(0);

    products.forEach((p: any) => {
      if (p.establishDate) {
        const d = new Date(p.establishDate);
        if (d.getFullYear() === currentYear) {
          const month = d.getMonth(); // 0-11
          newProductsByMonth[month] = (newProductsByMonth[month] || 0) + 1;
          if (p.status === '已成立') {
            establishedByMonth[month] = (establishedByMonth[month] || 0) + 1;
          }
        }
      }
    });

    // 只显示有数据的月份范围（最多到当前月）
    const maxMonth = Math.min(new Date().getMonth(), 11);
    const labels = months.slice(0, maxMonth + 1);
    const newData = newProductsByMonth.slice(0, maxMonth + 1);
    const estData = establishedByMonth.slice(0, maxMonth + 1);

    return {
      labels,
      datasets: [
        {
          label: '新增产品',
          data: newData,
          borderColor: primaryColor,
          backgroundColor: `${primaryColor}1a`,
          fill: true,
          tension: 0.4,
        },
        {
          label: '已成立',
          data: estData,
          borderColor: successColor,
          backgroundColor: `${successColor}1a`,
          fill: true,
          tension: 0.4,
        },
      ],
    };
  }, [products, primaryColor, successColor]);

  const lineOptions = {
    responsive: true,
    plugins: { legend: { position: 'top' as const, labels: { color: legendColor } } },
    scales: {
      y: { beginAtZero: true, ticks: { color: tickColor }, grid: { color: gridColor } },
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
    },
  };

  const getRange = (value: number) => {
    if (value < 1000000) return '<100万';
    if (value < 5000000) return '100-500万';
    if (value < 10000000) return '500-1000万';
    return '>1000万';
  };

  const rangeData = products.reduce((acc: Record<string, number>, p) => {
    const range = getRange(p.usd);
    acc[range] = (acc[range] || 0) + 1;
    return acc;
  }, {});

  const doughnutData = {
    labels: ['<100万', '100-500万', '500-1000万', '>1000万'],
    datasets: [
      {
        data: [
          rangeData['<100万'] || 0,
          rangeData['100-500万'] || 0,
          rangeData['500-1000万'] || 0,
          rangeData['>1000万'] || 0,
        ],
        backgroundColor: [mutedColor, primaryColor, successColor, infoColor],
        borderWidth: 0,
      },
    ],
  };

  const doughnutOptions = {
    responsive: true,
    plugins: { legend: { position: 'bottom' as const, labels: { color: legendColor } } },
  };

  const chartTitleClass = "flex items-center gap-2 text-[15px] font-bold mb-4";

  const cardBase = {
    background: 'var(--app-panel)',
    borderRadius: 16,
    border: '1px solid var(--app-border)',
    boxShadow: 'var(--app-shadow)',
    padding: 24,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div style={cardBase}>
        <div style={{ height: 3, borderRadius: '3px 3px 0 0', background: 'linear-gradient(90deg, var(--app-primary), var(--app-accent))', margin: -24, marginBottom: 20 }} />
        <h3 className={chartTitleClass} style={{ color: 'var(--app-text)' }}>
          <span style={{ width: 3, height: 16, borderRadius: 2, background: 'var(--app-primary)', display: 'inline-block' }} />
          产品状态分布
        </h3>
        <div className="h-64">
          <Bar data={barData} options={barOptions} />
        </div>
      </div>

      <div style={cardBase}>
        <div style={{ height: 3, borderRadius: '3px 3px 0 0', background: 'linear-gradient(90deg, var(--app-success), var(--app-primary))', margin: -24, marginBottom: 20 }} />
        <h3 className={chartTitleClass} style={{ color: 'var(--app-text)' }}>
          <span style={{ width: 3, height: 16, borderRadius: 2, background: 'var(--app-success)', display: 'inline-block' }} />
          产品趋势
        </h3>
        <div className="h-64">
          <Line data={monthlyData} options={lineOptions} />
        </div>
      </div>

      <div className="lg:col-span-2" style={cardBase}>
        <div style={{ height: 3, borderRadius: '3px 3px 0 0', background: 'linear-gradient(90deg, var(--app-info), var(--app-primary))', margin: -24, marginBottom: 20 }} />
        <h3 className={chartTitleClass} style={{ color: 'var(--app-text)' }}>
          <span style={{ width: 3, height: 16, borderRadius: 2, background: 'var(--app-info)', display: 'inline-block' }} />
          规模分布（USD）
        </h3>
        <div className="h-64">
          <Doughnut data={doughnutData} options={doughnutOptions} />
        </div>
      </div>
    </div>
  );
}

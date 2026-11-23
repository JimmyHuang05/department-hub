import type { ReactNode } from 'react';

export interface ListCardView {
  key: string;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}

export interface ListCardMetric {
  label: string;
  value: string | number;
}

interface ListCardShellProps {
  id?: string;
  title?: string;
  subtitle?: string;
  views: ListCardView[];
  metrics: ListCardMetric[];
  toolbar?: ReactNode;
  hideViews?: boolean;
  stickyWorkspace?: boolean;
  mergeToolbarWithContent?: boolean;
  showContentTopDivider?: boolean;
  contentClassName?: string;
  compactViews?: boolean;
  viewsTitle?: string;
  children: ReactNode;
}

export default function ListCardShell({
  id,
  title,
  subtitle,
  views,
  metrics,
  toolbar,
  hideViews = false,
  stickyWorkspace = false,
  mergeToolbarWithContent = false,
  showContentTopDivider = true,
  contentClassName = 'p-4',
  compactViews = false,
  viewsTitle = '分类视图',
  children,
}: ListCardShellProps) {
  return (
    <section id={id} className={`${stickyWorkspace ? 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden' : 'space-y-3'}`}>
      {(title || subtitle) && (
        <div className="mb-5 min-w-0">
          {title && <h1 className="truncate text-4xl font-medium tracking-normal text-zinc-950">{title}</h1>}
          {subtitle && <p className="mt-2 text-sm text-zinc-500">{subtitle}</p>}
        </div>
      )}

      {toolbar ? (
        <div className={`app-module-frame app-content-toolbar relative z-30 border border-zinc-200 bg-white p-3 ${mergeToolbarWithContent ? 'border-b-0' : 'mb-3'}`}>
          <div className="flex h-full flex-col justify-center gap-3 xl:flex-row xl:items-center">
            <div className="min-w-0 xl:flex-1">{toolbar}</div>
            {metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:ml-auto xl:min-w-[420px] xl:shrink-0">
                {metrics.slice(0, 4).map(metric => (
                  <div key={metric.label} className="flex h-10 flex-col justify-center border border-slate-200 bg-white px-3 text-slate-700">
                    <div className="truncate text-[11px] leading-none text-slate-500">{metric.label}</div>
                    <div className="mt-1 truncate text-sm font-semibold leading-none text-slate-900">{metric.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        metrics.length > 0 && (
          <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {metrics.slice(0, 4).map(metric => (
              <div key={metric.label} className="flex h-10 flex-col justify-center border border-slate-200 bg-white px-3 text-slate-700">
                <div className="truncate text-[11px] leading-none text-slate-500">{metric.label}</div>
                <div className="mt-1 truncate text-sm font-semibold leading-none text-slate-900">{metric.value}</div>
              </div>
            ))}
          </div>
        )
      )}

      <div className={`grid grid-cols-1 ${mergeToolbarWithContent ? 'gap-0' : 'gap-3'} ${stickyWorkspace ? 'lg:min-h-0 lg:flex-1' : ''} ${hideViews ? '' : compactViews ? 'lg:grid-cols-[216px_minmax(0,1fr)]' : 'xl:grid-cols-[246px_minmax(0,1fr)]'}`}>
        {!hideViews && (
          <aside className={`border border-zinc-200 bg-white ${compactViews ? 'p-3 lg:min-h-0 lg:overflow-y-auto' : 'p-4'}`}>
            <h2 className={compactViews ? 'px-2 py-2 text-xs font-semibold text-slate-400' : 'text-xl font-medium tracking-normal text-zinc-950'}>{viewsTitle}</h2>
            <div className={compactViews ? 'mt-1 grid gap-1' : 'mt-4 grid gap-2'}>
              {views.map(view => (
                <button
                  key={view.key}
                  type="button"
                  onClick={view.onClick}
                  className={compactViews ? `relative flex h-12 items-center justify-between gap-3 px-3 text-left text-sm transition-colors before:absolute before:inset-y-2 before:left-0 before:w-0.5 ${
                    view.active
                      ? 'bg-primary-50 font-semibold text-primary-700 before:bg-primary-600'
                      : 'text-slate-600 before:bg-transparent hover:bg-slate-50 hover:text-slate-950'
                  }` : `grid h-[66px] grid-cols-[38px_minmax(0,1fr)] items-center gap-3 px-3 text-left transition-colors ${
                    view.active
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  }`}
                >
                  {compactViews ? <><span className="truncate">{view.label}</span><span className={`shrink-0 text-xs tabular-nums ${view.active ? 'text-primary-600' : 'text-slate-400'}`}>{view.count ?? 0}</span></> : <><span className={`h-9 w-9 ${view.active ? 'bg-white' : 'bg-zinc-400'}`} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{view.label}</span><span className={`mt-1 block text-xs ${view.active ? 'text-zinc-300' : 'text-zinc-500'}`}>{typeof view.count === 'number' ? `${view.count} 条` : '快速视图'}</span></span></>}
                </button>
              ))}
            </div>

            {!compactViews && <div className="mt-4 grid grid-cols-2 gap-2">
              {metrics.slice(0, 4).map(metric => (
                <div key={metric.label} className="flex h-10 flex-col justify-center border border-slate-200 bg-white px-3 text-slate-700">
                  <div className="truncate text-[11px] leading-none text-slate-500">{metric.label}</div>
                  <div className="mt-1 truncate text-sm font-semibold leading-none text-slate-900">{metric.value}</div>
                </div>
              ))}
            </div>}
          </aside>
        )}

        <div className={`app-module-frame ${mergeToolbarWithContent && showContentTopDivider ? 'app-module-divider' : ''} min-w-0 border border-zinc-200 bg-white ${contentClassName} ${stickyWorkspace ? 'lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden' : ''}`}>
          {children}
        </div>
      </div>
    </section>
  );
}

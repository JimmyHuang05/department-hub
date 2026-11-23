import SaveStatusIndicator from '../SaveStatusIndicator';

interface HeaderProps {
  title: string;
  info?: React.ReactNode;
  subtitle?: string;
  eyebrow?: string;
  showSearch?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export default function Header({
  title,
  info,
  subtitle,
  eyebrow = '全球资本运营部',
  showSearch = true,
  children,
  className = '',
}: HeaderProps) {
  void showSearch;

  return (
    <header className={`bg-white px-4 py-4 sm:px-5 ${className}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-surface-500">
            <span>{eyebrow}</span>
            <span className="h-1 w-1 rounded-full bg-danger-500" />
            <SaveStatusIndicator />
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-1.5">
            <h1 className="truncate text-xl font-semibold tracking-normal text-surface-900 sm:text-2xl">{title}</h1>
            {info}
          </div>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-surface-500">{subtitle}</p>}
        </div>

        {children && (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:w-auto">
            {children}
          </div>
        )}
      </div>
    </header>
  );
}

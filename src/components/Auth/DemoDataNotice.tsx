import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import AppModal from '../Layout/AppModal';
import { api } from '../../lib/api';

export default function DemoDataNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<{ synthetic: boolean }>('/demo-data').then(({ synthetic }) => {
      if (active && synthetic) setOpen(true);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const close = () => setOpen(false);

  return (
    <AppModal
      open={open}
      onClose={close}
      size="sm"
      title="数据说明"
      icon={<Info size={18} />}
      footer={<button type="button" onClick={close} className="app-button-primary h-10 px-5">我知道了</button>}
    >
      <p className="text-sm leading-6 text-surface-700">
        本站中的人员、机构、项目、文件及业务记录均为虚构数据，仅用于展示系统功能。
      </p>
    </AppModal>
  );
}

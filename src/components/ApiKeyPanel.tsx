import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCircle2, Clock3, Copy, Loader2, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';
import { _toast } from '../store/toastRef';

interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  maskedKey: string;
  scopes?: string[];
  lastUsedAt?: string | null;
}

const INSTRUCTION_TEXT = `阅读 ${new URL('/skill.md', window.location.origin)} 安装 GCO Link+ 能力`;
const VERIFY_TEXT = '请使用 GCO Link+ 查看我最近更新的项目，并概括当前进度和待处理事项。';

const SCOPE_LABELS: Record<string, string> = {
  'read:projects': '项目进度',
  'read:worklogs': '管理周报',
  'read:clouddrive': '云盘文件',
  'read:tools': '内部工具',
  'read:skills': '内部技能',
  'read:questionnaires': '问卷',
};

function formatLastUsed(value?: string | null) {
  if (!value) return '尚未使用';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未使用';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function makeStarMask(prefix?: string) {
  const raw = String(prefix || '').replace(/^ibd-?/i, '').replace(/^hb_live_?/i, '').replace(/[^a-zA-Z0-9]/g, '');
  const head = (raw.slice(0, 5).toLowerCase() || 'xxxxx').padEnd(5, 'x');
  const tail = (raw.slice(-4) || 'xxxx').padStart(4, 'x');
  return `ibd-${head}${'*'.repeat(23)}${tail}`;
}

export default function ApiKeyPanel({ embedded = false }: { embedded?: boolean }) {
  const [apiKey, setApiKey] = useState<ApiKeyInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  const loadKey = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ apiKey: ApiKeyInfo }>('/api-keys/mine');
      setApiKey(res.apiKey);
    } catch (error: any) {
      _toast.error?.(error.message || '获取 API Key 失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKey();
  }, []);

  const openCopyDialog = () => {
    setPassword('');
    setCopied(false);
    setCopyDialogOpen(true);
  };

  const copyInstruction = async () => {
    await navigator.clipboard.writeText(INSTRUCTION_TEXT);
    _toast.success?.('指令已复制');
  };

  const copyVerifyText = async () => {
    await navigator.clipboard.writeText(VERIFY_TEXT);
    _toast.success?.('验证请求已复制');
  };

  const copyWithPassword = async () => {
    if (!password) {
      _toast.warning?.('请输入当前登录密码');
      return;
    }
    setCopying(true);
    try {
      const res = await api.post<{ plainKey: string }>('/api-keys/mine/reveal', { password });
      await navigator.clipboard.writeText(res.plainKey);
      setCopied(true);
      setPassword('');
      _toast.success?.('API Key 已复制');
      window.setTimeout(() => setCopyDialogOpen(false), 700);
    } catch (error: any) {
      _toast.error?.(error.message || '复制 API Key 失败');
    } finally {
      setCopying(false);
    }
  };

  return (
    <section className={embedded ? '' : 'border border-slate-200 bg-white'}>
      <div className={`grid grid-cols-1 border-y border-slate-200 sm:grid-cols-3 ${embedded ? '' : 'mx-5'}`}>
        <CostItem label="预计时间" value="约 2 分钟" />
        <CostItem label="操作门槛" value="无需写代码" />
        <CostItem label="GCO Link 费用" value="不额外收费" last />
      </div>

      <div className={`grid gap-0 ${embedded ? 'py-6' : 'p-5'}`}>
        <GuideStep number="1" title="让 Agent 学会使用 GCO Link" description="复制下面这句话，发送给你正在使用的 Agent。它会自动阅读使用说明并完成准备。">
          <CopyLine value={INSTRUCTION_TEXT} buttonLabel="复制安装指令" onCopy={copyInstruction} />
          <p className="mt-2 text-xs text-slate-400">通常首次读取需要几十秒；之后同一任务中无需重复安装。</p>
        </GuideStep>

        <GuideStep number="2" title="提供你的专属访问密钥" description="Agent 需要用它确认你的身份和数据权限。复制时会要求输入一次当前登录密码。">
          <div className="grid gap-2">
            <CopyLine
              value={loading ? '正在读取...' : apiKey?.maskedKey || makeStarMask(apiKey?.keyPrefix)}
              buttonLabel="验证并复制密钥"
              onCopy={openCopyDialog}
              disabled={loading || !apiKey}
              mono
            />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5"><Clock3 size={13} />最近使用：{formatLastUsed(apiKey?.lastUsedAt)}</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} />修改必须经你二次确认</span>
            </div>
          </div>
        </GuideStep>

        <GuideStep number="3" title="发出第一条请求" description="把下面的示例发给同一个 Agent。如果它返回你的项目内容，就表示接入成功。" last>
          <CopyLine value={VERIFY_TEXT} buttonLabel="复制验证请求" onCopy={copyVerifyText} />
        </GuideStep>

        <div className="mt-7 grid border-y border-slate-200 md:grid-cols-2">
          <div className="py-5 md:pr-7">
            <h3 className="text-sm font-semibold text-slate-950">接入后能做什么</h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">Agent 可以搜索、读取和总结以下内容；修改会先展示差异，只有你在 Agent 中二次确认后才会写入。</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
              {(apiKey?.scopes || Object.keys(SCOPE_LABELS)).map(scope => <span key={scope} className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} className="text-primary-600" />{SCOPE_LABELS[scope] || scope}</span>)}
            </div>
          </div>
          <div className="border-t border-slate-200 py-5 md:border-l md:border-t-0 md:pl-7">
            <h3 className="text-sm font-semibold text-slate-950">你需要承担的成本</h3>
            <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-500">
              <p><span className="font-medium text-slate-700">时间：</span>首次接入约 2 分钟，之后可以直接用自然语言提问。</p>
              <p><span className="font-medium text-slate-700">费用：</span>GCO Link 不额外收费；Agent 或模型产生的用量由你所使用的平台套餐决定。</p>
              <p><span className="font-medium text-slate-700">维护：</span>密钥长期有效，正常情况下不需要反复复制或配置。</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-amber-700">
          <ShieldCheck size={15} className="mt-0.5 shrink-0" />
          <p>API Key 等同于你的访问凭证。所有修改都必须经过二次确认；仍请只发送给你信任的 Agent，不要放进群聊、截图、公开文档或代码仓库。</p>
        </div>
      </div>

      {copyDialogOpen && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-[420px] border border-slate-200 bg-white shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
              <div className="text-sm font-semibold text-slate-950">复制 API Key</div>
              <button
                type="button"
                onClick={() => setCopyDialogOpen(false)}
                className="flex h-8 w-8 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-4 p-5">
              <p className="text-xs leading-5 text-slate-500">为保护账号，请输入当前登录密码。验证成功后密钥会直接复制到剪贴板，不会在页面中明文展示。</p>
              <label className="grid gap-2">
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') copyWithPassword();
                  }}
                  className="h-10 w-full border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                  placeholder="当前登录密码"
                  autoComplete="current-password"
                  autoFocus
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setCopyDialogOpen(false)}
                className="inline-flex h-9 items-center justify-center border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={copyWithPassword}
                disabled={copying}
                className="inline-flex h-9 items-center justify-center gap-2 border border-primary-600 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {copying ? <Loader2 size={15} className="animate-spin" /> : copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? '已复制' : '确认复制'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

function CostItem({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <div className={`px-4 py-3 ${last ? '' : 'border-b border-slate-200 sm:border-b-0 sm:border-r'}`}><div className="text-[11px] text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold text-slate-900">{value}</div></div>;
}

function GuideStep({ number, title, description, last = false, children }: { number: string; title: string; description: string; last?: boolean; children: React.ReactNode }) {
  return <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3"><div className="flex flex-col items-center"><span className="flex h-7 w-7 items-center justify-center bg-primary-600 text-xs font-semibold text-white">{number}</span>{!last && <span className="mt-2 w-px flex-1 bg-slate-200" />}</div><div className={last ? 'pb-1' : 'pb-7'}><h3 className="text-sm font-semibold text-slate-950">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p><div className="mt-3">{children}</div></div></div>;
}

function CopyLine({ value, buttonLabel, onCopy, disabled = false, mono = false }: { value: string; buttonLabel: string; onCopy: () => void; disabled?: boolean; mono?: boolean }) {
  return <div className="flex flex-col gap-2 sm:flex-row"><div className={`flex min-h-10 min-w-0 flex-1 items-center border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 ${mono ? 'font-mono tracking-wide' : ''}`}><span className="min-w-0 truncate">{value}</span></div><button type="button" onClick={onCopy} disabled={disabled} className="app-button-primary h-10 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"><Copy size={15} />{buttonLabel}</button></div>;
}

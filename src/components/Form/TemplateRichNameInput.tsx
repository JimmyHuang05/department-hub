import { useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCT_NAME_TEMPLATE_SLOT, normalizeProductNameTemplateSlots } from '../../utils/productNameTemplates';

type NameToken =
  | { id: string; type: 'text'; value: string }
  | { id: string; type: 'slot'; value: string };

const tokensToName = (tokens: NameToken[]) => tokens.map(token => token.value).join('');

const templateToTokens = (template: string): NameToken[] => {
  const parts = normalizeProductNameTemplateSlots(template).split(PRODUCT_NAME_TEMPLATE_SLOT);
  const tokens: NameToken[] = [];
  parts.forEach((part, index) => {
    tokens.push({ id: `text-${index}-${part}`, type: 'text', value: part });
    if (index < parts.length - 1) tokens.push({ id: `slot-${index}`, type: 'slot', value: '' });
  });
  return tokens.length ? tokens : [{ id: 'text-empty', type: 'text', value: '' }];
};

function normalizeTokens(tokens: NameToken[]) {
  const normalized: NameToken[] = [];
  tokens.forEach(token => {
    const previous = normalized[normalized.length - 1];
    if (token.type === 'text' && previous?.type === 'text') {
      previous.value += token.value;
      return;
    }
    normalized.push(token);
  });
  if (!normalized.some(token => token.type === 'text')) {
    normalized.push({ id: `text-${Date.now()}`, type: 'text', value: '' });
  }
  return normalized;
}

export default function TemplateRichNameInput({
  template,
  onChange,
  placeholder,
}: {
  template: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const initialTokens = useMemo(() => templateToTokens(template), [template]);
  const [tokens, setTokens] = useState<NameToken[]>(initialTokens);
  const tokensRef = useRef<NameToken[]>(initialTokens);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nextTokens = templateToTokens(template);
    tokensRef.current = nextTokens;
    setTokens(nextTokens);
    onChange(tokensToName(nextTokens));
  }, [template]);

  const commitTokens = (nextTokens: NameToken[]) => {
    const normalized = normalizeTokens(nextTokens);
    tokensRef.current = normalized;
    setTokens(normalized);
    onChange(tokensToName(normalized));
  };

  const updateTokenValue = (id: string, value: string, options: { rerender?: boolean } = {}) => {
    const nextTokens = tokensRef.current.map(token => token.id === id ? { ...token, value } : token);
    tokensRef.current = nextTokens;
    if (options.rerender) setTokens(nextTokens);
    onChange(tokensToName(nextTokens));
  };

  const deleteToken = (id: string) => {
    commitTokens(tokensRef.current.filter(token => token.id !== id));
  };

  const focusLastText = () => {
    const textNodes = containerRef.current?.querySelectorAll<HTMLElement>('[data-rich-name-text]');
    const lastText = textNodes?.[textNodes.length - 1];
    lastText?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="textbox"
      aria-label={placeholder}
      onClick={event => {
        if (event.target === event.currentTarget) focusLastText();
      }}
      className="flex min-h-9 w-full flex-wrap items-center border border-slate-200 bg-white px-2.5 py-1 text-sm font-medium text-slate-900 outline-none focus-within:border-slate-400"
    >
      {tokens.map(token => (
        token.type === 'text' ? (
          <span
            key={token.id}
            data-rich-name-text
            contentEditable
            suppressContentEditableWarning
            onInput={event => updateTokenValue(token.id, event.currentTarget.textContent || '')}
            onBlur={() => {
              const current = tokensRef.current.find(item => item.id === token.id);
              if (current && current.value !== token.value) setTokens(tokensRef.current);
            }}
            className="min-w-2 cursor-text whitespace-pre outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]"
            data-placeholder={tokens.length === 1 ? placeholder : ''}
          >
            {token.value}
          </span>
        ) : (
          <span
            key={token.id}
            className="mx-0.5 inline-flex h-6 shrink-0 items-center rounded border border-slate-300 bg-slate-50 px-0.5 align-middle focus-within:border-slate-500 focus-within:bg-white"
          >
            <input
              value={token.value}
              onChange={event => updateTokenValue(token.id, event.target.value, { rerender: true })}
              onKeyDown={event => {
                if (event.key === 'Backspace' && !token.value) {
                  event.preventDefault();
                  deleteToken(token.id);
                }
              }}
              inputMode="numeric"
              className="h-full w-7 border-0 bg-transparent text-center text-xs font-medium text-slate-900 outline-none"
              placeholder="变量"
            />
          </span>
        )
      ))}
    </div>
  );
}

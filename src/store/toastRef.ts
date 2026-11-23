// 用于在非 React 组件（Zustand store）中使用的 toast 引用
// 在 App 层次通过 injectToastRef 注入
export const _toast: {success?: (m: string) => void; error?: (m: string) => void; warning?: (m: string) => void; info?: (m: string) => void} = {};

export function injectToastRef(t: typeof _toast) {Object.assign(_toast, t);}
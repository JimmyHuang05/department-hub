type WritableFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

export type SaveDestination =
  | { kind: 'picker'; handle: WritableFileHandle }
  | { kind: 'download' }
  | { kind: 'cancelled' };

type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<WritableFileHandle>;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function chooseXlsxDestination(suggestedName: string): Promise<SaveDestination> {
  const picker = (window as typeof window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) return { kind: 'download' };

  try {
    const handle = await picker({
      suggestedName,
      types: [{
        description: 'Excel 工作簿',
        accept: { [XLSX_MIME]: ['.xlsx'] },
      }],
    });
    return { kind: 'picker', handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'cancelled' };
    throw error;
  }
}

export async function saveXlsxBlob(blob: Blob, filename: string, destination: SaveDestination) {
  if (destination.kind === 'cancelled') return false;

  if (destination.kind === 'picker') {
    const writable = await destination.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}

export { XLSX_MIME };

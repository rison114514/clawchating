import { AlertTriangle, Loader2, X } from 'lucide-react';

interface DeleteAgentModalProps {
  isOpen: boolean;
  agentId: string;
  agentName: string;
  isDeleting?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteAgentModal({ isOpen, agentId, agentName, isDeleting = false, onClose, onConfirm }: DeleteAgentModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-300 font-semibold">
            <AlertTriangle className="w-4 h-4" />
            删除 Agent
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            disabled={isDeleting}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm text-neutral-300">
          <p>
            你将删除 Agent：
            <span className="text-white font-semibold"> {agentName}</span>
            <span className="text-neutral-500"> ({agentId})</span>
          </p>
          <p className="text-neutral-400">
            该操作将调用 OpenClaw 原生删除流程，并清理该 Agent 的工作区与状态目录。此操作不可撤销。
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
              disabled={isDeleting}
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting}
              className="px-3 py-2 text-sm rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-70 text-white inline-flex items-center gap-2"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isDeleting ? '删除中...' : '确认删除'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

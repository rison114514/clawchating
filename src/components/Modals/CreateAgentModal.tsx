import { useState } from 'react';
import { X, Loader2, UserPlus } from 'lucide-react';

type CreateAgentPayload = {
  agentId: string;
  name?: string;
  workspace?: string;
  model?: string;
  bindings?: string[];
  setDefault?: boolean;
};

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: CreateAgentPayload) => Promise<void>;
}

export function CreateAgentModal({ isOpen, onClose, onCreate }: CreateAgentModalProps) {
  const [agentId, setAgentId] = useState('');
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [model, setModel] = useState('');
  const [bindingsText, setBindingsText] = useState('');
  const [setDefault, setSetDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedId = agentId.trim();
    if (!trimmedId) {
      setError('Agent ID 不能为空。');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
      setError('Agent ID 仅支持字母、数字、下划线和短横线。');
      return;
    }

    const bindings = bindingsText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    setIsSubmitting(true);
    try {
      await onCreate({
        agentId: trimmedId,
        name: name.trim() || undefined,
        workspace: workspace.trim() || undefined,
        model: model.trim() || undefined,
        bindings: bindings.length ? bindings : undefined,
        setDefault,
      });
      setAgentId('');
      setName('');
      setWorkspace('');
      setModel('');
      setBindingsText('');
      setSetDefault(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-neutral-100 font-semibold">
            <UserPlus className="w-4 h-4 text-indigo-400" />
            新增 Agent（OpenClaw 原生）
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            disabled={isSubmitting}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-neutral-300 mb-1.5">Agent ID *</label>
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="例如: planner-zhao"
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          <div>
            <label className="block text-sm text-neutral-300 mb-1.5">显示名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 规划助手-赵"
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          <div>
            <label className="block text-sm text-neutral-300 mb-1.5">Workspace 路径（可选）</label>
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="留空则自动生成 ~/.openclaw/workspace-{agentId}"
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          <div>
            <label className="block text-sm text-neutral-300 mb-1.5">Model（可选）</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="例如: sglang/Qwen3.5-27B-FP8"
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          <div>
            <label className="block text-sm text-neutral-300 mb-1.5">绑定频道（可选，逗号分隔）</label>
            <input
              value={bindingsText}
              onChange={(e) => setBindingsText(e.target.value)}
              placeholder="例如: feishu:default,telegram"
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={setDefault}
              onChange={(e) => setSetDefault(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-950"
            />
            设为默认 Agent
          </label>

          {error ? <div className="text-sm text-rose-400">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-70 text-white inline-flex items-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isSubmitting ? '创建中...' : '创建 Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

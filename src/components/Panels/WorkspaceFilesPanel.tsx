import { useState, useEffect, type ReactNode } from 'react';
import { X, Search, FileText, Save, Edit2, Trash, FolderClosed, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { WorkspaceEntry } from '../../lib/types';

interface WorkspaceFilesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

type TreeEntry = WorkspaceEntry & {
  children?: TreeEntry[];
  expanded?: boolean;
  loaded?: boolean;
};

export function WorkspaceFilesPanel({ isOpen, onClose, workspaceId }: WorkspaceFilesPanelProps) {
  const [files, setFiles] = useState<TreeEntry[]>([]);
  const [search, setSearch] = useState('');
  
  const [activeEntry, setActiveEntry] = useState<TreeEntry | null>(null);
  const [fileContent, setFileContent] = useState('');
  
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState('');

  const fetchDir = async (dirPath: string): Promise<TreeEntry[]> => {
    const query = new URLSearchParams({ scopedId: workspaceId, dir: dirPath });
    const res = await fetch(`/api/workspace/files?${query.toString()}`);
    const data = await res.json();
    if (!Array.isArray(data.files)) return [];

    return data.files
      .map((entry: any) => {
        if (typeof entry === 'string') {
          return { name: entry, isDirectory: false, path: entry };
        }
        return {
          name: String(entry?.name || ''),
          isDirectory: !!entry?.isDirectory,
          path: String(entry?.path || entry?.name || ''),
        };
      })
      .filter((entry: WorkspaceEntry) => !!entry.name && !!entry.path)
      .map((entry: WorkspaceEntry) => ({
        ...entry,
        children: entry.isDirectory ? [] : undefined,
        expanded: false,
        loaded: !entry.isDirectory,
      }));
  };

  const fetchFiles = async () => {
    try {
      const rootEntries = await fetchDir('');
      setFiles(rootEntries);
    } catch (e) {
      console.error(e);
    }
  };

  const updateTree = (nodes: TreeEntry[], targetPath: string, updater: (node: TreeEntry) => TreeEntry): TreeEntry[] => {
    return nodes.map((node) => {
      if (node.path === targetPath) {
        return updater(node);
      }

      if (node.children?.length) {
        return {
          ...node,
          children: updateTree(node.children, targetPath, updater),
        };
      }

      return node;
    });
  };

  useEffect(() => {
    if (isOpen) {
      fetchFiles();
    }
  }, [isOpen, workspaceId]);

  const handleOpenEntry = async (entry: TreeEntry) => {
    if (entry.isDirectory) {
      try {
        if (!entry.loaded) {
          const children = await fetchDir(entry.path);
          setFiles((prev) =>
            updateTree(prev, entry.path, (node) => ({
              ...node,
              children,
              loaded: true,
              expanded: true,
            }))
          );
          setActiveEntry({ ...entry, children, loaded: true, expanded: true });
        } else {
          setFiles((prev) =>
            updateTree(prev, entry.path, (node) => ({
              ...node,
              expanded: !node.expanded,
            }))
          );
          setActiveEntry({ ...entry, expanded: !entry.expanded });
        }
      } catch (e) {
        console.error(e);
      }
      setFileContent('');
      setIsEditingContent(false);
      return;
    }

    try {
      const res = await fetch(`/api/workspace/files?scopedId=${workspaceId}&filename=${encodeURIComponent(entry.path)}`);
      const data = await res.json();
      setActiveEntry({ ...entry });
      setFileContent(data.content || '');
      setIsEditingContent(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveFile = async () => {
    if (!activeEntry || activeEntry.isDirectory) return;
    try {
      await fetch(`/api/workspace/files?scopedId=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: activeEntry.path, content: fileContent })
      });
      setIsEditingContent(false);
      fetchFiles();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRename = async () => {
    if (!activeEntry || !renameInput || activeEntry.name === renameInput) {
      setIsRenaming(false);
      return;
    }
    try {
      await fetch(`/api/workspace/files?scopedId=${workspaceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldFilename: activeEntry.path,
          newFilename: (() => {
            const lastSlash = activeEntry.path.lastIndexOf('/');
            if (lastSlash < 0) return renameInput;
            return `${activeEntry.path.slice(0, lastSlash)}/${renameInput}`;
          })(),
        })
      });
      const lastSlash = activeEntry.path.lastIndexOf('/');
      const nextPath = lastSlash < 0 ? renameInput : `${activeEntry.path.slice(0, lastSlash)}/${renameInput}`;
      setActiveEntry({ ...activeEntry, name: renameInput, path: nextPath });
      setIsRenaming(false);
      fetchFiles();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (entry: TreeEntry) => {
    const entryLabel = entry.isDirectory ? '文件夹' : '文件';
    if (confirm(`确定要删除${entryLabel} ${entry.name} 吗？`)) {
      try {
        await fetch(`/api/workspace/files?scopedId=${workspaceId}&filename=${encodeURIComponent(entry.path)}`, {
          method: 'DELETE'
        });
        if (activeEntry?.path === entry.path) {
          setActiveEntry(null);
          setFileContent('');
        }
        fetchFiles();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const renderTree = (nodes: TreeEntry[], depth = 0): ReactNode[] => {
    const result: ReactNode[] = [];

    for (const entry of nodes) {
      if (search && !entry.name.toLowerCase().includes(search.toLowerCase())) {
        if (!entry.isDirectory || !entry.children?.length) continue;
      }

      result.push(
        <div
          key={entry.path}
          className={cn(
            'group flex items-center justify-between px-2 py-2 rounded-md text-sm transition-colors cursor-pointer',
            activeEntry?.path === entry.path ? 'bg-indigo-600/20 text-indigo-300' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          )}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <span className="truncate flex-1 flex items-center gap-2" onClick={() => handleOpenEntry(entry)}>
            {entry.isDirectory ? (
              <ChevronRight className={cn('w-3.5 h-3.5 text-neutral-500 transition-transform', entry.expanded && 'rotate-90')} />
            ) : (
              <span className="w-3.5 h-3.5" />
            )}
            {entry.isDirectory ? <FolderClosed className="w-3.5 h-3.5 text-amber-400" /> : <FileText className="w-3.5 h-3.5 text-neutral-500" />}
            {entry.name}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(entry);
            }}
            className="opacity-0 group-hover:opacity-100 text-red-400/70 hover:text-red-400 transition-opacity p-1"
            title="删除"
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        </div>
      );

      if (entry.isDirectory && entry.expanded && entry.children?.length) {
        result.push(...renderTree(entry.children, depth + 1));
      }
    }

    return result;
  };

  const renderedEntries = renderTree(files);

  return (
    <div className={cn(
      "absolute inset-y-0 right-0 w-[500px] bg-neutral-900 border-l border-neutral-800 shadow-2xl flex flex-col transition-transform duration-300 z-50",
      isOpen ? "translate-x-0" : "translate-x-full"
    )}>
      <div className="h-16 px-5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/80 backdrop-blur shrink-0">
        <h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-400" />
          工作区空间
        </h2>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: File List */}
        <div className="w-48 border-r border-neutral-800 flex flex-col bg-neutral-950 shrink-0">
          <div className="p-3 border-b border-neutral-800">
            <div className="relative">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="搜索文件..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-indigo-500/50 transition-colors"
               />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {renderedEntries.length === 0 ? (
              <div className="text-xs text-neutral-500 text-center py-4">无匹配文件</div>
            ) : (
              renderedEntries
            )}
          </div>
        </div>

        {/* Right Side: File Content */}
        <div className="flex-1 flex flex-col bg-[#1e1e1e]">
          {activeEntry ? (
            <>
              <div className="h-12 border-b border-neutral-800 flex items-center justify-between px-4 bg-neutral-900 shrink-0">
                <div className="flex items-center gap-2 overflow-hidden flex-1 pr-2">
                  {isRenaming ? (
                    <input 
                      autoFocus
                      type="text" 
                      value={renameInput}
                      onChange={e => setRenameInput(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={e => e.key === 'Enter' && handleRename()}
                      className="bg-neutral-950 border border-indigo-500 rounded px-2 py-0.5 text-sm text-indigo-300 w-full focus:outline-none"
                    />
                  ) : (
                    <>
                      <span className="text-sm font-mono text-emerald-400 truncate" title={activeEntry.name}>{activeEntry.name}</span>
                      <button onClick={() => { setIsRenaming(true); setRenameInput(activeEntry.name); }} className="text-neutral-500 hover:text-indigo-400" title="重命名">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
                {!isRenaming && !activeEntry.isDirectory && (
                   <div className="flex items-center gap-1 shrink-0">
                     <button 
                       onClick={() => setIsEditingContent(!isEditingContent)}
                       className="p-1.5 rounded text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors"
                       title={isEditingContent ? "取消编辑" : "编辑内容"}
                     >
                       <Edit2 className="w-4 h-4" />
                     </button>
                     {isEditingContent && (
                       <button 
                         onClick={handleSaveFile}
                         className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                         title="保存"
                       >
                         <Save className="w-4 h-4" />
                       </button>
                     )}
                   </div>
                )}
              </div>
              <div className="flex-1 overflow-hidden flex">
                {activeEntry.isDirectory ? (
                  <div className="p-4 text-sm text-neutral-500">这是文件夹，当前仅支持文件内容查看与编辑。</div>
                ) : isEditingContent ? (
                  <textarea 
                    value={fileContent}
                    onChange={e => setFileContent(e.target.value)}
                    className="w-full h-full bg-transparent text-sm text-neutral-300 font-mono p-4 resize-none focus:outline-none leading-relaxed"
                  />
                ) : (
                  <pre className="p-4 text-sm font-mono text-neutral-300 leading-relaxed overflow-auto whitespace-pre-wrap word-wrap break-words">
                    {fileContent || <span className="text-neutral-600 italic">Empty file.</span>}
                  </pre>
                )}
              </div>
            </>
          ) : (
             <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
               点击左侧文件查看或编辑
             </div>
          )}
        </div>
      </div>
    </div>
  );
}

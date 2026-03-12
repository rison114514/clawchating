import { useState, useEffect } from 'react';
import { X, Search, FileText, Save, Edit2, Copy, Trash, ChevronRight, CornerDownRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface WorkspaceFilesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

export function WorkspaceFilesPanel({ isOpen, onClose, workspaceId }: WorkspaceFilesPanelProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState('');

  const fetchFiles = async () => {
    try {
      const res = await fetch(`/api/workspace/files?scopedId=${workspaceId}`);
      const data = await res.json();
      if (data.files) setFiles(data.files);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFiles();
    }
  }, [isOpen, workspaceId]);

  const handleOpenFile = async (filename: string) => {
    try {
      const res = await fetch(`/api/workspace/files?scopedId=${workspaceId}&filename=${filename}`);
      const data = await res.json();
      setActiveFile(filename);
      setFileContent(data.content || '');
      setIsEditingContent(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveFile = async () => {
    if (!activeFile) return;
    try {
      await fetch(`/api/workspace/files?scopedId=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: activeFile, content: fileContent })
      });
      setIsEditingContent(false);
      fetchFiles();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRename = async () => {
    if (!activeFile || !renameInput || activeFile === renameInput) {
      setIsRenaming(false);
      return;
    }
    try {
      await fetch(`/api/workspace/files?scopedId=${workspaceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldFilename: activeFile, newFilename: renameInput })
      });
      setActiveFile(renameInput);
      setIsRenaming(false);
      fetchFiles();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (filename: string) => {
    if (confirm(`确定要删除文件 ${filename} 吗？`)) {
      try {
        await fetch(`/api/workspace/files?scopedId=${workspaceId}&filename=${filename}`, {
          method: 'DELETE'
        });
        if (activeFile === filename) {
          setActiveFile(null);
          setFileContent('');
        }
        fetchFiles();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const filteredFiles = files.filter(f => f.toLowerCase().includes(search.toLowerCase()));

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
            {filteredFiles.length === 0 ? (
              <div className="text-xs text-neutral-500 text-center py-4">无匹配文件</div>
            ) : (
              filteredFiles.map(file => (
                <div key={file} className={cn(
                  "group flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors cursor-pointer",
                  activeFile === file ? "bg-indigo-600/20 text-indigo-300" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                )}>
                  <span className="truncate flex-1" onClick={() => handleOpenFile(file)}>{file}</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                    className="opacity-0 group-hover:opacity-100 text-red-400/70 hover:text-red-400 transition-opacity p-1"
                    title="删除"
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: File Content */}
        <div className="flex-1 flex flex-col bg-[#1e1e1e]">
          {activeFile ? (
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
                      <span className="text-sm font-mono text-emerald-400 truncate" title={activeFile}>{activeFile}</span>
                      <button onClick={() => { setIsRenaming(true); setRenameInput(activeFile); }} className="text-neutral-500 hover:text-indigo-400" title="重命名">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
                {!isRenaming && (
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
                {isEditingContent ? (
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

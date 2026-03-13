const fs = require('fs');

const path = 'src/components/Panels/RightSidebar.tsx';
let code = fs.readFileSync(path, 'utf8');

const mapLogic = `          {currentGroup.members.map(memberId => {
            const ag = agents.find(a => a.id === memberId);
            if (!ag) return null;
            const Icon = ag.icon;
            const isLeader = currentGroup.leaderId ? currentGroup.leaderId === memberId : currentGroup.members[0] === memberId;
            return (
              <div key={memberId} className="flex items-center gap-3 p-2 rounded-lg bg-neutral-800/50 border border-neutral-700/50 group relative">
                <div className={cn("p-1.5 rounded-md bg-neutral-900 shadow-sm flex-shrink-0", ag.color)}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0 pr-6">
                  <span className="text-sm text-neutral-200 truncate font-medium flex items-center gap-1">
                    {ag.name}
                    {isLeader && <Crown className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />}
                  </span>
                </div>
                {!isLeader && (
                  <button
                    onClick={() => onSetLeader(memberId)}
                    title="设为负责人"
                    className="absolute right-2 p-1.5 rounded-md text-neutral-500 hover:text-yellow-500 hover:bg-neutral-800 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Crown className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}`;

code = code.replace(/\{currentGroup\.members\.map.*?\{\n.*?return \([\s\S]*?\);\n\s*\}\)}/m, mapLogic);

fs.writeFileSync(path, code);

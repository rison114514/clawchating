const fs = require('fs');

const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

const regexFetchCrons = /const fetchCrons = async \(\) => \{[\s\S]*?useEffect\(\(\) => \{ fetchCrons\(\); \}, \[\]\);/;

const groupsInitCode = `
  // 获取并同步后端的群组列表
  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/groups');
      setGroups(await res.json());
    } catch (e) {
      console.error('Failed to fetch groups', e);
    }
  };

  useEffect(() => { fetchGroups(); }, []);\n`;

if(content.includes('fetchGroups')) {
  console.log('Already has fetchGroups');
} else {
  // insert before fetchCrons
  content = content.replace('const fetchCrons', groupsInitCode + '  const fetchCrons');
}

// Now replace handleCreateGroup logic
const oldHandleCreateGroup = `  const handleCreateGroup = () => {
    if (!newGroupName.trim() || newGroupMembers.length === 0) return;
    const newGroup = {
      id: \`group-\${Date.now()}\`,
      name: newGroupName,
      members: newGroupMembers,
      channelId: newGroupChannel
    };
    setGroups([...groups, newGroup]);
    setIsCreatingGroup(false);
    setNewGroupName('');
    setNewGroupMembers([]);
    setNewGroupChannel('group-project-alpha');
    setActiveSession({ type: 'group', id: newGroup.id });
  };`;

const newHandleCreateGroup = `  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || newGroupMembers.length === 0) return;
    const newGroupInfo = {
      name: newGroupName,
      members: newGroupMembers,
      channelId: newGroupChannel
    };
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGroupInfo)
      });
      if (res.ok) {
        const { group } = await res.json();
        setGroups([...groups, group]);
        setIsCreatingGroup(false);
        setNewGroupName('');
        setNewGroupMembers([]);
        setNewGroupChannel('group-project-alpha');
        setActiveSession({ type: 'group', id: group.id });
      }
    } catch (e) {
      console.error('Failed to create group', e);
    }
  };`;

if (content.includes('const handleCreateGroup = () => {')) {
  content = content.replace(oldHandleCreateGroup, newHandleCreateGroup);
  fs.writeFileSync(file, content);
  console.log('Successfully patched create group');
} else {
  console.log('Could not find handleCreateGroup strictly.');
}


const fs = require('fs');
const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /const handleCreateGroup = \(\) => \{[\s\S]*?setActiveSession\(\{ type: 'group', id: newGroup\.id \}\);\s*\};/;

const replacement = `const handleCreateGroup = async () => {
    if (!newGroupName.trim() || newGroupMembers.length === 0 || !newGroupChannel.trim()) return;
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

if (regex.test(content)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(file, content);
  console.log('Success');
} else {
  console.log('Failed');
}

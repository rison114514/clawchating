const fs = require('fs');

const file = 'src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// The main return statement looks like:
//   return (
//     <div className="flex h-screen bg-neutral-900 text-neutral-100 overflow-hidden font-sans">
//       
//       {/* 弹窗：Agent 能力配置 */}
//       {configAgentId && (
//         <div className="fixed ...

// Left Sidebar starts at: // {/* Left Sidebar */} or <div className="w-64 bg-neutral-950

// Let's find the start of the return block
const startConfigModal = content.indexOf('{/* 弹窗：Agent 能力配置 */}');
if (startConfigModal === -1) {
  console.log("Could not find startConfigModal");
  process.exit(1);
}

// Extract the contents of `{configAgentId && (` to its closing `)}`
// We will look for `{configAgentId && (` and match its closing parenthesis.

const configModalStartRegex = /{configAgentId && \([\s\S]*?<div className=\{cn\("bg-neutral-900 border border-neutral-700/;
const match = configModalStartRegex.exec(content);
if(!match) {
  console.log("Could not match configAgentId regex");
  process.exit(1);
}

const startIndex = content.indexOf('{configAgentId && (');
// find matching ')}' for `{configAgentId && (`
let braceCount = 0;
let parenCount = 0;
let endIndex = -1;
let started = false;

for (let i = startIndex; i < content.length; i++) {
  if (content[i] === '{') braceCount++;
  if (content[i] === '}') braceCount--;
  if (content[i] === '(') parenCount++;
  if (content[i] === ')') parenCount--;

  if (content.substring(i, i + 'configAgentId && ('.length) === 'configAgentId && (') {
    started = true;
  }

  if (started && braceCount === 0 && parenCount === 0 && content[i] !== ' ' && content[i] !== '\n') {
    // Check if we hit the closing `)}`
    if (content[i] === '}' && content[i-1] === ')') {
        endIndex = i + 1;
        break;
    }
  }
}

// manual extraction is safer:

const fs = require('fs');
const content = fs.readFileSync('src/components/CustomerProfile.tsx', 'utf-8');

const modalStartStr = '      {/* Full Screen Order Details Modal */}';
const modalIdx = content.indexOf(modalStartStr);

const endPattern = '\n    </div>\n  );\n}';
const lastDivIdx = content.lastIndexOf(endPattern);

if (modalIdx === -1 || lastDivIdx === -1) {
    console.log("Could not find modal or end of file");
    process.exit(1);
}

const modalContent = content.substring(modalIdx, lastDivIdx);
const newContent = content.substring(0, modalIdx) + content.substring(lastDivIdx);

const cpEndStr = '    </div>\n  );\n}\n\n/** Helpers for account management */';
const cpEndIdx = newContent.indexOf(cpEndStr);

if (cpEndIdx === -1) {
    console.log("Could not find end of CustomerProfile");
    process.exit(1);
}

const finalContent = newContent.substring(0, cpEndIdx) + modalContent + '\n' + newContent.substring(cpEndIdx);

fs.writeFileSync('src/components/CustomerProfile.tsx', finalContent, 'utf-8');
console.log("Modal moved successfully");

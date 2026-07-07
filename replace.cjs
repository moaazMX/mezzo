const fs = require('fs');

function processFile(file, isMobileMapEditor) {
  let content = fs.readFileSync(file, 'utf8');
  
  if (isMobileMapEditor) {
    // For MobileMapEditor.tsx the button is just text currently? Let's see later.
  } else {
    // CustomerProfile.tsx uses this specific pattern:
    const regex = /className="inline-flex [^>]+?>\s*\{\s*language === 'ar' \? <ChevronRight className="h-3\.5 w-3\.5" \/> : <ChevronLeft className="h-3\.5 w-3\.5" \/>\s*\}\s*\{\s*language === 'ar' \? 'رجوع' : 'Back'\s*\}\s*<\/button>/g;
    
    content = content.replace(regex, `className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>`);
  }
  
  fs.writeFileSync(file, content);
  console.log(file + ' updated');
}

processFile('src/components/CustomerProfile.tsx', false);

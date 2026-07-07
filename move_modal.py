import re

with open('src/components/CustomerProfile.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the start of the modal
modal_start_str = '      {/* Full Screen Order Details Modal */}'
modal_idx = content.find(modal_start_str)

# Find the end of the modal which is right before the end of the file
end_pattern = r'\n    </div>\n  \);\n}'
last_div_idx = content.rfind('\n    </div>\n  );\n}')

if modal_idx == -1 or last_div_idx == -1:
    print("Could not find modal or end of file")
    exit(1)

modal_content = content[modal_idx:last_div_idx]

# Remove the modal from its current place
new_content = content[:modal_idx] + content[last_div_idx:]

# Find the end of CustomerProfile to insert it there
# It's right before '/** Helpers for account management */'
customer_profile_end_str = '    </div>\n  );\n}\n\n/** Helpers for account management */'
cp_end_idx = new_content.find(customer_profile_end_str)

if cp_end_idx == -1:
    print("Could not find end of CustomerProfile")
    exit(1)

# Insert the modal before the '    </div>' of CustomerProfile
final_content = new_content[:cp_end_idx] + modal_content + new_content[cp_end_idx:]

with open('src/components/CustomerProfile.tsx', 'w', encoding='utf-8') as f:
    f.write(final_content)

print("Modal moved successfully")

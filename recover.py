import json
import os

transcript_path = r"C:\Users\moaaz\.gemini\antigravity-ide\brain\90abe02c-681f-4ec1-8e93-b26db8a4f15f\.system_generated\logs\transcript_full.jsonl"
target_file = r"d:\IMPORTANT\my projects\MX - Copy\src\components\CustomerProfile.tsx"

with open(target_file, 'r', encoding='utf-8') as f:
    content = f.read()

def apply_replacement(content, target, replacement):
    if target in content:
        return content.replace(target, replacement, 1) # Only first occurrence to mimic replace_file_content?
    else:
        print("COULD NOT FIND TARGET:")
        print(target[:100] + '...')
        return content

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            obj = json.loads(line.strip())
            if obj.get('type') == 'PLANNER_RESPONSE' and obj.get('tool_calls'):
                for tool in obj['tool_calls']:
                    if tool['name'] in ['replace_file_content', 'multi_replace_file_content']:
                        args = tool['args']
                        if 'CustomerProfile.tsx' in args.get('TargetFile', ''):
                            print(f"Applying step {obj['step_index']}")
                            if tool['name'] == 'replace_file_content':
                                content = apply_replacement(content, args['TargetContent'], args['ReplacementContent'])
                            elif tool['name'] == 'multi_replace_file_content':
                                for chunk in args.get('ReplacementChunks', []):
                                    content = apply_replacement(content, chunk['TargetContent'], chunk['ReplacementContent'])
        except Exception as e:
            pass

with open(target_file, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")

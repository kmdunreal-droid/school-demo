import sys

path = 'd:\\app\\school app demo\\src\\components\\AiPaperGenerator.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

# Current broken structure:
# Line 300: {files.length > 0 && (
# Line 301-308: files list div
# Line 309: (empty)
# Line 310-366: camera block (SHOULD BE OUTSIDE files condition)
# Line 367: </div>  (closes source content div - but we're still inside files block!)
# Line 368: )}       (stray - this is the problem)
# Line 369: </div>   (another stray)
# Line 370: (empty)
# 
# Correct structure should be:
# Line 300: {files.length > 0 && (
# Line 301-308: files list div
# Line 309: )        (close files block)
# Line 310: (empty)
# Line 311-367: camera block (as sibling, not child of files)
# Line 368: </div>   (closes source content div)
# ...
# 
# So we need to:
# 1. Add ) after line 308 (close files block)
# 2. Remove line 368 (stray )})
# 3. Keep line 369 as the closing </div> for source content div

files_start = 299  # 0-indexed line 300 in file
camera_comment_idx = 309  # line 310
camera_block_end_idx = 365  # line 366 - closes camera block with )}
stray_idx = 367  # line 368 - )} that should be removed
after_stray_idx = 368  # line 369 - </div> that should close source content

print(f"Line indices (0-based):")
print(f"  files_start: {files_start}")
print(f"  camera_comment_idx: {camera_comment_idx}")
print(f"  camera_block_end_idx: {camera_block_end_idx}")
print(f"  stray_idx: {stray_idx}")
print(f"  after_stray_idx: {after_stray_idx}")

# Build new content
before_files = lines[:files_start]  # lines 0-299

# Files block: from files_start to just before camera comment
files_block = lines[files_start:camera_comment_idx]  
# files_block currently is lines 300-309 (includes empty line 309)
# We need: files block content + closing )
files_block_content = files_block[:-1]  # lines 300-308 (without empty line 309)
files_block_with_close = files_block_content + ['            )}\n']  # add closing

# Camera block: from camera comment to end of camera block (line 366)
camera_block = lines[camera_comment_idx:camera_block_end_idx+1]  # lines 310-366

# After camera: line 367 (</div>), line 368 (stray )}), line 369 (</div>), then rest
# We want to keep line 367 as the closing </div>, skip line 368, keep line 369+ as is
after_camera = lines[after_stray_idx:]  # lines 369+

new_content = '\n'.join(before_files + files_block_with_close + ['\n'] + camera_block + after_camera)

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print('\nFixed! Structure now:')
print('  - Files block properly closed after line 308')
print('  - Camera block is sibling of files block (not nested)')
print('  - Removed stray )})')


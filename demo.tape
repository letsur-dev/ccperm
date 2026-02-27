Output demo.gif

Set Theme "Catppuccin Mocha"
Set Width 900
Set Height 600
Set FontSize 14
Set Padding 20

# Launch TUI — scan summary visible before TUI takes over
Type "ccperm"
Sleep 500ms
Enter
Sleep 3s

# Let the user see the list (G column visible)
Sleep 1.5s

# Scroll down to see projects
Down
Sleep 150ms
Down
Sleep 150ms
Down
Sleep 150ms

# Enter detail view
Enter
Sleep 1s

# Expand Bash group
Enter
Sleep 1s

# Scroll through permissions — show (in global) tags
Down
Sleep 150ms
Down
Sleep 150ms
Down
Sleep 150ms
Down
Sleep 150ms
Down
Sleep 150ms
Down
Sleep 150ms

# Toggle info mode — show severity + domain tags
Type "i"
Sleep 2s

# Back to list
Escape
Sleep 1s

# Search view — press / and type
Type "/"
Sleep 500ms
Type "curl"
Sleep 1.5s

# Navigate search results
Down
Sleep 300ms
Down
Sleep 300ms
Down
Sleep 300ms

# Exit search
Escape
Sleep 1s

# Quit
Type "q"
Sleep 500ms

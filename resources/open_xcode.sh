#!/bin/bash

jPath="$1"

exec osascript - "$jPath" <<EOF
on run argv
    set jPath to item 1 of argv
    tell app "Xcode"
    set wsDoc to (open jPath)
    set waitCount to 0
    repeat until wsDoc's loaded or waitCount ≥ 60
        set waitCount to waitCount + 1
        delay 1
    end repeat
    end tell
end run
EOF

#!/bin/bash

# download latest swift toolchain and then update TOOLCHAINS env variable before building it
# https://www.swift.org/download/#snapshots

#export TOOLCHAINS=swift

export TOOLCHAINS=org.swift.510202402021a

swift package update
swift build --configuration release # RELEASE BUILD
#swift build # DEBUG build


PATH=$(swift build --show-bin-path --configuration release)

echo "$PATH/sourcekit-lsp"
#!/usr/bin/env python3
import helper

# update git exclude so that generated .logs and buildServer.json is not visible for git
helper.update_git_exclude("buildServer.json")
helper.update_git_exclude(".logs")
helper.update_git_exclude(".vscode/xcode")

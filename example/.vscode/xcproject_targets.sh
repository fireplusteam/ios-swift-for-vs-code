#!/bin/sh
source '.vscode/.env'

#gem install xcodeproj

ruby -r xcodeproj -e "\
workspace = Xcodeproj::Workspace.new_from_xcworkspace('/Users/Ievgenii_Mykhalevskyi/Desktop/source7/AdidasAppSuite.xcworkspace');
workspace.file_references.each do |file|
  if File.extname(file.path) == '.xcodeproj'
    project = Xcodeproj::Project.open(file.path)
    puts file.path
    project.targets.each do |target|
      puts target.name
    end
  end
end"
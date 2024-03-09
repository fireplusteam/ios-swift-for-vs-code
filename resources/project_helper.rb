require 'xcodeproj'
require 'pathname'

# https://www.rubydoc.info/github/CocoaPods/Xcodeproj/Xcodeproj/Project/Object/PBXProject#project_dir_path-instance_method

action = ARGV[0]
project_path = ARGV[1]
project = Xcodeproj::Project.open(ARGV[1])

def is_relative_path?(path)
  !File.absolute_path?(path)
end

def get_real_path(file, project)
  xc_project_dir_path = project.root_object.project_dir_path
  if file.path.nil?
    file.real_path.to_s
  elsif is_relative_path?(file.path)
    if xc_project_dir_path.empty?
      file.real_path.to_s
    else
      Pathname.new(File.join(xc_project_dir_path, file.path)).cleanpath.to_s
    end
  else
    file.path.to_s
  end
end

def find_group_by_absolute_file_path(project, path, exit_on_not_found = true)
  groups =
    project.groups.lazy.filter_map do |group|
      relative_path = path.sub(get_real_path(group, project) + "/", "")
      relative_dir = File.dirname(relative_path)

      return group if get_real_path(group, project) == File.dirname(path)

      group.find_subpath(relative_dir)
    end

  if groups.first.nil? && exit_on_not_found
    group_name = File.dirname(path)
    puts "WARN: xcodebuild: Could not find \"#{group_name}\" group in the project."
    exit
  end

  groups.first
end

def find_group_by_absolute_dir_path(project, path, exit_on_not_found = true)
  groups =
    project.groups.lazy.filter_map do |group|
      relative_dir = path.sub(get_real_path(group, project) + "/", "")

      return group if get_real_path(group, project) == path

      group.find_subpath(relative_dir)
    end

  if groups.first.nil? && exit_on_not_found
    group_name = File.basename(path)
    puts "WARN: xcodebuild: Could not find \"#{group_name}\" group in the project."
    exit
  end

  groups.first
end

def find_file(project, file_path, exit_on_not_found = true)
  file_ref =
    project.files.find { |file| get_real_path(file, project) == file_path }

  if file_ref.nil? && exit_on_not_found
    file_name = File.basename(file_path)
    puts "WARN: xcodebuild: Could not find \"#{file_name}\" in the project."
    exit
  end

  file_ref
end

def add_file_to_targets(project, targets, file_path)
  file_ref = find_file(project, file_path, false)

  if file_ref.nil?
    group = find_group_by_absolute_file_path(project, file_path)
    file_ref = group.new_reference(file_path)
  end

  targets
    .split(",")
    .each do |target|
      target = project.targets.find { |current| current.name == target }
      target.add_file_references([file_ref])
    end

  project.save
end

def update_file_targets(project, targets, file_path)
  find_file(project, file_path).remove_from_project
  add_file_to_targets(project, targets, file_path)
end

def delete_file(project, file_path)
  find_file(project, file_path).remove_from_project
  project.save
end

def rename_file(project, old_file_path, new_file_path)
  find_file(project, old_file_path).set_path(new_file_path)
  project.save
end

def move_file(project, old_path, new_path)
  targets = get_targets_for_file(project, old_path)
  delete_file(project, old_path)
  add_file_to_targets(project, targets.join(","), new_path)
end

def add_group(project, group_path)
  splitted_path = group_path.split("/")

  for i in 1..(splitted_path.length - 2)
    current_path = splitted_path[0..i].join("/")
    new_group_path = current_path + "/" + splitted_path[i + 1]
    parent_group = find_group_by_absolute_dir_path(project, current_path, false)
    current_group =
      find_group_by_absolute_dir_path(project, new_group_path, false)

    if current_group.nil?
      unless parent_group.nil?
        parent_group.new_group(splitted_path[i + 1], new_group_path)
      end
    end
  end

  project.save
end

def rename_group(project, old_group_path, new_group_path)
  group = find_group_by_absolute_dir_path(project, old_group_path)
  group.name = File.basename(new_group_path)
  group.set_path(new_group_path)
  project.save
end

def move_group(project, old_path, new_path)
  new_parent_path = File.dirname(new_path)
  new_parent_group = find_group_by_absolute_dir_path(project, new_parent_path)
  old_group = find_group_by_absolute_dir_path(project, old_path)
  old_group.move(new_parent_group)

  project.save
end

def delete_group(project, group_path)
  group = find_group_by_absolute_dir_path(project, group_path)
  group.recursive_children_groups.reverse.each(&:clear)
  group.clear
  group.remove_from_project
  project.save
end

def list_targets(project)
  project.targets.each do |target| 
    puts target.name 
  end
end

def list_files(project)
  project.files.each do |file|
    puts get_real_path(file, project)
    #puts file.path.to_s
  end
end

def list_files_for_target(project, target_name)
  project.targets.each do |target|
    if target_name == target.name
      target.source_build_phase.files_references.each do |file|
        puts get_real_path(file, project)
      end
    end
  end
end

def list_targets_for_file(project, file_path)
  project.targets.each do |target|
    target.source_build_phase.files_references.each do |file|
      puts target.name if get_real_path(file, project) == file_path
    end
  end
end

def get_targets_for_file(project, file_path)
  result = []

  project.targets.each do |target|
    target.source_build_phase.files_references.each do |file|
      result << target.name if get_real_path(file, project) == file_path
    end
  end

  result
end

def handle_action(project, action)
  if action == "list_files"
    list_files(project)
    exit
  end

  if action == "list_files_for_target"
    list_files_for_target(project, ARGV[2])
    exit
  end

  if action == "add_file"
    add_file_to_targets(project, ARGV[2], ARGV[3])
    exit
  end

  if action == "delete_file"
    delete_file(project, ARGV[2])
    exit
  end

  if action == "rename_file"
    rename_file(project, ARGV[2], ARGV[3])
    exit
  end

  if action == "move_file"
    move_file(project, ARGV[2], ARGV[3])
    exit
  end

  if action == "add_group"
    add_group(project, ARGV[2])
    exit
  end

  if action == "delete_group"
    delete_group(project, ARGV[2])
    exit
  end

  if action == "rename_group"
    rename_group(project, ARGV[2], ARGV[3])
    exit
  end

  if action == "move_group"
    move_group(project, ARGV[2], ARGV[3])
    exit
  end

  if action == "update_file_targets"
    update_file_targets(project, ARGV[2], ARGV[3])
  end

  if action == "list_targets"
    list_targets(project)
    exit
  end

  if action == "list_targets_for_file"
    list_targets_for_file(project, ARGV[2])
    exit
  end
end

handle_action(project, action)

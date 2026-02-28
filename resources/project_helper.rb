# encoding: utf-8
Encoding.default_external = Encoding::UTF_8
Encoding.default_internal = Encoding::UTF_8

require "xcodeproj"
require_relative "project_scheme_helper"
require_relative "project_file_helper"
require_relative "package_helper"

require "stackprof" if ENV["DEBUG_XCODE_PROJECT_HELPER"] == "1"

# https://www.rubydoc.info/github/CocoaPods/Xcodeproj/Xcodeproj/Project/Object/PBXProject#project_dir_path-instance_method

# FILE AND GROUP MANAGEMENT

def find_file(project, file_path)
  file_path = clean_path(file_path)
  file_ref =
    project.files.find { |file| get_real_path(file, project) == file_path }

  file_ref
end

def add_file_to_targets(project, targets, file_path)
  group = first_folder_by_absolute_dir_path(project, File.dirname(file_path))
  if group # file is part of folder, no need to add it separately
    puts "file_is_part_of_folder"
    return
  end

  file_ref = find_file(project, file_path)

  if file_ref.nil?
    group = find_group_by_absolute_dir_path(project, File.dirname(file_path))
    group = project.main_group.new_group(File.dirname(file_path)) if group.nil?

    file_ref = group.new_reference(file_path)
  end

  return if targets.nil? || targets.empty?
  targets
    .split(",")
    .each do |target|
      target = project.targets.find { |current| current.name == target }
      target.add_file_references([file_ref])
    end
end

def update_file_targets(project, targets, file_path)
  group = first_folder_by_absolute_dir_path(project, file_path)
  if group # todo: file is part of folder, so targets are managed by folder (managing exception is not supported yet)
    puts "file_is_part_of_folder"
    return
  end

  file_ref = find_file(project, file_path)
  file_ref.remove_from_project if not file_ref.nil?
  Traverse.clean_cache(file_ref)

  add_file_to_targets(project, targets, file_path)
end

def update_folder_targets(project, targets, folder_path)
  group = first_folder_by_absolute_dir_path(project, folder_path)
  if group.nil? || is_folder(group) == false
    puts "folder_not_found"
    return
  end

  project.targets.each do |target|
    if target.respond_to?(:file_system_synchronized_groups) &&
         target.file_system_synchronized_groups
      if targets.split(",").include?(target.name)
        unless is_group_in_synchronized_group?(
                 target.file_system_synchronized_groups,
                 group
               )
          target.file_system_synchronized_groups << group
        end
      else
        if is_group_in_synchronized_group?(
             target.file_system_synchronized_groups,
             group
           )
          target.file_system_synchronized_groups.delete(group)
        end
      end
    end
  end
end

def delete_file(project, file_path)
  group = first_folder_by_absolute_dir_path(project, file_path)
  return if not group.nil?
  file_ref = find_file(project, file_path)
  file_ref.remove_from_project if not file_ref.nil?

  Traverse.clean_cache(file_ref)
end

def rename_file(project, old_file_path, new_file_path)
  group = first_folder_by_absolute_dir_path(project, old_file_path)
  return if not group.nil?
  file_ref = find_file(project, old_file_path)
  file_ref.set_path(new_file_path) if not file_ref.nil?

  Traverse.clean_cache(file_ref)
end

def move_file(project, old_path, new_path)
  old_group = find_group_by_absolute_dir_path(project, File.dirname(old_path))
  new_group = find_group_by_absolute_dir_path(project, File.dirname(new_path))
  return if old_group.equal?(new_group)

  if (not new_group.nil?) && !is_folder(new_group)
    targets = get_targets_for_file(project, old_path)
    delete_file(project, old_path)
    add_file_to_targets(project, targets.join(","), new_path)
  else # new parent is folder so the old file can be deleted as it would be part of folder
    delete_file(project, old_path)
  end
end

# GROUP MANAGEMENT

def add_group(project, group_path)
  root_group = furthest_group_by_absolute_dir_path(project, group_path)
  return if root_group && is_folder(root_group)

  if root_group
    root_group_path = get_real_path(root_group, project) if root_group
    start_index = root_group_path.split("/").length

    splitted_path = group_path.split("/")
    parent_group = root_group
    current_path = root_group_path
    for i in start_index..(splitted_path.length - 1)
      current_path = File.join(current_path, splitted_path[i])
      parent_group = parent_group.new_group(splitted_path[i], current_path)
    end
  else
    # didn't find any parent group, so add to main group
    main_group_path = get_real_path(project.main_group, project)
    # then relative path from main group to new group
    relative_path =
      Pathname.new(group_path).relative_path_from(Pathname.new(main_group_path))
    project.main_group.new_group(relative_path.to_s, group_path)
  end
end

def rename_group(project, old_group_path, new_group_path)
  group = find_group_by_absolute_dir_path(project, old_group_path)

  if not group.nil?
    Traverse.clean_cache(group)
    if is_folder(group)
      group.path = File.basename(new_group_path)
      return
    else
      group.name = File.basename(new_group_path)
      group.path = new_group_path
    end
  end
end

def move_group(project, old_path, new_path)
  new_parent_path = File.dirname(new_path)
  new_parent_group = find_group_by_absolute_dir_path(project, new_parent_path)
  if (not new_parent_group.nil?) && is_folder(new_parent_group) == false
    old_group = find_group_by_absolute_dir_path(project, old_path)
    Traverse.clean_cache(old_group)

    if old_group.nil? # it's a folder if it's not found as a group
      # create an instance of  PBXFileSystemSynchronizedRootGroup and inherit all properties of parent folder
      new_folder =
        Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup.new(
          project,
          project.generate_uuid
        )
      new_folder.source_tree = "<group>"
      new_folder.path = File.basename(new_path)

      # update targets to include the new folder as it's for a parent folder
      old_parent = first_folder_by_absolute_dir_path(project, old_path)
      project.targets.each do |target|
        if target.respond_to?(:file_system_synchronized_groups) &&
             target.file_system_synchronized_groups &&
             is_group_in_synchronized_group?(
               target.file_system_synchronized_groups,
               old_parent
             )
          target.file_system_synchronized_groups << new_folder
        end
      end
      # update structure of folders
      new_parent_group.children << new_folder
    elsif is_folder(old_group) # old_group is a folder group
      old_parent = parent_group_of_group(project, old_group)
      return if old_parent.equal?(new_parent_group)
      old_parent.children.delete(old_group)
      new_parent_group.children << old_group
    else # old_group is a group
      old_group.move(new_parent_group)
    end
  else # new parent is folder so the old group can be deleted as it would be part of folder
    delete_group(project, old_path) if old_path != new_path
  end
end

def delete_group(project, group_path)
  group = find_group_by_absolute_dir_path(project, group_path)

  if not group.nil?
    Traverse.clean_cache(group)
    if is_folder(group)
      # remove group from project
      group.exceptions.each { |exception| exception.remove_from_project }
      group.remove_from_project
    else
      group.recursive_children_groups.reverse.each(&:clear)
      group.clear
      group.remove_from_project
    end
  end
end

# TARGET MANAGEMENT

def list_targets(project)
  project.targets.each { |target| puts target.name }
end

def list_test_targets(project)
  project.targets.each do |target|
    if target.respond_to?(:test_target_type?) && target.test_target_type?
      puts target.name
    end
  end
end

def list_files(project)
  def print_all_group_paths(project)
    Traverse.traverse_all_group(
      project,
      true
    ) do |group, parent_group, group_path, _type|
      if _type == GroupType::SYNCHRONIZED_GROUP
        puts "folder:#{group_path}"
        all_files_in_folder(project, group, group_path).each do |file_in_folder|
          puts "file:#{file_in_folder}"
        end
      elsif _type == GroupType::FOLDER_REFERENCE
        puts "folder:#{group_path}"
        all_files_in_folder(project, group, group_path).each do |file_in_folder|
          puts "file:#{file_in_folder}"
        end
      elsif _type == GroupType::FILE_REFERENCE
        puts "file:#{group_path}"
      else
        puts "group:#{group_path}"
      end
    end
  end
  print_all_group_paths(project)
  # this's too slow
  # project.files.each do |file|
  #   puts "file:#{get_real_path(file, project)}" if !is_folder_reference(file)
  # end
end

def list_files_for_target(project, target_name)
  project.targets.each do |target|
    if target_name == target.name
      if target.respond_to?(:source_build_phase) && target.source_build_phase
        target.source_build_phase.files_references.each do |file|
          puts get_real_path(file, project) if !is_folder_reference(file)
        end
      end
      if target.respond_to?(:file_system_synchronized_groups) &&
           target.file_system_synchronized_groups
        target.file_system_synchronized_groups.each do |folder|
          all_files_in_folder(project, folder, nil).each do |file_in_folder|
            puts file_in_folder
          end
        end
      end
    end
  end
end

def get_targets_for_file(project, file_path)
  file_path = clean_path(file_path)
  group = first_folder_by_absolute_dir_path(project, file_path)
  result = []
  if not group.nil?
    project.targets.each do |target|
      if target.respond_to?(:file_system_synchronized_groups) &&
           target.file_system_synchronized_groups &&
           is_group_in_synchronized_group?(
             target.file_system_synchronized_groups,
             group
           )
        result << target.name
      end
    end
  end
  project.targets.each do |target|
    if target.respond_to?(:source_build_phase) && target.source_build_phase
      target.source_build_phase.files_references.each do |file|
        result << target.name if get_real_path(file, project) == file_path
      end
    end
  end
  result.uniq
end

def list_targets_for_file(project, file_path)
  get_targets_for_file(project, file_path).each do |target_name|
    puts target_name
  end
end

def type_of_path(project, path)
  group = first_folder_by_absolute_dir_path(project, path)
  if group
    puts "folder:#{get_path_of_group(project, group)}"
  else
    group = find_group_by_absolute_dir_path(project, path)
    if group
      puts "group:#{get_path_of_group(project, group)}"
    else
      puts "file:#{path}"
    end
  end
end

def list_dependencies_for_target(project, target_name)
  project.targets.each do |target|
    if target.name == target_name
      # Local and Subprojects and Products dependencies
      target.dependencies.each do |dep|
        name = dep.name || dep.target&.name || dep.product_ref&.product_name
        puts name if name
      end
    end
  end
end

# SCHEME MANAGEMENT

def list_all_buildable_targets_ids_for_scheme(projects, scheme_name)
  scheme = load_scheme_if_exists(projects, scheme_name)
  all_targets = get_all_targets_from_scheme(scheme[:scheme])
  all_targets.each do |target|
    target_name = target[:name]
    target_uuid = target[:uuid]
    projects.each do |project|
      project.targets.each do |target|
        if target.name == target_name && target.uuid == target_uuid
          puts "#{project.path.cleanpath}::#{target_name}"
        end
      end
    end
  end
end

def generate_scheme_depend_on_target(
  projects,
  generated_scheme_name,
  original_scheme_name,
  include_targets
)
  include_targets_list =
    include_targets.nil? == false ? include_targets.split(",") : []
  # format of id = {project_path}::{target_name}
  include_targets_list = include_targets_list.map { |id| id.split("::") }

  # load a scheme which is selected by a user to take base config if exists like codeCoverage, etc, so it builds in configuration close to user building for running an app. It forces less rebuilds between autocomplete and user builds
  result_scheme_load = load_scheme_if_exists(projects, original_scheme_name)
  scheme = result_scheme_load[:scheme]
  project = result_scheme_load[:project]

  if project.nil?
    puts "scheme_does_not_exist"
    return
  end

  root_project_dir_path = project.path.dirname

  is_different_from_existing = false

  # use selected by a user scheme as a base, so a build is run with user target which is likely used to launch and debug an app. So we just add targets which needs to be updated along with a user one.

  # scheme.test_action.testables = [] if not scheme.test_action.nil?
  # scheme.test_action.post_actions = [] if not scheme.test_action.nil?
  # scheme.test_action.pre_actions = [] if not scheme.test_action.nil?

  # scheme.build_action.entries = [] if not scheme.build_action.nil?
  # scheme.build_action.post_actions = [] if not scheme.build_action.nil?
  # scheme.build_action.pre_actions = [] if not scheme.build_action.nil?

  # scheme.launch_action.post_actions = [] if not scheme.launch_action.nil?
  # scheme.launch_action.pre_actions = [] if not scheme.launch_action.nil?
  # scheme.launch_action.buildable_product_runnable =
  #   nil if not scheme.launch_action.nil?

  # scheme.profile_action.buildable_product_runnable =
  #   nil if not scheme.profile_action.nil?

  # remove all buildable references from build action
  # scheme.build_action.entries = [] if not scheme.build_action.nil?

  # add all targets from include_targets_list
  include_targets_list.each do |project_path, target_name|
    target_project = projects.find { |p| p.path.to_s == project_path }
    next if target_project.nil?
    target_project.targets.each do |target|
      if target.name == target_name
        if add_target_to_scheme(scheme, target, false, root_project_dir_path)
          is_different_from_existing = true
        end
      end
    end
  end

  if is_different_from_existing == false
    puts "scheme_unchanged"
    return
  end

  # save the scheme

  scheme_dir = get_scheme_dir(project)
  scheme_dir.mkpath unless scheme_dir.exist?
  scheme.save_as(scheme_dir, generated_scheme_name, false)
  remove_package_swift_from_scheme(
    get_user_scheme_path(scheme_dir, generated_scheme_name)
  )

  puts project.path
  puts generated_scheme_name
end

def generate_test_scheme_depend_on_target(
  project,
  generated_scheme_name,
  original_scheme_name,
  test_targets
)
  test_targets_list = test_targets.split(",")
  test_targets_list = [] if test_targets == "include_all_tests_targets"
  test_targets_list = test_targets_list.uniq
  root_project_dir_path = project.path.dirname

  # load a scheme which is selected by a user to take base config if exists like codeCoverage, etc, so it builds in configuration close to user building for running an app. It forces less rebuilds between autocomplete and user builds
  scheme = load_scheme_if_exists(project, original_scheme_name)[:scheme]

  is_different_from_existing = false

  if remove_all_test_targets_from_scheme(scheme, test_targets_list)
    is_different_from_existing = true
  end

  project.targets.each do |current|
    # puts "current target: #{current.name}, #{current.product_name}"
    if test_targets_list.empty? == true ||
         test_targets_list.include?(current.name)
      if add_target_to_scheme(scheme, current, true, root_project_dir_path)
        is_different_from_existing = true
      end
    end
  end

  if is_different_from_existing == false
    puts "scheme_unchanged"
    return
  end

  if scheme.test_action.xml_element.elements["TestPlans"]
    scheme.test_action.xml_element.delete_element("TestPlans")
  end

  scheme.test_action.testables =
    scheme.test_action.testables.filter do |testable|
      testable.buildable_references.any?
    end

  # save the scheme
  scheme_dir = get_scheme_dir(project)

  scheme_dir.mkpath unless scheme_dir.exist?
  scheme.save_as(scheme_dir, generated_scheme_name, false)
  remove_package_swift_from_scheme(
    get_user_scheme_path(scheme_dir, generated_scheme_name)
  )

  puts project.path
  puts generated_scheme_name
end

def save(project)
  project.save
end

# ACTION HANDLER

def handle_action(project, action, arg)
  # HANDLE SWIFTPACKAGE ACTIONS
  if project.is_a?(SwiftPackage)
    if action == "list_files"
      package_list_files(project)
      return
    end
    if action == "list_files_for_target"
      package_list_files_for_target(project, arg[1])
      return
    end
    if action == "list_targets_for_file"
      package_list_targets_for_file(project, arg[1])
      return
    end
    if action == "list_targets"
      list_targets(project)
      return
    end
    list_test_targets(project) if action == "list_test_targets"
    if action == "generate_test_scheme_depend_on_target"
      generate_test_scheme_depend_on_target(project, arg[1], arg[2], arg[3])
      return
    end
    if action == "list_dependencies_for_target"
      package_list_dependencies_for_target(project, arg[1])
      return
    end
    package_name(project) if action == "package_name"
    return
  end

  # HANDLE XCODEPROJ ACTIONS

  if action == "save"
    save(project)
    return
  end
  if action == "list_files"
    list_files(project)
    return
  end

  if action == "list_files_for_target"
    list_files_for_target(project, arg[1])
    return
  end

  if action == "add_file"
    add_file_to_targets(project, arg[1], arg[2])
    return
  end

  if action == "delete_file"
    delete_file(project, arg[1])
    return
  end

  if action == "rename_file"
    rename_file(project, arg[1], arg[2])
    return
  end

  if action == "move_file"
    move_file(project, arg[1], arg[2])
    return
  end

  if action == "add_group"
    add_group(project, arg[1])
    return
  end

  if action == "delete_group"
    delete_group(project, arg[1])
    return
  end

  if action == "rename_group"
    rename_group(project, arg[1], arg[2])
    return
  end

  if action == "move_group"
    move_group(project, arg[1], arg[2])
    return
  end

  if action == "update_file_targets"
    update_file_targets(project, arg[1], arg[2])
    return
  end

  if action == "update_folder_targets"
    update_folder_targets(project, arg[1], arg[2])
    return
  end

  if action == "list_targets"
    list_targets(project)
    return
  end

  if action == "list_test_targets"
    list_test_targets(project)
    return
  end

  if action == "list_targets_for_file"
    list_targets_for_file(project, arg[1])
    return
  end

  if action == "list_dependencies_for_target"
    list_dependencies_for_target(project, arg[1])
    return
  end

  if action == "type_of_path"
    type_of_path(project, arg[1])
    return
  end

  if action == "list_all_buildable_targets_ids_for_scheme"
    list_all_buildable_targets_ids_for_scheme(project, arg[1])
    return
  end

  if action == "generate_scheme_depend_on_target"
    generate_scheme_depend_on_target(project, arg[1], arg[2], arg[3])
    return
  end

  if action == "generate_test_scheme_depend_on_target"
    generate_test_scheme_depend_on_target(project, arg[1], arg[2], arg[3])
    return
  end
end

# MAIN LOOP

$all_projects = {}
def load_project(project_path)
  if project_path.end_with?("Package.swift")
    SwiftPackage.new(project_path)
  else
    Xcodeproj::Project.open(project_path)
  end
end

def get_project(path)
  # use global all_projects to cache opened projects
  unless $all_projects.key?(path)
    $all_projects[path] = {
      project: load_project(path),
      mtime: File.mtime(path)
    }
  end
  $all_projects[path]
end

def perform_action_on_project(project_path, action, arg)
  def get_latest_project(project_path)
    project = get_project(project_path)

    previous_mtime = project[:mtime]
    project = project[:project]

    new_mtime = File.mtime(project_path)
    if previous_mtime != new_mtime
      project = load_project(project_path)
      $all_projects[project_path] = { project: project, mtime: new_mtime }
    end
    project
  end

  if action == "generate_scheme_depend_on_target" ||
       action == "list_all_buildable_targets_ids_for_scheme"
    project_path = project_path.split(":::")
    projects = project_path.map { |path| get_latest_project(path) }
    handle_action(projects, action, arg)
  else
    project = get_latest_project(project_path)

    if ENV["DEBUG_XCODE_PROJECT_HELPER"] == "1"
      StackProf.run(mode: :cpu, out: "stackprof-output.dump") do
        start_time = Time.now
        handle_action(project, action, arg)
        end_time = Time.now
        puts "Time for action #{action}: #{end_time - start_time} seconds"
      end
      # dump to console
      # to see result in terminal use stackprof stackprof-output.dump
      StackProf.results("stackprof-output.dump")
    else
      handle_action(project, action, arg)
    end
  end

  if action == "save" && project.is_a?(Xcodeproj::Project)
    previous_mtime = File.mtime(project_path)
    $all_projects[project_path] = { project: project, mtime: previous_mtime }
  end
end

# DEBUG MODE
if ENV["DEBUG_XCODE_PROJECT_HELPER"] == "1"
  input = ARGV[0]

  arg = input.split("|^|^|")
  project_path = arg[0]
  action = arg[1]
  begin
    perform_action_on_project(project_path, action, arg[1..-1])
    puts "EOF_REQUEST"
  rescue => e
    puts "#{e.full_message}}"
    puts "ERROR_REQUEST_error"
  end

  exit 0
end

# READ-EVAL-PRINT LOOP
$stdout.sync = false
while (input = STDIN.gets.chomp)
  break if input == "exit"

  arg = input.split("|^|^|")
  project_path = arg[0]
  action = arg[1]
  begin
    perform_action_on_project(project_path, action, arg[1..-1])
    puts "EOF_REQUEST"
  rescue => e
    puts "#{e.full_message}}"
    puts "ERROR_REQUEST_error"
  end
  STDOUT.flush
end

require "xcodeproj"
require "pathname"
require_relative "project_scheme_helper"
require_relative "project_file_helper"
require_relative "package_helper"

# https://www.rubydoc.info/github/CocoaPods/Xcodeproj/Xcodeproj/Project/Object/PBXProject#project_dir_path-instance_method

# FILE AND GROUP MANAGEMENT

def find_file(project, file_path)
  file_path = Pathname.new(file_path).cleanpath
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
  add_file_to_targets(project, targets, file_path)
end

def update_folder_targets(project, targets, folder_path)
  group = find_group_by_absolute_dir_path(project, folder_path)
  if group.nil? || is_folder(group) == false
    puts "folder_not_found"
    return
  end

  project.targets.each do |target|
    if target.file_system_synchronized_groups
      if targets.split(",").include?(target.name)
        unless target.file_system_synchronized_groups.include?(group)
          target.file_system_synchronized_groups << group
        end
      else
        if target.file_system_synchronized_groups.include?(group)
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
end

def rename_file(project, old_file_path, new_file_path)
  group = first_folder_by_absolute_dir_path(project, old_file_path)
  return if not group.nil?
  file_ref = find_file(project, old_file_path)
  file_ref.set_path(new_file_path) if not file_ref.nil?
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

  splitted_path = group_path.split("/")
  # todo: optimize the search by starting from root_group
  for i in 1..(splitted_path.length - 2)
    current_path = splitted_path[0..i].join("/")
    new_group_path = current_path + "/" + splitted_path[i + 1]
    parent_group = find_group_by_absolute_dir_path(project, current_path)
    current_group = find_group_by_absolute_dir_path(project, new_group_path)

    if current_group.nil?
      unless parent_group.nil?
        parent_group.new_group(splitted_path[i + 1], new_group_path)
      end
    end
  end
end

def rename_group(project, old_group_path, new_group_path)
  group = find_group_by_absolute_dir_path(project, old_group_path)
  if not group.nil?
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
        if target.file_system_synchronized_groups &&
             target.file_system_synchronized_groups.include?(old_parent)
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
      project
    ) do |group, parent_group, group_path, _type|
      if _type == GroupType::SYNCHRONIZED_GROUP
        puts "folder:#{group_path}"
        all_files_in_folder(project, group).each do |file_in_folder|
          puts "file:#{file_in_folder}"
        end
      elsif _type == GroupType::FOLDER_REFERENCE
        puts "folder:#{group_path}"
        all_files_in_folder(project, group).each do |file_in_folder|
          puts "file:#{file_in_folder}"
        end
      else
        puts "group:#{group_path}"
      end
    end
  end
  project.files.each do |file|
    puts "file:#{get_real_path(file, project)}" if !is_folder_reference(file)
  end
  print_all_group_paths(project)
end

def list_files_for_target(project, target_name)
  project.targets.each do |target|
    if target_name == target.name
      target.source_build_phase.files_references.each do |file|
        puts get_real_path(file, project) if !is_folder_reference(file)
      end
      if target.file_system_synchronized_groups
        target.file_system_synchronized_groups.each do |folder|
          all_files_in_folder(project, folder).each do |file_in_folder|
            puts file_in_folder
          end
        end
      end
    end
  end
end

def get_targets_for_file(project, file_path)
  file_path = Pathname.new(file_path).cleanpath
  group = first_folder_by_absolute_dir_path(project, file_path)
  result = []
  if not group.nil?
    project.targets.each do |target|
      if target.file_system_synchronized_groups &&
           target.file_system_synchronized_groups.include?(group)
        result << target.name
      end
    end
  end
  project.targets.each do |target|
    target.source_build_phase.files_references.each do |file|
      result << target.name if get_real_path(file, project) == file_path
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

# SCHEME MANAGEMENT

def generate_scheme_depend_on_target(
  projects,
  generated_scheme_name,
  original_scheme_name,
  include_targets,
  exclude_targets
)
  include_targets_list =
    include_targets.nil? == false ? include_targets.split(",") : []
  exclude_targets_list =
    exclude_targets.nil? == false ? exclude_targets.split(",") : []

  # root target scheme can be a scheme, load it if exists
  result_scheme_load = load_scheme_if_exists(projects, original_scheme_name)
  scheme = result_scheme_load[:scheme]
  project = result_scheme_load[:project]

  root_targets = []
  if project.nil?
    projects.each do |proj|
      proj.targets.each do |target|
        if target.name == original_scheme_name
          root_targets = [target]
          project = proj
          break
        end
      end
      break unless project.nil?
    end
  else
    all_targets = get_all_targets_from_scheme(scheme)
    root_targets =
      all_targets
        .map do |target|
          get_target_by_name(project, target[:name], target[:uuid])
        end
        .reject(&:nil?)
  end

  if project.nil? || root_targets.empty?
    puts "scheme_does_not_exist"
    return
  end

  root_project_dir_path = project.path.dirname

  visited = {}

  is_different_from_existing = false

  # remove all test targets from scheme first and then add back only required ones as buildable references
  # remove "Testables" from test action
  scheme.test_action.testables = [] if not scheme.test_action.nil?

  # use bfs to find all deps of the original_scheme_name target
  # build inverted dependency graph
  dep_graph = {}
  project.targets.each do |target|
    target.dependencies.each do |dep|
      next if dep.target.nil? || dep.target.name.nil? || dep.target.name.empty?

      dep_graph[dep.target.name] ||= []
      dep_graph[dep.target.name] << target
    end
  end

  # bfs to find all dependent targets of the root_target
  queue = root_targets.dup
  queue.each { |target| visited[target.uuid] = true }
  root_targets.each do |target|
    if add_target_to_scheme(scheme, target, false, root_project_dir_path)
      is_different_from_existing = true
    end
  end

  while !queue.empty?
    current = queue.shift
    if dep_graph.key?(current.name)
      dep_graph[current.name].each do |neighbor|
        next if neighbor.nil? || neighbor.name.nil? || neighbor.name.empty?

        if !visited.key?(neighbor.uuid) &&
             exclude_targets_list.include?(neighbor.name) == false
          visited[neighbor.uuid] = true
          queue << neighbor
          if add_target_to_scheme(
               scheme,
               neighbor,
               false,
               root_project_dir_path
             )
            is_different_from_existing = true
          end
        end
      end
    end
  end

  # add all other targets from include_targets_list
  projects.each do |project|
    project.targets.each do |target|
      if !visited.key?(target.uuid) &&
           include_targets_list.include?(target.name) &&
           exclude_targets_list.include?(target.name) == false
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

  if action == "type_of_path"
    type_of_path(project, arg[1])
    return
  end

  if action == "generate_scheme_depend_on_target"
    generate_scheme_depend_on_target(project, arg[1], arg[2], arg[3], arg[4])
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

  if action == "generate_scheme_depend_on_target"
    project_path = project_path.split(":::")
    projects = project_path.map { |path| get_latest_project(path) }
    handle_action(projects, action, arg)
  else
    project = get_latest_project(project_path)
    handle_action(project, action, arg)
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

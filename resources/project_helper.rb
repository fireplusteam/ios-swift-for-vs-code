# typed: true
if LSP = ENV["SORBETSILENCE"]
  require "sorbet-runtime"
else
  begin
    require "sorbet-runtime"
  rescue LoadError
    # Do nothing if sorbet-runtime is not available
  end
end

require "xcodeproj"
require "pathname"
require_relative "project_scheme_helper"

# https://www.rubydoc.info/github/CocoaPods/Xcodeproj/Xcodeproj/Project/Object/PBXProject#project_dir_path-instance_method

# to support old ruby 2.6 versions
if !File.respond_to?(:absolute_path?)
  def File.absolute_path?(path)
    # Check if it starts with / (Unix)
    path.start_with?("/")
  end
end

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

# FILE AND GROUP MANAGEMENT

def find_group_by_absolute_file_path(project, path)
  groups =
    project
      .groups
      .lazy
      .map do |group|
        relative_path = path.sub(get_real_path(group, project) + "/", "")
        relative_dir = File.dirname(relative_path)

        return group if get_real_path(group, project) == File.dirname(path)

        group.find_subpath(relative_dir)
      end
      .reject(&:nil?)

  groups.first
end

def find_group_by_absolute_dir_path(project, path)
  groups =
    project
      .groups
      .lazy
      .map do |group|
        relative_dir = path.sub(get_real_path(group, project) + "/", "")

        return group if get_real_path(group, project) == path

        group.find_subpath(relative_dir)
      end
      .reject(&:nil?)

  groups.first
end

def find_file(project, file_path)
  file_ref =
    project.files.find { |file| get_real_path(file, project) == file_path }

  file_ref
end

def add_file_to_targets(project, targets, file_path)
  file_ref = find_file(project, file_path)

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
end

def update_file_targets(project, targets, file_path)
  file_ref = find_file(project, file_path)
  file_ref.remove_from_project if not file_ref.nil?
  if targets == "" # means to remove the file from all targets
    return
  end
  add_file_to_targets(project, targets, file_path)
end

def delete_file(project, file_path)
  file_ref = find_file(project, file_path)
  file_ref.remove_from_project if not file_ref.nil?
end

def rename_file(project, old_file_path, new_file_path)
  file_ref = find_file(project, old_file_path)
  file_ref.set_path(new_file_path) if not file_ref.nil?
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
    group.name = File.basename(new_group_path)
    group.set_path(new_group_path)
  end
end

def move_group(project, old_path, new_path)
  new_parent_path = File.dirname(new_path)
  new_parent_group = find_group_by_absolute_dir_path(project, new_parent_path)
  if not new_parent_group.nil?
    old_group = find_group_by_absolute_dir_path(project, old_path)
    old_group.move(new_parent_group) if not old_group.nil?
  end
end

def delete_group(project, group_path)
  group = find_group_by_absolute_dir_path(project, group_path)
  if not group.nil?
    group.recursive_children_groups.reverse.each(&:clear)
    group.clear
    group.remove_from_project
  end
end

def list_targets(project)
  project.targets.each { |target| puts target.name }
end

def is_folder_reference(file)
  return(
    file.last_known_file_type == "folder" ||
      file.last_known_file_type == "folder.assetcatalog"
  )
end

def print_all_group_paths(project, group = project.main_group)
  puts "group:#{get_real_path(group, project)}"
  group.children.each do |child|
    # if child is a file reference with folder type, print it as folder reference
    if child.kind_of?(Xcodeproj::Project::Object::PBXFileReference) &&
         is_folder_reference(child)
      puts "folder:#{get_real_path(child, project)}"
    elsif child.kind_of?(Xcodeproj::Project::Object::PBXGroup)
      print_all_group_paths(project, child)
    end
  end
end

def list_files(project)
  project.files.each do |file|
    puts "file:#{get_real_path(file, project)}" if !is_folder_reference(file)
  end
  print_all_group_paths(project)
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

# SCHEME MANAGEMENT

def generate_scheme_depend_on_target(
  project,
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
  scheme = load_scheme_if_exists(project, original_scheme_name)

  all_targets = get_all_targets_from_scheme(scheme)

  # write bfs to find all deps of the original_scheme_name target
  root_targets =
    all_targets
      .map do |target|
        get_target_by_name(project, target[:name], target[:uuid])
      end
      .reject(&:nil?)

  if root_targets.empty?
    puts "scheme_does_not_exist"
    return
  end

  # build inverted dependency graph
  dep_graph = {}
  project.targets.each do |target|
    target.dependencies.each do |dep|
      next if dep.target.nil? || dep.target.name.nil? || dep.target.name.empty?

      dep_graph[dep.target.name] ||= []
      dep_graph[dep.target.name] << target
    end
  end

  # bfs to find all dependents targets of the root_target
  queue = root_targets.dup
  visited = {}
  queue.each { |target| visited[target.uuid] = true }
  is_different_from_existing = false
  root_targets.each do |target|
    is_different_from_existing ||= add_target_to_scheme(scheme, target, false)
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
          is_different_from_existing ||=
            add_target_to_scheme(scheme, neighbor, false)
        end
      end
    end
  end

  # add all other targets from include_targets_list
  project.targets.each do |target|
    if !visited.key?(target.uuid) &&
         include_targets_list.include?(target.name) &&
         exclude_targets_list.include?(target.name) == false
      is_different_from_existing ||= add_target_to_scheme(scheme, target, false)
    end
  end

  # save the scheme
  if is_different_from_existing == false
    puts "scheme_unchanged"
    return
  end

  scheme_dir = project.path
  scheme_dir.mkpath unless scheme_dir.exist?
  scheme.save_as(scheme_dir, generated_scheme_name, false)
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

  scheme = load_scheme_if_exists(project, original_scheme_name)

  is_different_from_existing = false

  all_test_targets_in_scheme = get_all_test_targets_from_scheme(scheme)
  for to_remove_target in all_test_targets_in_scheme
    if test_targets_list.empty? == false &&
         !test_targets_list.include?(to_remove_target[:name])
      if remove_target_from_scheme(scheme, to_remove_target)
        is_different_from_existing = true
      end
    end
  end

  project.targets.each do |current|
    # puts "current target: #{current.name}, #{current.product_name}"
    if test_targets_list.empty? == true ||
         test_targets_list.include?(current.name)
      add_target_to_scheme(scheme, current, true)
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
  scheme_dir = project.path
  scheme_dir.mkpath unless scheme_dir.exist?
  scheme.save_as(scheme_dir, generated_scheme_name, false)
  puts generated_scheme_name
end

def save(project)
  project.save
end

def handle_action(project, action, arg)
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

  if action == "list_targets"
    list_targets(project)
    return
  end

  if action == "list_targets_for_file"
    list_targets_for_file(project, arg[1])
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

if ENV["DEBUG_XCODE_PROJECT_HELPER"] == "1"
  input = ARGV[0].split("|^|^|")
  project_path = input[0]
  puts "Opening project at path: #{project_path}"
  project = Xcodeproj::Project.open(project_path)
  # rest of the input is action
  action = input[1]
  handle_action(project, action, input[1..-1])
  exit 0
end

project_path = ARGV[0]
project = Xcodeproj::Project.open(project_path)
previous_mtime = File.mtime(project_path)

while (input = STDIN.gets.chomp)
  break if input == "exit"

  new_mtime = File.mtime(project_path)
  if previous_mtime != new_mtime
    previous_mtime = new_mtime
    project = Xcodeproj::Project.open(project_path)
  end
  arg = input.split("|^|^|")
  action = arg[0]
  handle_action(project, action, arg)
  previous_mtime = File.mtime(project_path) if action == "save"
  puts "EOF_REQUEST"
  STDOUT.flush
end

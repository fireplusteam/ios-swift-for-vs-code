require "xcodeproj"
require "find"

# to support old ruby 2.6 versions
if !File.respond_to?(:absolute_path?)
  def File.absolute_path?(path)
    # Check if it starts with / (Unix)
    path.start_with?("/")
  end
end

def clean_path(path)
  path = path.to_s
  if File.absolute_path?(path)
    return File.expand_path(path)
  else
    File.expand_path(path, "/").delete_prefix("/")
  end
end

def is_folder_reference(file)
  if file.kind_of?(Xcodeproj::Project::Object::PBXFileReference) == false
    return false
  end
  return(
    file.last_known_file_type == "folder" ||
      file.last_known_file_type == "folder.assetcatalog" ||
      file.last_known_file_type == "wrapper"
  )
end

def is_folder(group)
  return(
    group.kind_of?(
      Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup
    ) || is_folder_reference(group)
  )
end

def is_relative_path?(path)
  !File.absolute_path?(path)
end

def get_real_path(file, project)
  xc_project_dir_path = project.root_object.project_dir_path
  if file.path.nil?
    clean_path(file.real_path)
  elsif is_relative_path?(file.path)
    if xc_project_dir_path.empty?
      clean_path(file.real_path)
    else
      clean_path(
        File.join(
          project.project_dir.to_s,
          xc_project_dir_path.to_s,
          file.path.to_s
        )
      )
    end
  else
    clean_path(file.path)
  end
end

# define enum of group types
module GroupType
  GROUP = 0
  SYNCHRONIZED_GROUP = 1
  FOLDER_REFERENCE = 2
end

def combine_path(group, parent_path)
  if group.path.nil?
    parent_path.to_s
  elsif is_relative_path?(group.path)
    File.join(parent_path.to_s, group.path.to_s)
  else
    group.path.to_s
  end
end

module Traverse
  VERSION = "0.1.0"

  def traverse_all_group(project)
    GC.disable
    group = project.main_group
    path =
      File.join(
        project.project_dir.to_s,
        project.root_object.project_dir_path.to_s
      )
    path = combine_path(group, path) if group != project.root_object

    queue_group = [group]
    queue_parent_group = [nil]
    queue_current_path = [path]
    head_queue = 0
    while head_queue < queue_group.length
      group = queue_group[head_queue]
      parent_group = queue_parent_group[head_queue]
      current_path = queue_current_path[head_queue]
      head_queue += 1

      catch(:prune) do
        yield(group, parent_group, clean_path(current_path), GroupType::GROUP)
        group.children.each do |child|
          # if child is a file reference with folder type, print it as folder reference
          child_path = combine_path(child, current_path)
          if child.kind_of?(Xcodeproj::Project::Object::PBXFileReference) &&
               is_folder_reference(child)
            yield(
              child,
              group,
              clean_path(child_path),
              GroupType::FOLDER_REFERENCE
            )
          elsif child.kind_of?(
                Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup
              )
            yield(
              child,
              group,
              clean_path(child_path),
              GroupType::SYNCHRONIZED_GROUP
            )
          elsif child.kind_of?(Xcodeproj::Project::Object::PBXGroup)
            queue_group << child
            queue_parent_group << group
            queue_current_path << child_path
          end
        end
      end
    end
    GC.enable
  end

  def prune
    throw :prune
  end

  module_function :traverse_all_group, :prune
end

def parent_group_of_group(project, target_group)
  Traverse.traverse_all_group(project) do |group, parent, _group_path, _type|
    return parent if group == target_group
  end
  nil
end

def get_path_of_group(project, folder)
  Traverse.traverse_all_group(project) do |group, _parent, group_path, type|
    return group_path if group == folder
  end
  nil
end

def all_files_in_folder(project, group, folder_path)
  result = []
  folder_path = get_path_of_group(project, group) if folder_path.nil?
  return result if folder_path.nil?
  # look up all files in folder and subfolders and further folders recursively in file system
  # don't recurse folder if it has Package.swift file at root (as Swift Package)
  def package_file(path)
    File.join(path, "Package.swift")
  end

  if File.exist?(package_file(folder_path))
    result << package_file(folder_path)
    return result
  end
  if File.directory?(folder_path)
    Find.find(folder_path) do |path|
      path = clean_path(path)
      # skip search if we have Package.swift file in subfolder
      if File.directory?(path) && File.exist?(package_file(path))
        result << package_file(path)
        Find.prune
      else
        result << path if File.file?(path)
      end
    end
  end
  return result
end

def find_group_by_absolute_dir_path(project, path)
  path = clean_path(path)
  Traverse.traverse_all_group(
    project
  ) do |group, parent_group, group_path, _type|
    return group if group_path == path
  end
  nil
end

def first_folder_by_absolute_dir_path(project, path)
  path = clean_path(path).split("/")

  all_pref_paths = {}
  current_path = "/"
  path.each do |part|
    current_path = File.join(current_path, part)
    all_pref_paths[current_path.to_s] = true
  end

  Traverse.traverse_all_group(
    project
  ) do |group, parent_group, group_path, type|
    return group if all_pref_paths.key?(group_path.to_s) && is_folder(group)
  end
  nil
end

def furthest_group_by_absolute_dir_path(project, path)
  folder = first_folder_by_absolute_dir_path(project, path)
  return folder if folder

  result_group = nil
  result_path_components = 0
  path = clean_path(path).split("/")

  all_pref_paths = {}
  current_path = "/"
  path.each do |part|
    current_path = File.join(current_path, part)
    all_pref_paths[current_path.to_s] = current_path.to_s.split("/").length
  end

  Traverse.traverse_all_group(
    project
  ) do |group, parent_group, group_path, _type|
    group_path = group_path.to_s
    if all_pref_paths.key?(group_path)
      group_path_components = group_path.split("/").length
      if group_path_components > result_path_components
        result_group = group
        result_path_components = group_path_components
      end
    end
  end
  return result_group
end

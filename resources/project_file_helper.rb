require "xcodeproj"
require "find"
require "pathname"

# to support old ruby 2.6 versions
if !File.respond_to?(:absolute_path?)
  def File.absolute_path?(path)
    # Check if it starts with / (Unix)
    path.start_with?("/")
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
    file.real_path.cleanpath
  elsif is_relative_path?(file.path)
    if xc_project_dir_path.empty?
      file.real_path.cleanpath
    else
      (project.project_dir + xc_project_dir_path + file.path).cleanpath
    end
  else
    Pathname.new(file.path).cleanpath
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
    parent_path
  elsif is_relative_path?(group.path)
    parent_path + group.path
  else
    Pathname.new(group.path)
  end
end

def traverse_all_group(project, &block)
  def all_group_paths_rec(project, group, parent_group, current_path, &block)
    yield(group, parent_group, current_path.cleanpath, GroupType::GROUP)

    group.children.each do |child|
      # if child is a file reference with folder type, print it as folder reference
      child_path = combine_path(child, current_path)
      if child.kind_of?(Xcodeproj::Project::Object::PBXFileReference) &&
           is_folder_reference(child)
        yield(child, group, child_path, GroupType::FOLDER_REFERENCE)
      elsif child.kind_of?(
            Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup
          )
        yield(child, group, child_path, GroupType::SYNCHRONIZED_GROUP)
      elsif child.kind_of?(Xcodeproj::Project::Object::PBXGroup)
        all_group_paths_rec(project, child, group, child_path, &block)
      end
    end
  end

  group = project.main_group
  path = project.project_dir + project.root_object.project_dir_path

  path = combine_path(group, path) if group != project.root_object

  all_group_paths_rec(project, group, nil, path, &block)
end

def parent_group_of_group(project, target_group)
  traverse_all_group(project) do |group, parent, _group_path, _type|
    return parent if group == target_group
  end
  nil
end

def get_path_of_group(project, folder)
  traverse_all_group(project) do |group, _parent, group_path, type|
    return group_path if group == folder
  end
  nil
end

def all_files_in_folder(project, group)
  result = []
  folder_path = get_path_of_group(project, group)
  return result if folder_path.nil?
  # look up all files in folder and subfolders and further folders recursively in file system
  # don't recurse folder if it has Package.swift file at root (as Swift Package)
  def package_file(path)
    path + "Package.swift"
  end

  if File.exist?(package_file(folder_path))
    result << package_file(folder_path)
    return result
  end
  if File.directory?(folder_path)
    Find.find(folder_path) do |path|
      path = Pathname.new(path).cleanpath
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
  path = Pathname.new(path).cleanpath
  traverse_all_group(project) do |group, parent_group, group_path, _type|
    return group if group_path == path
  end
  nil
end

def first_folder_by_absolute_dir_path(project, path)
  path = Pathname.new(path).cleanpath.to_s.split("/")

  all_pref_paths = {}
  current_path = Pathname.new("/")
  path.each do |part|
    current_path = current_path + part
    all_pref_paths[current_path.to_s] = true
  end

  traverse_all_group(project) do |group, parent_group, group_path, type|
    return group if all_pref_paths.key?(group_path.to_s) && is_folder(group)
  end
  nil
end

def furthest_group_by_absolute_dir_path(project, path)
  folder = first_folder_by_absolute_dir_path(project, path)
  return folder if folder

  result_group = nil
  result_path_components = 0
  path = Pathname.new(path).cleanpath.to_s.split("/")

  all_pref_paths = {}
  current_path = Pathname.new("/")
  path.each do |part|
    current_path = current_path + part
    all_pref_paths[current_path.to_s] = current_path.to_s.split("/").length
  end

  traverse_all_group(project) do |group, parent_group, group_path, _type|
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

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
      file.last_known_file_type == "folder.assetcatalog"
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
    file.real_path.to_s
  elsif is_relative_path?(file.path)
    if xc_project_dir_path.empty?
      file.real_path.to_s
    else
      Pathname
        .new(
          File.join(project.project_dir, xc_project_dir_path, file.path.to_s)
        )
        .cleanpath
        .to_s
    end
  else
    file.path.to_s
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
    Pathname.new(File.join(parent_path, group.path.to_s)).cleanpath.to_s
  else
    Pathname.new(group.path.to_s).cleanpath.to_s
  end
end

def traverse_all_group(project, &block)
  def all_group_paths_rec(project, group, parent_group, current_path, &block)
    yield(group, parent_group, current_path, GroupType::GROUP)

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
  path =
    Pathname
      .new(
        File.join(
          project.project_dir,
          project.root_object.project_dir_path.to_s
        )
      )
      .cleanpath
      .to_s

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
  # look up all files in folder and subfolders and futher folders recursively in file system
  Find.find(folder_path) do |path|
    result << Pathname.new(path).cleanpath.to_s if File.file?(path)
  end
  return result
end

def find_group_by_absolute_dir_path(project, path)
  path = Pathname.new(path).cleanpath.to_s
  traverse_all_group(project) do |group, parent_group, group_path, _type|
    return group if group_path == path
  end
  nil
end

def first_folder_by_absolute_dir_path(project, path)
  path = Pathname.new(path).cleanpath.to_s.split("/")

  all_pref_paths = {}
  current_path = ""
  path.each do |part|
    current_path = Pathname.new(File.join(current_path, part)).cleanpath.to_s
    all_pref_paths[current_path] = true
  end

  traverse_all_group(project) do |group, parent_group, group_path, type|
    return group if all_pref_paths.key?(group_path) && is_folder(group)
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
  current_path = ""
  path.each do |part|
    current_path = Pathname.new(File.join(current_path, part)).cleanpath.to_s
    all_pref_paths[current_path] = current_path.split("/").length
  end

  traverse_all_group(project) do |group, parent_group, group_path, _type|
    group_path_components = group_path.split("/").length
    if all_pref_paths.key?(group_path)
      if group_path_components > result_path_components
        result_group = group
        result_path_components = group_path_components
      end
    end
  end
  return result_group
end

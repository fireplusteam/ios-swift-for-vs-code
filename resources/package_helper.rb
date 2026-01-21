require "pathname"
require "find"
require_relative "project_scheme_helper"
require_relative "project_file_helper"

# FILE AND GROUP MANAGEMENT
$targets_dir = "Sources"
$tests_dir = "Tests"

class SwiftPackage
  class Target
    attr_accessor :project, :name, :uuid, :is_test_target

    def initialize(project, name, is_test_target)
      @project = project
      @name = name.to_s
      @uuid = name.to_s
      @is_test_target = is_test_target
    end

    def isa
      "PBXAggregateTarget"
    end

    def test_target_type?
      return @is_test_target
    end

    def product_type
      if @is_test_target
        "com.apple.product-type.bundle.unit-test"
      else
        "com.apple.product-type.library.dynamic"
      end
    end

    def path
      if @is_test_target
        File.join($tests_dir, @name)
      else
        File.join($targets_dir, @name)
      end
    end
  end

  attr_accessor :path, :folder_path, :project_dir_path

  def initialize(package_path)
    @path = Pathname.new(package_path).expand_path
    @folder_path = @path.dirname
    # should be used in buildable reference to construct XCScheme only
    @project_dir_path = @folder_path
    # TODO: to parse Package.swift file, we can use the following command to dump package info as JSON
    # swift package dump-package
    #   "targets" : [
    #   {
    #     "dependencies" : [
    #       {
    #         "byName" : [
    #           "FLAnimatedImage",
    #           null
    #         ]
    #       },
    #       {
    #         "byName" : [
    #           "Nuke",
    #           null
    #         ]
    #       },
    #       {
    #         "product" : [
    #           "NukeExtensions",
    #           "Nuke",
    #           null,
    #           null
    #         ]
    #       },
    #     ],
    #     "exclude" : [

    #     ],
    #     "name" : "MainLib",
    #     "packageAccess" : false,
    #     "type" : "regular"
    #   },
    #   {
    #     "dependencies" : [
    #       {
    #         "byName" : [
    #           "MainLib",
    #           null
    #         ]
    #       },
    #       {
    #         "product" : [
    #           "SnapshotTesting",
    #           "swift-snapshot-testing",
    #           null,
    #           null
    #         ]
    #       }
    #     ],
    #     "exclude" : [

    #     ],
    #     "name" : "MainLibTests",
    #     "packageAccess" : false,
    #     "settings" : [

    #     ],
    #     "type" : "test"
    #   }
    # ],
  end

  #root_object.project_dir_path

  def root_object
    self
  end

  def targets
    result = []
    [$targets_dir, $tests_dir].each do |base_dir|
      dir_path = File.join(folder_path, base_dir)
      if File.exist?(dir_path) && File.directory?(dir_path)
        # enumerate all subdirs as targets
        Dir.foreach(dir_path) do |entry|
          next if entry == "." || entry == ".." || entry.start_with?(".")
          target_dir = File.join(dir_path, entry)
          next unless File.directory?(target_dir)
          result << Target.new(
            self,
            entry,
            base_dir == $tests_dir ? true : false
          )
        end
      end
    end
    result
  end
end

# helper

def find_files(path)
  result = []
  if File.directory?(path)
    Find.find(path) do |path|
      result << Pathname.new(path).cleanpath.to_s if File.file?(path)
    end
  end
  result
end

# Package interface

def package_list_files(project)
  find_files(File.join(project.folder_path, $targets_dir)).each do |file_path|
    puts "file:#{file_path}"
  end

  find_files(File.join(project.folder_path, $tests_dir)).each do |file_path|
    puts "file:#{file_path}"
  end
end

def package_list_targets_for_file(project, file_path)
  project.targets.each do |target|
    candidate_target =
      Pathname.new(File.join(project.folder_path, target.path)).cleanpath.to_s
    puts target.name if file_path.start_with?("#{candidate_target}/")
  end
end

def package_list_files_for_target(project, target)
  # find all dirs in Sources or Tests matching target name
  [$targets_dir, $tests_dir].each do |base_dir|
    dir_path = File.join(project.folder_path, base_dir, target)
    if File.exist?(dir_path) && File.directory?(dir_path)
      find_files(dir_path).each { |file_path| puts file_path }
    end
  end
end

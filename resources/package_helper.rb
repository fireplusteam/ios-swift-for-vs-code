require "pathname"
require "find"
require "json"
require_relative "project_scheme_helper"
require_relative "project_file_helper"

# FILE AND GROUP MANAGEMENT
$targets_dir = "Sources"
$tests_dir = "Tests"

class SwiftPackage
  class Target
    class Dependency
      attr_accessor :target
      def initialize(target)
        @target = target
      end
    end

    attr_accessor :project, :name, :uuid, :is_test_target, :dependencies, :path

    def initialize(project, name, target_path, is_test_target)
      @project = project
      @name = name.to_s
      @uuid = name.to_s
      @is_test_target = is_test_target
      @dependencies = []
      @path = target_path
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
      return Pathname.new(@path) if @path && !@path.empty?
      if @is_test_target
        File.join($tests_dir, @name)
      else
        File.join($targets_dir, @name)
      end
    end
  end

  attr_accessor :path, :project_dir_path, :parsed_targets

  def initialize(package_path)
    @path = Pathname.new(package_path).expand_path
    # should be used in buildable reference to construct XCScheme only
    @project_dir_path = @path.dirname
    @parsed_targets = nil
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

  def parsed_targets
    return @parsed_targets if @parsed_targets
    begin
      package_info = {}
      Dir.chdir(@project_dir_path) do
        package_info_json = `swift package dump-package`
        package_info = JSON.parse(package_info_json)
      end
      @parsed_targets = []
      targets = {}
      package_info["targets"].each do |target_info|
        target_name = target_info["name"]
        target_type = target_info["type"]
        is_test_target = target_type == "test" ? true : false
        target_path = target_info["path"] if target_info.key?("path")
        target = Target.new(self, target_name, target_path, is_test_target)
        targets[target_name] = target

        target.dependencies = target_info["dependencies"]
        @parsed_targets << target
      end
      @parsed_targets.each do |target|
        resolved_dependencies = []
        added_deps = {}
        target.dependencies.each do |dep_info|
          if dep_info.key?("byName")
            dep_info["byName"].each do |dep_name|
              next if dep_name.nil? || added_deps.key?(dep_name)
              added_deps[dep_name] = true
              if targets.key?(dep_name)
                resolved_dependencies << Target::Dependency.new(
                  targets[dep_name]
                )
              end
            end
          end
        end
        target.dependencies = resolved_dependencies
      end
      @parsed_targets
    rescue => e
      @parsed_targets = nil
    end
  end

  def targets
    return parsed_targets if parsed_targets
    # fallback to directory structure parsing
    result = []
    [$targets_dir, $tests_dir].each do |base_dir|
      dir_path = File.join(@project_dir_path, base_dir)
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
  find_files(
    File.join(project.project_dir_path, $targets_dir)
  ).each { |file_path| puts "file:#{file_path}" }

  find_files(
    File.join(project.project_dir_path, $tests_dir)
  ).each { |file_path| puts "file:#{file_path}" }
end

def package_list_targets_for_file(project, file_path)
  project.targets.each do |target|
    candidate_target =
      Pathname
        .new(File.join(project.project_dir_path, target.path))
        .cleanpath
        .to_s
    if file_path.downcase.start_with?("#{candidate_target.downcase}/")
      puts target.name
    end
  end
end

def package_list_files_for_target(project, target_name)
  # find all dirs in Sources or Tests matching target name
  project.targets.each do |target|
    next if target.name != target_name
    dir_path = target.path
    full_dir_path = File.join(project.project_dir_path, dir_path)
    if File.exist?(full_dir_path) && File.directory?(full_dir_path)
      find_files(full_dir_path).each { |file_path| puts file_path }
    end
  end
end

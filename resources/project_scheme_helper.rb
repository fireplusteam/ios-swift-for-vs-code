def get_target_by_name(project, target_name, target_uuid = nil)
  project.targets.each do |target|
    next if target.nil? || target.name.nil? || target.name.empty?
    if target.name == target_name &&
         (target_uuid.nil? || target.uuid == target_uuid)
      return target
    end
  end
  nil
end

def load_scheme_if_exists(project, scheme_name)
  scheme_dir = project.path
  scheme_path = scheme_dir + "xcshareddata/xcschemes/#{scheme_name}.xcscheme"
  return Xcodeproj::XCScheme.new(scheme_path) if scheme_path.exist?
  # check user schemes
  scheme_path =
    scheme_dir +
      "xcuserdata/#{ENV["USER"]}.xcuserdatad/xcschemes/#{scheme_name}.xcscheme"
  return Xcodeproj::XCScheme.new(scheme_path) if scheme_path.exist?
  Xcodeproj::XCScheme.new # return empty scheme
end

def get_all_targets_from_scheme(scheme)
  targets = []
  if scheme.build_action
    scheme.build_action.entries.each do |entry|
      if entry.buildable_references.any?
        entry.buildable_references.each do |buildable_ref|
          targets << {
            name: buildable_ref.target_name,
            uuid: buildable_ref.target_uuid
          }
        end
      end
    end
  end
  targets
end

def get_all_test_targets_from_scheme(scheme)
  test_targets = []
  if scheme.test_action
    scheme.test_action.testables.each do |testable_references|
      testable_references.buildable_references.each do |buildable_ref|
        if buildable_ref.target_name
          test_targets << {
            name: buildable_ref.target_name,
            uuid: buildable_ref.target_uuid
          }
        end
      end
    end
  end
  test_targets
end

def get_build_reference_from_build_action(
  build_action,
  target_name,
  target_uuid
)
  build_action.entries.each do |entry|
    entry.buildable_references.each do |buildable_ref|
      if buildable_ref.target_name == target_name &&
           buildable_ref.target_uuid == target_uuid
        return buildable_ref
      end
    end
  end
  nil
end

def get_build_reference_from_testable_reference(
  testable_reference,
  target_name,
  target_uuid
)
  testable_reference.buildable_references.each do |buildable_ref|
    if buildable_ref.target_name == target_name &&
         buildable_ref.target_uuid == target_uuid
      return buildable_ref
    end
  end
  nil
end

def check_target_in_scheme(scheme, test_target)
  return(
    get_build_reference_from_build_action(
      scheme.build_action,
      test_target.name,
      test_target.uuid
    ) != nil
  )
end

def check_test_target_in_scheme(scheme, test_target)
  all_test_targets = get_all_test_targets_from_scheme(scheme)
  all_test_targets.each do |target|
    if target[:name] == test_target.name && target[:uuid] == test_target.uuid
      return true
    end
  end
  false
end

def add_target_to_scheme(scheme, test_target, build_for_testing)
  if scheme.is_a?(Xcodeproj::XCScheme) == false
    raise "scheme should be of type Xcodeproj::XCScheme"
  end

  if !build_for_testing
    if !check_target_in_scheme(scheme, test_target) &&
         !check_test_target_in_scheme(scheme, test_target)
      scheme.add_build_target(test_target)
      puts "Added target to scheme: #{test_target.name}"
      return true
    end
  else
    if !check_test_target_in_scheme(scheme, test_target)
      test_action = scheme.test_action
      testable_reference =
        Xcodeproj::XCScheme::TestAction::TestableReference.new(test_target)
      test_action.add_testable(testable_reference)
      return true
    end
  end
  return false
end

def remove_target_from_scheme(scheme, test_target)
  if scheme.is_a?(Xcodeproj::XCScheme) == false
    raise "scheme should be of type Xcodeproj::XCScheme"
  end

  removed = false

  to_remove =
    get_build_reference_from_build_action(
      scheme.build_action,
      test_target[:name],
      test_target[:uuid]
    )
  if to_remove
    scheme.build_action.remove_buildable_reference(to_remove)
    puts "Removed target from scheme: #{test_target[:name]}"
    removed = true
  end

  scheme.test_action.testables.each do |testable_references|
    while buildable_ref =
            get_build_reference_from_testable_reference(
              testable_references,
              test_target[:name],
              test_target[:uuid]
            )
      testable_references.remove_buildable_reference(buildable_ref)
      removed = true
    end
  end

  removed
end

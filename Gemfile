# frozen_string_literal: true

source 'https://rubygems.org'

ruby File.read(File.join(__dir__, '.ruby-version')).strip

git_source(:github) { |repo_name| "https://github.com/#{repo_name}" }
gem 'pathname'
gem 'xcodeproj'

group :development do
  # linter
  #gem 'rubocop', require: false
  # formatter
  gem 'syntax_tree', require: true
end

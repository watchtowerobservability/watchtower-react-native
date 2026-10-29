require 'json'
pkg = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'WatchtowerRN'
  s.version      = pkg['version']
  s.summary      = pkg['description']
  s.license      = pkg['license']
  s.homepage     = 'https://github.com/watchtowerobservability/watchtower-react-native'
  s.authors      = 'Watchtower'
  s.platforms    = { :ios => '13.0' }
  s.source       = { :git => 'https://github.com/watchtowerobservability/watchtower-react-native.git', :tag => "v#{s.version}" }
  s.source_files = 'ios/*.{h,m,swift}'
  s.swift_version = '5.9'
  s.dependency 'React-Core'
  # The native iOS SDK (sdks/ios, mirrored as watchtower-ios) must be available to CocoaPods as `Watchtower`.
  s.dependency 'Watchtower', pkg['version']
end

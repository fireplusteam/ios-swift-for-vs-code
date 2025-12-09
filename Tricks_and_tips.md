# Improve Build Time if you use Xcode below 26

xcodebuild CLI tool is slower than Xcode. This section provides a workaround to improve the build time.

The issue is caused by the fact that xcodebuild tries to connect to the Apple servers before building the project, which can take 20 seconds or more. Usually, those requests are not necessary, but they slow down each build.

The workaround blocks developerservices2.apple.com domain when the xcodebuild tool is running by modifying /etc/hosts. Below you can find three ways to enable the workaround.

### Warning

Keep in mind that disabling access to developerservices2.apple.com for xcodebuild may cause some issues with the build process. It will disable things like registering devices, capabilities, and other network-related features. Therefore, it's best to use it when you are working just on the code and don't need updating project settings.

## 1. Manual (script)

Enable workaround:

```bash
sudo bash -c "echo '127.0.0.1 developerservices2.apple.com' >>/etc/hosts"
```

Disable workaround:

```bash
sudo sed -i '' '/developerservices2\.apple\.com/d' /etc/hosts
```

## 2. Manual (network sniffer)

If you use some tool to sniff network traffic like Proxyman or Charles Proxy, you can block requests to https://developerservices2.apple.com/* and automatically return some error like 999 status code. It will prevent xcodebuild from further calls.

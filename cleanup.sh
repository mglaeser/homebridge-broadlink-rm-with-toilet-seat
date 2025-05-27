#!/bin/bash

# Toilet Seat Project Cleanup Script
# This script removes unnecessary files and refactors the project to focus only on toilet seat functionality

set -e  # Exit on any error

echo "🚽 Starting Toilet Seat Project Cleanup..."

# Create backup
echo "📦 Creating backup..."
cp -r . "../$(basename "$PWD")_backup_$(date +%Y%m%d_%H%M%S)" 2>/dev/null || echo "⚠️  Backup failed - continuing anyway"

# Remove unnecessary accessory files
echo "🗑️  Removing unnecessary accessory files..."
rm -f accessories/aircon.js
rm -f accessories/air-purifier.js
rm -f accessories/fan.js
rm -f accessories/garageDoorOpener.js
rm -f accessories/humidifier-dehumidifier.js
rm -f accessories/learnCode.js
rm -f accessories/light.js
rm -f accessories/lock.js
rm -f accessories/outlet.js
rm -f accessories/switch.js
rm -f accessories/switchMulti.js
rm -f accessories/switchMultiRepeat.js
rm -f accessories/switchRepeat.js
rm -f accessories/window.js
rm -f accessories/windowCovering.js

# Remove test files
echo "🧪 Removing test files..."
rm -rf test/

# Remove unnecessary helper files
echo "🛠️  Removing unnecessary helper files..."
rm -f helpers/checkForUpdates.js
rm -f helpers/convertProntoCode.js
rm -f helpers/learnData.js
rm -f helpers/learnRFData.js
rm -f helpers/ping.js

# Keep these essential helpers:
# - broadlink.js (core communication)
# - sendData.js (sending IR commands)  
# - delayForDuration.js (timing functions)
# - getDevice.js (device discovery)
# - errors.js (error handling)
# - catchDelayCancelError.js (error handling)

# Keep existing smartToiletSeat.js (already up to date)
echo "🚽 Keeping existing smartToiletSeat.js (already updated)..."

# Update accessories/index.js to only export SmartToiletSeat
echo "📝 Updating accessories/index.js..."
cat > accessories/index.js << 'EOF'
const SmartToiletSeat = require('./smartToiletSeat');

module.exports = {
  SmartToiletSeat
}
EOF

# Update platform.js to only support toilet seat
echo "🏗️  Updating platform.js..."
cat > platform.js << 'EOF'
const { HomebridgePlatform } = require('homebridge-platform-helper');

const npmPackage = require('./package.json');
const Accessory = require('./accessories');
const broadlink = require('./helpers/broadlink');
const { discoverDevices } = require('./helpers/getDevice');

const classTypes = {
  'smart-toilet-seat': Accessory.SmartToiletSeat
}

let homebridgeRef

const ToiletSeatPlatform = class extends HomebridgePlatform {

  constructor (log, config = {}) {
    super(log, config, homebridgeRef);
  }

  addAccessories (accessories) {
    const { config, log } = this;

    this.discoverToiletDevices();

    if (!config.accessories) config.accessories = []

    // Iterate through the config accessories
    config.accessories.forEach((accessory) => {
      // Optionally hide the accessory from HomeKit
      if (accessory.ignore === true) return

      if (!accessory.type) throw new Error(`Each accessory must be configured with a "type". Currently only "smart-toilet-seat" is supported.`);

      if (!classTypes[accessory.type]) throw new Error(`homebridge-toilet-seat only supports accessories of type "smart-toilet-seat".`);

      const homeKitAccessory = new classTypes[accessory.type](log, accessory);

      accessories.push(homeKitAccessory);
    })
  }

  discoverToiletDevices () {
    const { config, log } = this;
    const { debug, hosts } = config;

    if (!hosts) {
      log(`\x1b[35m[INFO]\x1b[0m Automatically discovering IR devices for toilet seat.`)
      discoverDevices(true, log, debug, config.deviceDiscoveryTimeout);

      return;
    }
    
    discoverDevices(false, log, debug);

    log(`\x1b[35m[INFO]\x1b[0m Automatic IR device discovery has been disabled as the "hosts" option has been set.`)

    if (!Array.isArray(hosts)) {
      throw new Error(`hosts should be an array of objects.`);
    }
      
    hosts.forEach((host) => {
      if (typeof host !== 'object') {
        throw new Error(`Each item in the hosts array should be an object.`);
      }
      
      const { address, isRFSupported, mac } = host;
      if (!address) {
        throw new Error(`Each object in the hosts option should contain a value for address (e.g. "192.168.1.23").`);
      }
      if (!mac) {
        throw new Error(`Each object in the hosts option should contain a unique value for mac (e.g. "34:ea:34:e7:d7:28").`);
      }

      const deviceType = isRFSupported ? 0x279d : 0x2712;

      broadlink.addDevice({ address, port: 80 }, mac, deviceType);
    })
  }
}

ToiletSeatPlatform.setHomebridge = (homebridge) => {
  homebridgeRef = homebridge
}

module.exports = ToiletSeatPlatform
EOF

# Update main index.js
echo "🔧 Updating main index.js..."
cat > index.js << 'EOF'
const ToiletSeatPlatform = require('./platform')

module.exports = (homebridge) => {
  global.Service = homebridge.hap.Service;
  global.Characteristic = homebridge.hap.Characteristic;

  ToiletSeatPlatform.setHomebridge(homebridge);

  homebridge.registerPlatform("homebridge-toilet-seat", "IR-Toilet-Seat", ToiletSeatPlatform);
}
EOF

# Update package.json
echo "📦 Updating package.json..."
cat > package.json << 'EOF'
{
  "name": "homebridge-toilet-seat",
  "version": "1.0.0",
  "description": "Smart toilet seat plugin for homebridge with IR control via Broadlink devices",
  "license": "ISC",
  "keywords": [
    "homebridge-plugin",
    "toilet-seat",
    "smart-toilet",
    "broadlink",
    "infrared"
  ],
  "engines": {
    "node": ">=7.6.0",
    "homebridge": ">=0.2.0"
  },
  "author": {
    "name": "homebridge-toilet-seat"
  },
  "repository": {
    "type": "git",
    "url": "git@github.com:your-username/homebridge-toilet-seat.git"
  },
  "dependencies": {
    "broadlinkjs-rm": "^0.7.6",
    "homebridge-platform-helper": "lprhodes/homebridge-platform-helper#feature/typescript",
    "uuid": "^3.3.3"
  }
}
EOF

# Create toilet-seat specific config sample
echo "📋 Creating toilet seat config sample..."
cat > config-sample.json << 'EOF'
{
  "bridge":{
    "name":"Homebridge",
    "username":"CD:22:3D:E3:CE:30",
    "port":51826,
    "pin":"031-45-156"
  },
  "description":"Homebridge with Smart Toilet Seat",
  "accessories":[

  ],
  "platforms":[
    {
      "platform":"IR-Toilet-Seat",
      "name":"Smart Toilet Seat Platform",
      "accessories":[
        {
          "name":"Smart Toilet Seat",
          "type":"smart-toilet-seat",
          "powerName": "Power",
          "powerSaveName": "Power Save",
          "showerName": "Shower",
          "bidetName": "Bidet",
          "dryName": "Dry",
          "data":{
            "powerOn":"2600500000012...",
            "powerOff":"2600500000012...",
            "powerSaveOn":"2600500000012...",
            "powerSaveOff":"2600500000012...",
            "showerOn":"2600500000012...",
            "showerOff":"2600500000012...",
            "bidetOn":"2600500000012...",
            "bidetOff":"2600500000012...",
            "dryOn":"2600500000012...",
            "dryOff":"2600500000012..."
          }
        }
      ]
    }
  ]
}
EOF

# Remove old config files
echo "🗑️  Removing old config files..."
rm -f config-multiple-rm-devices-sample.json

# Update README
echo "📖 Updating README..."
cat > README.md << 'EOF'
# Homebridge Smart Toilet Seat

## Introduction
Welcome to the Smart Toilet Seat plugin for [Homebridge](https://github.com/nfarina/homebridge).

This plugin allows you to control your smart toilet seat with HomeKit using the Home app and Siri via IR commands sent through Broadlink devices.

## Features
- **Power Control**: Turn toilet seat on/off
- **Power Save Mode**: Enable/disable power save functionality  
- **Shower Function**: Control shower/cleansing function with auto-off after 60 seconds
- **Bidet Function**: Control bidet function with auto-off after 60 seconds
- **Dry Function**: Control drying function with auto-off after 60 seconds

## Installation

1. Install homebridge if you haven't already
2. Install this plugin: `npm install -g homebridge-toilet-seat`
3. Update your configuration file

## Configuration

Add the following to your homebridge config.json:

```json
{
  "platforms": [
    {
      "platform": "IR-Toilet-Seat",
      "name": "Smart Toilet Seat Platform",
      "accessories": [
        {
          "name": "Smart Toilet Seat",
          "type": "smart-toilet-seat",
          "powerName": "Power",
          "powerSaveName": "Power Save",
          "showerName": "Shower", 
          "bidetName": "Bidet",
          "dryName": "Dry",
          "data": {
            "powerOn": "YOUR_POWER_ON_HEX_CODE",
            "powerOff": "YOUR_POWER_OFF_HEX_CODE",
            "powerSaveOn": "YOUR_POWER_SAVE_ON_HEX_CODE",
            "powerSaveOff": "YOUR_POWER_SAVE_OFF_HEX_CODE",
            "showerOn": "YOUR_SHOWER_ON_HEX_CODE",
            "showerOff": "YOUR_SHOWER_OFF_HEX_CODE",
            "bidetOn": "YOUR_BIDET_ON_HEX_CODE",
            "bidetOff": "YOUR_BIDET_OFF_HEX_CODE",
            "dryOn": "YOUR_DRY_ON_HEX_CODE",
            "dryOff": "YOUR_DRY_OFF_HEX_CODE"
          }
        }
      ]
    }
  ]
}
```

## Learning IR Codes

You'll need to capture the IR codes from your toilet seat's remote control. You can use the original homebridge-broadlink-rm plugin temporarily to learn codes, or use other IR learning tools.

## License
ISC
EOF

# Remove temporary files
echo "🧹 Cleaning up temporary files..."
rm -f paste.txt paste-2.txt 2>/dev/null || true

echo ""
echo "✅ Toilet Seat Project Cleanup Complete!"
echo ""
echo "📁 Files kept:"
echo "   - accessories/accessory.js (base class)"
echo "   - accessories/smartToiletSeat.js (toilet seat implementation)"
echo "   - accessories/index.js (exports)"
echo "   - helpers/broadlink.js"
echo "   - helpers/sendData.js" 
echo "   - helpers/delayForDuration.js"
echo "   - helpers/getDevice.js"
echo "   - helpers/errors.js"
echo "   - helpers/catchDelayCancelError.js"
echo "   - platform.js (toilet seat platform)"
echo "   - index.js (main entry point)"
echo "   - package.json (updated)"
echo "   - config-sample.json (toilet seat specific)"
echo "   - README.md (updated)"
echo ""
echo "🗑️  Files removed:"
echo "   - All other accessory types"
echo "   - Test directory"
echo "   - Unnecessary helper files"
echo "   - Old config samples"
echo ""
echo "🚽 Your project is now focused solely on toilet seat functionality!"
echo "📝 Next steps:"
echo "   1. Review the config-sample.json"
echo "   2. Add your actual IR hex codes"
echo "   3. Test the functionality"
echo "   4. Publish to npm if desired"